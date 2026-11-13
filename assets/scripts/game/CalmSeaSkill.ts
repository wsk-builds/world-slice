import { _decorator, Color, Component, Graphics, Node, UITransform } from 'cc';
import { calcRingPillarGeometry, GameConst } from '../config/GameConst';
import { Palette } from '../config/Palette';
import { TankSpace } from '../config/TankSpace';
import {
    CalmSeaFlowTerm,
    CalmSeaPillarInfo,
    CalmSeaRingRegulator,
    computeCalmSeaTargetY,
} from '../core/flow/CalmSeaFlow';
import { SolvedFeelConfig } from '../core/flow/FeelSolver';
import { FlowField } from '../core/flow/FlowField';
import { PillarEnergySnapshot, SkillTriggerEvent } from '../core/rules/Energy';
import { RenderLayers } from '../render/Stage3DRig';
import { PhysicsStepper } from './PhysicsStepper';
import { Pillar } from './Pillar';
import { PillarEnergyController } from './PillarEnergyController';
import { RingLayer } from './RingLayer';
import { ScoreJudge } from './ScoreJudge';

const { ccclass } = _decorator;

const TANK_PAD = 4;
const WAVE_SEGMENTS = 22;
const STREAM_SEGMENTS = 14;

const warmOuterColorScratch = new Color();
const warmInnerColorScratch = new Color();
const scratchWarmVel = { x: 0, y: 0 };

const scratchPillars: [CalmSeaPillarInfo, CalmSeaPillarInfo] = [
    { x: 0, z: 0, baseTopY: 0, tipY: 0, isFull: false },
    { x: 0, z: 0, baseTopY: 0, tipY: 0, isFull: false },
];
const scratchPillarOne: [CalmSeaPillarInfo] = [scratchPillars[0]];
const EMPTY_PILLARS: readonly CalmSeaPillarInfo[] = [];

export interface CalmSeaSkillDeps {
    flowField: FlowField;
    energyController: PillarEnergyController;
    ringLayer: RingLayer;
    leftPillar: Pillar;
    rightPillar: Pillar;
    scoreJudge?: ScoreJudge | null;
}

function clampTankY(y: number): number {
    return Math.min(TankSpace.height - TANK_PAD, Math.max(TANK_PAD, y));
}

function clampTankXAtY(x: number, y: number): number {
    const r = GameConst.tankCornerRadius;
    let minX = TANK_PAD;
    let maxX = TankSpace.width - TANK_PAD;
    if (y < r) {
        const dy = r - y;
        const inset = Math.max(0, r - Math.sqrt(Math.max(0, r * r - dy * dy)));
        minX = Math.max(minX, inset + TANK_PAD);
        maxX = Math.min(maxX, TankSpace.width - inset - TANK_PAD);
    }
    return Math.min(maxX, Math.max(minX, x));
}

/**
 * 右柱技能「定海」引擎桥接与灰盒表现组件（GDD §2.3，T019）：
 * - 订阅右柱技能触发与 PillarEnergy 技能状态（持续约 5 秒，随 PhysicsStepper 物理时间推进，暂停时冻结）；
 * - 激活时向 FlowField 注入柔和暖流项（CalmSeaFlowTerm）并将扰动与全缸环流压制到极低倍率；
 * - 步前驱动 CalmSeaRingRegulator，将包括沉底铁圈在内的全部自由 3D 圆环托浮至略高于柱尖的目标带并转为极慢下沉，
 *   同时施柔和三维水平回正阻尼力矩与 z=0 居中阻尼；
 * - 灰盒表现：缸底升起柔和暖流线与水平波纹提示（共用单个 Graphics，零每帧对象分配，严守内屏圆弧边界）。
 */
@ccclass('CalmSeaSkill')
export class CalmSeaSkill extends Component {
    flowField: FlowField | null = null;
    energyController: PillarEnergyController | null = null;
    ringLayer: RingLayer | null = null;
    leftPillar: Pillar | null = null;
    rightPillar: Pillar | null = null;
    scoreJudge: ScoreJudge | null = null;

