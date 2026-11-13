import { TorusBody3D } from '../physics3d/TorusBody3D';
import { TankBounds3D } from '../physics3d/TorusContactDetect';
import { SeededRandom } from '../util/SeededRandom';

export interface SoakBotOptions {
    enabled: boolean;
    stepsPerFrame: number;
    seed: number;
    muteSfx: boolean;
}

export interface SoakRingSnapshot {
    id: number;
    kind: string;
    color?: string;
    locked: boolean;
    clearing: boolean;
    isDropping: boolean;
    dropTargetY?: number;
    body: Readonly<
        Pick<
            TorusBody3D,
            | 'x'
            | 'y'
            | 'z'
            | 'vx'
            | 'vy'
            | 'vz'
            | 'wx'
            | 'wy'
            | 'wz'
            | 'quat'
            | 'basisU'
            | 'basisV'
            | 'basisN'
            | 'majorRadius'
            | 'tubeRadius'
        >
    >;
}

export type SoakViolationRule =
    | 'invalid_number'
    | 'out_of_tank'
    | 'locked_drift'
    | 'ring_count_mismatch';

export interface SoakViolation {
    rule: SoakViolationRule;
    ruleLabel: string;
    simTimeSec: number;
    roundIndex: number;
    levelId: string;
    ringIndex: number;
    ringId: number;
    ringDesc: string;
    detail: string;
}

export interface SoakCheckerConfig {
    /** 缸壁容差（像素），允许 120Hz 碰撞瞬间微小穿透压缩，同时抓出穿墙逃逸 */
    wallTolerancePx?: number;
    /** 已锁定圈位置与四元数允许的浮点漂移误差 */
    lockedDriftEps?: number;
}

interface LockedBaseline {
    x: number;
    y: number;
    z: number;
    qx: number;
    qy: number;
    qz: number;
    qw: number;
    wasDropping: boolean;
    lastY: number;
}

const DEFAULT_STEPS_PER_FRAME = 8;
const MAX_STEPS_PER_FRAME = 20;
const DEFAULT_BOT_SEED = 2026001;
const DEFAULT_WALL_TOLERANCE_PX = 10;
const DEFAULT_LOCKED_DRIFT_EPS = 1e-4;

const RULE_LABELS: Record<SoakViolationRule, string> = {
    invalid_number: '无效数字（NaN/Infinity）',
    out_of_tank: '圈超出三维水缸边界',
    locked_drift: '已锁定圈发生位移或姿态漂移',
    ring_count_mismatch: '圈的总数异常变化',
};

const CIRCLE_SAMPLE_COUNT = 16;
const CIRCLE_COS: number[] = [];
const CIRCLE_SIN: number[] = [];
for (let i = 0; i < CIRCLE_SAMPLE_COUNT; i++) {
    const theta = (i / CIRCLE_SAMPLE_COUNT) * Math.PI * 2;
    CIRCLE_COS.push(Math.cos(theta));
    CIRCLE_SIN.push(Math.sin(theta));
}

/** 安全解析 URL 查询参数（如 `?bot=1&botSpeed=8&botSeed=2026&botSfx=0`） */
export function parseSoakBotOptions(search: string | null | undefined): SoakBotOptions {
    const defaults: SoakBotOptions = {
        enabled: false,
        stepsPerFrame: DEFAULT_STEPS_PER_FRAME,
        seed: DEFAULT_BOT_SEED,
        muteSfx: true,
    };

    if (!search || typeof search !== 'string') {
        return defaults;
    }
    const trimmed = search.startsWith('?') ? search.slice(1) : search;
    if (!trimmed) {
        return defaults;
    }

    const pairs = trimmed.split('&');
    for (let i = 0; i < pairs.length; i++) {
        const part = pairs[i];
        if (!part) {
            continue;
        }
        const eqIdx = part.indexOf('=');
        const rawKey = eqIdx >= 0 ? part.slice(0, eqIdx) : part;
        const rawVal = eqIdx >= 0 ? part.slice(eqIdx + 1) : '';
        let key: string;
        let val: string;
        try {
            key = decodeURIComponent(rawKey).trim();
            val = decodeURIComponent(rawVal.replace(/\+/g, ' ')).trim();
        } catch {
            continue;
        }

        if (key === 'bot') {
            defaults.enabled = val === '1' || val.toLowerCase() === 'true';
        } else if (key === 'botSpeed') {
            const parsed = Number(val);
            if (Number.isFinite(parsed) && parsed >= 1) {
                defaults.stepsPerFrame = Math.min(MAX_STEPS_PER_FRAME, Math.max(1, Math.round(parsed)));
            }
        } else if (key === 'botSeed') {
            const parsed = Number(val);
            if (Number.isFinite(parsed)) {
                defaults.seed = Math.floor(parsed) >>> 0;
            }
        } else if (key === 'botSfx') {
            defaults.muteSfx = !(val === '1' || val.toLowerCase() === 'true');
        }
    }

    return defaults;
}

