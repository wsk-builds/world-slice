import { describe, expect, it, vi } from 'vitest';
import { GameConst } from '../../../assets/scripts/config/GameConst';
import { TappableRegistry } from '../../../assets/scripts/core/input/TappableRegistry';

describe('TappableRegistry 敲玻璃可点对象登记表（T021）', () => {
    it('默认命中倍率常量生效：超出图形本身但在放大半径内可命中，超出放大半径则不命中', () => {
        expect(GameConst.tappableHitScale).toBeGreaterThan(1);

        const registry = new TappableRegistry();
        const onTap = vi.fn();
        const radius = 50;
        const expanded = radius * GameConst.tappableHitScale; // 50 * 1.4 = 70

        registry.register({
            id: 'clam_left',
            position: { x: 120, y: 100 },
            radius,
            onTap,
        });

        // 图形外（距离 60 > 50）但在放大后范围（<= 70）内 -> 命中
        const hit = registry.dispatchTap({ x: 180, y: 100 });
        expect(hit).not.toBeNull();
        expect(hit?.id).toBe('clam_left');
        expect(hit?.distance).toBeCloseTo(60, 6);
        expect(onTap).toHaveBeenCalledTimes(1);

        // 刚好超出放大半径（距离 72 > 70）-> 不命中
        const miss = registry.dispatchTap({ x: 192, y: 100 });
        expect(miss).toBeNull();
        expect(onTap).toHaveBeenCalledTimes(1);
    });

    it('支持矩形尺寸与自定义 hitScale，以及动态坐标读取', () => {
        const registry = new TappableRegistry();
        const onTap = vi.fn();
        const pos = { x: 100, y: 200 };

        registry.register({
            id: 'crab_right',
            getPosition: () => pos,
            size: { width: 100, height: 60 },
            hitScale: 1.5,
            onTap,
        });

        // 放大后半宽 75、半高 45
        expect(registry.dispatchTap({ x: 170, y: 240 })?.id).toBe('crab_right');
        expect(registry.dispatchTap({ x: 176, y: 200 })).toBeNull();

        // 目标移动后按新坐标判定
        pos.x = 240;
        pos.y = 260;
        expect(registry.dispatchTap({ x: 100, y: 200 })).toBeNull();
        expect(registry.dispatchTap({ x: 245, y: 255 })?.id).toBe('crab_right');
        expect(onTap).toHaveBeenCalledTimes(2);
    });

    it('多个可点对象放大范围重叠时，一次点击只触发离点击位置最近的那个对象', () => {
        const registry = new TappableRegistry();
        const tapA = vi.fn();
        const tapB = vi.fn();
        const tapC = vi.fn();

        registry.register({ id: 'obj_a', position: { x: 100, y: 100 }, radius: 50, onTap: tapA });
        registry.register({ id: 'obj_b', position: { x: 160, y: 100 }, radius: 50, onTap: tapB });
        registry.register({ id: 'obj_c', position: { x: 135, y: 140 }, radius: 50, onTap: tapC });

        // 点击 (145, 102)：距离 B(160,100) ≈ 15.13，距离 C(135,140) ≈ 39.3，距离 A(100,100) ≈ 45.04
        const hit1 = registry.dispatchTap({ x: 145, y: 102 });
        expect(hit1?.id).toBe('obj_b');
        expect(tapB).toHaveBeenCalledTimes(1);
        expect(tapA).toHaveBeenCalledTimes(0);
        expect(tapC).toHaveBeenCalledTimes(0);

        // 点击 (115, 100)：距离 A 15 < 距离 B 45 < 距离 C ≈ 44.7
        const hit2 = registry.dispatchTap({ x: 115, y: 100 });
        expect(hit2?.id).toBe('obj_a');
        expect(tapA).toHaveBeenCalledTimes(1);
        expect(tapB).toHaveBeenCalledTimes(1);
        expect(tapC).toHaveBeenCalledTimes(0);
    });

    it('禁用或注销对象后不再命中，自动把点击让给其余有效对象', () => {
        const registry = new TappableRegistry();
        const tapNear = vi.fn();
        const tapFar = vi.fn();

        registry.register({ id: 'near', position: { x: 100, y: 100 }, radius: 50, onTap: tapNear });
        registry.register({ id: 'far', position: { x: 130, y: 100 }, radius: 50, onTap: tapFar });

        // 禁用 near 后，同一点击落到 far
        expect(registry.setEnabled('near', false)).toBe(true);
        expect(registry.isEnabled('near')).toBe(false);
        expect(registry.dispatchTap({ x: 105, y: 100 })?.id).toBe('far');
        expect(tapNear).not.toHaveBeenCalled();
        expect(tapFar).toHaveBeenCalledTimes(1);

        // 重新启用 near 后恢复优先命中
        registry.setEnabled('near', true);
        expect(registry.dispatchTap({ x: 105, y: 100 })?.id).toBe('near');

        // 注销 near 后不再命中
        expect(registry.unregister('near')).toBe(true);
        expect(registry.has('near')).toBe(false);
        expect(registry.dispatchTap({ x: 105, y: 100 })?.id).toBe('far');

        // clear 清空全部
        registry.clear();
        expect(registry.count).toBe(0);
        expect(registry.dispatchTap({ x: 130, y: 100 })).toBeNull();
    });
});
