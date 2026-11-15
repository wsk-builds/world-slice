import { describe, expect, it } from 'vitest';
import { GameConst } from '../../../assets/scripts/config/GameConst';
import { clipSegmentToRect, GlassRipplePool } from '../../../assets/scripts/core/input/GlassRipplePool';

describe('GlassRipplePool 与内屏边界裁剪（T021）', () => {
    it('固定容量池支持并发震纹、满池时覆盖最老槽位且自动淡出回收', () => {
        const pool = new GlassRipplePool(4);
        expect(pool.items.length).toBe(4);
        expect(pool.activeCount).toBe(0);

        pool.spawn(100, 100, false);
        pool.step(0.1);
        pool.spawn(200, 100, false);
        pool.step(0.1);
        pool.spawn(300, 100, true);
        pool.step(0.05);
        pool.spawn(400, 100, false);
        expect(pool.activeCount).toBe(4);

        // 满池第 5 次生成会顶掉最老的 (100, 100)
        pool.spawn(500, 200, true);
        expect(pool.activeCount).toBe(4);
        expect(pool.items.some((it) => it.active && it.x === 500 && it.hitMatched)).toBe(true);
        expect(pool.items.some((it) => it.active && it.x === 100)).toBe(false);

        // 推进超过持续时长后全部回收
        pool.step(GameConst.glassTapRippleDurationSec + 0.05);
        expect(pool.activeCount).toBe(0);
    });

    it('clipSegmentToRect 将越界线段严格裁剪在内屏矩形边界之内', () => {
        const out = { x0: 0, y0: 0, x1: 0, y1: 0 };

        // 穿过左下角边界的线段
        expect(clipSegmentToRect(-20, 10, 30, 10, 1, 1, 1059, 605, out)).toBe(true);
        expect(out.x0).toBe(1);
        expect(out.y0).toBe(10);
        expect(out.x1).toBe(30);
        expect(out.y1).toBe(10);

        // 斜穿右上角边界
        expect(clipSegmentToRect(1040, 590, 1080, 630, 1, 1, 1059, 605, out)).toBe(true);
        expect(out.x0).toBe(1040);
        expect(out.y0).toBe(590);
        expect(out.x1).toBeLessThanOrEqual(1059);
        expect(out.y1).toBeLessThanOrEqual(605);

        // 完全在内屏之外
        expect(clipSegmentToRect(-50, 200, -10, 300, 1, 1, 1059, 605, out)).toBe(false);
    });
});
