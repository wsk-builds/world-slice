/**
 * 手感参数配置（GDD §3.4）。
 * T004 先放入柱子位置起始值；其余体感参数在 T010 补齐。
 */
export interface FeelParams {
    /** 左柱距缸左侧百分比（右柱对称在 100 - pillarPosPct） */
    pillarPosPct: number;
    /** 柱底离缸底百分比 */
    pillarBottomPct: number;
    /** 左海眼距缸左侧百分比（右海眼对称在 100 - nozzlePosPct，GDD §3.4：17% / 83%） */
    nozzlePosPct: number;
    /** 海眼喷流向缸中心内倾角（度，GDD §3.4：约 10°） */
    nozzleTiltDeg: number;
    /** 全缸环流衰减至 5% 的时间（秒，GDD §3.3：1.5–2.0 秒，起始值 1.75） */
    circulationDecaySec: number;
    /** 松手或单口气喷完后主喷流余韵衰减至 5% 的时间（秒，GDD §3.3：0.25–0.3 秒） */
    jetAfterglowSec: number;
    /** 气囊单口气最长持续出水时间（秒，GDD §2.2 / §3.4：约 0.65 秒） */
    bladderMaxBreathSec: number;
    /** 气囊松手回弹吸满时间（秒，GDD §3.4 / T010：约 0.2–0.25 秒，起始值 0.22） */
    bladderRefillSec: number;
    /**
     * 临时底层物理与水流参数（T005/T006/T008 使用），T010 接入 FeelSolver 后按体感参数换算覆盖。
     * 基准下沉加速度（像素/秒²），配合 ringLinearDamping=2.5 约 3 秒沉底
     */
    baseSinkAccel: number;
    /** 圈的线性阻尼（模拟水的粘滞阻力） */
    ringLinearDamping: number;
    /** 圈的角阻尼（抑制旋转疯转） */
    ringAngularDamping: number;
    /** 圈横条碰撞摩擦系数 */
    ringFriction: number;
    /** 圈碰撞弹性系数 */
    ringRestitution: number;
    /** 主喷流在海眼口中心的最大水速（像素/秒） */
    jetMaxSpeed: number;
    /** 全缸环流满动量时的最大边缘水速（像素/秒） */
    circulationMaxSpeed: number;
    /** 喷水向环流注入动量的速率（1/秒） */
    circulationChargeRate: number;
    /** 平静时的微弱底噪扰动水速（像素/秒） */
    turbulenceBaseSpeed: number;
    /** 水流活跃时附加的扰动水速（像素/秒） */
    turbulenceFlowSpeed: number;
}

export const DEFAULT_FEEL_CONFIG: Readonly<FeelParams> = {
    pillarPosPct: 32,
    pillarBottomPct: 26,
    nozzlePosPct: 17,
    nozzleTiltDeg: 10,
    circulationDecaySec: 1.75,
    jetAfterglowSec: 0.28,
    bladderMaxBreathSec: 0.65,
    bladderRefillSec: 0.22,
    baseSinkAccel: 525,
    ringLinearDamping: 2.5,
    ringAngularDamping: 3.0,
    ringFriction: 0.03,
    ringRestitution: 0.12,
    jetMaxSpeed: 1100,
    circulationMaxSpeed: 220,
    circulationChargeRate: 1.8,
    turbulenceBaseSpeed: 10,
    turbulenceFlowSpeed: 22,
};

/** 运行时可调节的手感参数实例 */
export const FeelConfig: FeelParams = {
    ...DEFAULT_FEEL_CONFIG,
};
