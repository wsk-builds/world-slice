import { _decorator, Color, Component, Graphics, Node, toRadian, UITransform } from 'cc';
import { GameConst } from '../config/GameConst';
import { Palette } from '../config/Palette';
import { TankSpace } from '../config/TankSpace';
import { buildTidePullFunnelBoost, TidePullFlowTerm } from '../core/flow/TidePullFlow';
import { FlowField } from '../core/flow/FlowField';
import { PillarEnergySnapshot, SkillTriggerEvent } from '../core/rules/Energy';
import { RenderLayers } from '../render/Stage3DRig';
import { Funnel } from './Funnel';
import { PhysicsStepper } from './PhysicsStepper';
import { Pillar } from './Pillar';
import { PillarEnergyController } from './PillarEnergyController';
import { ScoreJudge } from './ScoreJudge';

const { ccclass } = _decorator;

const TIDE_PULL_BOOST = buildTidePullFunnelBoost();
const VORTEX_SEGMENTS = 18;
const VORTEX_SWEEP_RAD = 3.4;
const TANK_PAD = 2;

const outerColorScratch = new Color();
const innerColorScratch = new Color();

export interface TidePullSkillDeps {
    flowField: FlowField;
    funnel: Funnel;
    energyController: PillarEnergyController;
    scoreJudge: ScoreJudge;
    leftPillar: Pillar;
}

function clampTankX(x: number): number {
    return Math.min(TankSpace.width - TANK_PAD, Math.max(TANK_PAD, x));
}

function clampTankY(y: number): number {
    return Math.min(TankSpace.height - TANK_PAD, Math.max(TANK_PAD, y));
}

/**
 * 左柱技能「潮引」引擎桥接与灰盒表现组件（GDD §2.3，T018）：
 * - 订阅左柱技能触发与 PillarEnergy 技能状态（持续约 5 秒，随 PhysicsStepper 物理时间推进，暂停时冻结）；
 * - 激活时放大左柱三维漏斗（Funnel.boost）并向 FlowField 注入顺时针向心漩流项；
 * - 左柱满柱（6 圈）时停止硬吸，切关 / 重开 / R 清空或技能结束时立即移除漩流项、清除漏斗增益并恢复充能；
 * - 灰盒表现：左柱柱尖灵珠处旋转的漩流线（共用单个 Graphics，零每帧对象分配，严守内屏边界）。
 */
@ccclass('TidePullSkill')
export class TidePullSkill extends Component {
    flowField: FlowField | null = null;
    funnel: Funnel | null = null;
    energyController: PillarEnergyController | null = null;
    scoreJudge: ScoreJudge | null = null;
    leftPillar: Pillar | null = null;

    private stepper: PhysicsStepper | null = null;
    private gfx: Graphics | null = null;
    private readonly swirlTerm = new TidePullFlowTerm();

    private active = false;
    private suppressedByFull = false;
    private animTime = 0;
    private visualBlend = 0;
    private hasDrawnLastFrame = false;

    private unsubTrigger: (() => void) | null = null;
    private unsubEnergy: (() => void) | null = null;

    static attach(tankRoot: Node, deps: TidePullSkillDeps): TidePullSkill {
        const comp = tankRoot.getComponent(TidePullSkill) ?? tankRoot.addComponent(TidePullSkill);
        comp.flowField = deps.flowField;
        comp.funnel = deps.funnel;
        comp.energyController = deps.energyController;
        comp.scoreJudge = deps.scoreJudge;
        comp.leftPillar = deps.leftPillar;
        comp.bindSubscriptions();
        return comp;
    }

    get isActive(): boolean {
        return this.active;
    }

    get isSuppressedByFull(): boolean {
        return this.suppressedByFull;
    }

    onLoad(): void {
        this.stepper = this.getComponent(PhysicsStepper) ?? this.node.parent?.getComponent(PhysicsStepper) ?? null;
        this.ensureVortexGraphics();
    }

    onEnable(): void {
        this.ensureVortexGraphics();
        this.bindSubscriptions();
    }

    onDisable(): void {
        this.unbindSubscriptions();
        this.deactivate();
    }

    onDestroy(): void {
        this.unbindSubscriptions();
        this.deactivate();
    }

    /** 重置技能状态，立即移除漩流项、清除漏斗增益并清空漩流线 */
    reset(): void {
        this.deactivate();
    }

