/**
 * 手感参数配置（GDD §3.4）。
 * T004 先放入柱子位置起始值；其余体感参数在 T010 补齐。
 */
export interface FeelParams {
    /** 左柱距缸左侧百分比（右柱对称在 100 - pillarPosPct） */
    pillarPosPct: number;
    /** 柱底离缸底百分比 */
    pillarBottomPct: number;
}

export const DEFAULT_FEEL_CONFIG: Readonly<FeelParams> = {
    pillarPosPct: 32,
    pillarBottomPct: 26,
};

/** 运行时可调节的手感参数实例 */
export const FeelConfig: FeelParams = {
    ...DEFAULT_FEEL_CONFIG,
};
