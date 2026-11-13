import { _decorator, Component, Node } from 'cc';
import { GameConst } from '../config/GameConst';
import {
    calcRingTiltDeg3D,
    calcSlotCenterY,
    isRingOnPillar3D,
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

interface LockedLocalOffset {
    dx: number;
    dyFromBase: number;
    dz: number;
}

/**
 * 真 3D 套中判定与锁定组件（GDD §2.1、§3.2，T012）：
 * 每个物理步之后检查柱子是否穿过圆环 3D 内孔且圈心低于柱尖；
 * 连续稳定 0.3 秒后将圈切换为静态，保留自然 3D 错落微倾（限制最大歪斜度保证 6 层稳妥叠放），不再受水流冲走。
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
    private readonly lockedOffsets = new Map<Ring, LockedLocalOffset>();
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
        this.lockedOffsets.clear();
    }

    /** 同步所有已锁定圈的位置到当前柱子布局与槽位高度（保留各自的 3D 自然微倾与轻微偏心） */
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
                const fallbackY = calcSlotCenterY(
                    baseTopY,
                    thicknesses,
                    ring.dimensions.thickness,
                    i,
                    GameConst.pillarSlotPitchScale,
                );
                const off = this.lockedOffsets.get(ring);
                const targetY = off ? baseTopY + off.dyFromBase : fallbackY;
                const dx = off ? off.dx : 0;
                const dz = off ? off.dz : 0;
                const q = ring.body3D.quat;
                ring.body3D.setPose(pillarX + dx, targetY, dz, q.x, q.y, q.z, q.w);
                ring.syncVisualFromBody();
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

        for (let i = 0; i < rings.length; i++) {
            const ring = rings[i];
            if (!ring.isValid || ring.locked || !ring.isBodyReady) {
                this.holdProgress.delete(ring);
                continue;
            }

            const matched = this.findMatchingPillar3D(ring);
            if (!matched) {
                this.holdProgress.delete(ring);
                continue;
            }

            const stack = this.stacks[matched.side];
            const thicknesses = stack.items.map((r) => r.dimensions.thickness);
            const slotCenterY = calcSlotCenterY(
                matched.baseTopY,
                thicknesses,
                ring.dimensions.thickness,
                stack.count,
                GameConst.pillarSlotPitchScale,
            );

            const b = ring.body3D;
            const linearSpeedPx = Math.hypot(b.vx, b.vy, b.vz);
            const angularSpeedRad = Math.hypot(b.wx, b.wy, b.wz);
            const tiltDeg = calcRingTiltDeg3D(b.basisN.x, b.basisN.y, b.basisN.z);

            if (
                !isRingStableForLock({
                    linearSpeedPx,
                    angularSpeedRad,
                    tiltDeg,
                    centerY: b.y,
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
            this.lockRingOnPillar3D(ring, matched, slotCenterY);

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

    private findMatchingPillar3D(ring: Ring): Pillar | null {
        const b = ring.body3D;
        const candidates = [this.leftPillar, this.rightPillar];
        for (let i = 0; i < candidates.length; i++) {
            const pillar = candidates[i];
            if (!pillar || this.stacks[pillar.side].isFull()) {
                continue;
            }
            if (
                isRingOnPillar3D({
                    centerX: b.x,
                    centerY: b.y,
                    centerZ: b.z,
                    normalX: b.basisN.x,
                    normalY: b.basisN.y,
                    normalZ: b.basisN.z,
                    innerRadius: ring.dimensions.innerRadius,
                    pillarX: pillar.node.position.x,
                    pillarZ: 0,
                    baseTopY: pillar.baseTopY,
                    tipY: pillar.tipY,
                    shaftRadiusAtY: pillar.shaftRadiusAtY(b.y),
                })
            ) {
                return pillar;
            }
        }
        return null;
    }

    private lockRingOnPillar3D(ring: Ring, pillar: Pillar, _slotCenterY: number): void {
        ring.locked = true;
        const b = ring.body3D;
        const pillarX = pillar.node.position.x;

        // 原地静默休眠：圆环在卡托或下方已锁圈上稳定 0.3 秒时，物理接触已完全自然落妥无穿模，
        // 直接冻结当前真实三维位置与旋转，绝不瞬移跳动！
        this.lockedOffsets.set(ring, {
            dx: b.x - pillarX,
            dyFromBase: b.y - pillar.baseTopY,
            dz: b.z,
        });

        b.type = 'static';
        b.vx = 0;
        b.vy = 0;
        b.vz = 0;
        b.wx = 0;
        b.wy = 0;
        b.wz = 0;
        ring.syncVisualFromBody();
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

        for (const ring of this.lockedOffsets.keys()) {
            if (!activeSet.has(ring)) {
                this.lockedOffsets.delete(ring);
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
