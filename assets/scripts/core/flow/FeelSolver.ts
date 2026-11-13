import { DEFAULT_FEEL_CONFIG, FEEL_BASE_CONST, FeelConfig, FeelParams } from '../../config/FeelConfig';
import { calcRingPillarGeometry, GameConst } from '../../config/GameConst';
import { TankSpace } from '../../config/TankSpace';
import { Bladder } from '../input/Bladder';
import { getRingKindConfig } from '../rings/RingKinds';
import {
    buildDefaultJetConeGeometry,
    JetConeGeometry,
    LN20,
    sampleSingleNozzleVelocity,
    stepJetAfterglowLevel,
} from './JetProfile';
import { calcEndpointFollowAccel } from './WaterFollow';

const FIXED_SIM_DT = 1 / 60;
const MIN_FLOW_FOLLOW = 1.5;
const MAX_FLOW_FOLLOW = 25.0;
const MIN_SINK_ACCEL = 10;
const MAX_SINK_ACCEL = 40000;
const MIN_JET_SPEED = 200;
const MAX_JET_SPEED = 60000;

export interface SolvedFunnelParams {
    /** 柱尖碗口吸纳半径（像素） */
    radiusPx: number;
    /** 允许触发入柱宽容的最大倾角（度，0.5 旋钮对应 35°） */
    maxAngleDeg: number;
    /** 朝柱心的居中加速度（像素/秒²） */
    pullAccel: number;
    /** 柔和回正角速度倍率（1/秒） */
    alignRate: number;
}

export interface SolvedFeelMetrics {
    /** 1D 竖直小模拟量出的普通圈沉底时间（秒） */
    sinkSec: number;
    /** 1D 竖直小模拟量出的轻点推升缸高百分比（0–100） */
    tapLiftPct: number;
    /** 1D 竖直小模拟量出的按满推升缸高百分比（0–100） */
    holdLiftPct: number;
}

export interface SolvedFeel {
    /** 普通圈基准下沉加速度（像素/秒²） */
    baseSinkAccel: number;
    /** 圈对水流的基准跟随度（1/秒） */
    flowFollowRate: number;
    /** 主喷流在海眼口中心的最大水速（像素/秒） */
    jetMaxSpeed: number;
    /** 圈的线性阻尼（1/秒） */
    ringLinearDamping: number;
    /** 圈的角阻尼（1/秒，由翻滚灵敏度换算） */
    ringAngularDamping: number;
    /** 双端点差分翻滚力矩倍率（0.5 时为 1.0，不改变净平移推力） */
    tumbleTorqueScale: number;
    /** 圈横条碰撞摩擦系数 */
    ringFriction: number;
    /** 圈碰撞弹性系数 */
    ringRestitution: number;
    /** 松手后主喷流余韵衰减时间（秒） */
    jetAfterglowSec: number;
    /** 全缸环流满动量边缘水速（像素/秒） */
    circulationMaxSpeed: number;
    /** 喷水向环流注入动量的速率（1/秒） */
    circulationChargeRate: number;
    /** 平静时微弱底噪扰动水速（像素/秒） */
    turbulenceBaseSpeed: number;
    /** 水流活跃时附加扰动水速（像素/秒） */
    turbulenceFlowSpeed: number;
    /** 入柱宽容参数（由 funnelTolerance 换算，供 T013 使用） */
    funnel: SolvedFunnelParams;
    /** 1D 竖直小模拟回验指标 */
    measured: SolvedFeelMetrics;
}

export type FeelAppliedListener = (solved: Readonly<SolvedFeel>, feel: Readonly<FeelParams>) => void;

const tempVel = { x: 0, y: 0 };
const tempAccel = { x: 0, y: 0 };

/**
 * 一维竖直下沉小模拟：普通圈从水面释放，计算落到缸底所需时间（秒）。
 */
export function simulateSink1D(
    baseSinkAccel: number,
    flowFollowRate: number,
    linearDamping: number = FEEL_BASE_CONST.ringLinearDamping,
    tankHeight = TankSpace.height,
    dt = FIXED_SIM_DT,
): number {
    const halfThick = GameConst.ringThickness / 2;
    let y = tankHeight - (halfThick + 2);
    const floorY = halfThick;
    let vy = 0;
    let t = 0;
    const linDecay = 1 / (1 + dt * linearDamping);
    const normalFollow = getRingKindConfig('normal').flowFollow;

    while (y > floorY && t < 20) {
        calcEndpointFollowAccel(0, 0, 0, vy, flowFollowRate, normalFollow, tempAccel);
        const ay = tempAccel.y - baseSinkAccel;
        vy = (vy + ay * dt) * linDecay;
        y += vy * dt;
        t += dt;
    }
    return t;
}

