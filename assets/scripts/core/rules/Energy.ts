import { GameConst } from '../../config/GameConst';
import { LevelPillarEnergySwitch } from '../level/LevelData';

export type EnergySide = 'left' | 'right';

export interface PillarEnergyConfig {
    lockGain?: number;
    /** 2 圈消除额外加能量（默认 20%） */
    matchBonus?: number;
    /** 3 圈消除额外加能量（默认 30%） */
    matchBonus3?: number;
    /** 4 圈消除额外加能量（默认 40%） */
    matchBonus4?: number;
    maxEnergy?: number;
    skillDurationSec?: number;
    enabled?: LevelPillarEnergySwitch;
}

export interface PillarEnergySnapshot {
    side: EnergySide;
    enabled: boolean;
    energy: number;
    maxEnergy: number;
    /** 归一化充能进度 [0, 1] */
    ratio: number;
    /** 十字卡托应点亮的刻度格数 [0, tickCount] */
    litTicks: number;
    skillActive: boolean;
    skillRemainingSec: number;
    skillDurationSec: number;
    triggerCount: number;
}

export interface EnergyGainResult {
    side: EnergySide;
    enabled: boolean;
    pausedBySkill: boolean;
    added: number;
    triggered: boolean;
    energy: number;
    overflow: number;
    ratio: number;
    litTicks: number;
}

export interface SkillTriggerEvent {
    side: EnergySide;
    overflow: number;
    durationSec: number;
    triggerCount: number;
}

export type SkillTriggerListener = (event: SkillTriggerEvent) => void;
export type EnergyChangeListener = (snapshot: PillarEnergySnapshot) => void;

interface InternalPillarState {
    enabled: boolean;
    energy: number;
    skillActive: boolean;
    skillRemainingSec: number;
    triggerCount: number;
}

/** 按能量比例计算应点亮的刻度格数（默认 10 格，每格 10%） */
export function calcLitEnergyTicks(
    ratio: number,
    tickCount: number = GameConst.energyTickCount,
): number {
    if (!Number.isFinite(ratio) || ratio <= 0 || tickCount <= 0) {
        return 0;
    }
    const clamped = Math.min(1, Math.max(0, ratio));
    return Math.min(tickCount, Math.floor((clamped + 1e-6) * tickCount));
}

/**
 * 按本次消除的圈数计算额外充能百分比：
 * - 消除 2 个：+20%
 * - 消除 3 个：+30%
 * - 消除 4 个：+40%（超过 4 个按每多 1 个 +10% 递增）
 */
export function calcMatchEnergyBonusPct(
    matchCount: number,
    bonus2: number = GameConst.energyMatchBonus2Pct,
    bonus3: number = GameConst.energyMatchBonus3Pct,
    bonus4: number = GameConst.energyMatchBonus4Pct,
): number {
    if (!Number.isFinite(matchCount) || matchCount < 2) {
        return 0;
    }
    const count = Math.floor(matchCount);
    if (count === 2) {
        return bonus2;
    }
    if (count === 3) {
        return bonus3;
    }
    if (count === 4) {
        return bonus4;
    }
    return Math.min(100, bonus4 + (count - 4) * 10);
}

/**
 * 柱子充能与技能触发纯逻辑模型（GDD §2.1，T017，纯逻辑不依赖引擎）：
 * - 套中锁定 +10%；本次同时触发消除按消除数量额外加能量（2 圈 +20%、3 圈 +30%、4 圈 +40%）；
 * - 满 100% 发出技能触发事件并保留溢出能量；
 * - 技能持续期间（默认 5 秒）本柱暂停充能，结束后恢复充能并保留溢出；
 * - 支持按关卡数据单独开关左/右柱充能（如第 1–2 关双关、第 3 关仅左柱开启）。
 */
export class PillarEnergy {
    readonly lockGain: number;
    readonly matchBonus: number;
    readonly matchBonus3: number;
    readonly matchBonus4: number;
    readonly maxEnergy: number;
    private skillDurationSec: number;

    private readonly state: Record<EnergySide, InternalPillarState>;
    private readonly triggerListeners: SkillTriggerListener[] = [];
    private readonly changeListeners: EnergyChangeListener[] = [];

