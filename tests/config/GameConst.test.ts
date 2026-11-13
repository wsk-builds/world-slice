import { describe, expect, it } from 'vitest';
import { FeelConfig } from '../../assets/scripts/config/FeelConfig';
import { calcRingPillarGeometry, GameConst } from '../../assets/scripts/config/GameConst';
import { TankSpace } from '../../assets/scripts/config/TankSpace';

describe('GameConst & FeelConfig', () => {
    it('柱子几何与圈尺寸关系符合 GDD 与任务要求', () => {
        const geom = calcRingPillarGeometry(TankSpace.width);

        // 中号圈外径 = 缸宽 / 7.5
        expect(geom.ringOuterDiameter).toBeCloseTo(TankSpace.width / 7.5, 5);
        // 柱杆高度等于 6 个圈叠起来的高度
        expect(geom.pillarHeight).toBeCloseTo(GameConst.pillarCapacity * geom.ringThickness, 5);
        // 柱杆比圈内径窄，底托比圈两端圆心间距（outerDiameter - thickness）宽且比圈外径窄
        expect(geom.pillarWidth).toBeLessThan(geom.ringInnerDiameter);
        expect(geom.pillarBaseWidth).toBeGreaterThan(geom.ringOuterDiameter - geom.ringThickness);
        expect(geom.pillarBaseWidth).toBeLessThan(geom.ringOuterDiameter);
    });

    it('柱子位置左右对称且不侵入底角圆弧、留出底部水域', () => {
        expect(FeelConfig.pillarPosPct).toBe(32);
        expect(FeelConfig.pillarBottomPct).toBe(26);

        const leftX = TankSpace.pctToPxX(FeelConfig.pillarPosPct);
        const rightX = TankSpace.pctToPxX(100 - FeelConfig.pillarPosPct);
        expect(leftX + rightX).toBeCloseTo(TankSpace.width, 5);

        const geom = calcRingPillarGeometry(TankSpace.width);
        expect(leftX - geom.pillarBaseWidth / 2).toBeGreaterThan(GameConst.tankCornerRadius);
        expect(TankSpace.pctToPxY(FeelConfig.pillarBottomPct)).toBeGreaterThan(geom.ringOuterDiameter);
    });

    it('海眼位置左右对称，位于圆弧底角内侧且在悬空柱外侧', () => {
        expect(FeelConfig.nozzlePosPct).toBe(17);
        expect(FeelConfig.nozzleTiltDeg).toBe(10);

        const leftNozzleX = TankSpace.pctToPxX(FeelConfig.nozzlePosPct);
        const rightNozzleX = TankSpace.pctToPxX(100 - FeelConfig.nozzlePosPct);
        const leftPillarX = TankSpace.pctToPxX(FeelConfig.pillarPosPct);

        expect(leftNozzleX + rightNozzleX).toBeCloseTo(TankSpace.width, 5);
        expect(leftNozzleX - GameConst.jetMouthHalfWidth).toBeGreaterThan(GameConst.tankCornerRadius);
        expect(leftNozzleX).toBeLessThan(leftPillarX);
    });
});