/**
 * 一维竖直推升小模拟：海眼上方缸底普通圈在指定按压时长下的最高升程（占缸高百分比 0–100）。
 */
export function simulateLift1D(
    pressSec: number,
    feel: Readonly<FeelParams>,
    baseSinkAccel: number,
    flowFollowRate: number,
    jetMaxSpeed: number,
    linearDamping: number = FEEL_BASE_CONST.ringLinearDamping,
    tankWidth = TankSpace.width,
    tankHeight = TankSpace.height,
    dt = FIXED_SIM_DT,
    coneOverride?: Readonly<JetConeGeometry>,
): number {
    const geom = calcRingPillarGeometry(tankWidth);
    const halfThick = geom.ringThickness / 2;
    const endOffset = geom.ringOuterDiameter / 2 - halfThick;
    const floorY = halfThick;
    const ceilingY = tankHeight - (halfThick + 2);

    const cone =
        coneOverride ??
        buildDefaultJetConeGeometry(
            feel.pillarBottomPct,
            feel.nozzlePosPct,
            feel.nozzleTiltDeg,
            tankWidth,
            tankHeight,
        );
    const nozzle = cone.leftNozzle;
    const tanTilt = nozzle.axisX / nozzle.axisY;

    const bladder = new Bladder(
        {
            maxBreathSec: feel.bladderMaxBreathSec,
            refillSec: feel.bladderRefillSec,
        },
        feel,
    );
    const normalKind = getRingKindConfig('normal');
    const afterglowDecay = Math.exp((-LN20 * dt) / FEEL_BASE_CONST.jetAfterglowSec);
    const linDecay = 1 / (1 + dt * linearDamping);

    let y = halfThick + 2;
    let vy = 0;
    let level = 0;
    let maxY = y;

    const totalSteps = Math.round(4.0 / dt);
    const pressSteps = Math.max(1, Math.round(pressSec / dt));

    for (let i = 0; i < totalSteps; i++) {
        bladder.setPressed(i < pressSteps);
        const input = bladder.output;
        level = input >= level ? input : stepJetAfterglowLevel(level, input, afterglowDecay);
        bladder.step(dt);

        const cx = nozzle.x + y * tanTilt;
        sampleSingleNozzleVelocity(nozzle, cone, jetMaxSpeed, level, cx - endOffset, y, tempVel);
        const wyLeft = tempVel.y;
        sampleSingleNozzleVelocity(nozzle, cone, jetMaxSpeed, level, cx + endOffset, y, tempVel);
        const wyRight = tempVel.y;
        const wy = 0.5 * (wyLeft + wyRight);

        calcEndpointFollowAccel(0, wy, 0, vy, flowFollowRate, normalKind.flowFollow, tempAccel);
        const ay = tempAccel.y - baseSinkAccel * normalKind.sinkScale;

        vy = (vy + ay * dt) * linDecay;
        y += vy * dt;

        if (y > ceilingY) {
            y = ceilingY;
            if (vy > 0) {
                vy = 0;
            }
        } else if (y < floorY) {
            y = floorY;
            if (vy < 0) {
                vy = 0;
            }
        }

        if (y > maxY) {
            maxY = y;
        }
        if (i >= pressSteps && vy <= 0 && level <= 1e-4) {
            break;
        }
    }

    return (maxY / tankHeight) * 100;
}

