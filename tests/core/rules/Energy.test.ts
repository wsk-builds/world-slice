import { describe, expect, it, vi } from 'vitest';
import { GameConst } from '../../../assets/scripts/config/GameConst';
import { resolvePillarEnergyEnabled } from '../../../assets/scripts/core/level/LevelData';
import {
    calcLitEnergyTicks,
    PillarEnergy,
    SkillTriggerEvent,
} from '../../../assets/scripts/core/rules/Energy';

describe('Energy 柱子充能与技能触发（T017）', () => {
    it('单套锁定 +10%，触发同款消除额外 +40%（单次 +50%，凑成一对共 60%）', () => {
        const energy = new PillarEnergy();
        expect(energy.lockGain).toBe(GameConst.energyLockGainPct);
        expect(energy.matchBonus).toBe(GameConst.energyMatchBonusPct);
        expect(energy.maxEnergy).toBe(GameConst.energyMaxPct);

        // 第一枚红圈套中锁定 -> +10%（1 格）
        const first = energy.recordLock('left', false);
        expect(first.added).toBe(10);
        expect(first.triggered).toBe(false);
        expect(first.energy).toBe(10);
        expect(first.ratio).toBeCloseTo(0.1, 6);
        expect(first.litTicks).toBe(1);

        // 异色蓝圈套中不消除 -> 再 +10%（共 20%，2 格）
        const second = energy.recordLock('left', false);
        expect(second.added).toBe(10);
        expect(second.energy).toBe(20);
        expect(second.litTicks).toBe(2);

        // 第二枚红圈套中并触发消除 -> +10% + 40% = +50%（总 70%，若仅有一对则为 10% + 50% = 60%）
        const third = energy.recordLock('left', true);
        expect(third.added).toBe(50);
        expect(third.triggered).toBe(false);
        expect(third.energy).toBe(70);
        expect(third.litTicks).toBe(7);

        // 右柱独立计算，凑成纯粹一对：10% + 50% = 60%
        energy.recordLock('right', false);
        const pairSecond = energy.recordLock('right', true);
        expect(pairSecond.energy).toBe(60);
        expect(pairSecond.litTicks).toBe(6);
    });

    it('满 100% 触发技能事件并保留溢出能量（如 90% + 50% -> 触发后保留 40%）', () => {
        const energy = new PillarEnergy();
        const triggers: SkillTriggerEvent[] = [];
        energy.onSkillTrigger((e) => triggers.push(e));

        // 左柱先积累到 90%（一对 60% + 三个单套 30%）
        energy.recordLock('left', false);
        energy.recordLock('left', true); // 60
        energy.recordLock('left', false); // 70
        energy.recordLock('left', false); // 80
        energy.recordLock('left', false); // 90
        expect(energy.getEnergy('left')).toBe(90);
        expect(triggers).toHaveLength(0);

        // 再次消除 +50% -> 140% -> 触发技能，保留溢出 40%
        const res = energy.recordLock('left', true);
        expect(res.triggered).toBe(true);
        expect(res.overflow).toBe(40);
        expect(res.energy).toBe(40);
        expect(energy.getEnergy('left')).toBe(40);
        expect(energy.isSkillActive('left')).toBe(true);

        expect(triggers).toHaveLength(1);
        expect(triggers[0]).toEqual({
            side: 'left',
            overflow: 40,
            durationSec: GameConst.pillarSkillDurationSec,
            triggerCount: 1,
        });
    });

    it('技能持续期间该柱暂停充能，结束后恢复充能且溢出仍在；未接技能效果时 5 秒后自动恢复不卡死', () => {
        const energy = new PillarEnergy();
        const triggers: SkillTriggerEvent[] = [];
        energy.onSkillTrigger((e) => triggers.push(e));

        // 凑到 90% 后再消除触发（保留 40%）
        energy.addEnergy('right', 90);
        energy.recordLock('right', true);
        expect(energy.isSkillActive('right')).toBe(true);
        expect(energy.getEnergy('right')).toBe(40);

        // 技能持续期间（前 4 秒）本柱暂停充能，但另一侧左柱不受影响
        energy.step(2.0);
        const pausedLock = energy.recordLock('right', true);
        expect(pausedLock.pausedBySkill).toBe(true);
        expect(pausedLock.added).toBe(0);
        expect(pausedLock.triggered).toBe(false);
        expect(energy.getEnergy('right')).toBe(40);

        const leftDuringRightSkill = energy.recordLock('left', true);
        expect(leftDuringRightSkill.pausedBySkill).toBe(false);
        expect(leftDuringRightSkill.added).toBe(50);

        // 走完剩余 3 秒（总 5 秒），右柱技能结束、恢复充能，溢出 40% 仍在
        energy.step(3.0);
        expect(energy.isSkillActive('right')).toBe(false);
        expect(energy.getEnergy('right')).toBe(40);
        expect(triggers).toHaveLength(1);

        // 恢复后再消除一次 +50% -> 90%，再单套 +10% -> 100% 再次触发（无溢出）
        energy.recordLock('right', true);
        expect(energy.getEnergy('right')).toBe(90);
        const secondTrigger = energy.recordLock('right', false);
        expect(secondTrigger.triggered).toBe(true);
        expect(secondTrigger.overflow).toBe(0);
        expect(energy.getEnergy('right')).toBe(0);
        expect(triggers).toHaveLength(2);
    });

    it('技能结束时若溢出本身 >= 100%，自动顺延触发下一轮；skillDurationSec=0 时不会死循环', () => {
        const energy = new PillarEnergy({ skillDurationSec: 5 });
        const triggers: SkillTriggerEvent[] = [];
        energy.onSkillTrigger((e) => triggers.push(e));

        // 一次性注入 220%：立即触发第 1 次，留 120% 溢出
        const r1 = energy.addEnergy('left', 220);
        expect(r1.triggered).toBe(true);
        expect(r1.overflow).toBe(120);
        expect(triggers).toHaveLength(1);

        // 5 秒技能结束后溢出 120% >= 100%，顺延触发第 2 次并留 20% 溢出
        const stepEvents = energy.step(5.0);
        expect(stepEvents).toHaveLength(1);
        expect(stepEvents[0]).toMatchObject({ side: 'left', overflow: 20, triggerCount: 2 });
        expect(energy.isSkillActive('left')).toBe(true);
        expect(energy.getEnergy('left')).toBe(20);

        // 再走完 5 秒后退出技能期，保留 20%，不会继续无限触发
        const stepEnd = energy.step(5.0);
        expect(stepEnd).toHaveLength(0);
        expect(energy.isSkillActive('left')).toBe(false);
        expect(energy.getEnergy('left')).toBe(20);

        // skillDurationSec = 0 时触发后不卡在技能期，也不会死循环
        const zeroDur = new PillarEnergy({ skillDurationSec: 0 });
        const zeroTriggers: SkillTriggerEvent[] = [];
        zeroDur.onSkillTrigger((e) => zeroTriggers.push(e));
        zeroDur.addEnergy('left', 130);
        expect(zeroDur.isSkillActive('left')).toBe(false);
        expect(zeroDur.getEnergy('left')).toBe(30);
        expect(zeroDur.step(5.0)).toHaveLength(0);
        expect(zeroTriggers).toHaveLength(1);
    });

    it('支持按关卡数据开关单柱/双柱充能（覆盖第 1–2 关双关、第 3 关只开左柱规则）', () => {
        // 第 1–2 关：双柱关闭
        const l1Switch = resolvePillarEnergyEnabled({ pillarEnergy: { left: false, right: false } });
        expect(l1Switch).toEqual({ left: false, right: false });
        const l1Energy = new PillarEnergy({ enabled: l1Switch });
        expect(l1Energy.isEnabled('left')).toBe(false);
        expect(l1Energy.isEnabled('right')).toBe(false);

        const l1ResLeft = l1Energy.recordLock('left', true);
        const l1ResRight = l1Energy.recordLock('right', true);
        expect(l1ResLeft).toMatchObject({ enabled: false, added: 0, triggered: false, energy: 0, litTicks: 0 });
        expect(l1ResRight).toMatchObject({ enabled: false, added: 0, triggered: false, energy: 0, litTicks: 0 });

        // 第 3 关：仅开左柱
        const l3Switch = resolvePillarEnergyEnabled({ pillarEnergy: { left: true, right: false } });
        expect(l3Switch).toEqual({ left: true, right: false });
        const l3Energy = new PillarEnergy({ enabled: l3Switch });
        expect(l3Energy.recordLock('left', true)).toMatchObject({ enabled: true, added: 50, energy: 50, litTicks: 5 });
        expect(l3Energy.recordLock('right', true)).toMatchObject({ enabled: false, added: 0, energy: 0, litTicks: 0 });

        // 第 4 关起（省略 pillarEnergy 时默认双柱开启）
        expect(resolvePillarEnergyEnabled({})).toEqual({ left: true, right: true });
    });

    it('reset 与刻度换算、订阅通知及取消订阅工作正常', () => {
        expect(calcLitEnergyTicks(0)).toBe(0);
        expect(calcLitEnergyTicks(0.09)).toBe(0);
        expect(calcLitEnergyTicks(0.1)).toBe(1);
        expect(calcLitEnergyTicks(0.30000000000000004)).toBe(3);
        expect(calcLitEnergyTicks(0.6)).toBe(6);
        expect(calcLitEnergyTicks(1.0)).toBe(10);
        expect(calcLitEnergyTicks(1.4)).toBe(10);

        const energy = new PillarEnergy();
        const changeSpy = vi.fn();
        const unsub = energy.onChange(changeSpy);

        energy.recordLock('left', true); // 50%
        energy.addEnergy('right', 120); // 触发技能，溢出 20%
        expect(changeSpy).toHaveBeenCalled();

        // 重置并切换为仅右柱开启
        energy.reset({ enabled: { left: false, right: true } });
        expect(energy.getSnapshot('left')).toMatchObject({
            enabled: false,
            energy: 0,
            litTicks: 0,
            skillActive: false,
            triggerCount: 0,
        });
        expect(energy.getSnapshot('right')).toMatchObject({
            enabled: true,
            energy: 0,
            litTicks: 0,
            skillActive: false,
            triggerCount: 0,
        });

        unsub();
        const callsBefore = changeSpy.mock.calls.length;
        energy.recordLock('right', false);
        expect(changeSpy).toHaveBeenCalledTimes(callsBefore);
    });
});
