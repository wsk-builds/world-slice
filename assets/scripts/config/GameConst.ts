/**
 * 全局规则常数与 3D 圈/柱/水缸几何结构常量（纯逻辑，不依赖引擎）。
 * 尺寸比例适配扩容后的 1060 × 606 内屏与纤巧圆环、精巧十字玉柱。
 */
export const GameConst = {
    /** 统一调试开关，正式发布时置为 false */
    DEBUG: true,

    /** 3D 渲染世界单位换算：100 缸内像素 = 1 个 3D 单位 */
    physics3dPtm: 100,

    /** 3D 圈柱相机竖直视场角（度，俯视微透视表现前后纵深与缸底堆圈圆孔立体感，z=0 平面与 2D 1:1 对齐） */
    camera3dFovDeg: 28,

    /** 3D 圈柱相机俯视倾角（度，模拟经典水压掌机斜向下俯看水缸底部的自然立体视角） */
    camera3dPitchDownDeg: 14,

    /** 单根柱子最多叠放的圈数 */
    pillarCapacity: 6,

    /** 中号圈外径占缸宽的比例（1 / 13.25 ≈ 80.0px，比旧版略微缩小且水缸活动空间更宽裕） */
    ringOuterDiameterRatio: 1 / 13.25,

    /** 圈管粗占自身外径的比例（15.5%，中号圈管粗约 12.4px，线条纤巧利落不显胖） */
    ringTubeRatio: 0.155,

    /** 中号圈基准管粗近似常量（像素，供静态参考；精确值由 calcRingPillarGeometry 按缸宽算出） */
    ringThickness: 12.4,

    /** 薄层 3D 水缸前后纵深与中号圈外径之比（约 118px，兼顾全圈种 360° 三轴翻转、前后斜靠堆叠与柱位对齐） */
    tankDepthRatio: 1.48,

    /** 锥形柱杆顶端直径（像素，整体变细更精致且易于入环） */
    pillarTipWidth: 11,

    /** 锥形柱杆根部直径（像素，上尖下粗） */
    pillarRootWidth: 22,

    /** 锥形柱杆中段参考直径（像素） */
    pillarWidth: 16.5,

    /** 单层微倾叠放高度相对管粗的留余系数（适配变细管径下的 15° 自然三维微倾叠放，6 层稳妥对齐柱尖） */
    pillarSlotPitchScale: 1.24,

    /** 十字四翼卡托视觉横向总宽与中号圈外径之比（收短至 0.88 倍 ≈ 70.4px，比圈外径略收敛、精致不挂圈） */
    pillarCrossWidthRatio: 0.88,

    /** 十字四翼卡托视觉前后总深与中号圈外径之比（收短至 0.84 倍 ≈ 67.2px） */
    pillarCrossDepthRatio: 0.84,

    /** 十字卡托承接碰撞区占视觉翼展的比例（0.68：碰撞范围比显示的卡托更短，且取消外伸横刺杜绝竖挂卡圈） */
    pillarCrossColliderRatio: 0.68,

    /** 十字四翼卡托竖向厚度（像素） */
    pillarBaseHeight: 16,

    /** 十字卡托下方悬空收尖尾椎高度（像素） */
    pillarTailHeight: 34,

    /** 缸壁碰撞厚度（像素，位于内壁外侧） */
    tankWallThickness: 24,

    /** 左右底角向内圆弧半径（像素，直接衔接到 14%/86% 海眼外缘，彻底消除海眼外侧平底死角） */
    tankCornerRadius: 122,

    /** 单个底角圆弧用多少段折线近似（供 2D 缸壁绘制与校验） */
    tankCornerSegments: 12,

    /** 底角折线外推厚度（像素） */
    tankCornerStripThickness: 14,

    /** 海眼喷口初始半宽（像素，向左/右延伸深入 122px 底角斜坡区，确保落入两角的圈都能直接被喷流冲起） */
    jetMouthHalfWidth: 68,

    /** 喷射键点击热区向四周外扩像素（点击范围比图形大，GDD 画面铁律） */
    jetBtnHitPadding: 24,

    /** 灰盒默认随机种子（T016 改为从关卡数据读取） */
    defaultLevelSeed: 1024,

    /** 主喷流下窄上宽锥形半张角（度） */
    jetHalfAngleDeg: 16,

    /** 水体涡流扰动的空间特征尺度（像素） */
    turbulenceSpatialScale: 165,

    /** 水体涡流扰动随时间演化的频率（1/秒） */
    turbulenceTimeRate: 0.5,

    /** 气泡池最大同时存在数量上限 */
    bubblePoolMaxCount: 56,

    /** 圈在柱子上连续稳定多久后锁定（秒，GDD §2.1） */
    ringLockDurationSec: 0.3,

    /** 锁定判定的三维线速度上限（像素/秒，收紧以确保圈完全落妥静止后才休眠） */
    ringLockMaxLinearSpeedPx: 18,

    /** 锁定判定的三维角速度上限（弧度/秒，收紧以确保圈不再晃动才休眠） */
    ringLockMaxAngularSpeedRad: 0.45,

    /** 锁定判定允许的最大倾角（度，0° 为水平正圆环） */
    ringLockMaxTiltDeg: 28,

    /** 锁定后保留自然 3D 错落微倾的最大倾角上限（度，既自然斜靠又不影响叠满 6 层） */
    ringLockedRestMaxTiltDeg: 15,

    /** 圈心相对目标槽位高度的容差（像素） */
    ringLockSlotMarginPx: 24,

    /** 同款消除时被消双圈闪烁持续时间（秒） */
    matchFlashDurationSec: 0.22,

    /** 柱上仍有紧邻同色圈正在稳定时，暂缓触发消除的最长等待时间（秒，防卡死） */
    matchDeferMaxSec: 1.2,

    /** 同款消除后上方已锁圈启动平滑下落的延迟时间（秒，待双圈闪亮缩隐后再落） */
    matchDropDelaySec: 0.1,

    /** 同款消除后上方已锁圈沿 Y 轴平滑下落速度（像素/秒） */
    matchDropSpeedPxPerSec: 260,

    /** 同款消除后上方已锁圈平滑下落最短耗时（秒） */
    matchDropMinDurationSec: 0.12,

    /** 同款消除后上方已锁圈平滑下落最长耗时（秒） */
    matchDropMaxDurationSec: 0.26,

    /** 灰盒与默认关卡倒计时（秒，GDD §3.4 为 60–90 秒） */
    defaultLevelDurationSec: 60,

    /** 倒计时最后提示变色阈值（秒） */
    countdownUrgentSec: 10,

    /** 暂停/弹窗按键点击热区外扩像素（GDD 画面铁律：点击范围比图形大） */
    hudBtnHitPadding: 10,

    /** 默认进入的关卡编号 */
    defaultLevelId: 'X01',

    /** 单关同时出现的圈种上限（GDD §2.1：最多 5 种，配合柱容量 6 保证永不锁死） */
    maxLevelRingSpecies: 5,

    /** 关卡数据百分比坐标安全范围（0~100，避开贴壁边缘） */
    levelPosMinXPct: 3,
    levelPosMaxXPct: 97,
    levelPosMinYPct: 2,
    levelPosMaxYPct: 98,

    /** 关卡随机摆位时圈与圈、圈与柱之间的最小间隙（像素） */
    levelRingSpawnGapPx: 6,

    /** 开局随机圈落到两根柱子之一的触发概率（约 5%，100 局约 5 局） */
    startPillarDropChance: 0.05,

    /** 套中锁定一次增加的柱子能量（%，GDD §2.1） */
    energyLockGainPct: 10,

    /** 消除 2 个同款圈额外增加的能量（%） */
    energyMatchBonus2Pct: 20,

    /** 消除 3 个同款圈额外增加的能量（%） */
    energyMatchBonus3Pct: 30,

    /** 消除 4 个同款圈额外增加的能量（%） */
    energyMatchBonus4Pct: 40,

    /** 默认消除额外加能量（2 个圈消除为 20%，保留字段供兼容参考） */
    energyMatchBonusPct: 20,

    /** 柱子满能量触发技能的阈值（%） */
    energyMaxPct: 100,

    /** 十字四翼卡托发光刻度格数（每格对应 10%） */
    energyTickCount: 10,

    /** 柱子技能默认持续时间（秒，期间暂停本柱充能，供 T018/T019 接管） */
    pillarSkillDurationSec: 5,

    /** 充满触发技能瞬间柱尖灵珠闪光时长（秒） */
    pillarOrbFlashDurationSec: 0.45,

    /** 柱尖 3D 灵珠小球半径（像素） */
    pillarOrbRadiusPx: 6.8,

    /** 柱尖 3D 灵珠底部相对柱尖顶点的留隙（像素） */
    pillarOrbTipGapPx: 2.0,

    /** T018 左柱技能「潮引」：漏斗增益与下限保证（确保低宽容度或 0 宽容度下依然显著吸纳） */
    tidePullFunnelRadiusScale: 2.5,
    tidePullFunnelMinRadiusPx: 165,
    tidePullFunnelMaxTiltDeg: 72,
    tidePullFunnelPullScale: 2.6,
    tidePullFunnelMinPullAccel: 2600,
    tidePullFunnelMinAlignRate: 11.5,
    tidePullFunnelMaxVy: 95,

    /** T018 左柱技能「潮引」：FlowField 漩流场参数 */
    tidePullSwirlRadiusPx: 250,
    tidePullSwirlInwardSpeed: 240,
    tidePullSwirlTangentSpeed: 105,
    tidePullSwirlDownwardSpeed: 0,
    tidePullSwirlCoreRadiusPx: 22,
    tidePullSwirlFocusOffsetY: 24,

    /** T018 左柱技能「潮引」：灰盒柱尖漩流线视觉参数 */
    tidePullVortexArmCount: 3,
    tidePullVortexMaxRadiusPx: 118,
    tidePullVortexMinRadiusPx: 14,
    tidePullVortexSpinRadPerSec: 4.2,

    /** T019 右柱技能「定海」：暖流托浮、平息乱流与水平归中参数 */
    calmSeaTargetAboveTipPx: 36,
    calmSeaTopMarginPx: 26,
    calmSeaWarmFlowSpeed: 135,
    calmSeaWarmFlowTaperSpanPx: 65,
    calmSeaTurbulenceScale: 0.06,
    calmSeaCirculationScale: 0.08,
    calmSeaRiseMaxSpeedPx: 145,
    calmSeaRiseMinSpeedPx: 26,
    calmSeaRiseSlope: 1.5,
    calmSeaRiseGain: 8.5,
    calmSeaMaxRiseAccelPx: 1400,
    calmSeaOvershootDampRate: 7.0,
    calmSeaSlowSinkSpeedPx: 10,
    calmSeaPillarSettleSinkSpeedPx: 30,
    calmSeaHighDescentSpeedPx: 32,
    calmSeaBandTrackRate: 14.0,
    calmSeaMaxBrakeDownRatio: 0.45,
    calmSeaReLiftOffsetPx: 32,
    calmSeaAlignRate: 6.5,
    calmSeaSpinDampRate: 3.2,
    calmSeaZCenterStiffness: 18.0,
    calmSeaZCenterDamping: 8.5,
    calmSeaPillarDetourAccelPx: 240,
    calmSeaWaveCount: 5,
    calmSeaStreamCount: 7,

    /** T020 灰盒音效与碰撞触发阈值配置 */
    sfxMasterVolume: 0.85,
    sfxMaxGlobalVoices: 8,
    sfxCollisionMinImpulse: 8,
    sfxCollisionMaxImpulse: 220,
    sfxCollisionMinApproachSpeed: 22,
    sfxCollisionMinVolumeScale: 0.18,
    sfxJetLoopVolumeSmoothRate: 24,
    sfxJetLoopOutflowThreshold: 0.01,
    sfxReboundMinDepletion: 0.06,

    /** T021 敲玻璃震纹与可点对象放大倍率配置 */
    tappableHitScale: 1.4,
    glassTapRipplePoolSize: 12,
    glassTapRippleDurationSec: 0.42,
    glassTapRippleStartRadiusPx: 10,
    glassTapRippleEndRadiusPx: 56,
} as const;