    private stepper: PhysicsStepper | null = null;
    private gfx: Graphics | null = null;
    private readonly warmTerm = new CalmSeaFlowTerm();
    private readonly regulator = new CalmSeaRingRegulator();

    private active = false;
    private currentTargetY = TankSpace.height * 0.6;
    private animTime = 0;
    private visualBlend = 0;
    private hasDrawnLastFrame = false;

    private unsubTrigger: (() => void) | null = null;
    private unsubEnergy: (() => void) | null = null;

    static attach(tankRoot: Node, deps: CalmSeaSkillDeps): CalmSeaSkill {
        const comp = tankRoot.getComponent(CalmSeaSkill) ?? tankRoot.addComponent(CalmSeaSkill);
        comp.flowField = deps.flowField;
        comp.energyController = deps.energyController;
        comp.ringLayer = deps.ringLayer;
        comp.leftPillar = deps.leftPillar;
        comp.rightPillar = deps.rightPillar;
        comp.scoreJudge = deps.scoreJudge ?? null;
        comp.bindSubscriptions();
        return comp;
    }

    get isActive(): boolean {
        return this.active;
    }

    get targetY(): number {
        return this.currentTargetY;
    }

    onLoad(): void {
        this.stepper = this.getComponent(PhysicsStepper) ?? this.node.parent?.getComponent(PhysicsStepper) ?? null;
        this.ensureWarmGraphics();
    }

