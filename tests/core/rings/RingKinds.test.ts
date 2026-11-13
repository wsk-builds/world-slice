import { describe, expect, it } from 'vitest';
import {
    DEBUG_RING_SLOTS,
    getRingKindConfig,
    ringSpecLabel,
    sameKind,
} from '../../../assets/scripts/core/rings/RingKinds';

describe('RingKinds', () => {
    it('各圈种尺寸、下沉与水流跟随倍率符合 GDD 设定', () => {
        const normal = getRingKindConfig({ kind: 'normal', color: 'red' });
        expect(normal.sizeScale).toBe(1);
        expect(normal.sinkScale).toBe(1);
        expect(normal.flowFollow).toBe(1);

        const gold = getRingKindConfig('gold');
        expect(gold.sizeScale).toBeCloseTo(0.8);
        expect(gold.sinkScale).toBe(1);
        expect(gold.flowFollow).toBe(1);

        const iron = getRingKindConfig('iron');
        expect(iron.sizeScale).toBe(1);
        expect(iron.sinkScale).toBeCloseTo(2.2);
        expect(iron.flowFollow).toBeLessThan(normal.flowFollow);

        const wood = getRingKindConfig('wood');
        expect(wood.sizeScale).toBe(1);
        expect(wood.sinkScale).toBeCloseTo(0.45);
        expect(wood.flowFollow).toBeGreaterThan(normal.flowFollow);
    });

    it('sameKind 普通圈按颜色匹配，特殊圈按种类匹配', () => {
        expect(sameKind({ kind: 'normal', color: 'red' }, { kind: 'normal', color: 'red' })).toBe(true);
        expect(sameKind({ kind: 'normal', color: 'red' }, { kind: 'normal', color: 'blue' })).toBe(false);
        expect(sameKind({ kind: 'normal' }, { kind: 'normal' })).toBe(false);

        expect(sameKind({ kind: 'gold' }, { kind: 'gold' })).toBe(true);
        expect(sameKind({ kind: 'gold', color: 'red' }, { kind: 'gold', color: 'blue' })).toBe(true);
        expect(sameKind({ kind: 'iron' }, { kind: 'iron' })).toBe(true);
        expect(sameKind({ kind: 'wood' }, { kind: 'wood' })).toBe(true);

        expect(sameKind({ kind: 'gold' }, { kind: 'iron' })).toBe(false);
        expect(sameKind({ kind: 'normal', color: 'orange' }, { kind: 'gold' })).toBe(false);
    });

    it('调试预设包含 7 个不重复款式的圈', () => {
        expect(DEBUG_RING_SLOTS.length).toBe(7);
        for (let i = 0; i < DEBUG_RING_SLOTS.length; i++) {
            expect(ringSpecLabel(DEBUG_RING_SLOTS[i]).length).toBeGreaterThan(0);
            for (let j = i + 1; j < DEBUG_RING_SLOTS.length; j++) {
                expect(sameKind(DEBUG_RING_SLOTS[i], DEBUG_RING_SLOTS[j])).toBe(false);
            }
        }
    });
});
