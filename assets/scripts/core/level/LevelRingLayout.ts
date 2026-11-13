import { FeelConfig } from '../../config/FeelConfig';
import { calcRingPillarGeometry, GameConst } from '../../config/GameConst';
import { TankSpace } from '../../config/TankSpace';
import { PillarCollider3D, TaperedCapsule3D } from '../physics3d/PillarCollider3D';
import { getRingKindConfig, RingSpec } from '../rings/RingKinds';
import { SeededRandom } from '../util/SeededRandom';
import { LevelRingEntry } from './LevelData';

export interface LevelRingLayoutOptions {
    seed: number;
    tankWidth?: number;
    tankHeight?: number;
    pillarPosPct?: number;
    pillarBottomPct?: number;
    cornerRadius?: number;
    minGapPx?: number;
    /** 开局随机圈落向两根柱子之一的触发概率（默认 0.05，即约 5%） */
    startPillarDropChance?: number;
    /** 外部传入的开局落柱概率采样 [0, 1)；未传时由 seed 派生确定性采样 */
    startPillarDropRoll?: number;
    /** 外部传入的左右柱选择采样 [0, 1)；未传时由 seed 派生确定性采样 */
    startPillarSideRoll?: number;
    /** 外部传入的候选随机圈选择采样 [0, 1)；未传时由 seed 派生确定性采样 */
    startPillarRingRoll?: number;
}

export interface StartPillarDropSelection {
    ringIndex: number;
    side: 'left' | 'right';
}

export interface PickStartPillarDropOptions {
    candidateIndices: readonly number[];
    chance?: number;
    dropRoll: number;
    sideRoll: number;
    ringRoll: number;
}

export interface ResolvedLevelRingSpawn {
    index: number;
    spec: RingSpec;
    x: number;
    y: number;
    z: number;
    pitchXDeg: number;
    yawYDeg: number;
    rollZDeg: number;
    outerRadius: number;
    tubeRadius: number;
    fromRandom: boolean;
}

const WALL_MARGIN_PAD_PX = 6;
const PILLAR_DROP_CORRIDOR_PAD_PX = 18;
const RANDOM_ATTEMPTS_PER_RING = 120;
const GRID_SCAN_STEP_PX = 18;

function clamp(val: number, min: number, max: number): number {
    return val < min ? min : val > max ? max : val;
}

/** 计算二维点 (px, py) 到线段在 XY 平面上的最近距离与对应参数 t */
function distPointToSegmentXY(px: number, py: number, seg: TaperedCapsule3D): { dist: number; t: number } {
    const abx = seg.bx - seg.ax;
    const aby = seg.by - seg.ay;
    const lenSq = abx * abx + aby * aby;
    let t = 0;
    if (lenSq > 1e-8) {
        t = clamp(((px - seg.ax) * abx + (py - seg.ay) * aby) / lenSq, 0, 1);
    }
    const cx = seg.ax + abx * t;
    const cy = seg.ay + aby * t;
    return { dist: Math.hypot(px - cx, py - cy), t };
}

/** 计算二维点 (px, py) 到矩形 [minX, maxX] × [minY, maxY] 的最短距离 */
function distPointToAabbXY(px: number, py: number, minX: number, maxX: number, minY: number, maxY: number): number {
    const dx = px < minX ? minX - px : px > maxX ? px - maxX : 0;
    const dy = py < minY ? minY - py : py > maxY ? py - maxY : 0;
    return Math.hypot(dx, dy);
}

/** 判断圆心 (x, y) 半径 outerR 的圆是否完全处于带圆弧底角的矩形水缸之内 */
export function isCircleInsideTank(
    x: number,
    y: number,
    outerR: number,
    tankWidth: number,
    tankHeight: number,
    cornerRadius: number,
    pad = WALL_MARGIN_PAD_PX,
): boolean {
    const minMargin = outerR + pad;
    if (x < minMargin || x > tankWidth - minMargin || y < minMargin || y > tankHeight - minMargin) {
        return false;
    }

    const cr = Math.min(cornerRadius, tankWidth * 0.5, tankHeight * 0.5);
    if (cr > minMargin) {
        const safeArcR = cr - minMargin;
        if (x < cr && y < cr && Math.hypot(x - cr, y - cr) > safeArcR) {
            return false;
        }
        const rightCx = tankWidth - cr;
        if (x > rightCx && y < cr && Math.hypot(x - rightCx, y - cr) > safeArcR) {
            return false;
        }
    }

    return true;
}

