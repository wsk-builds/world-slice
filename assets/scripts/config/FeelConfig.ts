/**
 * 手感参数配置（GDD §3.4）。
 * T004 先放入柱子位置起始值；其余体感参数在 T010 补齐。
 */
export interface FeelParams {
    /** 左柱距缸左侧百分比（右柱对称在 100 - pillarPosPct） */
    pillarPosPct: number;
    /** 柱底离缸底百分比 */
    pillarBottomPct: number;
    /**
     * 临时底层物理参数（T005/T008 调试用），T010 接入 FeelSolver 后由体感参数换算覆盖。
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
}

export const DEFAULT_FEEL_CONFIG: Readonly<FeelParams> = {
    pillarPosPct: 32,
    pillarBottomPct: 26,
    baseSinkAccel: 525,
    ringLinearDamping: 2.5,
    ringAngularDamping: 3.0,
    ringFriction: 0.03,
    ringRestitution: 0.12,
};

/** 运行时可调节的手感参数实例 */
export const FeelConfig: FeelParams = {
    ...DEFAULT_FEEL_CONFIG,
};
