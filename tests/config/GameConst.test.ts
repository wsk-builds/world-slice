import { describe, expect, it } from 'vitest';
import { FeelConfig } from '../../assets/scripts/config/FeelConfig';
import { calcRingPillarGeometry, GameConst } from '../../assets/scripts/config/GameConst';
import { TankSpace } from '../../assets/scripts/config/TankSpace';

describe('GameConst & FeelConfig（按参考视频重设计的 3D 圈柱与比例）', () => {
    it('正圆环与三段式锥形十字柱比例精确符合视频实测比例', () => {
        const geom = calcRingPillarGeometry(TankSpace.width);

        // 中号圈外径 = 缸宽 / 10.4 ≈ 90.4px（占缸宽约 9.6%）
        expect(geom.ringOuterDiameter).toBeCloseTo(TankSpace.width / 10.4, 5);
        // 管粗占外径 20%，内孔占外径 60%
        expect(geom.ringThickness).toBeCloseTo(geom.ringOuterDiameter * 0.2, 5);
        expect(geom.ringInnerDiameter).toBeCloseTo(geom.ringOuterDiameter * 0.6, 5);

        // 上尖下粗锥杆均比圈内孔明显窄，留足 3D 晃动与倾斜间隙
        expect(geom.pillarTipWidth).toBeLessThan(geom.pillarRootWidth);
        expect(geom.pillarRootWidth).toBeLessThan(geom.ringInnerDiameter * 0.6);

        // 十字四翼卡托明显宽于正圆环外径（约 1.46 倍），任何 3D 角度落下都能稳稳托住
        expect(geom.pillarBaseWidth).toBeGreaterThan(geom.ringOuterDiameter * 1.35);

        // 上段有效柱杆高度可容纳 6 个保留微倾的圈，三段总高度约占内屏高的 1/3
        expect(geom.pillarHeight).toBeCloseTo(
            GameConst.pillarCapacity * geom.ringThickness * GameConst.pillarSlotPitchScale,
            5,
        );
        const totalRatio = geom.pillarTotalHeight / TankSpace.height;
        expect(totalRatio).toBeGreaterThan(0.29);
        expect(totalRatio).toBeLessThan(0.36);
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
