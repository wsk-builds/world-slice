import { _decorator, Component, ERigidBody2DType, Node, PHYSICS_2D_PTM_RATIO, Vec2 } from 'cc';
import { GameConst } from '../config/GameConst';
import {
    calcRingTiltDeg,
    calcSlotCenterY,
    isRingOnPillar,
    isRingStableForLock,
    PillarStack,
} from '../core/rules/PillarStack';
import { PhysicsStepper } from './PhysicsStepper';
import { Pillar, PillarSide } from './Pillar';
import { Ring } from './Ring';
import { RingLayer } from './RingLayer';

const { ccclass } = _decorator;

export interface RingLockedEvent {
    ring: Ring;
    pillar: Pillar;
    side: PillarSide;
    slotIndex: number;
    stack: PillarStack<Ring>;
}

export type RingLockedListener = (event: RingLockedEvent) => void;

interface HoldProgress {
    side: PillarSide;
    elapsed: number;
}

interface RigidBody2DImpl {
    syncPositionToPhysics?: (enableAnimated?: boolean) => void;
    syncRotationToPhysics?: (enableAnimated?: boolean) => void;
}

const tempLeft = new Vec2();
const tempRight = new Vec2();
const tempZero = new Vec2(0, 0);

/**
 * 套中判定与锁定组件（GDD §2.1、§3.2，T012），挂在 TankRoot 上：
 * 每个物理步之后检查"柱子在圈的两个端点之间，并且圈心低于柱尖"；
 * 连续稳定 0.3 秒后将圈切换为静态并对齐到对应槽位高度，之后不再受水流影响。
 */
@ccclass('ScoreJudge')
export class ScoreJudge extends Component {
    leftPillar: Pillar | null = null;
    rightPillar: Pillar | null = null;
    ringLayer: RingLayer | null = null;

    private stepper: PhysicsStepper | null = null;
    private readonly stacks: Record<PillarSide, PillarStack<Ring>> = {
        left: new PillarStack<Ring>(GameConst.pillarCapacity),
        right: new PillarStack<Ring>(GameConst.pillarCapacity),
    };
    private readonly holdProgress = new Map<Ring, HoldProgress>();
    private readonly lockListeners: RingLockedListener[] = [];

    static attach(tankRoot: Node, leftPillar: Pillar, rightPillar: Pillar, ringLayer: RingLayer): ScoreJudge {
        const judge = tankRoot.addComponent(ScoreJudge);
        judge.leftPillar = leftPillar;
        judge.rightPillar = rightPillar;
        judge.ringLayer = ringLayer;
        return judge;
    }

    onLoad(): void {
        this.stepper = this.getComponent(PhysicsStepper) ?? this.node.parent?.getComponent(PhysicsStepper) ?? null;
    }

    onEnable(): void {
        if (!this.stepper) {
            this.stepper = this.getComponent(PhysicsStepper) ?? this.node.parent?.getComponent(PhysicsStepper) ?? null;
        }
        this.stepper?.onAfterStep(this.onAfterStep);
    }

    onDisable(): void {
        this.stepper?.offAfterStep(this.onAfterStep);
    }

    getStack(side: PillarSide): PillarStack<Ring> {
        return this.stacks[side];
    }

    isPillarFull(side: PillarSide): boolean {
        return this.stacks[side].isFull();
    }

    getLockedCount(side?: PillarSide): number {
        if (side) {
            return this.stacks[side].count;
        }
        return this.stacks.left.count + this.stacks.right.count;
    }

    onRingLocked(cb: RingLockedListener): () => void {
        if (!this.lockListeners.includes(cb)) {
            this.lockListeners.push(cb);
        }
        return () => {
            this.offRingLocked(cb);
        };
    }

    offRingLocked(cb: RingLockedListener): void {
        const idx = this.lockListeners.indexOf(cb);
        if (idx >= 0) {
            this.lockListeners.splice(idx, 1);
        }
    }

    /** 清空槽位与稳定计时（切关或调试清空时调用） */
    reset(): void {
        this.stacks.left.clear();
        this.stacks.right.clear();
        this.holdProgress.clear();
    }

    /** 同步所有已锁定圈的位置到当前柱子布局与槽位高度（供调参改柱位时联动） */
    syncLockedRings(): void {
        for (const side of ['left', 'right'] as const) {
            const pillar = side === 'left' ? this.leftPillar : this.rightPillar;
            if (!pillar) {
                continue;
            }
            const stack = this.stacks[side];
            const thicknesses = stack.items.map((r) => r.dimensions.thickness);
            const pillarX = pillar.node.position.x;
            const baseTopY = pillar.baseTopY;

            for (let i = 0; i < stack.items.length; i++) {
                const ring = stack.items[i];
                if (!ring.isValid) {
                    continue;
                }
                const slotY = calcSlotCenterY(baseTopY, thicknesses, ring.dimensions.thickness, i);
                this.snapRingTransform(ring, pillarX, slotY);
            }
        }
    }

