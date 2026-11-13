import { _decorator, Component, Node } from 'cc';
import { SolvedFeelConfig } from '../core/flow/FeelSolver';
import {
    applyFunnelToBody,
    FunnelBoost,
    FunnelParams,
    FunnelPillarTarget,
    resolveEffectiveFunnelParams,
} from '../core/rules/FunnelMath';
import { PhysicsStepper } from './PhysicsStepper';
import { Pillar, PillarSide } from './Pillar';
import { Ring } from './Ring';
import { RingLayer } from './RingLayer';
import { ScoreJudge } from './ScoreJudge';

const { ccclass } = _decorator;

export type FunnelCanEnterFn = (ring: Ring, pillar: Pillar) => boolean;

const scratchTargets: [FunnelPillarTarget, FunnelPillarTarget] = [
    { x: 0, z: 0, tipY: 0, baseTopY: 0, isFull: false },
    { x: 0, z: 0, tipY: 0, baseTopY: 0, isFull: false },
];
const scratchParams: [FunnelParams, FunnelParams] = [
    { radiusPx: 0, maxAngleDeg: 0, pullAccel: 0, alignRate: 0 },
    { radiusPx: 0, maxAngleDeg: 0, pullAccel: 0, alignRate: 0 },
];

/**
 * 入柱宽容漏斗组件（GDD §3.2，T013）：
 * 在每个物理步之前对下落进入柱尖碗口区的自由 3D 圆环施加柔和的三维回正力矩与朝柱心水平居中力；
 * 预留 boost(side, radiusScale, maxTiltDeg, pullScale) 接口供 T018「潮引」复用，
 * 以及 canEnter(ring, pillar) 回调供 T049 分类关接入颜色校验。
 */
@ccclass('Funnel')
export class Funnel extends Component {
    leftPillar: Pillar | null = null;
    rightPillar: Pillar | null = null;
    ringLayer: RingLayer | null = null;
    scoreJudge: ScoreJudge | null = null;

    /** 圈是否允许进入该柱子（T049 分类关接入颜色校验，默认始终允许） */
    canEnter: FunnelCanEnterFn = () => true;

    private stepper: PhysicsStepper | null = null;
    private readonly boosts: Record<PillarSide, FunnelBoost | null> = {
        left: null,
        right: null,
    };

    static attach(
        tankRoot: Node,
        leftPillar: Pillar,
        rightPillar: Pillar,
        ringLayer: RingLayer,
        scoreJudge: ScoreJudge,
    ): Funnel {
        const funnel = tankRoot.addComponent(Funnel);
        funnel.leftPillar = leftPillar;
        funnel.rightPillar = rightPillar;
        funnel.ringLayer = ringLayer;
        funnel.scoreJudge = scoreJudge;
        return funnel;
    }

    onLoad(): void {
        this.stepper = this.getComponent(PhysicsStepper) ?? this.node.parent?.getComponent(PhysicsStepper) ?? null;
    }

    onEnable(): void {
        if (!this.stepper) {
            this.stepper = this.getComponent(PhysicsStepper) ?? this.node.parent?.getComponent(PhysicsStepper) ?? null;
        }
        this.stepper?.onBeforeStep(this.onBeforeStep);
    }

    onDisable(): void {
        this.stepper?.offBeforeStep(this.onBeforeStep);
    }

    /** 放大指定侧柱子的漏斗范围、倾角上限与拉力（供 T018 左柱技能「潮引」使用） */
    boost(
        side: PillarSide,
        radiusScale: number,
        maxTiltDeg: number,
        pullScale: number,
        alignScale?: number,
    ): void {
        this.boosts[side] = {
            radiusScale,
            maxTiltDeg,
            pullScale,
            alignScale,
        };
    }

    /** 清除指定侧（或全部）漏斗放大效果 */
    clearBoost(side?: PillarSide): void {
        if (side) {
            this.boosts[side] = null;
            return;
        }
        this.boosts.left = null;
        this.boosts.right = null;
    }

    getBoost(side: PillarSide): Readonly<FunnelBoost> | null {
        return this.boosts[side];
    }

    /** 获取当前（叠加增益后的）漏斗有效参数 */
    getEffectiveParams(side: PillarSide): FunnelParams {
        return resolveEffectiveFunnelParams(SolvedFeelConfig.funnel, this.boosts[side]);
    }

    /** 重置漏斗增益状态 */
    reset(): void {
        this.clearBoost();
    }

    private onBeforeStep = (_dt: number): void => {
        if (!this.ringLayer) {
            return;
        }

        const rings = this.ringLayer.getRings();
        if (rings.length === 0) {
            return;
        }

        for (let i = 0; i < rings.length; i++) {
            const ring = rings[i];
            if (!ring.isValid || ring.locked || !ring.isBodyReady || ring.body3D.type !== 'dynamic') {
                continue;
            }

            let eligibleCount = 0;
            for (let p = 0; p < 2; p++) {
                const pillar = p === 0 ? this.leftPillar : this.rightPillar;
                if (!pillar) {
                    continue;
                }
                const isFull = this.scoreJudge ? this.scoreJudge.isPillarFull(pillar.side) : false;
                if (isFull || !this.canEnter(ring, pillar)) {
                    continue;
                }

                const target = scratchTargets[eligibleCount];
                target.x = pillar.node.position.x;
                target.z = 0;
                target.tipY = pillar.tipY;
                target.baseTopY = pillar.baseTopY;
                target.isFull = false;

                resolveEffectiveFunnelParams(
                    SolvedFeelConfig.funnel,
                    this.boosts[pillar.side],
                    scratchParams[eligibleCount],
                );
                eligibleCount++;
            }

            if (eligibleCount > 0) {
                applyFunnelToBody(ring.body3D, scratchTargets, scratchParams, eligibleCount);
            }
        }
    };
}