function solveInnerForFollowRate(
    flowFollowRate: number,
    targetSinkSec: number,
    targetHoldPct: number,
    feel: Readonly<FeelParams>,
    cone: Readonly<JetConeGeometry>,
): { baseSinkAccel: number; jetMaxSpeed: number; tapPct: number; holdPct: number; sinkSec: number } {
    const linDamp = FEEL_BASE_CONST.ringLinearDamping;

    // 1. 二分反推下沉加速度，使 1D 沉底秒数精确逼近 targetSinkSec
    let sLo = MIN_SINK_ACCEL;
    let sHi = MAX_SINK_ACCEL;
    for (let i = 0; i < 20; i++) {
        const mid = 0.5 * (sLo + sHi);
        if (simulateSink1D(mid, flowFollowRate, linDamp) > targetSinkSec) {
            sLo = mid;
        } else {
            sHi = mid;
        }
    }
    const baseSinkAccel = 0.5 * (sLo + sHi);
    const sinkSec = simulateSink1D(baseSinkAccel, flowFollowRate, linDamp);

    // 2. 二分反推主喷流最大水速，使按满一口气升程精确逼近 targetHoldPct
    const holdPressSec = Math.max(0.05, feel.bladderMaxBreathSec);
    let jLo = MIN_JET_SPEED;
    let jHi = MAX_JET_SPEED;
    for (let i = 0; i < 20; i++) {
        const mid = 0.5 * (jLo + jHi);
        if (
            simulateLift1D(
                holdPressSec,
                feel,
                baseSinkAccel,
                flowFollowRate,
                mid,
                linDamp,
                TankSpace.width,
                TankSpace.height,
                FIXED_SIM_DT,
                cone,
            ) < targetHoldPct
        ) {
            jLo = mid;
        } else {
            jHi = mid;
        }
    }
    const jetMaxSpeed = 0.5 * (jLo + jHi);
    const holdPct = simulateLift1D(
        holdPressSec,
        feel,
        baseSinkAccel,
        flowFollowRate,
        jetMaxSpeed,
        linDamp,
        TankSpace.width,
        TankSpace.height,
        FIXED_SIM_DT,
        cone,
    );
    const tapPct = simulateLift1D(
        FEEL_BASE_CONST.tapDurationSec,
        feel,
        baseSinkAccel,
        flowFollowRate,
        jetMaxSpeed,
        linDamp,
        TankSpace.width,
        TankSpace.height,
        FIXED_SIM_DT,
        cone,
    );

    return { baseSinkAccel, jetMaxSpeed, tapPct, holdPct, sinkSec };
}

function solveTumbleParams(tumbleSensitivity: number): { ringAngularDamping: number; tumbleTorqueScale: number } {
    const t = clamp01(tumbleSensitivity);
    // t=0 -> 12.0（极稳）、t=0.5 -> 4.0（默认对齐 T008）、t=1 -> 1.33（灵敏翻滚）
    const ringAngularDamping = 12 * Math.exp(-2.197224577 * t);
    // t=0.5 时保持 1.0，不改变纯双端点施力比例
    const tumbleTorqueScale = 0.35 + 1.3 * t;
    return { ringAngularDamping, tumbleTorqueScale };
}

function solveFunnelParams(funnelTolerance: number): SolvedFunnelParams {
    const t = clamp01(funnelTolerance);
    if (t <= 0) {
        return { radiusPx: 0, maxAngleDeg: 0, pullAccel: 0, alignRate: 0 };
    }
    const geom = calcRingPillarGeometry(TankSpace.width);
    const baseRadius = geom.ringOuterDiameter * 0.55;
    if (t <= 0.5) {
        const k = t / 0.5;
        return {
            radiusPx: baseRadius * k,
            maxAngleDeg: 35 * k,
            pullAccel: 950 * k,
            alignRate: 6.5 * k,
        };
    }
    const k = (t - 0.5) / 0.5;
    return {
        radiusPx: baseRadius * (1 + 0.65 * k),
        maxAngleDeg: 35 + 20 * k,
        pullAccel: 950 + 850 * k,
        alignRate: 6.5 + 5.5 * k,
    };
}

/**
 * 将 12 个体感参数换算为底层物理量与漏斗参数（纯逻辑）。
 * 通过一维竖直小模拟反推，保证沉底时间、轻点升高、按满升高落在目标 ±10% 以内。
 */
