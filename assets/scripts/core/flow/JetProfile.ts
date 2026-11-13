import { calcRingPillarGeometry, GameConst } from '../../config/GameConst';
import { Point2D, TankSpace } from '../../config/TankSpace';

export const DEG_TO_RAD = Math.PI / 180;
/** ln(20) ≈ 2.9957：使指数衰减 exp(-LN20 * t / T) 在 t = T 时精确落到 5% */
export const LN20 = Math.log(20);

export interface NozzlePose {
    x: number;
    y: number;
    axisX: number;
    axisY: number;
}

export interface JetConeParams {
    tankWidth: number;
    tankHeight: number;
    pillarBottomPct: number;
    nozzlePosPct: number;
    nozzleTiltDeg: number;
    jetMouthHalfWidth: number;
    jetHalfAngleDeg: number;
}

export interface JetConeGeometry {
    leftNozzle: NozzlePose;
    rightNozzle: NozzlePose;
    mouthHalfWidth: number;
    tanHalfAngle: number;
    apexOffset: number;
    softDist: number;
    jetRange: number;
}

/**
 * 根据水缸与海眼配置预计算锥形主喷流的几何尺度（纯逻辑，供 FlowField 与 FeelSolver 共用）。
 */
export function buildJetConeGeometry(params: JetConeParams): JetConeGeometry {
    const tiltRad = params.nozzleTiltDeg * DEG_TO_RAD;
    const sinT = Math.sin(tiltRad);
    const cosT = Math.max(0.2, Math.cos(tiltRad));

    const leftX = (params.nozzlePosPct / 100) * params.tankWidth;
    const rightX = ((100 - params.nozzlePosPct) / 100) * params.tankWidth;

    const mouthHalfWidth = Math.max(1, params.jetMouthHalfWidth);
    const halfRad = Math.max(1, params.jetHalfAngleDeg) * DEG_TO_RAD;
    const tanHalfAngle = Math.tan(halfRad);
    const apexOffset = mouthHalfWidth / tanHalfAngle;

    const geom = calcRingPillarGeometry(params.tankWidth);
    const pillarBottomY = (params.pillarBottomPct / 100) * params.tankHeight;
    const pillarTipY = Math.max(40, pillarBottomY + geom.pillarTotalHeight);

    return {
        leftNozzle: { x: leftX, y: 0, axisX: sinT, axisY: cosT },
        rightNozzle: { x: rightX, y: 0, axisX: -sinT, axisY: cosT },
        mouthHalfWidth,
        tanHalfAngle,
        apexOffset,
        softDist: pillarTipY / cosT,
        jetRange: params.tankHeight / cosT,
    };
}

/**
 * 采样单个海眼在缸坐标 (x, y) 处的锥形喷流水速（像素/秒）。
 * 轴向底部冲力强、至柱尖发散变柔；横向中心最强、边缘平滑归零。
 */
export function sampleSingleNozzleVelocity(
    nozzle: Readonly<NozzlePose>,
    cone: Readonly<JetConeGeometry>,
    jetMaxSpeed: number,
    level: number,
    x: number,
    y: number,
    out: Point2D,
): Point2D {
    if (level <= 0 || jetMaxSpeed <= 0) {
        out.x = 0;
        out.y = 0;
        return out;
    }

    const rx = x - nozzle.x;
    const ry = y - nozzle.y;
    const along = rx * nozzle.axisX + ry * nozzle.axisY;
    if (along < 0 || along >= cone.jetRange) {
        out.x = 0;
        out.y = 0;
        return out;
    }

    const perp = -rx * nozzle.axisY + ry * nozzle.axisX;
    const halfWidth = cone.mouthHalfWidth + along * cone.tanHalfAngle;
    const absPerp = Math.abs(perp);
    if (absPerp >= halfWidth) {
        out.x = 0;
        out.y = 0;
        return out;
    }

    const sNorm = along / cone.softDist;
    const rangeNorm = along / cone.jetRange;
    const axialBase = 1 / (1 + sNorm * 1.2);
    const axialFactor = axialBase * Math.sqrt(axialBase) * (1 - rangeNorm * rangeNorm);

    const u = absPerp / halfWidth;
    const radialFactor = 1 - u * u;

    const speed = jetMaxSpeed * level * axialFactor * radialFactor;

    const rayAlong = along + cone.apexOffset;
    const rayLen = Math.hypot(rayAlong, perp);
    const ca = rayAlong / rayLen;
    const cp = perp / rayLen;
    const dirX = nozzle.axisX * ca - nozzle.axisY * cp;
    const dirY = nozzle.axisY * ca + nozzle.axisX * cp;

    out.x = dirX * speed;
    out.y = dirY * speed;
    return out;
}

export function stepJetAfterglowLevel(current: number, target: number, decay: number): number {
    if (target >= current) {
        return target;
    }
    const next = target + (current - target) * decay;
    if (target === 0 && next < 1e-4) {
        return 0;
    }
    return next;
}

export function buildDefaultJetConeGeometry(
    pillarBottomPct: number,
    nozzlePosPct: number,
    nozzleTiltDeg: number,
    tankWidth = TankSpace.width,
    tankHeight = TankSpace.height,
): JetConeGeometry {
    return buildJetConeGeometry({
        tankWidth,
        tankHeight,
        pillarBottomPct,
        nozzlePosPct,
        nozzleTiltDeg,
        jetMouthHalfWidth: GameConst.jetMouthHalfWidth,
        jetHalfAngleDeg: GameConst.jetHalfAngleDeg,
    });
}