export interface RingPillarGeometry {
    /** 中号正圆环外径 */
    ringOuterDiameter: number;
    /** 中号正圆环管粗（截面圆直径） */
    ringThickness: number;
    /** 中号正圆环内孔直径 */
    ringInnerDiameter: number;
    /** 薄层 3D 水缸前后净深（Z 方向范围 [-tankDepth/2, +tankDepth/2]） */
    tankDepth: number;
    /** 锥形柱杆顶端直径 */
    pillarTipWidth: number;
    /** 锥形柱杆根部直径 */
    pillarRootWidth: number;
    /** 锥形柱杆中段平均宽度 */
    pillarWidth: number;
    /** 上段有效套圈锥杆高度（从十字卡托顶面到柱尖） */
    pillarHeight: number;
    /** 十字四翼卡托视觉横向总宽（X 轴） */
    pillarBaseWidth: number;
    /** 十字四翼卡托视觉前后总深（Z 轴） */
    pillarCrossDepth: number;
    /** 十字四翼卡托碰撞横向总宽（X 轴，比视觉卡托更短以防外侧挂卡） */
    pillarColliderBaseWidth: number;
    /** 十字四翼卡托碰撞前后总深（Z 轴，比视觉卡托更短以防外侧挂卡） */
    pillarColliderCrossDepth: number;
    /** 十字四翼卡托竖向厚度 */
    pillarBaseHeight: number;
    /** 下段悬空收尖尾椎高度（十字卡托底面到尾尖） */
    pillarTailHeight: number;
    /** 三段式柱子总高度（尾椎 + 十字卡托 + 上段锥杆） */
    pillarTotalHeight: number;
}

