import { FeelConfig, FeelParams } from '../../config/FeelConfig';
import { GameConst } from '../../config/GameConst';
import { Point2D, TankSpace } from '../../config/TankSpace';
import { CurlNoise } from './CurlNoise';
import { solveFeel, SolvedFeelConfig } from './FeelSolver';
import {
    buildJetConeGeometry,
    JetConeGeometry,
    LN20,
    NozzlePose,
    sampleSingleNozzleVelocity,
    stepJetAfterglowLevel,
} from './JetProfile';

const ZERO_THRESHOLD = 1e-6;

export type FlowSide = 'left' | 'right';

export type FlowVec2 = Point2D;

export interface FlowVec3 {
    x: number;
    y: number;
    z: number;
}

/** 函数形式的额外水流项：计算缸坐标 (x, y) 处的速度分量写入 out */
export type FlowTermFn = (x: number, y: number, out: FlowVec2) => void;

/** 对象形式的额外水流项：支持可选 id 与随时间推进 step(dt) */
export interface FlowTermObject {
    readonly id?: string;
    sample(x: number, y: number, out: FlowVec2): void;
    step?(dt: number): void;
}

export type FlowTerm = FlowTermFn | FlowTermObject;

export interface FlowFieldConfig {
    seed: number;
    tankWidth: number;
    tankHeight: number;
    pillarBottomPct: number;
    nozzlePosPct: number;
    nozzleTiltDeg: number;
    jetMouthHalfWidth: number;
    jetHalfAngleDeg: number;
    jetMaxSpeed: number;
    jetAfterglowSec: number;
    circulationMaxSpeed: number;
    circulationChargeRate: number;
    circulationDecaySec: number;
    turbulenceBaseSpeed: number;
    turbulenceFlowSpeed: number;
    turbulenceSpatialScale: number;
    turbulenceTimeRate: number;
    /** 扰动整体缩放（1 为正常，0 为关闭扰动；供 T019 定海与测试使用） */
    turbulenceScale: number;
    /** 环流整体缩放（1 为正常；供 T019 定海与机关使用） */
    circulationScale: number;
}

export function buildFlowFieldConfig(
    overrides: Partial<FlowFieldConfig> = {},
    feel: Readonly<FeelParams> = FeelConfig,
): FlowFieldConfig {
    const solved = feel === FeelConfig ? SolvedFeelConfig : solveFeel(feel);
    return {
        seed: overrides.seed ?? 1,
        tankWidth: overrides.tankWidth ?? TankSpace.width,
        tankHeight: overrides.tankHeight ?? TankSpace.height,
        pillarBottomPct: overrides.pillarBottomPct ?? feel.pillarBottomPct,
        nozzlePosPct: overrides.nozzlePosPct ?? feel.nozzlePosPct,
        nozzleTiltDeg: overrides.nozzleTiltDeg ?? feel.nozzleTiltDeg,
        jetMouthHalfWidth: overrides.jetMouthHalfWidth ?? GameConst.jetMouthHalfWidth,
        jetHalfAngleDeg: overrides.jetHalfAngleDeg ?? GameConst.jetHalfAngleDeg,
        jetMaxSpeed: overrides.jetMaxSpeed ?? solved.jetMaxSpeed,
        jetAfterglowSec: overrides.jetAfterglowSec ?? solved.jetAfterglowSec,
        circulationMaxSpeed: overrides.circulationMaxSpeed ?? solved.circulationMaxSpeed,
        circulationChargeRate: overrides.circulationChargeRate ?? solved.circulationChargeRate,
        circulationDecaySec: overrides.circulationDecaySec ?? feel.circulationDecaySec,
        turbulenceBaseSpeed: overrides.turbulenceBaseSpeed ?? solved.turbulenceBaseSpeed,
        turbulenceFlowSpeed: overrides.turbulenceFlowSpeed ?? solved.turbulenceFlowSpeed,
        turbulenceSpatialScale: overrides.turbulenceSpatialScale ?? GameConst.turbulenceSpatialScale,
        turbulenceTimeRate: overrides.turbulenceTimeRate ?? GameConst.turbulenceTimeRate,
        turbulenceScale: overrides.turbulenceScale ?? 1,
        circulationScale: overrides.circulationScale ?? 1,
    };
}

export type { NozzlePose };