/** 判断指定位置与半径的圈是否与三段式锥形十字柱发生重叠 */
export function overlapsPillar2D(
    x: number,
    y: number,
    outerR: number,
    pillar: PillarCollider3D,
    gap: number = GameConst.levelRingSpawnGapPx,
): boolean {
    for (let i = 0; i < pillar.segments.length; i++) {
        const seg = pillar.segments[i];
        const { dist, t } = distPointToSegmentXY(x, y, seg);
        const segRadius = seg.radiusA + (seg.radiusB - seg.radiusA) * t;
        if (dist < outerR + segRadius + gap) {
            return true;
        }
    }

    const crossHalfW = Math.max(pillar.visualCrossHalfWidth, pillar.crossHalfWidth);
    const crossDist = distPointToAabbXY(
        x,
        y,
        pillar.x - crossHalfW,
        pillar.x + crossHalfW,
        pillar.crossBottomY,
        pillar.baseTopY,
    );
    return crossDist < outerR + gap;
}

/**
 * 判断随机出生点是否处于柱子上方（含柱身段）的垂直落柱通道内：
 * 避免普通随机圈开局不经玩家操作就顺重力直接套上柱子。
 */
export function isInPillarDropCorridor(
    x: number,
    y: number,
    outerR: number,
    pillar: PillarCollider3D,
    gap: number = GameConst.levelRingSpawnGapPx,
): boolean {
    if (y < pillar.crossBottomY - outerR - gap) {
        return false;
    }
    return Math.abs(x - pillar.x) < outerR + PILLAR_DROP_CORRIDOR_PAD_PX;
}

/**
 * 开局随机圈落柱概率函数（默认约 5%，即 100 局约 5 局会有一个随机圈落入左右柱之一）：
 * - `dropRoll < chance` 且存在未受困随机圈时，等概率选中 `'left'` 或 `'right'` 柱及一枚随机圈；
 * - 其余约 95% 情况返回 `null`。
 */
export function pickStartPillarDrop(options: PickStartPillarDropOptions): StartPillarDropSelection | null {
    const chance = options.chance ?? GameConst.startPillarDropChance;
    const candidates = options.candidateIndices;
    if (!Number.isFinite(chance) || chance <= 0 || candidates.length === 0) {
        return null;
    }
    if (!(options.dropRoll >= 0 && options.dropRoll < chance)) {
        return null;
    }
    const side: 'left' | 'right' = options.sideRoll < 0.5 ? 'left' : 'right';
    const clampedRingRoll = Math.min(
        0.999999999,
        Math.max(0, Number.isFinite(options.ringRoll) ? options.ringRoll : 0),
    );
    const pickIdx = candidates[Math.floor(clampedRingRoll * candidates.length)];
    return { ringIndex: pickIdx, side };
}

/** 将显式坐标夹紧到水缸内部（含左右圆弧底角），保证不落入墙外 */
function clampExplicitInsideTank(
    rawX: number,
    rawY: number,
    outerR: number,
    tubeR: number,
    tankWidth: number,
    tankHeight: number,
    cornerRadius: number,
): { x: number; y: number } {
    const pad = 4;
    let x = clamp(rawX, outerR + pad, tankWidth - outerR - pad);
    let y = clamp(rawY, tubeR + pad, tankHeight - outerR - pad);

    const cr = Math.min(cornerRadius, tankWidth * 0.5, tankHeight * 0.5);
    const minArcDist = cr - outerR - pad;
    if (cr > outerR + pad && minArcDist > 0) {
        if (x < cr && y < cr) {
            const dx = x - cr;
            const dy = y - cr;
            const dist = Math.hypot(dx, dy);
            if (dist > minArcDist && dist > 1e-6) {
                x = cr + (dx / dist) * minArcDist;
                y = cr + (dy / dist) * minArcDist;
            }
        } else if (x > tankWidth - cr && y < cr) {
            const rcx = tankWidth - cr;
            const dx = x - rcx;
            const dy = y - cr;
            const dist = Math.hypot(dx, dy);
            if (dist > minArcDist && dist > 1e-6) {
                x = rcx + (dx / dist) * minArcDist;
                y = cr + (dy / dist) * minArcDist;
            }
        }
    }

    return { x, y };
}

/**
 * 基于关卡种子确定性生成所有圈的初始缸坐标 (x, y) 与轻微 3D 姿态 (z, pitch, yaw, roll)：
 * - 显式指定 `{ xPct, yPct }` 的圈保留百分比位置并夹紧在缸内；
 * - 标为 `'random'` 的圈自动避开水缸墙、左右圆弧底角、左右三段式锥形十字柱 `PillarCollider3D` 以及其他已放好的圈；
 * - 全程使用 `SeededRandom(seed)`，相同种子产出 100% 一致的开局布局（纯逻辑，不依赖引擎）。
 */
