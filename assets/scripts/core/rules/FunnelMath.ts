import { TorusBody3D } from '../physics3d/TorusBody3D';
import { calcRingTiltDeg3D } from './PillarStack';

export interface FunnelParams {
    /** 柱尖碗口吸纳半径（像素） */
    radiusPx: number;
    /** 允许触发入柱宽容的最大倾角（度） */
    maxAngleDeg: number;
    /** 朝柱心的居中加速度（像素/秒²） */
    pullAccel: number;
    /** 柔和回正速率（1/秒） */
    alignRate: number;
}

export interface FunnelBoost {
    radiusScale: number;
    maxTiltDeg: number;
    pullScale: number;
    alignScale?: number;
}

export interface FunnelPillarTarget {
    x: number;
    z?: number;
    tipY: number;
    baseTopY: number;
    isFull: boolean;
}

export interface FunnelForceResult {
    active: boolean;
    fx: number;
    fy: number;
    fz: number;
    tx: number;
    ty: number;
    tz: number;
    radialDist: number;
    tiltDeg: number;
}

const DEFAULT_PULL_DAMP_REF_ACCEL = 950;
const tempResult: FunnelForceResult = {
    active: false,
    fx: 0,
    fy: 0,
    fz: 0,
    tx: 0,
    ty: 0,
    tz: 0,
    radialDist: 0,
    tiltDeg: 0,
};

function clamp01(v: number): number {
    if (!(v > 0)) {
        return 0;
    }
    return v >= 1 ? 1 : v;
}

function resetResult(out: FunnelForceResult): FunnelForceResult {
    out.active = false;
    out.fx = 0;
    out.fy = 0;
    out.fz = 0;
    out.tx = 0;
    out.ty = 0;
    out.tz = 0;
    out.radialDist = 0;
    out.tiltDeg = 0;
    return out;
}

/**
 * 合并基础入柱宽容参数与外部增益（供 T018 左柱技能「潮引」放大漏斗）。
 */
export function resolveEffectiveFunnelParams(
    base: Readonly<FunnelParams>,
    boost?: Readonly<FunnelBoost> | null,
    out: FunnelParams = { radiusPx: 0, maxAngleDeg: 0, pullAccel: 0, alignRate: 0 },
): FunnelParams {
    if (!boost) {
        out.radiusPx = Math.max(0, base.radiusPx);
        out.maxAngleDeg = Math.max(0, base.maxAngleDeg);
        out.pullAccel = Math.max(0, base.pullAccel);
        out.alignRate = Math.max(0, base.alignRate);
        return out;
    }

    const rScale = Math.max(0, boost.radiusScale);
    const pScale = Math.max(0, boost.pullScale);
    const aScale = Math.max(0, boost.alignScale ?? boost.pullScale);

    out.radiusPx = Math.max(0, base.radiusPx * rScale);
    out.maxAngleDeg = Math.max(0, Math.max(base.maxAngleDeg, boost.maxTiltDeg));
    out.pullAccel = Math.max(0, base.pullAccel * pScale);
    out.alignRate = Math.max(0, base.alignRate * aScale);
    return out;
}

/**
 * 计算单根柱子对单个自由 3D 圆环的入柱宽容三维居中力与三维回正力矩（纯逻辑）。
 * 仅在以下条件全部满足时生效：
 * 1. 柱子未满、刚体处于动态自由状态；
 * 2. 圈正在下落（vy < 0）；
 * 3. 三维倾角 calcRingTiltDeg3D <= maxAngleDeg；
 * 4. 圈心处于柱尖 (pillarX, tipY, 0) 附近的碗口区（X/Z 水平径向距离与高度区间内；
 *    已低于柱尖肩部且未套住柱尖的圈不再侧向拉入，防止擦柱侧撞）。
 */
