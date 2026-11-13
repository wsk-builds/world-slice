import { describe, expect, it } from 'vitest';
import { calcRingPillarGeometry, GameConst } from '../../../assets/scripts/config/GameConst';
import { TankSpace } from '../../../assets/scripts/config/TankSpace';
import { getRingKindConfig, RingSpec } from '../../../assets/scripts/core/rings/RingKinds';
import {
    calcMatchDropDuration,
    calcMatchDropY,
    findMatchPair,
    MatchSlotInput,
    resolvePillarMatch,
} from '../../../assets/scripts/core/rules/MatchRule';
import { calcSlotCenterY } from '../../../assets/scripts/core/rules/PillarStack';

function makeEntry(id: string, spec: RingSpec): MatchSlotInput<string> {
    const geom = calcRingPillarGeometry(TankSpace.width);
    return {
        item: id,
        spec,
        thickness: geom.ringThickness * getRingKindConfig(spec).sizeScale,
    };
}

describe('MatchRule 同款消除与新槽位重算（T014）', () => {
    const baseTopY = 244;
    const pitch = GameConst.pillarSlotPitchScale;

    it('相邻同色普通圈触发消除，上方圈下移重算槽位', () => {
        const entries = [
            makeEntry('r1', { kind: 'normal', color: 'red' }),
            makeEntry('r2', { kind: 'normal', color: 'red' }),
            makeEntry('b1', { kind: 'normal', color: 'blue' }),
        ];

        const res = resolvePillarMatch(entries, { baseTopY, pitchScale: pitch });
        expect(res.matched).toBe(true);
        expect(res.pair?.first.item).toBe('r1');
        expect(res.pair?.second.item).toBe('r2');
        expect(res.pair?.firstIndex).toBe(0);
        expect(res.pair?.secondIndex).toBe(1);

        expect(res.remaining).toHaveLength(1);
        expect(res.remaining[0].item).toBe('b1');
        expect(res.remaining[0].oldIndex).toBe(2);
        expect(res.remaining[0].newIndex).toBe(0);
        expect(res.remaining[0].moved).toBe(true);
        expect(res.remaining[0].targetCenterY).toBeCloseTo(
            calcSlotCenterY(baseTopY, [entries[2].thickness], entries[2].thickness, 0, pitch),
            6,
        );
    });

    it('不相邻（隔着异色）同色普通圈触发消除：红、蓝、红 -> 两红消除，蓝落回 0 号槽位', () => {
        const entries = [
            makeEntry('r1', { kind: 'normal', color: 'red' }),
            makeEntry('b1', { kind: 'normal', color: 'blue' }),
            makeEntry('r2', { kind: 'normal', color: 'red' }),
        ];

        const res = resolvePillarMatch(entries, { baseTopY });
        expect(res.matched).toBe(true);
        expect(res.pair?.first.item).toBe('r1');
        expect(res.pair?.second.item).toBe('r2');
        expect(res.pair?.firstIndex).toBe(0);
        expect(res.pair?.secondIndex).toBe(2);

        expect(res.remaining).toHaveLength(1);
        const blue = res.remaining[0];
        expect(blue.item).toBe('b1');
        expect(blue.oldIndex).toBe(1);
        expect(blue.newIndex).toBe(0);
        expect(blue.moved).toBe(true);
        expect(blue.targetCenterY).toBeCloseTo(baseTopY + blue.thickness * pitch * 0.5, 6);
    });

    it('不同色普通圈不触发消除，剩余列表保持原槽位且 moved 均为 false', () => {
        const entries = [
            makeEntry('r1', { kind: 'normal', color: 'red' }),
            makeEntry('b1', { kind: 'normal', color: 'blue' }),
            makeEntry('g1', { kind: 'normal', color: 'green' }),
            makeEntry('o1', { kind: 'normal', color: 'orange' }),
        ];

        expect(findMatchPair(entries)).toBeNull();
        const res = resolvePillarMatch(entries, { baseTopY });
        expect(res.matched).toBe(false);
        expect(res.pair).toBeNull();
        expect(res.remaining).toHaveLength(4);
        for (let i = 0; i < res.remaining.length; i++) {
            expect(res.remaining[i].oldIndex).toBe(i);
            expect(res.remaining[i].newIndex).toBe(i);
            expect(res.remaining[i].moved).toBe(false);
        }
    });

    it('特殊圈按种类配对（小金环/铁圈/木圈），互不跨种配对也不与普通圈配对', () => {
        // 1. 不同种特殊圈 + 普通圈混放不消
        const mixedNoMatch = [
            makeEntry('gold1', { kind: 'gold' }),
            makeEntry('iron1', { kind: 'iron' }),
            makeEntry('wood1', { kind: 'wood' }),
            makeEntry('red1', { kind: 'normal', color: 'red' }),
        ];
        expect(resolvePillarMatch(mixedNoMatch, { baseTopY }).matched).toBe(false);

        // 2. 小金环隔着异色普通圈配对消除（不看 color）
        const goldMatch = [
            makeEntry('g1', { kind: 'gold', color: 'red' }),
            makeEntry('b1', { kind: 'normal', color: 'blue' }),
            makeEntry('g2', { kind: 'gold', color: 'green' }),
        ];
        const goldRes = resolvePillarMatch(goldMatch, { baseTopY });
        expect(goldRes.matched).toBe(true);
        expect(goldRes.pair?.first.item).toBe('g1');
        expect(goldRes.pair?.second.item).toBe('g2');
        expect(goldRes.remaining.map((r) => r.item)).toEqual(['b1']);

        // 3. 铁圈与木圈分别按自身种类配对
        const ironRes = resolvePillarMatch(
            [makeEntry('i1', { kind: 'iron' }), makeEntry('w1', { kind: 'wood' }), makeEntry('i2', { kind: 'iron' })],
            { baseTopY },
        );
        expect(ironRes.matched).toBe(true);
        expect(ironRes.pair?.first.item).toBe('i1');
        expect(ironRes.pair?.second.item).toBe('i2');

        const woodRes = resolvePillarMatch(
            [makeEntry('w1', { kind: 'wood' }), makeEntry('i1', { kind: 'iron' }), makeEntry('w2', { kind: 'wood' })],
            { baseTopY },
        );
        expect(woodRes.matched).toBe(true);
        expect(woodRes.pair?.first.item).toBe('w1');
        expect(woodRes.pair?.second.item).toBe('w2');
    });

    it('消除后下方圈不动、上方多个已锁圈（含小金环不同厚度）按新顺序重算槽位高度', () => {
        // 柱上从底到顶：[蓝0, 红1, 小金环2, 绿3, 木4, 红5]
        // 红1 与 红5 消除后，蓝0 留在 0 槽位不动，小金环2/绿3/木4 依次落到 1/2/3 槽位
        const blue = makeEntry('blue0', { kind: 'normal', color: 'blue' });
        const red1 = makeEntry('red1', { kind: 'normal', color: 'red' });
        const gold = makeEntry('gold2', { kind: 'gold' });
        const green = makeEntry('green3', { kind: 'normal', color: 'green' });
        const wood = makeEntry('wood4', { kind: 'wood' });
        const red5 = makeEntry('red5', { kind: 'normal', color: 'red' });

        const res = resolvePillarMatch([blue, red1, gold, green, wood, red5], { baseTopY, pitchScale: pitch });
        expect(res.matched).toBe(true);
        expect(res.pair?.firstIndex).toBe(1);
        expect(res.pair?.secondIndex).toBe(5);
        expect(res.remaining).toHaveLength(4);

        const expectedThicknesses = [blue.thickness, gold.thickness, green.thickness, wood.thickness];
        const expectedMoved = [false, true, true, true];
        const expectedOldIndices = [0, 2, 3, 4];

        for (let i = 0; i < res.remaining.length; i++) {
            const r = res.remaining[i];
            expect(r.oldIndex).toBe(expectedOldIndices[i]);
            expect(r.newIndex).toBe(i);
            expect(r.moved).toBe(expectedMoved[i]);
            expect(r.targetCenterY).toBeCloseTo(
                calcSlotCenterY(baseTopY, expectedThicknesses, r.thickness, i, pitch),
                6,
            );
        }
    });

    it('平滑下落耗时与插值函数满足边界限制与单调递减', () => {
        expect(calcMatchDropDuration(0)).toBe(0);
        expect(calcMatchDropDuration(5)).toBe(GameConst.matchDropMinDurationSec);
        expect(calcMatchDropDuration(1000)).toBe(GameConst.matchDropMaxDurationSec);

        const startY = 300;
        const targetY = 260;
        expect(calcMatchDropY(startY, targetY, -0.5)).toBe(startY);
        expect(calcMatchDropY(startY, targetY, 0)).toBe(startY);
        expect(calcMatchDropY(startY, targetY, 0.5)).toBeCloseTo(280, 6);
        expect(calcMatchDropY(startY, targetY, 1)).toBe(targetY);
        expect(calcMatchDropY(startY, targetY, 1.5)).toBe(targetY);

        let prev = startY;
        for (let step = 1; step <= 10; step++) {
            const cur = calcMatchDropY(startY, targetY, step / 10);
            expect(cur).toBeLessThanOrEqual(prev);
            prev = cur;
        }
    });
});