/**
 * 基础项 1：左右海眼主喷流（下窄上宽锥形，底部强、到柱尖高度发散变柔，松手 0.25–0.3 秒余韵）。
 */
export class JetFlowTerm implements FlowTermObject {
    readonly id = 'base:jet';

    private leftInput = 0;
    private rightInput = 0;
    private leftLevel = 0;
    private rightLevel = 0;

    private cone: JetConeGeometry;
    private jetMaxSpeed = 1100;
    private afterglowSec = 0.28;

    constructor(config: FlowFieldConfig) {
        this.cone = buildJetConeGeometry(config);
        this.applyConfig(config);
    }

    applyConfig(config: FlowFieldConfig): void {
        this.cone = buildJetConeGeometry(config);
        this.jetMaxSpeed = Math.max(0, config.jetMaxSpeed);
        this.afterglowSec = Math.max(0.01, config.jetAfterglowSec);
    }

    /** 设置单侧外部输入强度（0–1）；按下或加大力度时 0 延迟立刻提升当前水柱强度 */
    setInput(side: FlowSide, strength: number): void {
        const clamped = clamp01(strength);
        if (side === 'left') {
            this.leftInput = clamped;
            if (clamped >= this.leftLevel) {
                this.leftLevel = clamped;
            }
        } else {
            this.rightInput = clamped;
            if (clamped >= this.rightLevel) {
                this.rightLevel = clamped;
            }
        }
    }

    getInput(side: FlowSide): number {
        return side === 'left' ? this.leftInput : this.rightInput;
    }

    /** 当前实际生效的喷流强度（含松手后的余韵，0–1） */
    getLevel(side: FlowSide): number {
        return side === 'left' ? this.leftLevel : this.rightLevel;
    }

    getNozzlePose(side: FlowSide): Readonly<NozzlePose> {
        return side === 'left' ? this.cone.leftNozzle : this.cone.rightNozzle;
    }

    reset(): void {
        this.leftInput = 0;
        this.rightInput = 0;
        this.leftLevel = 0;
        this.rightLevel = 0;
    }

    step(dt: number): void {
        if (!(dt > 0)) {
            return;
        }
        const decay = Math.exp((-LN20 * dt) / this.afterglowSec);
        this.leftLevel = stepJetAfterglowLevel(this.leftLevel, this.leftInput, decay);
        this.rightLevel = stepJetAfterglowLevel(this.rightLevel, this.rightInput, decay);
    }

    sample(x: number, y: number, out: FlowVec2): void {
        let vx = 0;
        let vy = 0;
        if (this.leftLevel > 0) {
            const l = sampleSingleNozzleVelocity(
                this.cone.leftNozzle,
                this.cone,
                this.jetMaxSpeed,
                this.leftLevel,
                x,
                y,
                scratchNozzle,
            );
            vx += l.x;
            vy += l.y;
        }
        if (this.rightLevel > 0) {
            const r = sampleSingleNozzleVelocity(
                this.cone.rightNozzle,
                this.cone,
                this.jetMaxSpeed,
                this.rightLevel,
                x,
                y,
                scratchNozzle,
            );
            vx += r.x;
            vy += r.y;
        }
        out.x = vx;
        out.y = vy;
    }
}

/**
 * 基础项 2：全缸环流（左键顺时针 > 0，右键逆时针 < 0，松手按 1.5–2.0 秒指数衰减）。
 * 采用贴合水缸长宽比的无散椭圆旋转流场：左侧上涌、顶部右移、右侧下潜、缸底左卷回海眼（顺时针）。
 */
export class CirculationFlowTerm implements FlowTermObject {
    readonly id = 'base:circulation';

    /** 整体缩放系数（默认 1，供技能或机关临时压低环流） */
    scale = 1;

    private leftInput = 0;
    private rightInput = 0;
    /** 归一化环流动量 [-1, 1]：正数为顺时针，负数为逆时针 */
    private momentum = 0;

    private halfW = TankSpace.width / 2;
    private halfH = TankSpace.height / 2;
    private maxSpeed = 220;
    private chargeRate = 1.8;
    private decaySec = 1.75;

    constructor(config: FlowFieldConfig) {
        this.applyConfig(config);
    }