export function solveFeel(feel: Readonly<FeelParams> = FeelConfig): SolvedFeel {
    const targetSinkSec = clampRange(feel.sinkSec, 0.5, 12);
    const targetHoldPct = clampRange(feel.holdLiftPct, 12, 96);
    const targetTapPct = clampRange(feel.tapLiftPct, 5, Math.min(92, targetHoldPct));

    const cone = buildDefaultJetConeGeometry(feel.pillarBottomPct, feel.nozzlePosPct, feel.nozzleTiltDeg);

    // 外层二分搜索基准水流跟随度，使轻点推升同时逼近 targetTapPct
    let fLo = MIN_FLOW_FOLLOW;
    let fHi = MAX_FLOW_FOLLOW;
    for (let i = 0; i < 16; i++) {
        const fMid = 0.5 * (fLo + fHi);
        const probe = solveInnerForFollowRate(fMid, targetSinkSec, targetHoldPct, feel, cone);
        if (probe.tapPct < targetTapPct) {
            fLo = fMid;
        } else {
            fHi = fMid;
        }
    }

    const flowFollowRate = 0.5 * (fLo + fHi);
    const solved = solveInnerForFollowRate(flowFollowRate, targetSinkSec, targetHoldPct, feel, cone);
    const tumble = solveTumbleParams(feel.tumbleSensitivity);
    const funnel = solveFunnelParams(feel.funnelTolerance);

    const holdRatio = clampRange(targetHoldPct / DEFAULT_FEEL_CONFIG.holdLiftPct, 0.4, 1.5);

    return {
        baseSinkAccel: solved.baseSinkAccel,
        flowFollowRate,
        jetMaxSpeed: solved.jetMaxSpeed,
        ringLinearDamping: FEEL_BASE_CONST.ringLinearDamping,
        ringAngularDamping: tumble.ringAngularDamping,
        tumbleTorqueScale: tumble.tumbleTorqueScale,
        ringFriction: FEEL_BASE_CONST.ringFriction,
        ringRestitution: FEEL_BASE_CONST.ringRestitution,
        jetAfterglowSec: FEEL_BASE_CONST.jetAfterglowSec,
        circulationMaxSpeed: FEEL_BASE_CONST.circulationMaxSpeed * (0.4 + 0.6 * holdRatio),
        circulationChargeRate: FEEL_BASE_CONST.circulationChargeRate,
        turbulenceBaseSpeed: FEEL_BASE_CONST.turbulenceBaseSpeed,
        turbulenceFlowSpeed: FEEL_BASE_CONST.turbulenceFlowSpeed,
        funnel,
        measured: {
            sinkSec: solved.sinkSec,
            tapLiftPct: solved.tapPct,
            holdLiftPct: solved.holdPct,
        },
    };
}

function copySolvedFeel(src: Readonly<SolvedFeel>, dst: SolvedFeel): void {
    dst.baseSinkAccel = src.baseSinkAccel;
    dst.flowFollowRate = src.flowFollowRate;
    dst.jetMaxSpeed = src.jetMaxSpeed;
    dst.ringLinearDamping = src.ringLinearDamping;
    dst.ringAngularDamping = src.ringAngularDamping;
    dst.tumbleTorqueScale = src.tumbleTorqueScale;
    dst.ringFriction = src.ringFriction;
    dst.ringRestitution = src.ringRestitution;
    dst.jetAfterglowSec = src.jetAfterglowSec;
    dst.circulationMaxSpeed = src.circulationMaxSpeed;
    dst.circulationChargeRate = src.circulationChargeRate;
    dst.turbulenceBaseSpeed = src.turbulenceBaseSpeed;
    dst.turbulenceFlowSpeed = src.turbulenceFlowSpeed;
    dst.funnel = { ...src.funnel };
    dst.measured = { ...src.measured };
}

/** 全局激活的底层物理参数（由 FeelConfig 经 FeelSolver 换算并由 applyFeel 实时更新） */
export const SolvedFeelConfig: SolvedFeel = solveFeel(FeelConfig);

const appliedListeners: FeelAppliedListener[] = [];

/** 注册 applyFeel() 生效回调（供引擎层场景对象同步位置与物理参数） */
export function onFeelApplied(cb: FeelAppliedListener): () => void {
    if (!appliedListeners.includes(cb)) {
        appliedListeners.push(cb);
    }
    return () => {
        offFeelApplied(cb);
    };
}

export function offFeelApplied(cb: FeelAppliedListener): void {
    const idx = appliedListeners.indexOf(cb);
    if (idx >= 0) {
        appliedListeners.splice(idx, 1);
    }
}

/**
 * 立刻按当前 FeelConfig（或传入的局部覆盖值）重新换算并下发到底层系统。
 * 供调参面板（T011）及测试在修改体感参数后实时生效。
 */
export function applyFeel(overrides?: Partial<FeelParams>): Readonly<SolvedFeel> {
    if (overrides) {
        Object.assign(FeelConfig, overrides);
    }
    const next = solveFeel(FeelConfig);
    copySolvedFeel(next, SolvedFeelConfig);

    const snapshot = appliedListeners.slice();
    for (let i = 0; i < snapshot.length; i++) {
        snapshot[i](SolvedFeelConfig, FeelConfig);
    }
    return SolvedFeelConfig;
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
