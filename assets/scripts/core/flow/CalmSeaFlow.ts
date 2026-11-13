import { GameConst } from '../../config/GameConst';
import { TankSpace } from '../../config/TankSpace';
import { TorusBody3D } from '../physics3d/TorusBody3D';
import { RingKindConfig } from '../rings/RingKinds';
import { SolvedFeel } from './FeelSolver';
import { FlowTermObject, FlowVec2 } from './FlowField';

export interface CalmSeaFlowConfig {
    targetAboveTipPx: number;
    topMarginPx: number;
    warmFlowSpeed: number;
    warmFlowTaperSpanPx: number;
    turbulenceScale: number;
    circulationScale: number;
    riseMaxSpeedPx: number;
    riseMinSpeedPx: number;
    riseSlope: number;
    riseGain: number;
    maxRiseAccelPx: number;
    overshootDampRate: number;
    slowSinkSpeedPx: number;
    pillarSettleSinkSpeedPx: number;
    highDescentSpeedPx: number;
    bandTrackRate: number;
    maxBrakeDownRatio: number;
    reLiftOffsetPx: number;
    alignRate: number;
    spinDampRate: number;
    zCenterStiffness: number;
    zCenterDamping: number;
    pillarDetourAccelPx: number;
}

export interface CalmSeaPillarInfo {
    x: number;
    z?: number;
    baseTopY: number;
    tipY: number;
    isFull?: boolean;
}

export function buildCalmSeaFlowConfig(
    overrides: Partial<CalmSeaFlowConfig> = {},
): CalmSeaFlowConfig {
    return {
        targetAboveTipPx: Math.max(8, overrides.targetAboveTipPx ?? GameConst.calmSeaTargetAboveTipPx),
        topMarginPx: Math.max(8, overrides.topMarginPx ?? GameConst.calmSeaTopMarginPx),
        warmFlowSpeed: Math.max(0, overrides.warmFlowSpeed ?? GameConst.calmSeaWarmFlowSpeed),
        warmFlowTaperSpanPx: Math.max(10, overrides.warmFlowTaperSpanPx ?? GameConst.calmSeaWarmFlowTaperSpanPx),
        turbulenceScale: clamp01(overrides.turbulenceScale ?? GameConst.calmSeaTurbulenceScale),
        circulationScale: clamp01(overrides.circulationScale ?? GameConst.calmSeaCirculationScale),
        riseMaxSpeedPx: Math.max(20, overrides.riseMaxSpeedPx ?? GameConst.calmSeaRiseMaxSpeedPx),
        riseMinSpeedPx: Math.max(5, overrides.riseMinSpeedPx ?? GameConst.calmSeaRiseMinSpeedPx),
        riseSlope: Math.max(0.1, overrides.riseSlope ?? GameConst.calmSeaRiseSlope),
        riseGain: Math.max(0.5, overrides.riseGain ?? GameConst.calmSeaRiseGain),
        maxRiseAccelPx: Math.max(100, overrides.maxRiseAccelPx ?? GameConst.calmSeaMaxRiseAccelPx),
        overshootDampRate: Math.max(0, overrides.overshootDampRate ?? GameConst.calmSeaOvershootDampRate),
        slowSinkSpeedPx: Math.max(1, overrides.slowSinkSpeedPx ?? GameConst.calmSeaSlowSinkSpeedPx),
        pillarSettleSinkSpeedPx: Math.max(
            1,
            overrides.pillarSettleSinkSpeedPx ?? GameConst.calmSeaPillarSettleSinkSpeedPx,
        ),
        highDescentSpeedPx: Math.max(5, overrides.highDescentSpeedPx ?? GameConst.calmSeaHighDescentSpeedPx),
        bandTrackRate: Math.max(1, overrides.bandTrackRate ?? GameConst.calmSeaBandTrackRate),
        maxBrakeDownRatio: clamp01(overrides.maxBrakeDownRatio ?? GameConst.calmSeaMaxBrakeDownRatio),
        reLiftOffsetPx: Math.max(10, overrides.reLiftOffsetPx ?? GameConst.calmSeaReLiftOffsetPx),
        alignRate: Math.max(0.5, overrides.alignRate ?? GameConst.calmSeaAlignRate),
        spinDampRate: Math.max(0, overrides.spinDampRate ?? GameConst.calmSeaSpinDampRate),
        zCenterStiffness: Math.max(0, overrides.zCenterStiffness ?? GameConst.calmSeaZCenterStiffness),
        zCenterDamping: Math.max(0, overrides.zCenterDamping ?? GameConst.calmSeaZCenterDamping),
        pillarDetourAccelPx: Math.max(0, overrides.pillarDetourAccelPx ?? GameConst.calmSeaPillarDetourAccelPx),
    };
}