export function resolveLevelRingLayout(
    rings: readonly LevelRingEntry[],
    options: LevelRingLayoutOptions,
): ResolvedLevelRingSpawn[] {
    const tankWidth = options.tankWidth ?? TankSpace.width;
    const tankHeight = options.tankHeight ?? TankSpace.height;
    const pillarPosPct = options.pillarPosPct ?? FeelConfig.pillarPosPct;
    const pillarBottomPct = options.pillarBottomPct ?? FeelConfig.pillarBottomPct;
    const cornerRadius = options.cornerRadius ?? GameConst.tankCornerRadius;
    const minGapPx: number = options.minGapPx ?? GameConst.levelRingSpawnGapPx;

    const geom = calcRingPillarGeometry(tankWidth);
    const tailBottomY = (pillarBottomPct / 100) * tankHeight;
    const leftPillar = new PillarCollider3D((pillarPosPct / 100) * tankWidth, tailBottomY, geom);
    const rightPillar = new PillarCollider3D(((100 - pillarPosPct) / 100) * tankWidth, tailBottomY, geom);

    const rng = new SeededRandom(options.seed ^ 0x5f3759df);
    const placed: ResolvedLevelRingSpawn[] = [];
    const results = new Array<ResolvedLevelRingSpawn>(rings.length);

    const computeDims = (spec: RingSpec) => {
        const cfg = getRingKindConfig(spec);
        const outerDiameter = geom.ringOuterDiameter * cfg.sizeScale;
        const thickness = geom.ringThickness * cfg.sizeScale;
        return {
            outerRadius: outerDiameter * 0.5,
            tubeRadius: thickness * 0.5,
        };
    };

    const nextPose = (outerR: number, angleDeg?: number) => {
        const maxSafeZ = Math.max(4, geom.tankDepth * 0.5 - outerR - 2);
        const z = rng.range(-maxSafeZ * 0.75, maxSafeZ * 0.75);
        const pitchXDeg = rng.range(-22, 22);
        const yawYDeg = rng.range(0, 360);
        const rollZDeg = angleDeg !== undefined ? angleDeg : rng.range(-18, 18);
        return { z, pitchXDeg, yawYDeg, rollZDeg };
    };

    // 第一遍：先固定显式百分比位置的圈，确保后续随机圈能避开它们
    const randomCandidates: number[] = [];
    for (let i = 0; i < rings.length; i++) {
        const entry = rings[i];
        if (entry.pos === 'random') {
            if (!entry.trappedBy) {
                randomCandidates.push(i);
            }
            continue;
        }
        const spec: RingSpec = { kind: entry.kind, color: entry.color };
        const { outerRadius, tubeRadius } = computeDims(spec);
        const rawX = (entry.pos.xPct / 100) * tankWidth;
        const rawY = (entry.pos.yPct / 100) * tankHeight;
        const clamped = clampExplicitInsideTank(rawX, rawY, outerRadius, tubeRadius, tankWidth, tankHeight, cornerRadius);
        const pose = nextPose(outerRadius, entry.angleDeg);

        const spawn: ResolvedLevelRingSpawn = {
            index: i,
            spec,
            x: clamped.x,
            y: clamped.y,
            ...pose,
            outerRadius,
            tubeRadius,
            fromRandom: false,
        };
        placed.push(spawn);
        results[i] = spawn;
    }

    const defaultDropRoll = rng.next();
    const defaultSideRoll = rng.next();
    const defaultRingRoll = rng.next();
    const startDrop = pickStartPillarDrop({
        candidateIndices: randomCandidates,
        chance: options.startPillarDropChance,
        dropRoll: options.startPillarDropRoll ?? defaultDropRoll,
        sideRoll: options.startPillarSideRoll ?? defaultSideRoll,
        ringRoll: options.startPillarRingRoll ?? defaultRingRoll,
    });

    if (startDrop) {
        const entry = rings[startDrop.ringIndex];
        const spec: RingSpec = { kind: entry.kind, color: entry.color };
        const { outerRadius, tubeRadius } = computeDims(spec);
        const targetPillar = startDrop.side === 'left' ? leftPillar : rightPillar;
        const dropX = clamp(
            targetPillar.x + rng.range(-3.5, 3.5),
            outerRadius + WALL_MARGIN_PAD_PX,
            tankWidth - outerRadius - WALL_MARGIN_PAD_PX,
        );
        const dropY = clamp(
            targetPillar.tipY + outerRadius + 16,
            targetPillar.tipY + outerRadius + minGapPx,
            tankHeight - outerRadius - WALL_MARGIN_PAD_PX,
        );
        const dropZ = rng.range(-2.5, 2.5);
        const spawn: ResolvedLevelRingSpawn = {
            index: startDrop.ringIndex,
            spec,
            x: dropX,
            y: dropY,
            z: dropZ,
            pitchXDeg: rng.range(-7, 7),
            yawYDeg: rng.range(0, 360),
            rollZDeg: entry.angleDeg !== undefined ? entry.angleDeg : rng.range(-7, 7),
            outerRadius,
            tubeRadius,
            fromRandom: true,
        };
        placed.push(spawn);
        results[startDrop.ringIndex] = spawn;
    }

    const isFreeSpot = (x: number, y: number, outerR: number): boolean => {
        if (!isCircleInsideTank(x, y, outerR, tankWidth, tankHeight, cornerRadius)) {
            return false;
        }
        if (overlapsPillar2D(x, y, outerR, leftPillar, minGapPx) || overlapsPillar2D(x, y, outerR, rightPillar, minGapPx)) {
            return false;
        }
        if (
            isInPillarDropCorridor(x, y, outerR, leftPillar, minGapPx) ||
            isInPillarDropCorridor(x, y, outerR, rightPillar, minGapPx)
        ) {
            return false;
        }
        for (let j = 0; j < placed.length; j++) {
            const other = placed[j];
            const minDist = outerR + other.outerRadius + minGapPx;
            if (Math.hypot(x - other.x, y - other.y) < minDist) {
                return false;
            }
        }
        return true;
    };

    const minClearanceScore = (x: number, y: number, outerR: number): number => {
        let minScore = Number.POSITIVE_INFINITY;
        for (let j = 0; j < placed.length; j++) {
            const other = placed[j];
            minScore = Math.min(minScore, Math.hypot(x - other.x, y - other.y) - (outerR + other.outerRadius));
        }
        return minScore;
    };

    // 第二遍：为剩余所有 'random' 圈生成无重叠且避开柱顶落柱通道的坐标与确定性 3D 姿态
    for (let i = 0; i < rings.length; i++) {
        const entry = rings[i];
        if (entry.pos !== 'random' || results[i]) {
            continue;
        }
        const spec: RingSpec = { kind: entry.kind, color: entry.color };
        const { outerRadius, tubeRadius } = computeDims(spec);

        const minX = outerRadius + WALL_MARGIN_PAD_PX + 2;
        const maxX = Math.max(minX + 1, tankWidth - outerRadius - WALL_MARGIN_PAD_PX - 2);
        const minY = outerRadius + WALL_MARGIN_PAD_PX + 4;
        const maxY = Math.max(minY + 1, Math.min(tankHeight - outerRadius - WALL_MARGIN_PAD_PX - 4, tankHeight * 0.68));

        let chosenX = (minX + maxX) * 0.5;
        let chosenY = minY + 40;
        let found = false;

        for (let attempt = 0; attempt < RANDOM_ATTEMPTS_PER_RING; attempt++) {
            const cx = rng.range(minX, maxX);
            const cy = rng.range(minY, maxY);
            if (isFreeSpot(cx, cy, outerRadius)) {
                chosenX = cx;
                chosenY = cy;
                found = true;
                break;
            }
        }

        // 兜底：若随机采样未能一次命中（例如极高密度），按网格确定性扫描找合法空位或最大间隙点
        if (!found) {
            const fullMaxY = Math.max(minY + 1, tankHeight - outerRadius - WALL_MARGIN_PAD_PX - 4);
            let bestClearance = -Number.POSITIVE_INFINITY;
            for (let gy = minY; gy <= fullMaxY && !found; gy += GRID_SCAN_STEP_PX) {
                for (let gx = minX; gx <= maxX; gx += GRID_SCAN_STEP_PX) {
                    if (isFreeSpot(gx, gy, outerRadius)) {
                        chosenX = gx;
                        chosenY = gy;
                        found = true;
                        break;
                    }
                    if (
                        isCircleInsideTank(gx, gy, outerRadius, tankWidth, tankHeight, cornerRadius) &&
                        !overlapsPillar2D(gx, gy, outerRadius, leftPillar, minGapPx) &&
                        !overlapsPillar2D(gx, gy, outerRadius, rightPillar, minGapPx) &&
                        !isInPillarDropCorridor(gx, gy, outerRadius, leftPillar, minGapPx) &&
                        !isInPillarDropCorridor(gx, gy, outerRadius, rightPillar, minGapPx)
                    ) {
                        const score = minClearanceScore(gx, gy, outerRadius);
                        if (score > bestClearance) {
                            bestClearance = score;
                            chosenX = gx;
                            chosenY = gy;
                        }
                    }
                }
            }
        }

        const pose = nextPose(outerRadius, entry.angleDeg);
        const spawn: ResolvedLevelRingSpawn = {
            index: i,
            spec,
            x: chosenX,
            y: chosenY,
            ...pose,
            outerRadius,
            tubeRadius,
            fromRandom: true,
        };
        placed.push(spawn);
        results[i] = spawn;
    }

    return results;
}
