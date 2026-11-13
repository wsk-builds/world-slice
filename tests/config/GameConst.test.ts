import { describe, expect, it } from 'vitest';
import { FeelConfig } from '../../assets/scripts/config/FeelConfig';
import { calcRingPillarGeometry, GameConst } from '../../assets/scripts/config/GameConst';
import { TankSpace } from '../../assets/scripts/config/TankSpace';

describe('GameConst & FeelConfig（按参考视频重设计的 3D 圈柱与比例）', () => {
    it('纤巧正圆环与精巧三段式锥形十字柱比例正确，且卡托碰撞体积比视觉显示更短', () => {
        const geom = calcRingPillarGeometry(TankSpace.width);

        // 中号圈外径 = 缸宽 / 13.25 ≈ 80px，管粗占外径 15.5%（约 12.4px，纤巧不显胖），内孔占 69%
        expect(geom.ringOuterDiameter).toBeCloseTo(TankSpace.width / 13.25, 5);
        expect(geom.ringThickness).toBeCloseTo(geom.ringOuterDiameter * 0.155, 5);
        expect(geom.ringInnerDiameter).toBeCloseTo(geom.ringOuterDiameter * 0.69, 5);

        // 上尖下粗锥杆整体变细，均明显小于圈内孔
        expect(geom.pillarTipWidth).toBeLessThan(geom.pillarRootWidth);
        expect(geom.pillarRootWidth).toBeLessThan(geom.ringInnerDiameter * 0.5);

        // 十字四翼卡托视觉宽度适度收短（约 1.24 倍圈外径），且碰撞宽度严格短于视觉宽度（72%）以防外侧圈挂卡
        expect(geom.pillarBaseWidth).toBeGreaterThan(geom.ringOuterDiameter * 1.15);
        expect(geom.pillarBaseWidth).toBeLessThan(geom.ringOuterDiameter * 1.3);
        expect(geom.pillarColliderBaseWidth).toBeCloseTo(geom.pillarBaseWidth * 0.72, 5);
        expect(geom.pillarColliderCrossDepth).toBeCloseTo(geom.pillarCrossDepth * 0.72, 5);
        expect(geom.pillarColliderBaseWidth).toBeGreaterThan(geom.ringInnerDiameter);

        // 上段有效柱杆高度可容纳 6 个保留微倾的圈，柱子整体更精巧（约占扩容后内屏高的 24%）
        expect(geom.pillarHeight).toBeCloseTo(
            GameConst.pillarCapacity * geom.ringThickness * GameConst.pillarSlotPitchScale,
            5,
        );
        const totalRatio = geom.pillarTotalHeight / TankSpace.height;
        expect(totalRatio).toBeGreaterThan(0.21);
        expect(totalRatio).toBeLessThan(0.28);
    });

    it('柱子位置左右对称（24% / 76%）、悬空尾尖离底 31%，卡托面落在约 42.5% 且不侵入底角圆弧', () => {
        expect(FeelConfig.pillarPosPct).toBe(24);
        expect(FeelConfig.pillarBottomPct).toBe(31);

        const leftX = TankSpace.pctToPxX(FeelConfig.pillarPosPct);
        const rightX = TankSpace.pctToPxX(100 - FeelConfig.pillarPosPct);
        expect(leftX + rightX).toBeCloseTo(TankSpace.width, 5);

        const geom = calcRingPillarGeometry(TankSpace.width);
        expect(leftX - geom.pillarBaseWidth / 2).toBeGreaterThan(GameConst.tankCornerRadius);
        expect(TankSpace.pctToPxY(FeelConfig.pillarBottomPct)).toBeGreaterThan(geom.ringOuterDiameter * 1.5);
    });

    it('海眼位置左右对称（14% / 86%），位于圆弧底角内侧且在悬空柱外侧', () => {
        expect(FeelConfig.nozzlePosPct).toBe(14);
        expect(FeelConfig.nozzleTiltDeg).toBe(10);

        const leftNozzleX = TankSpace.pctToPxX(FeelConfig.nozzlePosPct);
        const rightNozzleX = TankSpace.pctToPxX(100 - FeelConfig.nozzlePosPct);
        const leftPillarX = TankSpace.pctToPxX(FeelConfig.pillarPosPct);

        expect(leftNozzleX + rightNozzleX).toBeCloseTo(TankSpace.width, 5);
        expect(leftNozzleX - GameConst.jetMouthHalfWidth).toBeGreaterThan(GameConst.tankCornerRadius);
        expect(leftNozzleX).toBeLessThan(leftPillarX);
    });
});
