import { describe, expect, it } from 'vitest';
import { LayoutConfig } from '../../assets/scripts/config/LayoutConfig';
import { TankSpace } from '../../assets/scripts/config/TankSpace';

describe('TankSpace', () => {
    it('百分比与缸内像素互换准确', () => {
        expect(TankSpace.pctToPx(0, 0)).toEqual({ x: 0, y: 0 });
        expect(TankSpace.pctToPx(100, 100)).toEqual({
            x: LayoutConfig.innerScreen.width,
            y: LayoutConfig.innerScreen.height,
        });
        expect(TankSpace.pctToPx(50, 20)).toEqual({
            x: LayoutConfig.innerScreen.width * 0.5,
            y: LayoutConfig.innerScreen.height * 0.2,
        });

        const back = TankSpace.pxToPct(300.8, 149.5);
        expect(back.x).toBeCloseTo(32, 6);
        expect(back.y).toBeCloseTo(26, 6);
    });

    it('缸坐标与机器坐标互换准确', () => {
        const machinePt = TankSpace.tankToMachine(100, 200);
        expect(machinePt).toEqual({
            x: LayoutConfig.innerScreen.x + 100,
            y: LayoutConfig.innerScreen.y + 200,
        });
        expect(TankSpace.machineToTank(machinePt.x, machinePt.y)).toEqual({
            x: 100,
            y: 200,
        });
    });
});