/** 将累计模拟秒数格式化为 MM:SS（如 30:00） */
export function formatSoakElapsed(totalSec: number): string {
    const safeSec = Number.isFinite(totalSec) && totalSec > 0 ? Math.floor(totalSec) : 0;
    const minutes = Math.floor(safeSec / 60);
    const seconds = safeSec % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export interface SoakInputState {
    leftPressed: boolean;
    rightPressed: boolean;
}

export interface SoakBotTankHint {
    leftFreeCount: number;
    rightFreeCount: number;
    leftNozzleZoneCount: number;
    rightNozzleZoneCount: number;
    ringHoveringOverPillar: boolean;
    hasHeavyFreeRing: boolean;
}

export interface SoakPillarHintTarget {
    x: number;
    baseTopY: number;
    tipY: number;
    isFull: boolean;
}

/** 根据当前自由圈分布生成轻量观察提示，供挂机机器人更有针对性地把圈冲上柱子 */
export function buildSoakBotTankHint(
    rings: readonly SoakRingSnapshot[],
    tankWidth: number,
    pillars: readonly SoakPillarHintTarget[],
): SoakBotTankHint {
    const midX = tankWidth * 0.5;
    const leftZoneX = tankWidth * 0.28;
    const rightZoneX = tankWidth * 0.72;
    let leftFreeCount = 0;
    let rightFreeCount = 0;
    let leftNozzleZoneCount = 0;
    let rightNozzleZoneCount = 0;
    let ringHoveringOverPillar = false;
    let hasHeavyFreeRing = false;

    for (let i = 0; i < rings.length; i++) {
        const r = rings[i];
        if (r.locked || r.clearing) {
            continue;
        }
        if (r.body.x < midX) {
            leftFreeCount++;
        } else {
            rightFreeCount++;
        }
        if (r.body.x < leftZoneX) {
            leftNozzleZoneCount++;
        } else if (r.body.x > rightZoneX) {
            rightNozzleZoneCount++;
        }
        if (r.kind === 'iron') {
            hasHeavyFreeRing = true;
        }
        for (let p = 0; p < pillars.length; p++) {
            const pil = pillars[p];
            if (pil.isFull) {
                continue;
            }
            const dx = Math.abs(r.body.x - pil.x);
            const dz = Math.abs(r.body.z);
            if (
                dx < r.body.majorRadius * 0.95 &&
                dz < r.body.majorRadius * 0.95 &&
                r.body.y >= pil.baseTopY - 8 &&
                r.body.y <= pil.tipY + r.body.majorRadius * 2.2
            ) {
                ringHoveringOverPillar = true;
            }
        }
    }

    return {
        leftFreeCount,
        rightFreeCount,
        leftNozzleZoneCount,
        rightNozzleZoneCount,
        ringHoveringOverPillar,
        hasHeavyFreeRing,
    };
}

interface ScheduledPulse {
    left: boolean;
    right: boolean;
    pressSec: number;
    releaseSec: number;
}

/**
 * 确定性拟真自动按键生成器（纯逻辑，仅使用 SeededRandom）：
 * 交替覆盖轻点微调、连点半回充、中等按压、按满一口气造全缸环流、双侧协同以及留白落定窗口。
 */
export class SoakBotInputGenerator {
    private rng: SeededRandom;
    private readonly queue: ScheduledPulse[] = [];
    private current: ScheduledPulse | null = null;
    private phase: 'press' | 'release' = 'press';
    private phaseElapsed = 0;

    private leftCount = 0;
    private rightCount = 0;

    constructor(seed: number = DEFAULT_BOT_SEED) {
        this.rng = new SeededRandom(seed);
    }

    get stats(): { leftPresses: number; rightPresses: number } {
        return { leftPresses: this.leftCount, rightPresses: this.rightCount };
    }

    /** 更换种子并清空队列 */
    reseed(seed: number): void {
        this.rng = new SeededRandom(seed);
        this.clearPending();
    }

    /** 清空当前按键动作但保留连续种子序列（重开新局时调用） */
    clearPending(): void {
        this.queue.length = 0;
        this.current = null;
        this.phase = 'press';
        this.phaseElapsed = 0;
    }

    step(dt: number, hint?: Readonly<SoakBotTankHint>): SoakInputState {
        if (!(dt > 0)) {
            return { leftPressed: false, rightPressed: false };
        }

        if (!this.current) {
            this.ensureQueue(hint);
            this.current = this.queue.shift() ?? null;
            this.phase = 'press';
            this.phaseElapsed = 0;
            if (this.current) {
                if (this.current.left) this.leftCount++;
                if (this.current.right) this.rightCount++;
            }
        }

        if (!this.current) {
            return { leftPressed: false, rightPressed: false };
        }

        let leftPressed = false;
        let rightPressed = false;

        if (this.phase === 'press') {
            leftPressed = this.current.left;
            rightPressed = this.current.right;
            this.phaseElapsed += dt;
            if (this.phaseElapsed >= this.current.pressSec) {
                if (this.current.releaseSec > 0) {
                    this.phase = 'release';
                    this.phaseElapsed = 0;
                } else {
                    this.current = null;
                }
            }
        } else {
            this.phaseElapsed += dt;
            if (this.phaseElapsed >= this.current.releaseSec) {
                this.current = null;
            }
        }

        return { leftPressed, rightPressed };
    }

    private ensureQueue(hint?: Readonly<SoakBotTankHint>): void {
        if (this.queue.length > 0) {
            return;
        }

        if (hint?.ringHoveringOverPillar && this.rng.next() < 0.65) {
            this.queue.push({
                left: false,
                right: false,
                pressSec: 0,
                releaseSec: this.rng.range(0.38, 0.62),
            });
            return;
        }

        let leftProb = 0.5;
        let inNozzleZone = false;
        if (hint) {
            if (hint.leftNozzleZoneCount > hint.rightNozzleZoneCount) {
                leftProb = 0.85;
                inNozzleZone = true;
            } else if (hint.rightNozzleZoneCount > hint.leftNozzleZoneCount) {
                leftProb = 0.15;
                inNozzleZone = true;
            } else if (hint.leftFreeCount > hint.rightFreeCount) {
                leftProb = 0.72;
            } else if (hint.rightFreeCount > hint.leftFreeCount) {
                leftProb = 0.28;
            }
        }
        const preferLeft = this.rng.next() < leftProb;
        const roll = this.rng.next();

        if (roll < (inNozzleZone ? 0.26 : 0.16)) {
            // 轻点微调（0.08–0.15s）后观察落柱窗口
            this.queue.push({
                left: preferLeft,
                right: !preferLeft,
                pressSec: this.rng.range(0.08, 0.15),
                releaseSec: this.rng.range(0.32, 0.58),
            });
        } else if (roll < (inNozzleZone ? 0.40 : 0.28)) {
            // 极快连点（测试气囊未吸满衰减），末尾留出落柱静置窗
            const count = 2 + this.rng.int(2);
            for (let i = 0; i < count; i++) {
                this.queue.push({
                    left: preferLeft,
                    right: !preferLeft,
                    pressSec: this.rng.range(0.08, 0.13),
                    releaseSec: i < count - 1 ? this.rng.range(0.09, 0.14) : this.rng.range(0.42, 0.72),
                });
            }
        } else if (roll < (inNozzleZone ? 0.68 : 0.48)) {
            // 中等按压（把海眼区圈精准推上近柱）
            this.queue.push({
                left: preferLeft,
                right: !preferLeft,
                pressSec: this.rng.range(0.24, 0.44),
                releaseSec: this.rng.range(0.45, 0.80),
            });
        } else if (roll < (hint?.hasHeavyFreeRing ? 0.86 : 0.80)) {
            // 按满一口气（0.58–0.68s）冲高跨柱 + 充分回充与落柱观察
            this.queue.push({
                left: preferLeft,
                right: !preferLeft,
                pressSec: this.rng.range(0.58, 0.68),
                releaseSec: this.rng.range(0.45, 0.85),
            });
        } else if (roll < 0.92) {
            // 单侧连按造环流（2–3 次泵水把底圈/远圈送到对侧柱上方，随后停手等落锁）
            const count = 2 + this.rng.int(2);
            for (let i = 0; i < count; i++) {
                this.queue.push({
                    left: preferLeft,
                    right: !preferLeft,
                    pressSec: this.rng.range(0.35, 0.62),
                    releaseSec: i < count - 1 ? this.rng.range(0.22, 0.28) : this.rng.range(0.55, 0.92),
                });
            }
        } else if (roll < 0.96) {
            // 双侧同时协同喷水（高能对撞）+ 观察落柱
            this.queue.push({
                left: true,
                right: true,
                pressSec: this.rng.range(0.22, 0.48),
                releaseSec: this.rng.range(0.42, 0.75),
            });
        } else {
            // 较长静水窗口（确保柱上圈稳妥完成 0.3s 锁定与连锁判定）
            this.queue.push({
                left: false,
                right: false,
                pressSec: 0,
                releaseSec: this.rng.range(0.65, 1.10),
            });
        }
    }
}

function formatRingDesc(index: number, ring: SoakRingSnapshot): string {
    const label = ring.kind === 'normal' ? `normal:${ring.color ?? '?'}` : ring.kind;
    const b = ring.body;
    const fx = Number.isFinite(b.x) ? b.x.toFixed(1) : String(b.x);
    const fy = Number.isFinite(b.y) ? b.y.toFixed(1) : String(b.y);
    const fz = Number.isFinite(b.z) ? b.z.toFixed(1) : String(b.z);
    return `#${index}(id=${ring.id},${label}) @ (${fx},${fy},${fz})`;
}

/**
 * 挂机四项物理与规则不变量检查器（纯逻辑）：
 * 1. body3D 的 (x, y, z) 与 quat 没有出现 NaN / Infinity / 零四元数；
 * 2. 所有圈都在三维水缸内（含六面墙壁与左右底角圆弧柱面）；
 * 3. 已锁定的圈没有位移或姿态漂移（兼容下方圈消除后上方圈合法沿 Y 平滑下落）；
 * 4. 圈的总数没变（初始总圈数 === 场内存活有效圈数 + 已确认消除销毁圈数）。
 */
export class SoakInvariantChecker {
    private readonly wallTolerancePx: number;
    private readonly lockedDriftEps: number;

    private roundIndex = 1;
    private levelId = '';
    private initialTotalCount = 0;
    private clearedDestroyedCount = 0;
    private readonly authorizedClearingIds = new Set<number>();
    private readonly lockedBaselines = new Map<number, LockedBaseline>();
    private readonly presentIdScratch = new Set<number>();

    /** 记录运行过程中观测到的最大缸壁穿透深度（便于统计与阈值核验） */
    maxObservedWallPenetrationPx = 0;

    constructor(config: SoakCheckerConfig = {}) {
        this.wallTolerancePx = Math.max(0.5, config.wallTolerancePx ?? DEFAULT_WALL_TOLERANCE_PX);
        this.lockedDriftEps = Math.max(1e-7, config.lockedDriftEps ?? DEFAULT_LOCKED_DRIFT_EPS);
    }

    get stats(): {
        roundIndex: number;
        initialTotalCount: number;
        clearedDestroyedCount: number;
        pendingClearingCount: number;
        lockedBaselineCount: number;
    } {
        return {
            roundIndex: this.roundIndex,
            initialTotalCount: this.initialTotalCount,
            clearedDestroyedCount: this.clearedDestroyedCount,
            pendingClearingCount: this.authorizedClearingIds.size,
            lockedBaselineCount: this.lockedBaselines.size,
        };
    }

    /** 开始新的一局时调用，记录初始圈总数并重置本局账本 */
    beginRound(roundIndex: number, levelId: string, rings: readonly SoakRingSnapshot[]): void {
        this.roundIndex = roundIndex;
        this.levelId = levelId;
        this.initialTotalCount = rings.length;
        this.clearedDestroyedCount = 0;
        this.authorizedClearingIds.clear();
        this.lockedBaselines.clear();
    }

    /** 当 ScoreJudge 触发合法同款消除时登记即将闪烁销毁的圈 ID（避免消除销毁误报） */
    markMatchCleared(ringIds: readonly number[]): void {
        for (let i = 0; i < ringIds.length; i++) {
            this.authorizedClearingIds.add(ringIds[i]);
        }
    }

    /** 在每个固定物理步之后检查全部四条不变量；通过返回 null，失败返回定位信息 */
    checkStep(
        simTimeSec: number,
        tank: Readonly<TankBounds3D>,
        rings: readonly SoakRingSnapshot[],
        worldBodyCount?: number,
    ): SoakViolation | null {
        this.presentIdScratch.clear();
        let activeWorldRingCount = 0;

        for (let i = 0; i < rings.length; i++) {
            const ring = rings[i];
            this.presentIdScratch.add(ring.id);
            if (!ring.clearing) {
                activeWorldRingCount++;
            }

            // 检查 1：无效数字（NaN / Infinity）与退化四元数
            const invalidViolation = this.checkFiniteNumbers(simTimeSec, i, ring);
            if (invalidViolation) {
                return invalidViolation;
            }

            // 检查 2：三维水缸边界（含左右底角圆弧）
            const boundsViolation = this.checkInsideTank3D(simTimeSec, tank, i, ring);
            if (boundsViolation) {
                return boundsViolation;
            }

            // 检查 3：已锁定圈无位移或姿态漂移（兼容消除平滑下落）
            const driftViolation = this.checkLockedDrift(simTimeSec, i, ring);
            if (driftViolation) {
                return driftViolation;
            }
        }

        // 检查 4：圈总数守恒（存活圈 + 合法消除销毁圈 === 初始总圈数）
        return this.checkRingConservation(simTimeSec, rings, activeWorldRingCount, worldBodyCount);
    }

    private buildViolation(
        rule: SoakViolationRule,
        simTimeSec: number,
        ringIndex: number,
        ringId: number,
        ringDesc: string,
        detail: string,
    ): SoakViolation {
        return {
            rule,
            ruleLabel: RULE_LABELS[rule],
            simTimeSec,
            roundIndex: this.roundIndex,
            levelId: this.levelId,
            ringIndex,
            ringId,
            ringDesc,
            detail,
        };
    }

    private checkFiniteNumbers(
        simTimeSec: number,
        ringIndex: number,
        ring: SoakRingSnapshot,
    ): SoakViolation | null {
        const b = ring.body;
        const q = b.quat;
        const allFinite =
            Number.isFinite(b.x) &&
            Number.isFinite(b.y) &&
            Number.isFinite(b.z) &&
            Number.isFinite(q.x) &&
            Number.isFinite(q.y) &&
            Number.isFinite(q.z) &&
            Number.isFinite(q.w) &&
            Number.isFinite(b.vx) &&
            Number.isFinite(b.vy) &&
            Number.isFinite(b.vz) &&
            Number.isFinite(b.wx) &&
            Number.isFinite(b.wy) &&
            Number.isFinite(b.wz);

        if (!allFinite) {
            return this.buildViolation(
                'invalid_number',
                simTimeSec,
                ringIndex,
                ring.id,
                formatRingDesc(ringIndex, ring),
                `坐标/四元数/速度出现非有限值 pos=(${b.x},${b.y},${b.z}) quat=(${q.x},${q.y},${q.z},${q.w})`,
            );
        }

        const qLen = Math.hypot(q.x, q.y, q.z, q.w);
        if (qLen < 0.5 || qLen > 1.5) {
            return this.buildViolation(
                'invalid_number',
                simTimeSec,
                ringIndex,
                ring.id,
                formatRingDesc(ringIndex, ring),
                `四元数长度异常 qLen=${qLen.toFixed(6)}`,
            );
        }
        return null;
    }

    private checkInsideTank3D(
        simTimeSec: number,
        tank: Readonly<TankBounds3D>,
        ringIndex: number,
        ring: SoakRingSnapshot,
    ): SoakViolation | null {
        const b = ring.body;
        const R = b.majorRadius;
        const r = b.tubeRadius;
        const tol = this.wallTolerancePx;

        // 中心不得越出六面体缸壁外沿
        if (
            b.x < -tol ||
            b.x > tank.width + tol ||
            b.y < -tol ||
            b.y > tank.height + tol ||
            b.z < -tank.halfDepth - tol ||
            b.z > tank.halfDepth + tol
        ) {
            return this.buildViolation(
                'out_of_tank',
                simTimeSec,
                ringIndex,
                ring.id,
                formatRingDesc(ringIndex, ring),
                `圆环中心脱离三维水缸 (${b.x.toFixed(2)}, ${b.y.toFixed(2)}, ${b.z.toFixed(2)})`,
            );
        }

        // 沿 3 轴投影的圆环外表面包络极值检查
        const nx = b.basisN.x;
        const ny = b.basisN.y;
        const nz = b.basisN.z;
        const extX = R * Math.sqrt(Math.max(0, 1 - nx * nx)) + r;
        const extY = R * Math.sqrt(Math.max(0, 1 - ny * ny)) + r;
        const extZ = R * Math.sqrt(Math.max(0, 1 - nz * nz)) + r;

        const penLeft = -(b.x - extX);
        const penRight = b.x + extX - tank.width;
        const penBottom = -(b.y - extY);
        const penTop = b.y + extY - tank.height;
        const penBack = -tank.halfDepth - (b.z - extZ);
        const penFront = b.z + extZ - tank.halfDepth;

        let maxPen = Math.max(penLeft, penRight, penBottom, penTop, penBack, penFront);

        // 左右底角圆弧边界采样检查（仅对进入圆弧象限的环周点检测）
        const cr = tank.cornerRadius;
        if (cr > 0 && (b.x - extX < cr || b.x + extX > tank.width - cr) && b.y - extY < cr) {
            const ux = b.basisU.x;
            const uy = b.basisU.y;
            const vx = b.basisV.x;
            const vy = b.basisV.y;
            const rightCx = tank.width - cr;
            const maxArcDist = cr - r;
            for (let s = 0; s < CIRCLE_SAMPLE_COUNT; s++) {
                const c = CIRCLE_COS[s];
                const sn = CIRCLE_SIN[s];
                const qx = b.x + R * (c * ux + sn * vx);
                const qy = b.y + R * (c * uy + sn * vy);
                if (qx < cr && qy < cr) {
                    const pen = Math.hypot(qx - cr, qy - cr) - maxArcDist;
                    if (pen > maxPen) maxPen = pen;
                } else if (qx > rightCx && qy < cr) {
                    const pen = Math.hypot(qx - rightCx, qy - cr) - maxArcDist;
                    if (pen > maxPen) maxPen = pen;
                }
            }
        }

        if (maxPen > this.maxObservedWallPenetrationPx) {
            this.maxObservedWallPenetrationPx = maxPen;
        }

        if (maxPen > tol) {
            return this.buildViolation(
                'out_of_tank',
                simTimeSec,
                ringIndex,
                ring.id,
                formatRingDesc(ringIndex, ring),
                `圆环管壁穿透水缸边界 maxPen=${maxPen.toFixed(2)}px > tol=${tol}px`,
            );
        }

        return null;
    }

    private checkLockedDrift(
        simTimeSec: number,
        ringIndex: number,
        ring: SoakRingSnapshot,
    ): SoakViolation | null {
        const baseline = this.lockedBaselines.get(ring.id);

        if (ring.clearing) {
            this.lockedBaselines.delete(ring.id);
            return null;
        }

        if (!ring.locked) {
            if (baseline) {
                return this.buildViolation(
                    'locked_drift',
                    simTimeSec,
                    ringIndex,
                    ring.id,
                    formatRingDesc(ringIndex, ring),
                    '已锁定的圈在未重开/未消除的情况下异常恢复为未锁定状态',
                );
            }
            return null;
        }

        const b = ring.body;
        const q = b.quat;

        if (!baseline) {
            this.lockedBaselines.set(ring.id, {
                x: b.x,
                y: b.y,
                z: b.z,
                qx: q.x,
                qy: q.y,
                qz: q.z,
                qw: q.w,
                wasDropping: ring.isDropping,
                lastY: b.y,
            });
            return null;
        }

        const eps = this.lockedDriftEps;
        const dx = Math.abs(b.x - baseline.x);
        const dz = Math.abs(b.z - baseline.z);
        if (dx > eps || dz > eps) {
            return this.buildViolation(
                'locked_drift',
                simTimeSec,
                ringIndex,
                ring.id,
                formatRingDesc(ringIndex, ring),
                `已锁定圈发生 X/Z 横向位移 dx=${dx.toFixed(5)} dz=${dz.toFixed(5)}`,
            );
        }

        // 四元数校验（兼容 q 与 -q 同姿态）
        const dot = Math.abs(q.x * baseline.qx + q.y * baseline.qy + q.z * baseline.qz + q.w * baseline.qw);
        if (1 - dot > 1e-6) {
            return this.buildViolation(
                'locked_drift',
                simTimeSec,
                ringIndex,
                ring.id,
                formatRingDesc(ringIndex, ring),
                `已锁定圈发生三维姿态漂移 1-|dot|=${(1 - dot).toExponential(3)}`,
            );
        }

        if (ring.isDropping) {
            if (b.y > baseline.lastY + eps) {
                return this.buildViolation(
                    'locked_drift',
                    simTimeSec,
                    ringIndex,
                    ring.id,
                    formatRingDesc(ringIndex, ring),
                    `消除后合法下落期间圈异常上漂 y=${b.y.toFixed(3)} > prev=${baseline.lastY.toFixed(3)}`,
                );
            }
            if (ring.dropTargetY !== undefined && b.y < ring.dropTargetY - eps) {
                return this.buildViolation(
                    'locked_drift',
                    simTimeSec,
                    ringIndex,
                    ring.id,
                    formatRingDesc(ringIndex, ring),
                    `消除后合法下落超过目标槽位 y=${b.y.toFixed(3)} < target=${ring.dropTargetY.toFixed(3)}`,
                );
            }
            baseline.y = b.y;
            baseline.lastY = b.y;
            baseline.wasDropping = true;
            return null;
        }

        if (baseline.wasDropping) {
            // 合法下落刚在这一步结束，校验未反向上弹后落定新基准高度
            if (b.y > baseline.lastY + eps) {
                return this.buildViolation(
                    'locked_drift',
                    simTimeSec,
                    ringIndex,
                    ring.id,
                    formatRingDesc(ringIndex, ring),
                    `下落完成瞬间异常上漂 y=${b.y.toFixed(3)} > prev=${baseline.lastY.toFixed(3)}`,
                );
            }
            baseline.y = b.y;
            baseline.lastY = b.y;
            baseline.wasDropping = false;
            return null;
        }

        const dy = Math.abs(b.y - baseline.y);
        if (dy > eps) {
            return this.buildViolation(
                'locked_drift',
                simTimeSec,
                ringIndex,
                ring.id,
                formatRingDesc(ringIndex, ring),
                `已锁定静止圈发生竖直位移 dy=${dy.toFixed(5)} (y=${b.y.toFixed(3)} vs base=${baseline.y.toFixed(3)})`,
            );
        }

        return null;
    }

    private checkRingConservation(
        simTimeSec: number,
        rings: readonly SoakRingSnapshot[],
        activeWorldRingCount: number,
        worldBodyCount?: number,
    ): SoakViolation | null {
        for (let i = 0; i < rings.length; i++) {
            const ring = rings[i];
            if (ring.clearing && !this.authorizedClearingIds.has(ring.id)) {
                return this.buildViolation(
                    'ring_count_mismatch',
                    simTimeSec,
                    i,
                    ring.id,
                    formatRingDesc(i, ring),
                    `出现未通过消除事件登记的 clearing 圈 id=${ring.id}`,
                );
            }
        }

        for (const id of Array.from(this.authorizedClearingIds)) {
            if (!this.presentIdScratch.has(id)) {
                this.authorizedClearingIds.delete(id);
                this.clearedDestroyedCount++;
            }
        }

        const accountedTotal = rings.length + this.clearedDestroyedCount;
        if (accountedTotal !== this.initialTotalCount) {
            return this.buildViolation(
                'ring_count_mismatch',
                simTimeSec,
                -1,
                -1,
                '全局总数',
                `初始总圈数=${this.initialTotalCount} ≠ 当前存活(${rings.length}) + 已消除销毁(${this.clearedDestroyedCount}) = ${accountedTotal}`,
            );
        }

        if (worldBodyCount !== undefined && worldBodyCount !== activeWorldRingCount) {
            return this.buildViolation(
                'ring_count_mismatch',
                simTimeSec,
                -1,
                -1,
                '物理世界刚体总数',
                `TorusWorld3D.bodies=${worldBodyCount} ≠ 活跃非消除圈数=${activeWorldRingCount}`,
            );
        }

        return null;
    }
}
