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

        // 十字四翼卡托视觉宽度进一步收短（0.88 倍圈外径），且碰撞宽度严格短于视觉宽度（68%）以防外侧挂卡
        expect(geom.pillarBaseWidth).toBeGreaterThan(geom.ringInnerDiameter * 1.2);
        expect(geom.pillarBaseWidth).toBeLessThan(geom.ringOuterDiameter * 0.95);
        expect(geom.pillarColliderBaseWidth).toBeCloseTo(geom.pillarBaseWidth * 0.68, 5);
        expect(geom.pillarColliderCrossDepth).toBeCloseTo(geom.pillarCrossDepth * 0.68, 5);

        // 上段有效柱杆高度可容纳 6 个保留微倾的圈，柱子整体更精巧（约占扩容后内屏高的 24%）
        expect(geom.pillarHeight).toBeCloseTo(
            GameConst.pillarCapacity * geom.ringThickness * GameConst.pillarSlotPitchScale,
            5,
        );
        const totalRatio = geom.pillarTotalHeight / TankSpace.height;
        expect(totalRatio).toBeGreaterThan(0.21);
        expect(totalRatio).toBeLessThan(0.28);
    });

    it('柱子位置左右对称（32.5% / 67.5%）、悬空尾尖离底 31%，远避开圆弧底角', () => {
        expect(FeelConfig.pillarPosPct).toBe(32.5);
        expect(FeelConfig.pillarBottomPct).toBe(31);

        const leftX = TankSpace.pctToPxX(FeelConfig.pillarPosPct);
        const rightX = TankSpace.pctToPxX(100 - FeelConfig.pillarPosPct);
        expect(leftX + rightX).toBeCloseTo(TankSpace.width, 5);

        const geom = calcRingPillarGeometry(TankSpace.width);
        expect(leftX - geom.pillarBaseWidth / 2).toBeGreaterThan(GameConst.tankCornerRadius);
        expect(TankSpace.pctToPxY(FeelConfig.pillarBottomPct)).toBeGreaterThan(geom.ringOuterDiameter * 1.5);
    });

    it('海眼位置左右对称（14% / 86%），圆弧底角无缝衔接海眼喷流消除角落死区', () => {
        expect(FeelConfig.nozzlePosPct).toBe(14);
        expect(FeelConfig.nozzleTiltDeg).toBe(10);

        const leftNozzleX = TankSpace.pctToPxX(FeelConfig.nozzlePosPct);
        const rightNozzleX = TankSpace.pctToPxX(100 - FeelConfig.nozzlePosPct);
        const leftPillarX = TankSpace.pctToPxX(FeelConfig.pillarPosPct);

        expect(leftNozzleX + rightNozzleX).toBeCloseTo(TankSpace.width, 5);
        // 海眼中心在圆弧底角内侧平底上，且喷流外缘直接覆盖进圆弧斜坡区，确保边角零死区
        expect(leftNozzleX).toBeGreaterThan(GameConst.tankCornerRadius);
        expect(leftNozzleX - GameConst.jetMouthHalfWidth).toBeLessThan(GameConst.tankCornerRadius);
        expect(leftNozzleX).toBeLessThan(leftPillarX);
    });
});