/** 计算「定海」目标悬停带高度：略高于两根柱尖，且不超过内屏上界留足安全余量 */
export function computeCalmSeaTargetY(
    pillars: readonly CalmSeaPillarInfo[],
    ringOuterRadius: number,
    tankHeight: number = TankSpace.height,
    config: Readonly<CalmSeaFlowConfig> = buildCalmSeaFlowConfig(),
): number {
    let maxTipY = 0;
    for (let i = 0; i < pillars.length; i++) {
        if (pillars[i].tipY > maxTipY) {
            maxTipY = pillars[i].tipY;
        }
    }
    if (maxTipY <= 0) {
        maxTipY = tankHeight * 0.55;
    }
    const desired = maxTipY + config.targetAboveTipPx;
    const maxSafeY = Math.max(20, tankHeight - ringOuterRadius - config.topMarginPx);
    return Math.min(desired, maxSafeY);
}

/**
 * 右柱技能「定海」的 FlowField 暖流托浮项（纯逻辑，不依赖引擎）：
 * - 激活后从缸底向上产生柔和均匀暖流，将气泡与自由圈自缸底温和托起；
 * - 靠近目标高度（略高于两根柱尖）时平滑衰减至 0，避免冲顶撞壁。
 */
export class CalmSeaFlowTerm implements FlowTermObject {
    readonly id = 'skill:calm-sea';

    config: CalmSeaFlowConfig;

    private active = false;
    private targetYValue = TankSpace.height * 0.6;
    private tankHeightValue = TankSpace.height;
    private elapsedSec = 0;

    constructor(overrides: Partial<CalmSeaFlowConfig> = {}) {
        this.config = buildCalmSeaFlowConfig(overrides);
    }

    get isActive(): boolean {
        return this.active;
    }

    get targetY(): number {
        return this.targetYValue;
    }

    get elapsed(): number {
        return this.elapsedSec;
    }

    setTargetY(targetY: number, tankHeight: number = TankSpace.height): void {
        this.targetYValue = targetY;
        this.tankHeightValue = Math.max(100, tankHeight);
    }

    activate(targetY: number, tankHeight: number = TankSpace.height): void {
        this.setTargetY(targetY, tankHeight);
        this.active = true;
        this.elapsedSec = 0;
    }

    deactivate(): void {
        this.active = false;
        this.elapsedSec = 0;
    }

    step(dt: number): void {
        if (!this.active || !(dt > 0)) {
            return;
        }
        this.elapsedSec += dt;
    }

    sample(_x: number, y: number, out: FlowVec2): void {
        if (!this.active || y < 0 || y >= this.tankHeightValue) {
            out.x = 0;
            out.y = 0;
            return;
        }

        const span = this.config.warmFlowTaperSpanPx;
        const fadeStart = this.targetYValue - span;
        const fadeEnd = this.targetYValue + span * 0.35;

        let weight = 1;
        if (y >= fadeEnd) {
            weight = 0;
        } else if (y > fadeStart) {
            const t = (y - fadeStart) / Math.max(1e-4, fadeEnd - fadeStart);
            weight = 1 - t * t * (3 - 2 * t);
        }

        out.x = 0;
        out.y = this.config.warmFlowSpeed * weight;
    }
}

/**
 * 「定海」期间自由 3D 圆环托浮、目标带极慢下沉与水平回正/z=0 居中控制器（纯逻辑，不依赖引擎）。
 * 结合 FlowField 暖流项共同作用，确保包括沉底铁圈在内的全部圈种在 5 秒窗口内稳稳浮至柱尖上方并转极慢下沉。
 */
export class CalmSeaRingRegulator {
    readonly config: CalmSeaFlowConfig;
    private readonly reachedBandByBodyId = new Map<number, boolean>();

    constructor(overrides: Partial<CalmSeaFlowConfig> = {}) {
        this.config = buildCalmSeaFlowConfig(overrides);
    }

    reset(): void {
        this.reachedBandByBodyId.clear();
    }

    clearBody(bodyId: number): void {
        this.reachedBandByBodyId.delete(bodyId);
    }

    hasReachedBand(bodyId: number): boolean {
        return this.reachedBandByBodyId.get(bodyId) === true;
    }