    update(dt: number): void {
        if (this.stepper && !this.stepper.running) {
            return;
        }
        const safeDt = Math.min(Math.max(0, dt), 0.1);
        const targetBlend = this.active && !this.suppressedByFull ? 1 : 0;

        if (this.visualBlend < targetBlend) {
            this.visualBlend = Math.min(1, this.visualBlend + safeDt * 6.5);
        } else if (this.visualBlend > targetBlend) {
            this.visualBlend = Math.max(0, this.visualBlend - safeDt * 8.5);
        }

        if (this.visualBlend > 0.005) {
            this.animTime += safeDt;
        }
    }

    lateUpdate(): void {
        if (!this.gfx) {
            return;
        }
        if (this.visualBlend <= 0.01 || !this.leftPillar) {
            if (this.hasDrawnLastFrame) {
                this.gfx.clear();
                this.hasDrawnLastFrame = false;
            }
            return;
        }

        this.drawVortexLines(this.gfx);
        this.hasDrawnLastFrame = true;
    }

    private ensureVortexGraphics(): void {
        if (this.gfx && this.gfx.isValid) {
            return;
        }
        const existing = this.node.getChildByName('TidePullVortex');
        if (existing) {
            this.gfx = existing.getComponent(Graphics) ?? existing.addComponent(Graphics);
            return;
        }
        const vortexNode = new Node('TidePullVortex');
        vortexNode.layer = RenderLayers.BG_2D;
        const tf = vortexNode.addComponent(UITransform);
        tf.setContentSize(TankSpace.width, TankSpace.height);
        tf.setAnchorPoint(0, 0);
        vortexNode.setPosition(0, 0, 0);
        this.node.addChild(vortexNode);
        this.gfx = vortexNode.addComponent(Graphics);
    }

    private bindSubscriptions(): void {
        if (!this.stepper) {
            this.stepper = this.getComponent(PhysicsStepper) ?? this.node.parent?.getComponent(PhysicsStepper) ?? null;
        }
        this.stepper?.onBeforeStep(this.onBeforeStep);
        if (!this.unsubTrigger && this.energyController) {
            this.unsubTrigger = this.energyController.onSkillTrigger(this.onSkillTriggered);
        }
        if (!this.unsubEnergy && this.energyController) {
            this.unsubEnergy = this.energyController.core.onChange(this.onEnergyChanged);
        }
        if (this.energyController?.core.isSkillActive('left') && !this.active) {
            this.activate();
        }
    }

    private unbindSubscriptions(): void {
        this.stepper?.offBeforeStep(this.onBeforeStep);
        this.unsubTrigger?.();
        this.unsubTrigger = null;
        this.unsubEnergy?.();
        this.unsubEnergy = null;
    }

    private onSkillTriggered = (event: SkillTriggerEvent): void => {
        if (event.side !== 'left') {
            return;
        }
        this.activate();
    };

    private onEnergyChanged = (snapshot: PillarEnergySnapshot): void => {
        if (snapshot.side !== 'left') {
            return;
        }
        if (this.active && (!snapshot.skillActive || !snapshot.enabled)) {
            this.deactivate();
        }
    };

    private onBeforeStep = (_dt: number): void => {
        if (!this.active) {
            return;
        }
        if (this.energyController && !this.energyController.core.isSkillActive('left')) {
            this.deactivate();
            return;
        }
        this.syncPillarAnchorAndFullState();
    };

    private activate(): void {
        if (!this.leftPillar) {
            return;
        }
        if (this.energyController && !this.energyController.core.isEnabled('left')) {
            return;
        }

        this.active = true;
        this.swirlTerm.activate(this.leftPillar.node.position.x, this.leftPillar.tipY);
        this.syncPillarAnchorAndFullState();

        this.flowField?.addTerm(this.swirlTerm);
        this.funnel?.boost(
            'left',
            TIDE_PULL_BOOST.radiusScale,
            TIDE_PULL_BOOST.maxTiltDeg,
            TIDE_PULL_BOOST.pullScale,
            TIDE_PULL_BOOST.alignScale,
            TIDE_PULL_BOOST,
        );
    }

    private deactivate(): void {
        this.active = false;
        this.suppressedByFull = false;
        this.animTime = 0;
        this.visualBlend = 0;

        this.swirlTerm.deactivate();
        this.flowField?.removeTerm(this.swirlTerm);
        this.funnel?.clearBoost('left');

        if (this.gfx && this.gfx.isValid) {
            this.gfx.clear();
        }
        this.hasDrawnLastFrame = false;
    }