    constructor(config?: PillarEnergyConfig) {
        this.lockGain = config?.lockGain ?? GameConst.energyLockGainPct;
        this.matchBonus = config?.matchBonus ?? GameConst.energyMatchBonus2Pct;
        this.matchBonus3 = config?.matchBonus3 ?? GameConst.energyMatchBonus3Pct;
        this.matchBonus4 = config?.matchBonus4 ?? GameConst.energyMatchBonus4Pct;
        this.maxEnergy = config?.maxEnergy ?? GameConst.energyMaxPct;
        this.skillDurationSec = Math.max(0, config?.skillDurationSec ?? GameConst.pillarSkillDurationSec);

        this.state = {
            left: {
                enabled: config?.enabled?.left !== false,
                energy: 0,
                skillActive: false,
                skillRemainingSec: 0,
                triggerCount: 0,
            },
            right: {
                enabled: config?.enabled?.right !== false,
                energy: 0,
                skillActive: false,
                skillRemainingSec: 0,
                triggerCount: 0,
            },
        };
    }

    isEnabled(side: EnergySide): boolean {
        return this.state[side].enabled;
    }

    isSkillActive(side: EnergySide): boolean {
        return this.state[side].skillActive;
    }

    getEnergy(side: EnergySide): number {
        return this.state[side].energy;
    }

    getRatio(side: EnergySide): number {
        return this.calcRatio(this.state[side].energy);
    }

    getSnapshot(side: EnergySide): PillarEnergySnapshot {
        const s = this.state[side];
        const ratio = s.enabled ? this.calcRatio(s.energy) : 0;
        return {
            side,
            enabled: s.enabled,
            energy: s.energy,
            maxEnergy: this.maxEnergy,
            ratio,
            litTicks: s.enabled ? calcLitEnergyTicks(ratio) : 0,
            skillActive: s.skillActive,
            skillRemainingSec: s.skillRemainingSec,
            skillDurationSec: this.skillDurationSec,
            triggerCount: s.triggerCount,
        };
    }

    setEnabled(side: EnergySide, enabled: boolean): void {
        const s = this.state[side];
        const next = Boolean(enabled);
        if (s.enabled === next && (!next ? s.energy === 0 && !s.skillActive : true)) {
            return;
        }
        s.enabled = next;
        if (!next) {
            s.energy = 0;
            s.skillActive = false;
            s.skillRemainingSec = 0;
        }
        this.emitChange(side);
    }

    applyLevelSwitch(enabled?: LevelPillarEnergySwitch | null): void {
        this.setEnabled('left', enabled?.left !== false);
        this.setEnabled('right', enabled?.right !== false);
    }

    reset(options?: { enabled?: LevelPillarEnergySwitch | null; skillDurationSec?: number }): void {
        if (options?.skillDurationSec !== undefined && Number.isFinite(options.skillDurationSec)) {
            this.skillDurationSec = Math.max(0, options.skillDurationSec);
        }

        for (const side of ['left', 'right'] as const) {
            const s = this.state[side];
            s.energy = 0;
            s.skillActive = false;
            s.skillRemainingSec = 0;
            s.triggerCount = 0;
            if (options && 'enabled' in options) {
                s.enabled = side === 'left' ? options.enabled?.left !== false : options.enabled?.right !== false;
            }
            this.emitChange(side);
        }
    }

    /**
     * 记录一次套中锁定：
     * - `matched` 可传 boolean（true 按 2 圈消除计）或本次消除圈数（0/2/3/4）；
     * - 套中固定 +10%，若触发消除按 2/3/4 圈额外加 20%/30%/40%。
     */
    recordLock(side: EnergySide, matched: boolean | number): EnergyGainResult {
        const matchCount = typeof matched === 'number' ? matched : matched ? 2 : 0;
        const bonus = calcMatchEnergyBonusPct(matchCount, this.matchBonus, this.matchBonus3, this.matchBonus4);
        const amount = this.lockGain + bonus;
        return this.addEnergy(side, amount);
    }

    /** 仅记录一次纯消除额外能量（用于下落连锁消除，不重复加套中 +10%） */
    recordMatchBonus(side: EnergySide, matchCount: number): EnergyGainResult {
        const bonus = calcMatchEnergyBonusPct(matchCount, this.matchBonus, this.matchBonus3, this.matchBonus4);
        return this.addEnergy(side, bonus);
    }

