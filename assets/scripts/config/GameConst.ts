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

    /** 十字四翼卡托视觉横向总宽与中号圈外径之比（收短至 1.24 倍 ≈ 99.2px，比旧版 132px 缩短 25%） */
    pillarCrossWidthRatio: 1.24,

    /** 十字四翼卡托视觉前后总深与中号圈外径之比（收短至 1.12 倍 ≈ 89.6px） */
    pillarCrossDepthRatio: 1.12,

    /** 十字卡托碰撞翼展占视觉翼展的比例（0.72：碰撞体积比实际显示的卡托还短 28%，彻底避免外侧圈挂卡在卡托上） */
    pillarCrossColliderRatio: 0.72,

    /** 十字四翼卡托竖向厚度（像素） */
    pillarBaseHeight: 19,

    /** 十字卡托下方悬空收尖尾椎高度（像素） */
    pillarTailHeight: 34,

    /** 缸壁碰撞厚度（像素，位于内壁外侧） */
    tankWallThickness: 24,

    /** 左右底角向内圆弧半径（像素，小于左海眼 14% = 131.6px 减喷口半宽，防死角且不占海眼位） */
    tankCornerRadius: 72,

    /** 单个底角圆弧用多少段折线近似（供 2D 缸壁绘制与校验） */
    tankCornerSegments: 8,

    /** 底角折线外推厚度（像素） */
    tankCornerStripThickness: 14,

    /** 海眼喷口初始半宽（像素，覆盖中号圈主半径 ±36.2px 且不侵入 72px 底角圆弧） */
    jetMouthHalfWidth: 50,

    /** 喷射键点击热区向四周外扩像素（点击范围比图形大，GDD 画面铁律） */
    jetBtnHitPadding: 24,

    /** 灰盒默认随机种子（T016 改为从关卡数据读取） */
    defaultLevelSeed: 1024,

    /** 主喷流下窄上宽锥形半张角（度） */
    jetHalfAngleDeg: 14,

    /** 水体涡流扰动的空间特征尺度（像素） */
    turbulenceSpatialScale: 165,

    /** 水体涡流扰动随时间演化的频率（1/秒） */
    turbulenceTimeRate: 0.5,

    /** 气泡池最大同时存在数量上限 */
    bubblePoolMaxCount: 56,

    /** 圈在柱子上连续稳定多久后锁定（秒，GDD §2.1） */
    ringLockDurationSec: 0.3,

    /** 锁定判定的三维线速度上限（像素/秒） */
    ringLockMaxLinearSpeedPx: 55,

    /** 锁定判定的三维角速度上限（弧度/秒） */
    ringLockMaxAngularSpeedRad: 2.0,

    /** 锁定判定允许的最大倾角（度，0° 为水平正圆环） */
    ringLockMaxTiltDeg: 38,

    /** 锁定后保留自然 3D 错落微倾的最大倾角上限（度，既自然斜靠又不影响叠满 6 层） */
    ringLockedRestMaxTiltDeg: 15,

    /** 圈心相对目标槽位高度的容差（像素） */
    ringLockSlotMarginPx: 24,
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
