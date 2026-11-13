import { describe, expect, it } from 'vitest';
import { calcRingPillarGeometry, GameConst } from '../../../assets/scripts/config/GameConst';
import { TankSpace } from '../../../assets/scripts/config/TankSpace';
import {
    calcRingTiltDeg,
    calcSlotCenterY,
    isRingOnPillar,
    isRingStableForLock,
    PillarStack,
} from '../../../assets/scripts/core/rules/PillarStack';

describe('PillarStack', () => {
    it('默认读取 GameConst.pillarCapacity（起始值 6）并正确管理放入、取出与满柱', () => {
        const stack = new PillarStack<string>();
        expect(stack.capacity).toBe(GameConst.pillarCapacity);
        expect(stack.capacity).toBe(6);
        expect(stack.isEmpty()).toBe(true);
        expect(stack.isFull()).toBe(false);

        for (let i = 0; i < 6; i++) {
            const slot = stack.push(`ring-${i}`);
            expect(slot).toBe(i);
            expect(stack.count).toBe(i + 1);
            expect(stack.has(`ring-${i}`)).toBe(true);
            expect(stack.indexOf(`ring-${i}`)).toBe(i);
            expect(stack.getAt(i)).toBe(`ring-${i}`);
        }

        expect(stack.isEmpty()).toBe(false);
        expect(stack.isFull()).toBe(true);

        // 第 7 个不能再放入
        expect(stack.push('ring-6')).toBe(-1);
        expect(stack.count).toBe(6);
        expect(stack.has('ring-6')).toBe(false);

        // 重复元素不能重复放入
        expect(stack.push('ring-0')).toBe(-1);
    });

    it('支持按对象与按槽位取出，上方圈顺序下移', () => {
        const stack = new PillarStack<string>(4);
        stack.push('a');
        stack.push('b');
        stack.push('c');

        expect(stack.remove('b')).toBe(1);
        expect(stack.items).toEqual(['a', 'c']);
        expect(stack.indexOf('c')).toBe(1);
        expect(stack.isFull()).toBe(false);

        expect(stack.remove('missing')).toBe(-1);
        expect(stack.removeAt(-1)).toBeUndefined();
        expect(stack.removeAt(5)).toBeUndefined();

        expect(stack.pop()).toBe('c');
        expect(stack.removeAt(0)).toBe('a');
        expect(stack.isEmpty()).toBe(true);

        stack.push('x');
        stack.clear();
        expect(stack.count).toBe(0);
        expect(stack.isEmpty()).toBe(true);
    });

    it('calcSlotCenterY 精确对齐 6 个普通圈到柱尖并支持混叠小金环', () => {
        const geom = calcRingPillarGeometry(TankSpace.width);
        const baseTopY = 165.5;
        const tipY = baseTopY + geom.pillarHeight;
        const thicknesses: number[] = [];

        for (let i = 0; i < GameConst.pillarCapacity; i++) {
            const centerY = calcSlotCenterY(baseTopY, thicknesses, geom.ringThickness);
            expect(centerY).toBeCloseTo(baseTopY + (i + 0.5) * geom.ringThickness, 6);
            expect(centerY).toBeLessThan(tipY);
            thicknesses.push(geom.ringThickness);
        }

        // 第 6 个圈顶边刚好对齐柱尖
        const topEdge = calcSlotCenterY(baseTopY, thicknesses.slice(0, 5), geom.ringThickness) + geom.ringThickness / 2;
        expect(topEdge).toBeCloseTo(tipY, 6);

        // 混叠小金环（16px）+ 普通圈（20px）紧密贴合无间隙
        const goldThick = geom.ringThickness * 0.8;
        expect(calcSlotCenterY(baseTopY, [goldThick], geom.ringThickness)).toBeCloseTo(
            baseTopY + goldThick + geom.ringThickness / 2,
            6,
        );
    });

    it('isRingOnPillar 准确判定端点跨柱与圈心高度范围（含倒扣 180° 与悬空底托下方排除）', () => {
        const pillarX = 300;
        const baseTopY = 165;
        const tipY = 285;

        // 正常套在柱子上
        expect(
            isRingOnPillar({
                leftEndX: 248,
                leftEndY: 175,
                rightEndX: 352,
                rightEndY: 175,
                pillarX,
                baseTopY,
                tipY,
            }),
        ).toBe(true);

        // 翻滚 180° 后左右端点互换仍能套中
        expect(
            isRingOnPillar({
                leftEndX: 352,
                leftEndY: 175,
                rightEndX: 248,
                rightEndY: 175,
                pillarX,
                baseTopY,
                tipY,
            }),
        ).toBe(true);

        // 圈心高于柱尖（例如满柱第 7 个圈压在顶部）不算套中
        expect(
            isRingOnPillar({
                leftEndX: 248,
                leftEndY: 295,
                rightEndX: 352,
                rightEndY: 295,
                pillarX,
                baseTopY,
                tipY,
            }),
        ).toBe(false);

        // 漂在悬空柱底托下方水域不算套中
        expect(
            isRingOnPillar({
                leftEndX: 248,
                leftEndY: 80,
                rightEndX: 352,
                rightEndY: 80,
                pillarX,
                baseTopY,
                tipY,
            }),
        ).toBe(false);

        // 偏移到柱子一侧（柱子不在两端点之间）不算套中
        expect(
            isRingOnPillar({
                leftEndX: 310,
                leftEndY: 180,
                rightEndX: 414,
                rightEndY: 180,
                pillarX,
                baseTopY,
                tipY,
            }),
        ).toBe(false);
    });

    it('calcRingTiltDeg 与 isRingStableForLock 校验稳定与倾角阈值', () => {
        expect(calcRingTiltDeg(248, 175, 352, 175)).toBeCloseTo(0, 6);
        expect(calcRingTiltDeg(352, 175, 248, 175)).toBeCloseTo(0, 6);
        expect(calcRingTiltDeg(300, 120, 300, 220)).toBeCloseTo(90, 6);

        expect(
            isRingStableForLock({
                linearSpeedPx: 10,
                angularSpeedRad: 0.2,
                tiltDeg: 5,
                centerY: 176,
                slotCenterY: 175,
            }),
        ).toBe(true);

        // 下落速度过快不锁定
        expect(
            isRingStableForLock({
                linearSpeedPx: GameConst.ringLockMaxLinearSpeedPx + 20,
                angularSpeedRad: 0,
                tiltDeg: 0,
                centerY: 176,
                slotCenterY: 175,
            }),
        ).toBe(false);

        // 悬停在半空距离目标槽位太远不提前锁定
        expect(
            isRingStableForLock({
                linearSpeedPx: 0,
                angularSpeedRad: 0,
                tiltDeg: 0,
                centerY: 175 + GameConst.ringLockSlotMarginPx + 10,
                slotCenterY: 175,
            }),
        ).toBe(false);
    });
});