    /** 增加指定能量值；若本柱关闭或正在释放技能则忽略 */
    addEnergy(side: EnergySide, amount: number): EnergyGainResult {
        const s = this.state[side];
        if (!s.enabled) {
            return {
                side,
                enabled: false,
                pausedBySkill: false,
                added: 0,
                triggered: false,
                energy: s.energy,
                overflow: 0,
                ratio: 0,
                litTicks: 0,
            };
        }

        if (s.skillActive) {
            const ratio = this.calcRatio(s.energy);
            return {
                side,
                enabled: true,
                pausedBySkill: true,
                added: 0,
                triggered: false,
                energy: s.energy,
                overflow: 0,
                ratio,
                litTicks: calcLitEnergyTicks(ratio),
            };
        }

        if (!Number.isFinite(amount) || amount <= 0) {
            const ratio = this.calcRatio(s.energy);
            return {
                side,
                enabled: true,
                pausedBySkill: false,
                added: 0,
                triggered: false,
                energy: s.energy,
                overflow: 0,
                ratio,
                litTicks: calcLitEnergyTicks(ratio),
            };
        }

        s.energy += amount;
        if (s.energy >= this.maxEnergy) {
            const triggerEvent = this.triggerSkillCycle(side, s);
            const ratio = this.calcRatio(s.energy);
            return {
                side,
                enabled: true,
                pausedBySkill: false,
                added: amount,
                triggered: true,
                energy: s.energy,
                overflow: triggerEvent.overflow,
                ratio,
                litTicks: calcLitEnergyTicks(ratio),
            };
        }

        this.emitChange(side);
        const ratio = this.calcRatio(s.energy);
        return {
            side,
            enabled: true,
            pausedBySkill: false,
            added: amount,
            triggered: false,
            energy: s.energy,
            overflow: 0,
            ratio,
            litTicks: calcLitEnergyTicks(ratio),
        };
    }

    /** 推进技能持续倒计时（使用物理时间 dt）；结束时恢复充能，若溢出仍 >= 100% 则顺延触发下一轮 */
    step(dt: number): SkillTriggerEvent[] {
        if (!Number.isFinite(dt) || dt <= 0) {
            return [];
        }
        const events: SkillTriggerEvent[] = [];

        for (const side of ['left', 'right'] as const) {
            const s = this.state[side];
            if (!s.enabled || !s.skillActive) {
                continue;
            }
            s.skillRemainingSec = Math.max(0, s.skillRemainingSec - dt);
            if (s.skillRemainingSec > 0) {
                continue;
            }

            s.skillActive = false;
            s.skillRemainingSec = 0;

            if (s.energy >= this.maxEnergy) {
                events.push(this.triggerSkillCycle(side, s));
            } else {
                this.emitChange(side);
            }
        }

        return events;
    }

    /** 提前结束某侧技能持续态（供外部技能控制器扩展使用） */
    endSkill(side: EnergySide): SkillTriggerEvent | null {
        const s = this.state[side];
        if (!s.skillActive) {
            return null;
        }
        s.skillActive = false;
        s.skillRemainingSec = 0;
        if (s.enabled && s.energy >= this.maxEnergy) {
            return this.triggerSkillCycle(side, s);
        }
        this.emitChange(side);
        return null;
    }

    onSkillTrigger(cb: SkillTriggerListener): () => void {
        if (!this.triggerListeners.includes(cb)) {
            this.triggerListeners.push(cb);
        }
        return () => {
            this.offSkillTrigger(cb);
        };
    }

    offSkillTrigger(cb: SkillTriggerListener): void {
        const idx = this.triggerListeners.indexOf(cb);
        if (idx >= 0) {
            this.triggerListeners.splice(idx, 1);
        }
    }

    onChange(cb: EnergyChangeListener): () => void {
        if (!this.changeListeners.includes(cb)) {
            this.changeListeners.push(cb);
        }
        return () => {
            this.offChange(cb);
        };
    }

    offChange(cb: EnergyChangeListener): void {
        const idx = this.changeListeners.indexOf(cb);
        if (idx >= 0) {
            this.changeListeners.splice(idx, 1);
        }
    }

    private triggerSkillCycle(side: EnergySide, s: InternalPillarState): SkillTriggerEvent {
        const overflow = Math.max(0, s.energy - this.maxEnergy);
        s.energy = overflow;
        s.triggerCount += 1;
        if (this.skillDurationSec > 0) {
            s.skillActive = true;
            s.skillRemainingSec = this.skillDurationSec;
        } else {
            s.skillActive = false;
            s.skillRemainingSec = 0;
        }

        const event: SkillTriggerEvent = {
            side,
            overflow,
            durationSec: this.skillDurationSec,
            triggerCount: s.triggerCount,
        };

        this.emitChange(side);
        const listeners = this.triggerListeners.slice();
        for (let i = 0; i < listeners.length; i++) {
            listeners[i](event);
        }
        return event;
    }

    private emitChange(side: EnergySide): void {
        if (this.changeListeners.length === 0) {
            return;
        }
        const snap = this.getSnapshot(side);
        const listeners = this.changeListeners.slice();
        for (let i = 0; i < listeners.length; i++) {
            listeners[i](snap);
        }
    }

    private calcRatio(energy: number): number {
        if (this.maxEnergy <= 0) {
            return 0;
        }
        return Math.min(1, Math.max(0, energy / this.maxEnergy));
    }
}