/** 按当前缸宽与配置常数计算 3D 正圆环、三段式锥形十字柱与水缸纵深的几何尺寸。 */
export function calcRingPillarGeometry(tankWidth: number): RingPillarGeometry {
    const ringOuterDiameter = tankWidth * GameConst.ringOuterDiameterRatio;
    const ringThickness = ringOuterDiameter * GameConst.ringTubeRatio;
    const ringInnerDiameter = ringOuterDiameter - ringThickness * 2;
    const tankDepth = ringOuterDiameter * GameConst.tankDepthRatio;

    const pillarTipWidth = GameConst.pillarTipWidth;
    const pillarRootWidth = GameConst.pillarRootWidth;
    const pillarWidth = 0.5 * (pillarTipWidth + pillarRootWidth);
    const pillarHeight = GameConst.pillarCapacity * ringThickness * GameConst.pillarSlotPitchScale;
    const pillarBaseWidth = ringOuterDiameter * GameConst.pillarCrossWidthRatio;
    const pillarCrossDepth = ringOuterDiameter * GameConst.pillarCrossDepthRatio;
    const pillarColliderBaseWidth = pillarBaseWidth * GameConst.pillarCrossColliderRatio;
    const pillarColliderCrossDepth = pillarCrossDepth * GameConst.pillarCrossColliderRatio;
    const pillarBaseHeight = GameConst.pillarBaseHeight;
    const pillarTailHeight = GameConst.pillarTailHeight;
    const pillarTotalHeight = pillarTailHeight + pillarBaseHeight + pillarHeight;

    return {
        ringOuterDiameter,
        ringThickness,
        ringInnerDiameter,
        tankDepth,
        pillarTipWidth,
        pillarRootWidth,
        pillarWidth,
        pillarHeight,
        pillarBaseWidth,
        pillarCrossDepth,
        pillarColliderBaseWidth,
        pillarColliderCrossDepth,
        pillarBaseHeight,
        pillarTailHeight,
        pillarTotalHeight,
    };
}