    applyConfig(config: FlowFieldConfig): void {
        this.halfW = Math.max(1, config.tankWidth / 2);
        this.halfH = Math.max(1, config.tankHeight / 2);
        this.maxSpeed = Math.max(0, config.circulationMaxSpeed);
        this.chargeRate = Math.max(0, config.circulationChargeRate);
        this.decaySec = Math.max(0.05, config.circulationDecaySec);
        this.scale = config.circulationScale;
    }

    setInput(side: FlowSide, strength: number): void {
        const clamped = clamp01(strength);
        if (side === 'left') {
            this.leftInput = clamped;
        } else {
            this.rightInput = clamped;
        }
    }

    /** 当前归一化环流动量（正 = 顺时针，负 = 逆时针） */
    getMomentum(): number {
        return this.momentum;
    }

    reset(): void {
        this.leftInput = 0;
        this.rightInput = 0;
        this.momentum = 0;
    }

    step(dt: number): void {
        if (!(dt > 0)) {
            return;
        }
        const decayRate = LN20 / this.decaySec;
        const decay = Math.exp(-decayRate * dt);
        const netInput = this.leftInput - this.rightInput;

        if (netInput === 0) {
            this.momentum *= decay;
            if (Math.abs(this.momentum) < ZERO_THRESHOLD) {
                this.momentum = 0;
            }
            return;
        }

        const steady = (this.chargeRate / decayRate) * netInput;
        const next = steady + (this.momentum - steady) * decay;
        this.momentum = Math.max(-1, Math.min(1, next));
    }

    sample(x: number, y: number, out: FlowVec2): void {
        const eff = this.momentum * this.scale;
        if (eff === 0 || this.maxSpeed === 0) {
            out.x = 0;
            out.y = 0;
            return;
        }

        const nx = Math.max(-1, Math.min(1, (x - this.halfW) / this.halfW));
        const ny = Math.max(-1, Math.min(1, (y - this.halfH) / this.halfH));
        const aspect = this.halfH / this.halfW;

        // 贴近左右缸壁时平滑收零横向推墙分量，避免喷水环流把边角圈死死压在底角内壁上
        const wallTaperX = 1 - 0.85 * nx * nx;
        const wallTaperY = 1 - 0.85 * ny * ny;

        // 顺时针（eff > 0）：上右(+x)、右侧下(-y)、底部左(-x)、左侧上(+y)
        out.x = eff * this.maxSpeed * ny * wallTaperX;
        out.y = -eff * this.maxSpeed * nx * aspect * wallTaperY;
    }
}

/**
 * 基础项 3：少量可复现扰动（基于 SeededRandom 初始化的二维旋度噪声）。
 */
export class TurbulenceFlowTerm implements FlowTermObject {
    readonly id = 'base:turbulence';

    /** 整体缩放系数（默认 1，设为 0 可关闭扰动） */
    scale = 1;

    private readonly curlNoise: CurlNoise;
    private elapsed = 0;
    private activity = 0;
    private baseSpeed = 10;
    private flowSpeed = 22;
    private spatialScale = 180;
    private timeRate = 0.45;

    constructor(config: FlowFieldConfig) {
        this.curlNoise = new CurlNoise(config.seed);
        this.applyConfig(config);
    }

    applyConfig(config: FlowFieldConfig): void {
        this.baseSpeed = Math.max(0, config.turbulenceBaseSpeed);
        this.flowSpeed = Math.max(0, config.turbulenceFlowSpeed);
        this.spatialScale = Math.max(10, config.turbulenceSpatialScale);
        this.timeRate = Math.max(0, config.turbulenceTimeRate);
        this.scale = config.turbulenceScale;
    }

    /** 由 FlowField 同步当前水流活跃度（0–1），喷水与环流越强则涡流略增 */
    setActivity(activity: number): void {
        this.activity = clamp01(activity);
    }

    reset(seed?: number): void {
        this.elapsed = 0;
        this.activity = 0;
        if (seed !== undefined) {
            this.curlNoise.reseed(seed);
        }
    }

    step(dt: number): void {
        if (!(dt > 0)) {
            return;
        }
        this.elapsed += dt;
    }

    sample(x: number, y: number, out: FlowVec2): void {
        if (this.scale === 0) {
            out.x = 0;
            out.y = 0;
            return;
        }
        const amp = (this.baseSpeed + this.flowSpeed * this.activity) * this.scale;
        if (amp === 0) {
            out.x = 0;
            out.y = 0;
            return;
        }
        this.curlNoise.sample(
            x / this.spatialScale,
            y / this.spatialScale,
            this.elapsed * this.timeRate,
            out,
        );
        out.x *= amp;
        out.y *= amp;
    }

