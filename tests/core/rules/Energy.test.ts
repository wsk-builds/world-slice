import { describe, expect, it, vi } from 'vitest';
import { GameConst } from '../../../assets/scripts/config/GameConst';
import { resolvePillarEnergyEnabled } from '../../../assets/scripts/core/level/LevelData';
import {
    calcLitEnergyTicks,
    calcMatchEnergyBonusPct,
    PillarEnergy,
    SkillTriggerEvent,
} from '../../../assets/scripts/core/rules/Energy';

describe('Energy 柱子充能与技能触发（2/3/4 消梯度能量）', () => {
    it('单套锁定 +10%，消除 2/3/4 个圈分别额外加 20%/30%/40%', () => {
        expect(calcMatchEnergyBonusPct(0)).toBe(0);
        expect(calcMatchEnergyBonusPct(1)).toBe(0);
        expect(calcMatchEnergyBonusPct(2)).toBe(20);
        expect(calcMatchEnergyBonusPct(3)).toBe(30);
        expect(calcMatchEnergyBonusPct(4)).toBe(40);
        expect(calcMatchEnergyBonusPct(5)).toBe(50);
        expect(calcMatchEnergyBonusPct(6)).toBe(60);

        const energy = new PillarEnergy();
        expect(energy.lockGain).toBe(GameConst.energyLockGainPct);
        expect(energy.matchBonus).toBe(GameConst.energyMatchBonus2Pct);
        expect(energy.matchBonus3).toBe(GameConst.energyMatchBonus3Pct);
        expect(energy.matchBonus4).toBe(GameConst.energyMatchBonus4Pct);
        expect(energy.maxEnergy).toBe(GameConst.energyMaxPct);

        // 第 1 枚红圈套中锁定 -> +10%（1 格）
        const first = energy.recordLock('left', 0);
        expect(first.added).toBe(10);
        expect(first.triggered).toBe(false);
        expect(first.energy).toBe(10);
        expect(first.litTicks).toBe(1);

        // 第 2 枚红圈套中并触发 2 圈消除 -> +10% + 20% = +30%（左柱累计 40%）
        const match2 = energy.recordLock('left', 2);
        expect(match2.added).toBe(30);
        expect(match2.energy).toBe(40);
        expect(match2.litTicks).toBe(4);

        // 3 圈消除 -> +10% + 30% = +40%（左柱累计 80%）
        const match3 = energy.recordLock('left', 3);
        expect(match3.added).toBe(40);
        expect(match3.energy).toBe(80);
        expect(match3.litTicks).toBe(8);

        // 右柱测试 4 圈消除 -> +10% + 40% = +50%
        const match4 = energy.recordLock('right', 4);
        expect(match4.added).toBe(50);
        expect(match4.energy).toBe(50);
        expect(match4.litTicks).toBe(5);

        // 纯连锁消除奖励（不加套中 +10%）-> 2/3/4 消分别 +20%/+30%/+40%
        expect(energy.recordMatchBonus('right', 2).added).toBe(20); // 70%
        expect(energy.recordMatchBonus('right', 3).added).toBe(30); // 100% 触发
        expect(energy.isSkillActive('right')).toBe(true);
    });

    it('满 100% 触发技能事件并保留溢出能量（如 80% + 40% -> 触发后保留 20%）', () => {
        const energy = new PillarEnergy();
        const triggers: SkillTriggerEvent[] = [];
        energy.onSkillTrigger((e) => triggers.push(e));

        // 左柱先积累到 80%（两对共 40%+40%）
        energy.recordLock('left', 0); // 10
        energy.recordLock('left', 2); // 40
        energy.recordLock('left', 0); // 50
        energy.recordLock('left', 2); // 80
        expect(energy.getEnergy('left')).toBe(80);
        expect(triggers).toHaveLength(0);

        // 再次 3 消 +40% -> 120% -> 触发技能，保留溢出 20%
        const res = energy.recordLock('left', 3);
        expect(res.triggered).toBe(true);
        expect(res.overflow).toBe(20);
        expect(res.energy).toBe(20);
        expect(energy.getEnergy('left')).toBe(20);
        expect(energy.isSkillActive('left')).toBe(true);

        expect(triggers).toHaveLength(1);
        expect(triggers[0]).toEqual({
            side: 'left',
            overflow: 20,
            durationSec: GameConst.pillarSkillDurationSec,
            triggerCount: 1,
        });
    });

    it('技能持续期间该柱暂停充能，结束后恢复充能且溢出仍在；未接技能效果时 5 秒后自动恢复不卡死', () => {
        const energy = new PillarEnergy();
        const triggers: SkillTriggerEvent[] = [];
        energy.onSkillTrigger((e) => triggers.push(e));

        // 凑到 90% 后再 2 消 (+30%) 触发（保留 20%）
        energy.addEnergy('right', 90);
        energy.recordLock('right', 2);
        expect(energy.isSkillActive('right')).toBe(true);
        expect(energy.getEnergy('right')).toBe(20);

        // 技能持续期间本柱暂停充能，另一侧左柱不受影响
        energy.step(2.0);
        const pausedLock = energy.recordLock('right', 2);
        expect(pausedLock.pausedBySkill).toBe(true);
        expect(pausedLock.added).toBe(0);
        expect(pausedLock.triggered).toBe(false);
        expect(energy.getEnergy('right')).toBe(20);

        const leftDuringRightSkill = energy.recordLock('left', 2);
        expect(leftDuringRightSkill.pausedBySkill).toBe(false);
        expect(leftDuringRightSkill.added).toBe(30);

        // 走完剩余 3 秒（总 5 秒），右柱技能结束、恢复充能，溢出 20% 仍在
        energy.step(3.0);
        expect(energy.isSkillActive('right')).toBe(false);
        expect(energy.getEnergy('right')).toBe(20);
        expect(triggers).toHaveLength(1);

        // 恢复后再 +50% (4 消) -> 70%，再 +30% (2 消) -> 100% 再次触发（无溢出）
        energy.recordLock('right', 4);
        expect(energy.getEnergy('right')).toBe(70);
        const secondTrigger = energy.recordLock('right', 2);
        expect(secondTrigger.triggered).toBe(true);
        expect(secondTrigger.overflow).toBe(0);
        expect(energy.getEnergy('right')).toBe(0);
        expect(triggers).toHaveLength(2);
    });

    it('技能结束时若溢出本身 >= 100%，自动顺延触发下一轮；skillDurationSec=0 时不会死循环', () => {
        const energy = new PillarEnergy({ skillDurationSec: 5 });
        const triggers: SkillTriggerEvent[] = [];
        energy.onSkillTrigger((e) => triggers.push(e));

        const r1 = energy.addEnergy('left', 220);
        expect(r1.triggered).toBe(true);
        expect(r1.overflow).toBe(120);
        expect(triggers).toHaveLength(1);

        const stepEvents = energy.step(5.0);
        expect(stepEvents).toHaveLength(1);
        expect(stepEvents[0]).toMatchObject({ side: 'left', overflow: 20, triggerCount: 2 });
        expect(energy.isSkillActive('left')).toBe(true);
        expect(energy.getEnergy('left')).toBe(20);

        const stepEnd = energy.step(5.0);
        expect(stepEnd).toHaveLength(0);
        expect(energy.isSkillActive('left')).toBe(false);
        expect(energy.getEnergy('left')).toBe(20);

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
        const l1Switch = resolvePillarEnergyEnabled({ pillarEnergy: { left: false, right: false } });
        expect(l1Switch).toEqual({ left: false, right: false });
        const l1Energy = new PillarEnergy({ enabled: l1Switch });
        expect(l1Energy.isEnabled('left')).toBe(false);
        expect(l1Energy.isEnabled('right')).toBe(false);

        const l1ResLeft = l1Energy.recordLock('left', 2);
        const l1ResRight = l1Energy.recordLock('right', 2);
        expect(l1ResLeft).toMatchObject({ enabled: false, added: 0, triggered: false, energy: 0, litTicks: 0 });
        expect(l1ResRight).toMatchObject({ enabled: false, added: 0, triggered: false, energy: 0, litTicks: 0 });

        const l3Switch = resolvePillarEnergyEnabled({ pillarEnergy: { left: true, right: false } });
        expect(l3Switch).toEqual({ left: true, right: false });
        const l3Energy = new PillarEnergy({ enabled: l3Switch });
        expect(l3Energy.recordLock('left', 2)).toMatchObject({ enabled: true, added: 30, energy: 30, litTicks: 3 });
        expect(l3Energy.recordLock('right', 2)).toMatchObject({ enabled: false, added: 0, energy: 0, litTicks: 0 });

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

        energy.recordLock('left', 2); // 30%
        energy.addEnergy('right', 120); // 触发技能，溢出 20%
        expect(changeSpy).toHaveBeenCalled();

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
