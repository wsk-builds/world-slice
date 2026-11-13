import { describe, expect, it } from 'vitest';
import { FeelConfig } from '../../../assets/scripts/config/FeelConfig';
import { Bladder } from '../../../assets/scripts/core/input/Bladder';

/** 按固定物理步长推进指定时长，累计总出水量 ∫ output dt（步前采样，与 WaterForce 每步前喂强度一致） */
function simulateHoldWater(bladder: Bladder, holdSec: number, dt = 1 / 60): number {
    bladder.press();
    const steps = Math.round(holdSec / dt);
    let totalWater = 0;
    for (let i = 0; i < steps; i++) {
        totalWater += bladder.output * dt;
        bladder.step(dt);
    }
    return totalWater;
}

describe('Bladder 气囊模型（T007）', () => {
    it('默认读取 FeelConfig 参数，按下 0 延迟立刻出水，松手立刻停水', () => {
        expect(FeelConfig.bladderMaxBreathSec).toBe(0.65);
        expect(FeelConfig.bladderRefillSec).toBeGreaterThanOrEqual(0.2);
        expect(FeelConfig.bladderRefillSec).toBeLessThanOrEqual(0.25);

        const bladder = new Bladder();
        expect(bladder.pressed).toBe(false);
        expect(bladder.output).toBe(0);
        expect(bladder.reserve).toBe(1);

        // 按下瞬间（未经任何 step）立刻输出满强度 1
        bladder.press();
        expect(bladder.pressed).toBe(true);
        expect(bladder.output).toBe(1);
        expect(bladder.reserve).toBe(1);

        // 推进 0.2 秒后余量下降，仍在出水；重复调用 press（如键盘连发）不改变当前口气强度
        bladder.step(0.2);
        bladder.press();
        expect(bladder.output).toBe(1);
        expect(bladder.reserve).toBeCloseTo(1 - 0.2 / 0.65, 5);

        // 松手瞬间立刻停水，余量保持松手刻的值等待回弹
        const reserveAtRelease = bladder.reserve;
        bladder.release();
        expect(bladder.pressed).toBe(false);
        expect(bladder.output).toBe(0);
        expect(bladder.reserve).toBeCloseTo(reserveAtRelease, 6);
    });

    it('轻点 0.1 秒的总出水量约等于按满一口气的 0.1 ÷ 0.65', () => {
        const dt = 1 / 60;

        const tapBladder = new Bladder();
        const tapWater = simulateHoldWater(tapBladder, 0.1, dt);
        tapBladder.release();
        expect(tapBladder.output).toBe(0);

        const fullBladder = new Bladder();
        // 按住 1.0 秒（超过 0.65 秒上限），总出水量只由前 0.65 秒贡献
        const fullWater = simulateHoldWater(fullBladder, 1.0, dt);
        fullBladder.release();

        const expectedRatio = 0.1 / 0.65;
        expect(tapWater / fullWater).toBeCloseTo(expectedRatio, 3);
    });

    it('按住超过 0.65 秒后出水强度与余量均为 0，继续按住不会提前回充', () => {
        const bladder = new Bladder();
        bladder.press();

        // 38 帧（约 0.633 秒 < 0.65 秒）时仍有余量并正常出水
        for (let i = 0; i < 38; i++) {
            bladder.step(1 / 60);
        }
        expect(bladder.output).toBe(1);
        expect(bladder.reserve).toBeGreaterThan(0);

        // 第 39 帧到达 0.65 秒上限，气囊排空、强度归零
        bladder.step(1 / 60);
        expect(bladder.reserve).toBe(0);
        expect(bladder.output).toBe(0);

        // 继续按住再过 0.5 秒（总计 1.15 秒 > 0.65 秒），强度保持 0 且不会自动吸气
        for (let i = 0; i < 30; i++) {
            bladder.step(1 / 60);
            expect(bladder.output).toBe(0);
            expect(bladder.reserve).toBe(0);
        }
    });

    it('松手后回弹吸气，0.25 秒后余量回到 1，再按恢复满强度', () => {
        const bladder = new Bladder();
        bladder.press();
        bladder.step(0.7); // 完全压空
        expect(bladder.reserve).toBe(0);
        expect(bladder.output).toBe(0);

        bladder.release();
        expect(bladder.reserve).toBe(0);

        // 松手 0.1 秒：正在回弹途中（0 < reserve < 1）
        for (let i = 0; i < 6; i++) {
            bladder.step(1 / 60);
        }
        expect(bladder.reserve).toBeGreaterThan(0.3);
        expect(bladder.reserve).toBeLessThan(1);

        // 累计松手满 0.25 秒（共 15 帧）：余量已回到 1
        for (let i = 0; i < 9; i++) {
            bladder.step(1 / 60);
        }
        expect(bladder.reserve).toBe(1);
        expect(bladder.output).toBe(0);

        // 吸满后再次按下，恢复满强度 1
        bladder.press();
        expect(bladder.output).toBe(1);
    });

    it('没吸满就再按，出水按余量打折；极快连点时第二下比第一下弱', () => {
        const dt = 1 / 60;

        // 场景 A：轻点 0.1 秒后仅松手 0.05 秒（极快连点）再按第二下 0.1 秒
        const rapidTapBladder = new Bladder();
        const firstTapPeak = (() => {
            rapidTapBladder.press();
            return rapidTapBladder.output;
        })();
        let firstTapWater = 0;
        for (let i = 0; i < 6; i++) {
            firstTapWater += rapidTapBladder.output * dt;
            rapidTapBladder.step(dt);
        }
        rapidTapBladder.release();

        // 松手仅 3 帧（0.05 秒 < 回充时间），尚未吸满
        for (let i = 0; i < 3; i++) {
            rapidTapBladder.step(dt);
        }
        const reserveBeforeSecond = rapidTapBladder.reserve;
        expect(reserveBeforeSecond).toBeGreaterThan(0);
        expect(reserveBeforeSecond).toBeLessThan(1);

        rapidTapBladder.press();
        const secondTapPeak = rapidTapBladder.output;
        expect(secondTapPeak).toBeCloseTo(reserveBeforeSecond, 6);
        expect(secondTapPeak).toBeLessThan(firstTapPeak);

        let secondTapWater = 0;
        for (let i = 0; i < 6; i++) {
            secondTapWater += rapidTapBladder.output * dt;
            rapidTapBladder.step(dt);
        }
        expect(secondTapWater).toBeLessThan(firstTapWater);

        // 场景 B：排空后仅松手 0.1 秒（约吸回一半）立刻再按，强度与持续时间均打折
        const halfBladder = new Bladder();
        halfBladder.press();
        halfBladder.step(0.65);
        halfBladder.release();
        halfBladder.step(0.1);

        const partialReserve = halfBladder.reserve;
        expect(partialReserve).toBeGreaterThan(0.35);
        expect(partialReserve).toBeLessThan(0.65);

        halfBladder.press();
        expect(halfBladder.output).toBeCloseTo(partialReserve, 6);
        expect(halfBladder.output).toBeLessThan(1);
    });

    it('边界保护：空囊瞬时重按强度为 0，非正 dt 安全忽略，reset 恢复满态', () => {
        const bladder = new Bladder();
        bladder.setPressed(true);
        bladder.step(0.65);
        expect(bladder.reserve).toBe(0);

        // 0 秒回充直接松开再按，仍为 0 强度
        bladder.setPressed(false);
        bladder.setPressed(true);
        expect(bladder.output).toBe(0);
        expect(bladder.reserve).toBe(0);

        // 非正或异常 dt 不破坏状态
        bladder.step(0);
        bladder.step(-0.5);
        bladder.step(Number.NaN);
        expect(bladder.output).toBe(0);
        expect(bladder.reserve).toBe(0);

        bladder.reset();
        expect(bladder.pressed).toBe(false);
        expect(bladder.reserve).toBe(1);
        expect(bladder.output).toBe(0);
    });
});
