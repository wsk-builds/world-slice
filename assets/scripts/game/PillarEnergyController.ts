import { _decorator, Component, Node } from 'cc';
import { LevelPillarEnergySwitch } from '../core/level/LevelData';
import {
    EnergySide,
    PillarEnergy,
    PillarEnergySnapshot,
    SkillTriggerEvent,
    SkillTriggerListener,
} from '../core/rules/Energy';
import { PhysicsStepper } from './PhysicsStepper';
import { Pillar } from './Pillar';
import { RingLockedEvent, ScoreJudge } from './ScoreJudge';

const { ccclass } = _decorator;

/**
 * 柱子充能与技能触发桥接组件（T017）：
 * - 监听 ScoreJudge.onRingLocked，将单套 (+10%) 与同款消除 (+40%，共 +50%) 喂给纯逻辑 PillarEnergy；
 * - 随 PhysicsStepper.onAfterStep 推进技能持续倒计时（暂停时冻结，结束后自动恢复充能并保留溢出）；
 * - 实时同步左右柱 3D 十字刻度与柱尖灵珠，并在满 100% 时触发闪光、打印提示与对外发出技能触发事件（供 T018/T019 订阅）。
 */
@ccclass('PillarEnergyController')
export class PillarEnergyController extends Component {
    readonly core = new PillarEnergy();

    leftPillar: Pillar | null = null;
    rightPillar: Pillar | null = null;
    scoreJudge: ScoreJudge | null = null;

    private stepper: PhysicsStepper | null = null;
    private unsubLock: (() => void) | null = null;
    private unsubChange: (() => void) | null = null;
    private unsubTrigger: (() => void) | null = null;
    private readonly skillListeners: SkillTriggerListener[] = [];

    static attach(
        tankRoot: Node,
        leftPillar: Pillar,
        rightPillar: Pillar,
        scoreJudge: ScoreJudge,
    ): PillarEnergyController {
        const ctrl = tankRoot.getComponent(PillarEnergyController) ?? tankRoot.addComponent(PillarEnergyController);
        ctrl.leftPillar = leftPillar;
        ctrl.rightPillar = rightPillar;
        ctrl.scoreJudge = scoreJudge;
        ctrl.bindSubscriptions();
        ctrl.syncAllVisuals();
        return ctrl;
    }

    onLoad(): void {
        this.stepper = this.getComponent(PhysicsStepper) ?? this.node.parent?.getComponent(PhysicsStepper) ?? null;
    }

    onEnable(): void {
        this.bindSubscriptions();
        this.syncAllVisuals();
    }

    private bindSubscriptions(): void {
        if (!this.stepper) {
            this.stepper = this.getComponent(PhysicsStepper) ?? this.node.parent?.getComponent(PhysicsStepper) ?? null;
        }
        this.stepper?.onAfterStep(this.onAfterStep);
        if (!this.unsubLock && this.scoreJudge) {
            this.unsubLock = this.scoreJudge.onRingLocked(this.onRingLocked);
        }
        if (!this.unsubChange) {
            this.unsubChange = this.core.onChange(this.onEnergyChanged);
        }
        if (!this.unsubTrigger) {
            this.unsubTrigger = this.core.onSkillTrigger(this.onCoreSkillTriggered);
        }
    }

    onDisable(): void {
        this.stepper?.offAfterStep(this.onAfterStep);
        this.unsubLock?.();
        this.unsubLock = null;
        this.unsubChange?.();
        this.unsubChange = null;
        this.unsubTrigger?.();
        this.unsubTrigger = null;
    }

    /** 订阅柱子技能触发事件（T018 潮引 / T019 定海在此接管具体技能效果） */
    onSkillTrigger(cb: SkillTriggerListener): () => void {
        if (!this.skillListeners.includes(cb)) {
            this.skillListeners.push(cb);
        }
        return () => {
            this.offSkillTrigger(cb);
        };
    }

    offSkillTrigger(cb: SkillTriggerListener): void {
        const idx = this.skillListeners.indexOf(cb);
        if (idx >= 0) {
            this.skillListeners.splice(idx, 1);
        }
    }

    getSnapshot(side: EnergySide): PillarEnergySnapshot {
        return this.core.getSnapshot(side);
    }

    /** 重置充能与技能状态，并按关卡开关刷新左右柱显示（切关 / 重开 / R 清空时调用） */
    reset(enabled?: LevelPillarEnergySwitch | null): void {
        this.core.reset({ enabled: enabled ?? { left: true, right: true } });
        this.leftPillar?.resetEnergyVisual(this.core.isEnabled('left'));
        this.rightPillar?.resetEnergyVisual(this.core.isEnabled('right'));
        this.syncAllVisuals();
    }

    syncAllVisuals(): void {
        this.applySnapshotToPillar(this.core.getSnapshot('left'));
        this.applySnapshotToPillar(this.core.getSnapshot('right'));
    }

    private onRingLocked = (event: RingLockedEvent): void => {
        this.core.recordLock(event.side, event.matched);
    };

    private onAfterStep = (dt: number): void => {
        this.core.step(dt);
    };

    private onEnergyChanged = (snapshot: PillarEnergySnapshot): void => {
        this.applySnapshotToPillar(snapshot);
    };

    private onCoreSkillTriggered = (event: SkillTriggerEvent): void => {
        const pillar = event.side === 'left' ? this.leftPillar : this.rightPillar;
        pillar?.triggerSkillFlash();

        console.log(event.side === 'left' ? '左柱技能触发' : '右柱技能触发');

        const listeners = this.skillListeners.slice();
        for (let i = 0; i < listeners.length; i++) {
            listeners[i](event);
        }
    };

    private applySnapshotToPillar(snapshot: PillarEnergySnapshot): void {
        const pillar = snapshot.side === 'left' ? this.leftPillar : this.rightPillar;
        if (!pillar || !pillar.isValid) {
            return;
        }
        pillar.setEnergyState({
            enabled: snapshot.enabled,
            ratio: snapshot.ratio,
            litTicks: snapshot.litTicks,
            skillActive: snapshot.skillActive,
        });
    }
}
