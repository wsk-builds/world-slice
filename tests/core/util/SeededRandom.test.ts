import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../../../assets/scripts/core/util/SeededRandom';

describe('SeededRandom', () => {
    it('同一个种子生成的序列完全相同', () => {
        const a = new SeededRandom(1024);
        const b = new SeededRandom(1024);

        const seqA = Array.from({ length: 20 }, () => a.next());
        const seqB = Array.from({ length: 20 }, () => b.next());

        expect(seqA).toEqual(seqB);
    });

    it('不同种子生成的序列不同', () => {
        const a = new SeededRandom(1024);
        const b = new SeededRandom(2048);

        const seqA = Array.from({ length: 10 }, () => a.next());
        const seqB = Array.from({ length: 10 }, () => b.next());

        expect(seqA).not.toEqual(seqB);
    });

    it('range 和 int 落在预期区间内', () => {
        const rng = new SeededRandom(42);
        for (let i = 0; i < 100; i++) {
            const v = rng.next();
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);

            const r = rng.range(-10, 10);
            expect(r).toBeGreaterThanOrEqual(-10);
            expect(r).toBeLessThan(10);

            const n = rng.int(5);
            expect(Number.isInteger(n)).toBe(true);
            expect(n).toBeGreaterThanOrEqual(0);
            expect(n).toBeLessThan(5);
        }
    });
});