    private syncPillarAnchorAndFullState(): void {
        if (this.leftPillar) {
            this.swirlTerm.setPillarAnchor(this.leftPillar.node.position.x, this.leftPillar.tipY);
        }
        const isFull = this.scoreJudge ? this.scoreJudge.isPillarFull('left') : false;
        this.suppressedByFull = isFull;
        this.swirlTerm.suppressed = isFull;
    }

    private drawVortexLines(gfx: Graphics): void {
        if (!this.leftPillar) {
            return;
        }

        gfx.clear();

        // 计算柱尖灵珠在 2D 缸坐标下的屏幕投影中心（与 matcap.effect 斜轴俯视一致）
        const outerDiameter = TankSpace.width * GameConst.ringOuterDiameterRatio;
        const majorRadius = outerDiameter * 0.5 * (1 - GameConst.ringTubeRatio);
        const projOffsetY = majorRadius * Math.tan(toRadian(GameConst.camera3dPitchDownDeg));

        const cx = clampTankX(this.leftPillar.node.position.x);
        const cy = clampTankY(
            this.leftPillar.tipY + GameConst.pillarOrbTipGapPx + GameConst.pillarOrbRadiusPx + projOffsetY,
        );

        const blend = this.visualBlend;
        const pulse = 0.5 + 0.5 * Math.sin(this.animTime * 6.5);
        const rMin = GameConst.tidePullVortexMinRadiusPx;
        const rMax = Math.max(rMin + 12, GameConst.tidePullVortexMaxRadiusPx * blend);
        const armCount = Math.max(1, GameConst.tidePullVortexArmCount);
        const baseSpin = -this.animTime * GameConst.tidePullVortexSpinRadPerSec;

        // 1. 外层青碧漩流旋臂（顺时针向内收束至灵珠）
        outerColorScratch.set(Palette.tidePullVortexOuter);
        outerColorScratch.a = Math.round(Palette.tidePullVortexOuter.a * blend * (0.78 + 0.22 * pulse));
        gfx.strokeColor = outerColorScratch;
        gfx.lineWidth = 2.6;

        for (let arm = 0; arm < armCount; arm++) {
            const armOffset = (arm * Math.PI * 2) / armCount;
            for (let s = 0; s <= VORTEX_SEGMENTS; s++) {
                const t = s / VORTEX_SEGMENTS;
                const invT = 1 - t;
                const r = rMin + (rMax - rMin) * invT * (1 - 0.16 * t);
                const angle = baseSpin + armOffset - t * VORTEX_SWEEP_RAD;
                const px = clampTankX(cx + Math.cos(angle) * r);
                const py = clampTankY(cy + Math.sin(angle) * r);
                if (s === 0) {
                    gfx.moveTo(px, py);
                } else {
                    gfx.lineTo(px, py);
                }
            }
            gfx.stroke();
        }

        // 2. 内层高光流丝与灵珠外环脉动圈（共用同一 Graphics）
        innerColorScratch.set(Palette.tidePullVortexInner);
        innerColorScratch.a = Math.round(Palette.tidePullVortexInner.a * blend * (0.72 + 0.28 * pulse));
        gfx.strokeColor = innerColorScratch;
        gfx.lineWidth = 1.6;

        const innerStartStep = Math.floor(VORTEX_SEGMENTS * 0.45);
        for (let arm = 0; arm < armCount; arm++) {
            const armOffset = (arm * Math.PI * 2) / armCount;
            for (let s = innerStartStep; s <= VORTEX_SEGMENTS; s++) {
                const t = s / VORTEX_SEGMENTS;
                const invT = 1 - t;
                const r = rMin + (rMax - rMin) * invT * (1 - 0.16 * t);
                const angle = baseSpin + armOffset - t * VORTEX_SWEEP_RAD;
                const px = clampTankX(cx + Math.cos(angle) * r);
                const py = clampTankY(cy + Math.sin(angle) * r);
                if (s === innerStartStep) {
                    gfx.moveTo(px, py);
                } else {
                    gfx.lineTo(px, py);
                }
            }
            gfx.stroke();
        }

        const haloR = Math.min(
            rMin + 4 * pulse,
            cx - TANK_PAD,
            TankSpace.width - TANK_PAD - cx,
            cy - TANK_PAD,
            TankSpace.height - TANK_PAD - cy,
        );
        if (haloR >= 4) {
            gfx.circle(cx, cy, haloR);
            gfx.stroke();
        }
    }
}