    /** 采样与 X-Y 解耦的前后纵深 Z 向归一化涡流（[-1, 1] 量级，纯空间时间函数不消耗随机序列） */
    sampleNormalizedZ(x: number, y: number, z: number, outScratch: FlowVec2): number {
        if (this.scale === 0) {
            return 0;
        }
        this.curlNoise.sample(
            (x + 313.7 + z * 0.65) / this.spatialScale,
            (y + 577.3 - z * 0.65) / this.spatialScale,
            this.elapsed * this.timeRate + 19.4,
            outScratch,
        );
        return outScratch.x * this.scale;
    }
}

const scratchTerm: FlowVec2 = { x: 0, y: 0 };
const scratchNozzle: FlowVec2 = { x: 0, y: 0 };

/**
 * 水缸水流速度场（纯逻辑，不依赖引擎，坐标一律为缸坐标，单位：像素/秒）。
 * 总水速 = 主喷流 + 全缸环流 + 少量扰动 + 通过 addTerm 挂载的机关/技能项。
 */
export class FlowField {
    readonly jet: JetFlowTerm;
    readonly circulation: CirculationFlowTerm;
    readonly turbulence: TurbulenceFlowTerm;

    private config: FlowFieldConfig;
    private readonly extraTerms: FlowTerm[] = [];

    constructor(overrides: Partial<FlowFieldConfig> = {}, feel: Readonly<FeelParams> = FeelConfig) {
        this.config = buildFlowFieldConfig(overrides, feel);
        this.jet = new JetFlowTerm(this.config);
        this.circulation = new CirculationFlowTerm(this.config);
        this.turbulence = new TurbulenceFlowTerm(this.config);
    }

    /** 按最新配置（如调参面板或 FeelSolver 修改后）刷新各项参数 */
    applyConfig(overrides: Partial<FlowFieldConfig> = {}, feel: Readonly<FeelParams> = FeelConfig): void {
        const prevSeed = this.config.seed;
        const prevTurbScale = overrides.turbulenceScale ?? this.turbulence.scale;
        const prevCircScale = overrides.circulationScale ?? this.circulation.scale;
        this.config = buildFlowFieldConfig(
            {
                seed: prevSeed,
                ...overrides,
                turbulenceScale: prevTurbScale,
                circulationScale: prevCircScale,
            },
            feel,
        );
        this.jet.applyConfig(this.config);
        this.circulation.applyConfig(this.config);
        this.turbulence.applyConfig(this.config);
        if (overrides.seed !== undefined && overrides.seed !== prevSeed) {
            this.turbulence.reset(overrides.seed);
        }
    }

    /** 设置单侧海眼外部输入强度（0–1） */
    setJetInput(side: FlowSide, strength: number): void {
        this.jet.setInput(side, strength);
        this.circulation.setInput(side, strength);
        this.syncTurbulenceActivity();
    }

    /** 同时设置左右海眼外部输入强度（0–1） */
    setJetInputs(leftStrength: number, rightStrength: number): void {
        this.jet.setInput('left', leftStrength);
        this.jet.setInput('right', rightStrength);
        this.circulation.setInput('left', leftStrength);
        this.circulation.setInput('right', rightStrength);
        this.syncTurbulenceActivity();
    }

    getJetInput(side: FlowSide): number {
        return this.jet.getInput(side);
    }

    /** 当前实际生效的喷流强度（含松手余韵，0–1） */
    getJetLevel(side: FlowSide): number {
        return this.jet.getLevel(side);
    }

    /** 当前归一化全缸环流动量（正 = 顺时针，负 = 逆时针） */
    getCirculation(): number {
        return this.circulation.getMomentum();
    }

    /** 挂载额外水流项（供潮引、定海、漩涡、深渊暗潮等使用），返回移除函数 */
    addTerm(term: FlowTerm): () => void {
        if (!this.extraTerms.includes(term)) {
            this.extraTerms.push(term);
        }
        return () => {
            this.removeTerm(term);
        };
    }

    /** 移除已挂载的额外水流项 */
    removeTerm(term: FlowTerm): boolean {
        const idx = this.extraTerms.indexOf(term);
        if (idx < 0) {
            return false;
        }
        this.extraTerms.splice(idx, 1);
        return true;
    }

