import { describe, expect, it } from 'vitest';
import { calcRingPillarGeometry, GameConst } from '../../../assets/scripts/config/GameConst';
import { TankSpace } from '../../../assets/scripts/config/TankSpace';
import { getRingKindConfig, RingSpec } from '../../../assets/scripts/core/rings/RingKinds';
import {
    calcMatchDropDuration,
    calcMatchDropY,
    findMatchGroup,
    MatchSlotInput,
    PillarRingCandidate,
    resolvePillarMatch,
    shouldDeferPillarMatch,
} from '../../../assets/scripts/core/rules/MatchRule';
import { calcSlotCenterY } from '../../../assets/scripts/core/rules/PillarStack';

function makeEntry(id: string, spec: RingSpec, thicknessOverride?: number): MatchSlotInput<string> {
    const geom = calcRingPillarGeometry(TankSpace.width);
    return {
        item: id,
        spec,
        thickness: thicknessOverride ?? geom.ringThickness * getRingKindConfig(spec).sizeScale,
    };
}

describe('MatchRule 相邻同款（2/3/4连消）与新槽位重算', () => {
    const baseTopY = 244;
    const pitch = GameConst.pillarSlotPitchScale;

    it('两个相邻同色同大小圈触发消除，上方圈下移重算槽位', () => {
        const entries = [
            makeEntry('r1', { kind: 'normal', color: 'red' }),
            makeEntry('r2', { kind: 'normal', color: 'red' }),
            makeEntry('b1', { kind: 'normal', color: 'blue' }),
        ];

        const res = resolvePillarMatch(entries, { baseTopY, pitchScale: pitch });
        expect(res.matched).toBe(true);
        expect(res.group?.count).toBe(2);
        expect(res.group?.entries.map((e) => e.item)).toEqual(['r1', 'r2']);
        expect(res.group?.indices).toEqual([0, 1]);

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

    it('中间隔一个其它圈时不消除：红、蓝、红 -> 不消除', () => {
        const entries = [
            makeEntry('r1', { kind: 'normal', color: 'red' }),
            makeEntry('b1', { kind: 'normal', color: 'blue' }),
            makeEntry('r2', { kind: 'normal', color: 'red' }),
        ];

        expect(findMatchGroup(entries)).toBeNull();
        const res = resolvePillarMatch(entries, { baseTopY });
        expect(res.matched).toBe(false);
        expect(res.group).toBeNull();
        expect(res.remaining).toHaveLength(3);
        for (let i = 0; i < res.remaining.length; i++) {
            expect(res.remaining[i].oldIndex).toBe(i);
            expect(res.remaining[i].newIndex).toBe(i);
            expect(res.remaining[i].moved).toBe(false);
        }
    });

    it('三个同种颜色/同大小圈同时相邻时，三个同时消除，上方圈正常下落', () => {
        const entries = [
            makeEntry('b0', { kind: 'normal', color: 'blue' }),
            makeEntry('r1', { kind: 'normal', color: 'red' }),
            makeEntry('r2', { kind: 'normal', color: 'red' }),
            makeEntry('r3', { kind: 'normal', color: 'red' }),
            makeEntry('g4', { kind: 'normal', color: 'green' }),
        ];

        const res = resolvePillarMatch(entries, { baseTopY, pitchScale: pitch });
        expect(res.matched).toBe(true);
        expect(res.group?.count).toBe(3);
        expect(res.group?.entries.map((e) => e.item)).toEqual(['r1', 'r2', 'r3']);
        expect(res.group?.indices).toEqual([1, 2, 3]);

        expect(res.remaining).toHaveLength(2);
        expect(res.remaining[0].item).toBe('b0');
        expect(res.remaining[0].moved).toBe(false);
        expect(res.remaining[0].newIndex).toBe(0);

        expect(res.remaining[1].item).toBe('g4');
        expect(res.remaining[1].moved).toBe(true);
        expect(res.remaining[1].oldIndex).toBe(4);
        expect(res.remaining[1].newIndex).toBe(1);
        expect(res.remaining[1].targetCenterY).toBeCloseTo(
            calcSlotCenterY(baseTopY, [entries[0].thickness, entries[4].thickness], entries[4].thickness, 1, pitch),
            6,
        );
    });

    it('四个同种颜色/同大小圈同时相邻时，四个同时消除', () => {
        const entries = [
            makeEntry('g0', { kind: 'normal', color: 'green' }),
            makeEntry('b1', { kind: 'normal', color: 'blue' }),
            makeEntry('b2', { kind: 'normal', color: 'blue' }),
            makeEntry('b3', { kind: 'normal', color: 'blue' }),
            makeEntry('b4', { kind: 'normal', color: 'blue' }),
            makeEntry('r5', { kind: 'normal', color: 'red' }),
        ];

        const res = resolvePillarMatch(entries, { baseTopY, pitchScale: pitch });
        expect(res.matched).toBe(true);
        expect(res.group?.count).toBe(4);
        expect(res.group?.entries.map((e) => e.item)).toEqual(['b1', 'b2', 'b3', 'b4']);
        expect(res.group?.indices).toEqual([1, 2, 3, 4]);

        expect(res.remaining.map((r) => r.item)).toEqual(['g0', 'r5']);
        expect(res.remaining[0].moved).toBe(false);
        expect(res.remaining[1].moved).toBe(true);
        expect(res.remaining[1].newIndex).toBe(1);
    });

    it('特殊圈需相邻且同种同大小才消除；隔开或不同大小不消除', () => {
        // 隔开的小金环不消除
        expect(
            resolvePillarMatch(
                [makeEntry('g1', { kind: 'gold' }), makeEntry('b1', { kind: 'normal', color: 'blue' }), makeEntry('g2', { kind: 'gold' })],
                { baseTopY },
            ).matched,
        ).toBe(false);

        // 相邻小金环、相邻铁圈、相邻木圈各自消除
        const goldRes = resolvePillarMatch(
            [makeEntry('b1', { kind: 'normal', color: 'blue' }), makeEntry('g1', { kind: 'gold' }), makeEntry('g2', { kind: 'gold' })],
            { baseTopY },
        );
        expect(goldRes.matched).toBe(true);
        expect(goldRes.group?.entries.map((e) => e.item)).toEqual(['g1', 'g2']);

        const ironRes = resolvePillarMatch(
            [makeEntry('i1', { kind: 'iron' }), makeEntry('i2', { kind: 'iron' }), makeEntry('i3', { kind: 'iron' })],
            { baseTopY },
        );
        expect(ironRes.matched).toBe(true);
        expect(ironRes.group?.count).toBe(3);

        const woodRes = resolvePillarMatch(
            [makeEntry('w1', { kind: 'wood' }), makeEntry('w2', { kind: 'wood' })],
            { baseTopY },
        );
        expect(woodRes.matched).toBe(true);
        expect(woodRes.group?.count).toBe(2);

        // 同色但不同大小的圈不消除
        const diffSize = resolvePillarMatch(
            [makeEntry('r1', { kind: 'normal', color: 'red' }, 12.4), makeEntry('r2', { kind: 'normal', color: 'red' }, 9.9)],
            { baseTopY },
        );
        expect(diffSize.matched).toBe(false);
    });

    it('指定 preferredIndex 时优先消除包含刚落锁圈的那一组（兼容下落连锁顺序）', () => {
        const entries = [
            makeEntry('r0', { kind: 'normal', color: 'red' }),
            makeEntry('r1', { kind: 'normal', color: 'red' }),
            makeEntry('b2', { kind: 'normal', color: 'blue' }),
            makeEntry('g3', { kind: 'normal', color: 'green' }),
            makeEntry('g4', { kind: 'normal', color: 'green' }),
        ];

        const res = resolvePillarMatch(entries, { baseTopY, preferredIndex: 4 });
        expect(res.matched).toBe(true);
        expect(res.group?.indices).toEqual([3, 4]);
        expect(res.remaining.map((r) => r.item)).toEqual(['r0', 'r1', 'b2']);
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

    it('5/6 个任意数量相邻同色圈同样全部同时消除', () => {
        const entries5 = ['r1', 'r2', 'r3', 'r4', 'r5'].map((id) =>
            makeEntry(id, { kind: 'normal', color: 'red' }),
        );
        const res5 = resolvePillarMatch(entries5, { baseTopY, pitchScale: pitch });
        expect(res5.matched).toBe(true);
        expect(res5.group?.count).toBe(5);
        expect(res5.remaining).toHaveLength(0);
    });

    it('shouldDeferPillarMatch 在柱上仍有相邻未锁定同色圈（或组内夹着未锁定圈）时暂缓消除，确保全部同时消除', () => {
        const geom = calcRingPillarGeometry(TankSpace.width);
        const thick = geom.ringThickness;
        const redSpec: RingSpec = { kind: 'normal', color: 'red' };
        const blueSpec: RingSpec = { kind: 'normal', color: 'blue' };

        const locked2: PillarRingCandidate[] = [
            { spec: redSpec, thickness: thick, y: 244, lockedIndex: 0 },
            { spec: redSpec, thickness: thick, y: 260, lockedIndex: 1 },
        ];

        // 1. 正上方有第 3/4 个未锁定红圈还在柱上稳定中 -> 暂缓消除，等它们锁好一起消
        expect(
            shouldDeferPillarMatch(locked2, [{ spec: redSpec, thickness: thick, y: 276, lockedIndex: -1 }], [0, 1]),
        ).toBe(true);

        // 2. 正下方也有未锁定红圈 -> 暂缓消除
        expect(
            shouldDeferPillarMatch(
                [
                    { spec: redSpec, thickness: thick, y: 260, lockedIndex: 0 },
                    { spec: redSpec, thickness: thick, y: 276, lockedIndex: 1 },
                ],
                [{ spec: redSpec, thickness: thick, y: 244, lockedIndex: -1 }],
                [0, 1],
            ),
        ).toBe(true);

        // 3. 中间隔着异色蓝圈，上方才是红圈 -> 不暂缓，下方两红照常消
        expect(
            shouldDeferPillarMatch(
                locked2,
                [
                    { spec: blueSpec, thickness: thick, y: 276, lockedIndex: -1 },
                    { spec: redSpec, thickness: thick, y: 292, lockedIndex: -1 },
                ],
                [0, 1],
            ),
        ).toBe(false);

        // 4. 异色未锁定圈物理夹在两红中间 -> 暂缓，等蓝圈先落定排序避免跨圈误消
        expect(
            shouldDeferPillarMatch(
                [
                    { spec: redSpec, thickness: thick, y: 244, lockedIndex: 0 },
                    { spec: redSpec, thickness: thick, y: 276, lockedIndex: 1 },
                ],
                [{ spec: blueSpec, thickness: thick, y: 260, lockedIndex: -1 }],
                [0, 1],
            ),
        ).toBe(true);
    });
});