    onEnable(): void {
        this.ensureWarmGraphics();
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

    /** 重置技能状态，立即移除暖流项、恢复流场扰动/环流并清空暖流线 */
    reset(): void {
        this.deactivate();
    }

    update(dt: number): void {
        if (this.stepper && !this.stepper.running) {
            return;
        }
        const safeDt = Math.min(Math.max(0, dt), 0.1);
        const targetBlend = this.active ? 1 : 0;

        if (this.visualBlend < targetBlend) {
            this.visualBlend = Math.min(1, this.visualBlend + safeDt * 6.0);
        } else if (this.visualBlend > targetBlend) {
            this.visualBlend = Math.max(0, this.visualBlend - safeDt * 7.5);
        }

        if (this.visualBlend > 0.005) {
            this.animTime += safeDt;
        }
    }

    lateUpdate(): void {
        if (!this.gfx) {
            return;
        }
        if (this.visualBlend <= 0.01) {
            if (this.hasDrawnLastFrame) {
                this.gfx.clear();
                this.hasDrawnLastFrame = false;
            }
            return;
        }

        this.drawWarmWaves(this.gfx);
        this.hasDrawnLastFrame = true;
    }

    private ensureWarmGraphics(): void {
        if (this.gfx && this.gfx.isValid) {
            return;
        }
        const existing = this.node.getChildByName('CalmSeaWaves');
        if (existing) {
            this.gfx = existing.getComponent(Graphics) ?? existing.addComponent(Graphics);
            return;
        }
        const waveNode = new Node('CalmSeaWaves');
        waveNode.layer = RenderLayers.BG_2D;
        const tf = waveNode.addComponent(UITransform);
        tf.setContentSize(TankSpace.width, TankSpace.height);
        tf.setAnchorPoint(0, 0);
        waveNode.setPosition(0, 0, 0);
        this.node.addChild(waveNode);
        this.gfx = waveNode.addComponent(Graphics);
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
        if (this.energyController?.core.isSkillActive('right') && !this.active) {
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
        if (event.side !== 'right') {
            return;
        }
        this.activate();
    };

    private onEnergyChanged = (snapshot: PillarEnergySnapshot): void => {
        if (snapshot.side !== 'right') {
            return;
        }
        if (this.active && (!snapshot.skillActive || !snapshot.enabled)) {
            this.deactivate();
        }
    };

    private syncPillarTargets(): number {
        let count = 0;
        if (this.leftPillar) {
            scratchPillars[count].x = this.leftPillar.node.position.x;
            scratchPillars[count].z = 0;
            scratchPillars[count].baseTopY = this.leftPillar.baseTopY;
            scratchPillars[count].tipY = this.leftPillar.tipY;
            scratchPillars[count].isFull = this.scoreJudge ? this.scoreJudge.isPillarFull('left') : false;
            count++;
        }
        if (this.rightPillar) {
            scratchPillars[count].x = this.rightPillar.node.position.x;
            scratchPillars[count].z = 0;
            scratchPillars[count].baseTopY = this.rightPillar.baseTopY;
            scratchPillars[count].tipY = this.rightPillar.tipY;
            scratchPillars[count].isFull = this.scoreJudge ? this.scoreJudge.isPillarFull('right') : false;
            count++;
        }

        const geom = calcRingPillarGeometry(TankSpace.width);
        const outerR = geom.ringOuterDiameter * 0.5;
        const activePillars = count === 2 ? scratchPillars : count === 1 ? scratchPillarOne : EMPTY_PILLARS;
        const targetY = computeCalmSeaTargetY(
            activePillars,
            outerR,
            TankSpace.height,
            this.warmTerm.config,
        );
        this.currentTargetY = targetY;
        this.warmTerm.setTargetY(targetY, TankSpace.height);
        return count;
    }

    private activate(): void {
        if (!this.rightPillar) {
            return;
        }
        if (this.energyController && !this.energyController.core.isEnabled('right')) {
            return;
        }

        this.active = true;
        this.regulator.reset();
        this.syncPillarTargets();
        this.warmTerm.activate(this.currentTargetY, TankSpace.height);

        this.flowField?.addTerm(this.warmTerm);
        this.flowField?.setFlowSuppression(
            this.warmTerm.config.turbulenceScale,
            this.warmTerm.config.circulationScale,
        );
    }

    private deactivate(): void {
        this.active = false;
        this.animTime = 0;
        this.visualBlend = 0;

        this.warmTerm.deactivate();
        this.flowField?.removeTerm(this.warmTerm);
        this.flowField?.clearFlowSuppression();
        this.regulator.reset();

        if (this.gfx && this.gfx.isValid) {
            this.gfx.clear();
        }
        this.hasDrawnLastFrame = false;
    }

    private onBeforeStep = (_dt: number): void => {
        if (!this.active) {
            return;
        }
        if (this.energyController && !this.energyController.core.isSkillActive('right')) {
            this.deactivate();
            return;
        }

        const pillarCount = this.syncPillarTargets();
        if (!this.ringLayer) {
            return;
        }
        const activePillars = pillarCount === 2 ? scratchPillars : pillarCount === 1 ? scratchPillarOne : EMPTY_PILLARS;

        const rings = this.ringLayer.getRings();
        for (let i = 0; i < rings.length; i++) {
            const ring = rings[i];
            if (!ring.isValid || !ring.isBodyReady) {
                continue;
            }
            if (ring.locked || ring.clearing || ring.body3D.type !== 'dynamic') {
                this.regulator.clearBody(ring.body3D.id);
                continue;
            }
            const b = ring.body3D;
            this.warmTerm.sample(b.x, b.y, scratchWarmVel);
            this.regulator.applyToBody(
                b,
                ring.kindConfig,
                SolvedFeelConfig,
                activePillars,
                TankSpace.width,
                TankSpace.height,
                this.currentTargetY,
                scratchWarmVel.y,
            );
        }
    };

    private drawWarmWaves(gfx: Graphics): void {
        gfx.clear();

        const blend = this.visualBlend;
        const maxDrawY = Math.min(TankSpace.height - 20, this.currentTargetY + 28);
        const minDrawY = 18;
        const spanY = Math.max(80, maxDrawY - minDrawY);

        // 1. 从缸底缓缓升起的柔和暖流水平波纹
        const waveCount = Math.max(1, GameConst.calmSeaWaveCount);
        gfx.lineWidth = 2.4;

        for (let w = 0; w < waveCount; w++) {
            const phase = (this.animTime * 0.28 + w / waveCount) % 1;
            const yBase = clampTankY(minDrawY + phase * spanY);
            const env = Math.sin(phase * Math.PI);
            const alphaScale = blend * (0.28 + 0.72 * env);

            warmOuterColorScratch.set(Palette.calmSeaWarmOuter);
            warmOuterColorScratch.a = Math.round(Palette.calmSeaWarmOuter.a * alphaScale);
            gfx.strokeColor = warmOuterColorScratch;

            const leftEdge = clampTankXAtY(52, yBase) + 6;
            const rightEdge = clampTankXAtY(TankSpace.width - 52, yBase) - 6;
            const width = Math.max(40, rightEdge - leftEdge);

            for (let s = 0; s <= WAVE_SEGMENTS; s++) {
                const u = s / WAVE_SEGMENTS;
                const x = clampTankXAtY(leftEdge + u * width, yBase);
                const arch = Math.sin(u * Math.PI) * 8;
                const ripple = Math.sin(u * Math.PI * 4 - this.animTime * 2.8 + w * 1.3) * 4.5;
                const y = clampTankY(yBase + arch + ripple);
                if (s === 0) {
                    gfx.moveTo(x, y);
                } else {
                    gfx.lineTo(x, y);
                }
            }
            gfx.stroke();
        }

        // 2. 缸底升向柱尖目标带的柔和竖向暖流丝线
        const streamCount = Math.max(2, GameConst.calmSeaStreamCount);
        const streamLeft = GameConst.tankCornerRadius * 0.85;
        const streamRight = TankSpace.width - GameConst.tankCornerRadius * 0.85;
        const streamSpanX = Math.max(100, streamRight - streamLeft);

        gfx.lineWidth = 1.7;
        for (let i = 0; i < streamCount; i++) {
            const uStream = (i + 0.5) / streamCount;
            const baseX = streamLeft + uStream * streamSpanX;
            const cycle = (this.animTime * 0.34 + i * 0.19) % 1;
            const segStart = Math.max(0, cycle - 0.38);
            const segEnd = Math.min(1, cycle + 0.04);
            if (segEnd <= segStart + 0.02) {
                continue;
            }

            const midEnv = Math.sin(((segStart + segEnd) * 0.5) * Math.PI);
            warmInnerColorScratch.set(Palette.calmSeaWarmInner);
            warmInnerColorScratch.a = Math.round(Palette.calmSeaWarmInner.a * blend * (0.3 + 0.7 * midEnv));
            gfx.strokeColor = warmInnerColorScratch;

            for (let s = 0; s <= STREAM_SEGMENTS; s++) {
                const t = segStart + ((segEnd - segStart) * s) / STREAM_SEGMENTS;
                const y = clampTankY(minDrawY + t * spanY);
                const sway = Math.sin(t * Math.PI * 3.2 - this.animTime * 3.4 + i * 1.7) * 11;
                const x = clampTankXAtY(baseX + sway, y);
                if (s === 0) {
                    gfx.moveTo(x, y);
                } else {
                    gfx.lineTo(x, y);
                }
            }
            gfx.stroke();
        }

        // 3. 目标托浮带高度处的柔和平静水面微光提示线
        const horizonY = clampTankY(this.currentTargetY);
        const pulse = 0.5 + 0.5 * Math.sin(this.animTime * 3.8);
        warmInnerColorScratch.set(Palette.calmSeaWarmInner);
        warmInnerColorScratch.a = Math.round(Palette.calmSeaWarmInner.a * blend * (0.32 + 0.24 * pulse));
        gfx.strokeColor = warmInnerColorScratch;
        gfx.lineWidth = 1.5;

        const hLeft = clampTankXAtY(64, horizonY);
        const hRight = clampTankXAtY(TankSpace.width - 64, horizonY);
        const hWidth = Math.max(40, hRight - hLeft);
        for (let s = 0; s <= WAVE_SEGMENTS; s++) {
            const u = s / WAVE_SEGMENTS;
            const x = clampTankXAtY(hLeft + u * hWidth, horizonY);
            const y = clampTankY(horizonY + Math.sin(u * Math.PI * 3 + this.animTime * 2.1) * 2.5);
            if (s === 0) {
                gfx.moveTo(x, y);
            } else {
                gfx.lineTo(x, y);
            }
        }
        gfx.stroke();
    }
}