    /** 清空所有额外挂载项 */
    clearExtraTerms(): void {
        this.extraTerms.length = 0;
    }

    /** 重置动态水流状态（喷流、环流、扰动时钟），可选更换新种子 */
    reset(seed?: number): void {
        if (seed !== undefined) {
            this.config.seed = seed;
        }
        this.jet.reset();
        this.circulation.reset();
        this.turbulence.reset(seed);
    }

    /** 推进物理时间 dt（秒）：更新主喷流松手余韵、全缸环流衰减、扰动演化及额外项 */
    step(dt: number): void {
        if (!(dt > 0)) {
            return;
        }
        this.jet.step(dt);
        this.circulation.step(dt);
        this.syncTurbulenceActivity();
        this.turbulence.step(dt);

        for (let i = 0; i < this.extraTerms.length; i++) {
            const term = this.extraTerms[i];
            if (typeof term !== 'function' && term.step) {
                term.step(dt);
            }
        }
    }

    /** 返回缸坐标 (x, y) 此刻的总水速（像素/秒），等于三项基础水流与所有额外项之和 */
    velocityAt(x: number, y: number, out?: FlowVec2): FlowVec2 {
        const target = out ?? { x: 0, y: 0 };
        let vx = 0;
        let vy = 0;

        scratchTerm.x = 0;
        scratchTerm.y = 0;
        this.jet.sample(x, y, scratchTerm);
        vx += scratchTerm.x;
        vy += scratchTerm.y;

        scratchTerm.x = 0;
        scratchTerm.y = 0;
        this.circulation.sample(x, y, scratchTerm);
        vx += scratchTerm.x;
        vy += scratchTerm.y;

        scratchTerm.x = 0;
        scratchTerm.y = 0;
        this.turbulence.sample(x, y, scratchTerm);
        vx += scratchTerm.x;
        vy += scratchTerm.y;

        for (let i = 0; i < this.extraTerms.length; i++) {
            const term = this.extraTerms[i];
            scratchTerm.x = 0;
            scratchTerm.y = 0;
            if (typeof term === 'function') {
                term(x, y, scratchTerm);
            } else {
                term.sample(x, y, scratchTerm);
            }
            vx += scratchTerm.x;
            vy += scratchTerm.y;
        }

        target.x = vx;
        target.y = vy;
        return target;
    }

    /**
     * 采样薄层 3D 水缸内 (x, y, z) 处的三维水速（像素/秒）：
     * - X/Y 主流场与 2D 气泡严格同源，离 z=0 中平面越远水速略柔化以自然产生三维俯仰力矩；
     * - Z 向兼具确定性旋度涡流（驱动正圆环绕 X/Y 轴真 3D 侧翻）与喷流期向 z=0 柱平面的柔和回中。
     */
    velocityAt3D(
        x: number,
        y: number,
        z: number,
        halfDepth: number,
        zSwirlSpeed: number,
        zCenteringRate: number,
        out: FlowVec3 = { x: 0, y: 0, z: 0 },
    ): FlowVec3 {
        this.velocityAt(x, y, scratchTerm);
        const uZ = halfDepth > 1 ? Math.max(-1, Math.min(1, z / halfDepth)) : 0;
        const zProfile = 1 - 0.14 * uZ * uZ;

        out.x = scratchTerm.x * zProfile;
        out.y = scratchTerm.y * zProfile;

        const jetAct = Math.min(1, this.jet.getLevel('left') + this.jet.getLevel('right'));
        const circAct = Math.abs(this.circulation.getMomentum());
        const totalAct = Math.min(1, jetAct + circAct * 0.7);

        const swirlNorm = this.turbulence.sampleNormalizedZ(x, y, z, scratchTerm);
        const swirlVz = swirlNorm * zSwirlSpeed * (0.22 + 0.78 * totalAct);
        const centerVz = -z * zCenteringRate * (0.15 + 0.85 * jetAct);

        out.z = swirlVz + centerVz;
        return out;
    }

    private syncTurbulenceActivity(): void {
        const active = this.jet.getLevel('left') + this.jet.getLevel('right') + Math.abs(this.circulation.getMomentum());
        this.turbulence.setActivity(active);
    }
}

function clamp01(value: number): number {
    if (!(value > 0)) {
        return 0;
    }
    return value >= 1 ? 1 : value;
}
