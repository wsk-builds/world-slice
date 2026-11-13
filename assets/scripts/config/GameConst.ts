/**
 * 全局规则常数与几何结构常量（纯逻辑，不依赖引擎）。
 */
export const GameConst = {
    /** 统一调试开关，正式发布时置为 false */
    DEBUG: true,

    /** 单根柱子最多叠放的圈数 */
    pillarCapacity: 6,

    /** 中号圈外径占缸宽的比例（GDD §3.4：约 1/7.5） */
    ringOuterDiameterRatio: 1 / 7.5,

    /** 中号圈管粗（像素） */
    ringThickness: 20,

    /** 柱杆宽度（像素，远小于圈内径） */
    pillarWidth: 18,

    /** 柱底托比中号圈内径多出的总宽度（像素，确保圈两端碰撞圆心稳落在底托顶面内） */
    pillarBaseExtraWidth: 28,

    /** 柱底托高度（像素） */
    pillarBaseHeight: 16,

    /** 缸壁碰撞厚度（像素，位于内屏外侧） */
    tankWallThickness: 24,

    /** 左右底角向内圆弧半径（像素，小于海眼位置 17% = 159.8px，避免占海眼位） */
    tankCornerRadius: 90,

    /** 单个底角圆弧用多少段折线近似 */
    tankCornerSegments: 8,

    /** 底角折线外推厚度（像素），确保每段为严格凸四边形 */
    tankCornerStripThickness: 14,

    /** 海眼喷口初始半宽（像素，对应 GDD 附录海眼 80×40） */
    jetMouthHalfWidth: 32,

    /** 主喷流下窄上宽锥形半张角（度） */
    jetHalfAngleDeg: 14,

    /** 水体涡流扰动的空间特征尺度（像素） */
    turbulenceSpatialScale: 180,

    /** 水体涡流扰动随时间演化的频率（1/秒） */
    turbulenceTimeRate: 0.45,
} as const;

export interface RingPillarGeometry {
    ringOuterDiameter: number;
    ringThickness: number;
    ringInnerDiameter: number;
    pillarWidth: number;
    pillarHeight: number;
    pillarBaseWidth: number;
    pillarBaseHeight: number;
}

/** 按当前缸宽与配置常数计算圈与柱子的基准几何尺寸。 */
export function calcRingPillarGeometry(tankWidth: number): RingPillarGeometry {
    const ringOuterDiameter = tankWidth * GameConst.ringOuterDiameterRatio;
    const ringThickness = GameConst.ringThickness;
    const ringInnerDiameter = ringOuterDiameter - ringThickness * 2;
    const pillarWidth = GameConst.pillarWidth;
    const pillarHeight = GameConst.pillarCapacity * ringThickness;
    const pillarBaseWidth = ringInnerDiameter + GameConst.pillarBaseExtraWidth;
    const pillarBaseHeight = GameConst.pillarBaseHeight;

    return {
        ringOuterDiameter,
        ringThickness,
        ringInnerDiameter,
        pillarWidth,
        pillarHeight,
        pillarBaseWidth,
        pillarBaseHeight,
    };
}