    private onAfterStep = (dt: number): void => {
        if (!this.ringLayer) {
            return;
        }

        const rings = this.ringLayer.getRings();
        this.pruneRemovedRings(rings);

        if (rings.length === 0) {
            return;
        }

        const scale = Math.abs(this.node.worldScale.x) || 1;

        for (let i = 0; i < rings.length; i++) {
            const ring = rings[i];
            if (!ring.isValid || ring.locked || !ring.isBodyReady) {
                this.holdProgress.delete(ring);
                continue;
            }

            ring.getTankEnds(tempLeft, tempRight);
            const matched = this.findMatchingPillar(tempLeft, tempRight);
            if (!matched) {
                this.holdProgress.delete(ring);
                continue;
            }

            const stack = this.stacks[matched.side];
            const thicknesses = stack.items.map((r) => r.dimensions.thickness);
            const slotCenterY = calcSlotCenterY(matched.baseTopY, thicknesses, ring.dimensions.thickness);
            const centerY = 0.5 * (tempLeft.y + tempRight.y);

            const linVel = ring.body.linearVelocity;
            const linearSpeedPx = (Math.hypot(linVel.x, linVel.y) * PHYSICS_2D_PTM_RATIO) / scale;
            const angularSpeedRad = ring.body.angularVelocity;
            const tiltDeg = calcRingTiltDeg(tempLeft.x, tempLeft.y, tempRight.x, tempRight.y);

            if (
                !isRingStableForLock({
                    linearSpeedPx,
                    angularSpeedRad,
                    tiltDeg,
                    centerY,
                    slotCenterY,
                })
            ) {
                this.holdProgress.delete(ring);
                continue;
            }

            const prev = this.holdProgress.get(ring);
            const elapsed = prev && prev.side === matched.side ? prev.elapsed + dt : dt;
            if (elapsed < GameConst.ringLockDurationSec) {
                this.holdProgress.set(ring, { side: matched.side, elapsed });
                continue;
            }

            const slotIndex = stack.push(ring);
            if (slotIndex < 0) {
                this.holdProgress.delete(ring);
                continue;
            }

            this.holdProgress.delete(ring);
            this.lockRingOnPillar(ring, matched, slotCenterY);

            const event: RingLockedEvent = {
                ring,
                pillar: matched,
                side: matched.side,
                slotIndex,
                stack,
            };
            const listeners = this.lockListeners.slice();
            for (let j = 0; j < listeners.length; j++) {
                listeners[j](event);
            }
        }
    };

    private findMatchingPillar(leftEnd: Vec2, rightEnd: Vec2): Pillar | null {
        const candidates = [this.leftPillar, this.rightPillar];
        for (let i = 0; i < candidates.length; i++) {
            const pillar = candidates[i];
            if (!pillar) {
                continue;
            }
            if (this.stacks[pillar.side].isFull()) {
                continue;
            }
            if (
                isRingOnPillar({
                    leftEndX: leftEnd.x,
                    leftEndY: leftEnd.y,
                    rightEndX: rightEnd.x,
                    rightEndY: rightEnd.y,
                    pillarX: pillar.node.position.x,
                    baseTopY: pillar.baseTopY,
                    tipY: pillar.tipY,
                })
            ) {
                return pillar;
            }
        }
        return null;
    }

    private lockRingOnPillar(ring: Ring, pillar: Pillar, slotCenterY: number): void {
        ring.locked = true;
        ring.body.linearVelocity = tempZero;
        ring.body.angularVelocity = 0;
        ring.body.type = ERigidBody2DType.Static;
        this.snapRingTransform(ring, pillar.node.position.x, slotCenterY);
        ring.body.sleep();
    }

    /** 绕过 stepping 守卫直接将对齐坐标写入 Box2D，防止同帧后续 syncPhysicsToScene 拉回旧刚体坐标 */
    private snapRingTransform(ring: Ring, tankX: number, tankY: number): void {
        ring.node.setPosition(tankX, tankY, 0);
        ring.node.angle = 0;
        const impl = ring.body.impl as RigidBody2DImpl | null;
        impl?.syncPositionToPhysics?.(false);
        impl?.syncRotationToPhysics?.(false);
    }

    private pruneRemovedRings(activeRings: readonly Ring[]): void {
        const activeSet = new Set<Ring>();
        for (let i = 0; i < activeRings.length; i++) {
            const r = activeRings[i];
            if (r.isValid) {
                activeSet.add(r);
            }
        }

        for (const ring of this.holdProgress.keys()) {
            if (!activeSet.has(ring)) {
                this.holdProgress.delete(ring);
            }
        }

        for (const side of ['left', 'right'] as const) {
            const stack = this.stacks[side];
            for (let i = stack.items.length - 1; i >= 0; i--) {
                const ring = stack.items[i];
                if (!activeSet.has(ring)) {
                    stack.removeAt(i);
                }
            }
        }
    }
}
