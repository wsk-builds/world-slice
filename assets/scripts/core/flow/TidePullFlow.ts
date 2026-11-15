import { GameConst } from '../../config/GameConst';
import { FlowTermObject, FlowVec2 } from './FlowField';
import { FunnelBoost } from '../rules/FunnelMath';

export interface TidePullFlowConfig {
    /** 漩流作用半径（像素） */
    radiusPx: number;
    /** 向柱尖汇聚的峰值径向速度（像素/秒） */
    inwardSpeed: number;
    /** 顺时针旋转的峰值切向速度（像素/秒） */
    tangentSpeed: number;
    /** 柱尖上方区域的温和下引速度（像素/秒） */
    downwardSpeed: number;
    /** 核心平滑半径（像素，防止中心奇点剧烈抖动） */
    coreRadiusPx: number;
    /** 汇聚焦点相对柱尖 tipY 的竖直偏移（像素） */
    focusOffsetY: number;
}

export function buildTidePullFlowConfig(
    overrides: Partial<TidePullFlowConfig> = {},
): TidePullFlowConfig {
    return {
        radiusPx: Math.max(10, overrides.radiusPx ?? GameConst.tidePullSwirlRadiusPx),
        inwardSpeed: Math.max(0, overrides.inwardSpeed ?? GameConst.tidePullSwirlInwardSpeed),
        tangentSpeed: Math.max(0, overrides.tangentSpeed ?? GameConst.tidePullSwirlTangentSpeed),
        downwardSpeed: Math.max(0, overrides.downwardSpeed ?? GameConst.tidePullSwirlDownwardSpeed),
        coreRadiusPx: Math.max(1, overrides.coreRadiusPx ?? GameConst.tidePullSwirlCoreRadiusPx),
        focusOffsetY: overrides.focusOffsetY ?? GameConst.tidePullSwirlFocusOffsetY,
    };
}

/** 生成 T018 左柱「潮引」的标准漏斗增益配置（带低宽容/0宽容保底） */
export function buildTidePullFunnelBoost(): FunnelBoost {
    return {
        radiusScale: GameConst.tidePullFunnelRadiusScale,
        maxTiltDeg: GameConst.tidePullFunnelMaxTiltDeg,
        pullScale: GameConst.tidePullFunnelPullScale,
        alignScale: GameConst.tidePullFunnelPullScale,
        minRadiusPx: GameConst.tidePullFunnelMinRadiusPx,
        minPullAccel: GameConst.tidePullFunnelMinPullAccel,
        minAlignRate: GameConst.tidePullFunnelMinAlignRate,
        maxVy: GameConst.tidePullFunnelMaxVy,
    };
}

function clamp01(v: number): number {
    if (!(v > 0)) {
        return 0;
    }
    return v >= 1 ? 1 : v;
}

/**
 * 左柱技能「潮引」的 FlowField 漩流项（纯逻辑，不依赖引擎）：
 * - 在左柱柱尖灵珠上方形成顺时针向心汇聚的漩流场，将气泡与飘入左柱上半区附近的自由圈引向柱尖；
 * - 低于柱尖高度时快速衰减向心水平分量，杜绝把圈从侧面拉撞到柱杆外壁；
 * - 支持 `suppressed`（如左柱满柱时停止硬吸）与即时激活/停用。
 */
export class TidePullFlowTerm implements FlowTermObject {
    readonly id = 'skill:tide-pull';

    config: TidePullFlowConfig;

    private active = false;
    private suppressedState = false;
    private pillarX = 0;
    private tipY = 0;
    private centerY = 0;
    private elapsed = 0;

    constructor(overrides: Partial<TidePullFlowConfig> = {}) {
        this.config = buildTidePullFlowConfig(overrides);
    }

    get isActive(): boolean {
        return this.active;
    }

    get suppressed(): boolean {
        return this.suppressedState;
    }

    set suppressed(value: boolean) {
        this.suppressedState = Boolean(value);
    }

    get centerX(): number {
        return this.pillarX;
    }

    get focusY(): number {
        return this.centerY;
    }

    get pillarTipY(): number {
        return this.tipY;
    }

    /** 设置左柱当前缸坐标位置，漩流中心自动锚定于柱尖上方灵珠处 */
    setPillarAnchor(pillarX: number, tipY: number): void {
        this.pillarX = pillarX;
        this.tipY = tipY;
        this.centerY = tipY + this.config.focusOffsetY;
    }

    /** 激活「潮引」漩流项 */
    activate(pillarX: number, tipY: number): void {
        this.setPillarAnchor(pillarX, tipY);
        this.active = true;
        this.suppressedState = false;
        this.elapsed = 0;
    }

    /** 停用「潮引」漩流项 */
    deactivate(): void {
        this.active = false;
        this.suppressedState = false;
        this.elapsed = 0;
    }

    step(dt: number): void {
        if (!this.active || !(dt > 0)) {
            return;
        }
        this.elapsed += dt;
    }

    sample(x: number, y: number, out: FlowVec2): void {
        if (!this.active || this.suppressedState) {
            out.x = 0;
            out.y = 0;
            return;
        }

        const dx = x - this.pillarX;
        const dy = y - this.centerY;
        const dist = Math.hypot(dx, dy);
        const radius = this.config.radiusPx;

        if (dist >= radius || dist <= 1e-6) {
            out.x = 0;
            out.y = 0;
            return;
        }

        const u = dist / radius;
        const falloff = 1 - u * u;
        const core = dist / (dist + this.config.coreRadiusPx);

        // 低于柱尖时快速衰减向心水平牵引与漩流，避免把柱侧下方的圈横推撞向柱杆
        const belowTip = this.tipY - y;
        const inwardYGate = belowTip <= 0 ? 1 : Math.max(0, 1 - belowTip / 12);
        const swirlYGate = belowTip <= 0 ? 1 : Math.max(0, 1 - belowTip / 48);

        const invDist = 1 / dist;
        const rx = -dx * invDist;
        const ry = -dy * invDist;
        // 顺时针切向向量，与左侧海眼喷流自然形成的顺时针环流一致
        const tx = dy * invDist;
        const ty = -dx * invDist;

        const inwardGain = core * falloff * this.config.inwardSpeed * inwardYGate;
        const tangentGain = core * falloff * this.config.tangentSpeed * swirlYGate;
        const downWeight = dy > 16 ? clamp01((dy - 16) / 48) : 0;
        const downSpeed = this.config.downwardSpeed * falloff * downWeight;

        let vx = rx * inwardGain + tx * tangentGain;
        const vy = ry * inwardGain + ty * tangentGain - downSpeed;

        // 低于柱尖少许高度且水平分量指向柱轴时强制归零，彻底杜绝从侧面把圈推进柱杆
        if (belowTip > 6 && vx * dx < 0) {
            vx *= inwardYGate;
        }

        out.x = vx === 0 ? 0 : vx;
        out.y = vy === 0 ? 0 : vy;
    }
}