export function computeFunnelForce3D(
    body: Readonly<TorusBody3D>,
    pillar: Readonly<FunnelPillarTarget>,
    params: Readonly<FunnelParams>,
    out: FunnelForceResult = {
        active: false,
        fx: 0,
        fy: 0,
        fz: 0,
        tx: 0,
        ty: 0,
        tz: 0,
        radialDist: 0,
        tiltDeg: 0,
    },
): FunnelForceResult {
    resetResult(out);

    if (pillar.isFull || body.type !== 'dynamic') {
        return out;
    }
    if (params.radiusPx <= 1e-4 || params.maxAngleDeg <= 0 || (params.pullAccel <= 0 && params.alignRate <= 0)) {
        return out;
    }
    if (!(body.vy < 0)) {
        return out;
    }

    const tiltDeg = calcRingTiltDeg3D(body.basisN.x, body.basisN.y, body.basisN.z);
    out.tiltDeg = tiltDeg;
    if (tiltDeg > params.maxAngleDeg) {
        return out;
    }

    const pz = pillar.z ?? 0;
    const dx = body.x - pillar.x;
    const dz = body.z - pz;
    const radialDist = Math.hypot(dx, dz);
    out.radialDist = radialDist;
    if (radialDist > params.radiusPx) {
        return out;
    }

    const tipShoulderY = pillar.tipY - body.tubeRadius;
    const shaftSpan = Math.max(0, pillar.tipY - pillar.baseTopY);
    const belowSpan = Math.min(shaftSpan, Math.max(body.tubeRadius * 2, params.radiusPx * 0.45));
    const minEnterY = Math.max(pillar.baseTopY, pillar.tipY - belowSpan);
    const maxY = pillar.tipY + params.radiusPx * 1.5;

    if (body.y > maxY || body.y < minEnterY) {
        return out;
    }
    if (body.y < tipShoulderY && radialDist > body.innerRadius) {
        return out;
    }

    let yWeight = 1;
    if (body.y < tipShoulderY) {
        yWeight = clamp01((body.y - minEnterY) / Math.max(1e-4, tipShoulderY - minEnterY));
    } else {
        const fadeStart = pillar.tipY + params.radiusPx * 0.9;
        if (body.y > fadeStart) {
            yWeight = clamp01((maxY - body.y) / Math.max(1e-4, maxY - fadeStart));
        }
    }
    if (yWeight <= 0) {
        return out;
    }

    // 1. 朝柱心 (pillarX, z=0) 的三维水平居中力（春季收拢 + 抑制横冲过头的速度阻尼）
    if (params.pullAccel > 0) {
        const softCore = Math.max(6, params.radiusPx * 0.25);
        const edgeFade =
            radialDist > params.radiusPx * 0.9
                ? clamp01((params.radiusPx - radialDist) / Math.max(1e-4, params.radiusPx * 0.1))
                : 1;
        const radialGain = radialDist > 1e-4 ? Math.min(1, radialDist / softCore) * edgeFade : 0;
        const pullMag = params.pullAccel * yWeight * radialGain;

        let ax = radialDist > 1e-4 ? (-dx / radialDist) * pullMag : 0;
        let az = radialDist > 1e-4 ? (-dz / radialDist) * pullMag : 0;

        const lateralDamp = (params.pullAccel / DEFAULT_PULL_DAMP_REF_ACCEL) * 4.0 * yWeight;
        ax -= lateralDamp * body.vx;
        az -= lateralDamp * body.vz;

        out.fx = body.mass * ax;
        out.fz = body.mass * az;
    }

    // 2. 柔和三维回正力矩：将孔轴 basisN 拉向竖直 (0, ±1, 0)，不强制翻转 180° 倒扣的环
    if (params.alignRate > 0) {
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

            const kAlign = params.alignRate * params.alignRate * 0.65 * yWeight;
            const cAlign = params.alignRate * 0.45 * yWeight;

            out.tx = ixz * (kAlign * errX - cAlign * body.wx);
            out.ty = 0;
            out.tz = ixz * (kAlign * errZ - cAlign * body.wz);
        }
    }

    out.active = true;
    return out;
}

/**
 * 从候选柱子中选择距离最近的满足条件的柱子，将漏斗居中力与回正力矩施加到 TorusBody3D。
 */
export function applyFunnelToBody(
    body: TorusBody3D,
    pillars: readonly FunnelPillarTarget[],
    paramsList: readonly FunnelParams[],
    maxCount?: number,
): boolean {
    let bestActive = false;
    let bestDist = Infinity;
    let bestFx = 0;
    let bestFy = 0;
    let bestFz = 0;
    let bestTx = 0;
    let bestTy = 0;
    let bestTz = 0;

    const limit = maxCount !== undefined ? Math.min(maxCount, pillars.length, paramsList.length) : Math.min(pillars.length, paramsList.length);
    for (let i = 0; i < limit; i++) {
        computeFunnelForce3D(body, pillars[i], paramsList[i], tempResult);
        if (tempResult.active && tempResult.radialDist < bestDist) {
            bestActive = true;
            bestDist = tempResult.radialDist;
            bestFx = tempResult.fx;
            bestFy = tempResult.fy;
            bestFz = tempResult.fz;
            bestTx = tempResult.tx;
            bestTy = tempResult.ty;
            bestTz = tempResult.tz;
        }
    }

    if (!bestActive) {
        return false;
    }

    body.applyCentralForce(bestFx, bestFy, bestFz);
    body.applyTorque(bestTx, bestTy, bestTz);
    return true;
}
