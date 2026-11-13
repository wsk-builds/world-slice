/**
 * 12 个体感结果参数配置（GDD §3.4，对齐参考视频比例）。
 * 所有底层物理量（下沉加速度、跟随度、喷流强度、角阻尼、漏斗等）均由 core/flow/FeelSolver.ts 换算得出。
 */
export interface FeelParams {
    /** 1. 普通圈从水面沉到缸底的秒数（起始值 3 秒） */
    sinkSec: number;
    /** 2. 轻点一下（约 0.1 秒）推升普通圈达到的缸高百分比（起始值 40%） */
    tapLiftPct: number;
    /** 3. 按满一口气推升普通圈达到的缸高百分比（起始值 85%） */
    holdLiftPct: number;
    /** 4. 气囊单口气最长持续出水时间（秒，GDD §2.2 / §3.4：起始值 0.65） */
    bladderMaxBreathSec: number;
    /** 5. 气囊松手回弹吸满时间（秒，GDD §3.4：起始值 0.22） */
    bladderRefillSec: number;
    /** 6. 左柱距缸左侧百分比（右柱对称在 100 - pillarPosPct，起始值 32.5%） */
    pillarPosPct: number;
    /** 7. 柱尾尖离缸底百分比（起始值 31%，使十字卡托承接面落在约 42.5% 缸高，对齐视频） */
    pillarBottomPct: number;
    /** 8. 左海眼距缸左侧百分比（右海眼对称在 100 - nozzlePosPct，起始值 14%） */
    nozzlePosPct: number;
    /** 9. 海眼喷流向缸中心内倾角（度，起始值 10°） */
    nozzleTiltDeg: number;
    /** 10. 全缸环流衰减至 5% 的时间（秒，GDD §3.3：起始值 1.75） */
    circulationDecaySec: number;
    /** 11. 翻滚灵敏度（0–1 旋钮，起始值 0.5） */
    tumbleSensitivity: number;
    /** 12. 入柱宽容（0–1 旋钮，起始值 0.5） */
    funnelTolerance: number;
}

export const DEFAULT_FEEL_CONFIG: Readonly<FeelParams> = {
    sinkSec: 3,
    tapLiftPct: 40,
    holdLiftPct: 85,
    bladderMaxBreathSec: 0.65,
    bladderRefillSec: 0.22,
    pillarPosPct: 32.5,
    pillarBottomPct: 31,
    nozzlePosPct: 14,
    nozzleTiltDeg: 10,
    circulationDecaySec: 1.75,
    tumbleSensitivity: 0.5,
    funnelTolerance: 0.5,
};

/** 不作为调参滑块暴露的底层物理基数，供 FeelSolver 与 FlowField 换算使用 */
export const FEEL_BASE_CONST = {
    /** 圈在水中除水流跟随阻力外的粘滞线性阻尼（1/秒） */
    ringLinearDamping: 0.5,
    /** 松手或单口气喷完后主喷流余韵衰减至 5% 的时间（秒，GDD §3.3：0.25–0.3 秒） */
    jetAfterglowSec: 0.28,
    /** 圈管碰撞摩擦系数（适度摩擦使缸底与柱上斜靠堆叠稳固自然） */
    ringFriction: 0.14,
    /** 圈碰撞弹性系数 */
    ringRestitution: 0.12,
    /** 基准全缸环流满动量边缘水速（像素/秒） */
    circulationMaxSpeed: 310,
    /** 喷水向环流注入动量的速率（1/秒） */
    circulationChargeRate: 2.4,
    /** 平静时的微弱底噪扰动水速（像素/秒） */
    turbulenceBaseSpeed: 12,
    /** 水流活跃时附加的扰动水速（像素/秒） */
    turbulenceFlowSpeed: 28,
    /** 前后纵深 Z 方向的涡流翻转速度（像素/秒，推动正圆环绕 X/Y 轴真 3D 侧翻） */
    zSwirlSpeed: 68,
    /** 喷流上升时向 z=0 柱位中平面的柔和回中系数（1/秒，避免圈贴死前后玻璃套不上柱） */
    zCenteringRate: 1.65,
    /** 轻点一下的时长定义（秒，GDD §2.2：约 0.1 秒） */
    tapDurationSec: 0.1,
} as const;

/** 运行时可调节的 12 个体感参数实例 */
export const FeelConfig: FeelParams = {
    ...DEFAULT_FEEL_CONFIG,
};