    applyToBody(
        body: TorusBody3D,
        kindConfig: Readonly<RingKindConfig>,
        solvedFeel: Readonly<SolvedFeel>,
        pillars: readonly CalmSeaPillarInfo[],
        tankWidth: number,
        tankHeight: number,
        targetY: number,
        warmFlowVy: number,
    ): boolean {
        if (body.type !== 'dynamic') {
            this.reachedBandByBodyId.delete(body.id);
            return false;
        }

        let isThreadingPillar = false;
        let isOverUnfullPillar = false;
        let isAlignedAboveUnfullPillar = false;
        let detourDirX = 0;

        for (let i = 0; i < pillars.length; i++) {
            const p = pillars[i];
            const pz = p.z ?? 0;
            const dx = body.x - p.x;
            const dz = body.z - pz;
            const distXZ = Math.hypot(dx, dz);

            if (!p.isFull) {
                if (distXZ < body.outerRadius * 0.95 && body.y >= p.baseTopY - 4) {
                    isOverUnfullPillar = true;
                }
                if (distXZ < body.innerRadius && body.y >= p.tipY + body.tubeRadius) {
                    isAlignedAboveUnfullPillar = true;
                }
                if (
                    body.y >= p.baseTopY - 4 &&
                    body.y < p.tipY + body.tubeRadius &&
                    distXZ < body.innerRadius
                ) {
                    isThreadingPillar = true;
                }
            }

            if (body.y < p.baseTopY - 4 && distXZ < body.outerRadius * 0.85 && detourDirX === 0) {
                if (Math.abs(dx) > 2) {
                    detourDirX = dx > 0 ? 1 : -1;
                } else {
                    detourDirX = body.x < tankWidth * 0.5 ? 1 : -1;
                }
            }
        }

        const sinkAccel = solvedFeel.baseSinkAccel * kindConfig.sinkScale;

        if (isThreadingPillar) {
            // 已套入柱杆准备落定：仅略减沉以便轻柔落稳锁定，绝不逆向顶出柱尖
            body.applyCentralForce(0, body.mass * sinkAccel * 0.45, 0);
        } else {
            let reached = this.reachedBandByBodyId.get(body.id) === true;
            if (!reached && body.y >= targetY) {
                reached = true;
                this.reachedBandByBodyId.set(body.id, true);
            } else if (
                reached &&
                !isOverUnfullPillar &&
                body.y < targetY - this.config.reLiftOffsetPx
            ) {
                reached = false;
                this.reachedBandByBodyId.set(body.id, false);
            }

            let controlAy = 0;
            if (!reached) {
                const distBelow = Math.max(0, targetY - body.y);
                const vTarget = clampRange(
                    distBelow * this.config.riseSlope,
                    this.config.riseMinSpeedPx,
                    this.config.riseMaxSpeedPx,
                );
                if (body.vy < vTarget) {
                    controlAy = Math.min(
                        this.config.maxRiseAccelPx,
                        this.config.riseGain * (vTarget - body.vy),
                    );
                } else if (body.y > targetY - 28) {
                    const damp = this.config.overshootDampRate * (vTarget - body.vy);
                    controlAy = Math.max(-sinkAccel * this.config.maxBrakeDownRatio, damp);
                }
            } else {
                const targetSinkVy =
                    body.y > targetY + 36
                        ? -this.config.highDescentSpeedPx
                        : isAlignedAboveUnfullPillar
                          ? -this.config.pillarSettleSinkSpeedPx
                          : -this.config.slowSinkSpeedPx;
                const effWaterRate = solvedFeel.flowFollowRate * kindConfig.flowFollow;
                const steadyHoldAy =
                    (effWaterRate + solvedFeel.ringLinearDamping) * targetSinkVy -
                    effWaterRate * warmFlowVy;
                const trackRate = isAlignedAboveUnfullPillar
                    ? this.config.bandTrackRate * 1.6
                    : this.config.bandTrackRate;
                let trackAy = steadyHoldAy + trackRate * (targetSinkVy - body.vy);
                const nearCeiling = body.y > tankHeight - body.outerRadius - this.config.topMarginPx;
                if (!nearCeiling && body.vy > 40) {
                    trackAy = Math.max(-sinkAccel * this.config.maxBrakeDownRatio, trackAy);
                }
                controlAy = trackAy;
            }

            body.applyCentralForce(
                detourDirX !== 0 ? body.mass * detourDirX * this.config.pillarDetourAccelPx : 0,
                body.mass * (sinkAccel + controlAy),
                0,
            );
        }

        // 1. z = 0 中平面柔和居中阻尼
        const fz = body.mass * (-this.config.zCenterStiffness * body.z - this.config.zCenterDamping * body.vz);
        body.applyCentralForce(0, 0, fz);

        // 2. 柔和三维水平回正阻尼力矩：将孔轴 basisN 拉向竖直 (0, ±1, 0)，抑制三轴翻转角速度
        const nLen = Math.hypot(body.basisN.x, body.basisN.y, body.basisN.z);
        if (nLen > 1e-6) {
            const nx = body.basisN.x / nLen;
            const ny = body.basisN.y / nLen;
            const nz = body.basisN.z / nLen;
            const signY = ny >= 0 ? 1 : -1;

            // N × (0, signY, 0) = (-nz * signY, 0, nx * signY)
            const errX = -nz * signY;
            const errZ = nx * signY;

            const R2 = body.majorRadius * body.majorRadius;
            const r2 = body.tubeRadius * body.tubeRadius;
            const ixz = body.mass * (0.5 * R2 + 0.625 * r2);
            const iy = body.mass * (R2 + 0.75 * r2);

            const kAlign = this.config.alignRate * this.config.alignRate * 0.85;
            const cAlign = this.config.alignRate * 1.6;

            body.applyTorque(
                ixz * (kAlign * errX - cAlign * body.wx),
                -iy * this.config.spinDampRate * body.wy,
                ixz * (kAlign * errZ - cAlign * body.wz),
            );
        }

        return true;
    }
}

function clamp01(v: number): number {
    if (!(v > 0)) {
        return 0;
    }
    return v >= 1 ? 1 : v;
}

function clampRange(v: number, min: number, max: number): number {
    if (!(v >= min)) {
        return min;
    }
    return v >= max ? max : v;
}
