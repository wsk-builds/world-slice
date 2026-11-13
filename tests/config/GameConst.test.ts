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
});
