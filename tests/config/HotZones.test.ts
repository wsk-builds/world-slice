import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    clampToHotZone,
    DEFAULT_HOT_ZONE_WIDTH_PCT,
    getHotZonePctRects,
    getHotZoneRects,
    getHotZoneWidthPx,
    HotZones,
    inHotZone,
    MAX_HOT_ZONE_WIDTH_PCT,
    MIN_HOT_ZONE_WIDTH_PCT,
    whichHotZone,
} from '../../assets/scripts/config/HotZones';
import { TankSpace } from '../../assets/scripts/config/TankSpace';

describe('HotZones 拇指热区纯逻辑（T021）', () => {
    afterEach(() => {
        HotZones.reset();
    });

    it('起始宽度为内屏左右各 22% 且左右热区对称在内屏内', () => {
        expect(HotZones.widthPct).toBe(DEFAULT_HOT_ZONE_WIDTH_PCT);
        expect(DEFAULT_HOT_ZONE_WIDTH_PCT).toBe(22);

        const wPx = getHotZoneWidthPx();
        expect(wPx).toBeCloseTo(TankSpace.width * 0.22, 6);

        const [left, right] = getHotZoneRects();
        expect(left).toEqual({
            side: 'left',
            x: 0,
            y: 0,
            width: wPx,
            height: TankSpace.height,
        });
        expect(right).toEqual({
            side: 'right',
            x: TankSpace.width - wPx,
            y: 0,
            width: wPx,
            height: TankSpace.height,
        });

        const [leftPct, rightPct] = getHotZonePctRects();
        expect(leftPct).toEqual({ side: 'left', x: 0, y: 0, width: 22, height: 100 });
        expect(rightPct).toEqual({ side: 'right', x: 78, y: 0, width: 22, height: 100 });
    });

    it('inHotZone 与 whichHotZone 在缸像素坐标与百分比坐标下判定准确', () => {
        const wPx = getHotZoneWidthPx();

        expect(inHotZone({ x: 0, y: 0 })).toBe(true);
        expect(inHotZone({ x: wPx, y: TankSpace.height })).toBe(true);
        expect(whichHotZone({ x: 50, y: 200 })).toBe('left');

        expect(inHotZone({ x: TankSpace.width - wPx, y: 120 })).toBe(true);
        expect(inHotZone({ x: TankSpace.width, y: 300 })).toBe(true);
        expect(whichHotZone({ x: TankSpace.width - 20, y: 300 })).toBe('right');

        // 内屏正中死区与越界高度均不在热区内
        expect(inHotZone({ x: TankSpace.width * 0.5, y: TankSpace.height * 0.5 })).toBe(false);
        expect(whichHotZone({ x: wPx + 1, y: 200 })).toBeNull();
        expect(inHotZone({ x: 50, y: -1 })).toBe(false);
        expect(inHotZone({ x: 50, y: TankSpace.height + 1 })).toBe(false);

        // 百分比坐标支持
        expect(inHotZone({ x: 10, y: 50 }, 'pct')).toBe(true);
        expect(inHotZone({ x: 50, y: 50 }, 'pct')).toBe(false);
        expect(inHotZone({ x: 85, y: 50 }, 'pct')).toBe(true);
    });

    it('clampToHotZone 就近夹入左/右热区并夹紧到内屏高度内', () => {
        const wPx = getHotZoneWidthPx();

        // 已在热区内保持原坐标
        expect(clampToHotZone({ x: 100, y: 240 })).toEqual({ x: 100, y: 240 });
        expect(clampToHotZone({ x: TankSpace.width - 80, y: 240 })).toEqual({
            x: TankSpace.width - 80,
            y: 240,
        });

        // 靠左死区夹到左热区右边缘；靠右死区夹到右热区左边缘
        const leftClamped = clampToHotZone({ x: TankSpace.width * 0.4, y: 300 });
        expect(leftClamped.x).toBeCloseTo(wPx, 6);
        expect(leftClamped.y).toBe(300);

        const rightClamped = clampToHotZone({ x: TankSpace.width * 0.65, y: 300 });
        expect(rightClamped.x).toBeCloseTo(TankSpace.width - wPx, 6);
        expect(rightClamped.y).toBe(300);

        // 越界 X / Y 同步夹紧
        expect(clampToHotZone({ x: -30, y: -25 })).toEqual({ x: 0, y: 0 });
        expect(clampToHotZone({ x: TankSpace.width + 50, y: TankSpace.height + 80 })).toEqual({
            x: TankSpace.width,
            y: TankSpace.height,
        });

        // 百分比模式 + padding
        expect(clampToHotZone({ x: 42, y: 120 }, { space: 'pct', padding: 2 })).toEqual({
            x: 20,
            y: 98,
        });
    });

    it('修改热区宽度会夹紧到合法范围并触发变更监听，reset 恢复 22%', () => {
        const listener = vi.fn();
        const unsub = HotZones.onChange(listener);

        expect(HotZones.setWidthPct(5)).toBe(MIN_HOT_ZONE_WIDTH_PCT);
        expect(HotZones.widthPct).toBe(MIN_HOT_ZONE_WIDTH_PCT);
        expect(listener).toHaveBeenCalledWith(MIN_HOT_ZONE_WIDTH_PCT);

        expect(HotZones.setWidthPct(32)).toBe(32);
        expect(inHotZone({ x: TankSpace.width * 0.3, y: 100 })).toBe(true);

        expect(HotZones.setWidthPct(80)).toBe(MAX_HOT_ZONE_WIDTH_PCT);
        expect(HotZones.reset()).toBe(DEFAULT_HOT_ZONE_WIDTH_PCT);
        expect(inHotZone({ x: TankSpace.width * 0.3, y: 100 })).toBe(false);

        unsub();
    });
});
