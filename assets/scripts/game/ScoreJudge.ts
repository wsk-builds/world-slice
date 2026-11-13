import { _decorator, Component, Node } from 'cc';
import { GameConst } from '../config/GameConst';
import { RingSpec } from '../core/rings/RingKinds';
import {
    calcMatchDropDuration,
    calcMatchDropY,
    MatchSlotInput,
    PillarRingCandidate,
    RemainingSlotLayout,
    resolvePillarMatch,
    shouldDeferPillarMatch,
} from '../core/rules/MatchRule';
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
    /** 本次锁定是否触发了同款消除（供 T017 充能等模块识别） */
    matched: boolean;
    /** 本次锁定触发消除的圈数（未触发为 0，触发则为 2 / 3 / 4） */
    matchedCount: number;
}

export interface MatchClearedEvent {
    pillar: Pillar;
    side: PillarSide;
    triggerRing: Ring | null;
    clearedRings: readonly Ring[];
    matchCount: number;
    remainingRings: readonly Ring[];
    spec: RingSpec;
    /** 是否为上方圈平滑下落后产生的连锁消除 */
    isChain: boolean;
}

export type RingLockedListener = (event: RingLockedEvent) => void;
export type MatchClearedListener = (event: MatchClearedEvent) => void;

interface HoldProgress {
    side: PillarSide;
    elapsed: number;
}

interface LockedLocalOffset {
    dx: number;
    dyFromBase: number;
    dz: number;
}

interface FlashingRingState {
    ring: Ring;
    elapsed: number;
    duration: number;
}

interface DroppingRingState {
    ring: Ring;
    pillar: Pillar;
    startDyFromBase: number;
    targetDyFromBase: number;
    elapsed: number;
    delay: number;
    duration: number;
}

/**
 * 真 3D 套中判定、锁定与同款消除组件（GDD §2.1、§3.2，T012 / T014）：
 * - 每个物理步之后检查柱子是否穿过圆环 3D 内孔且圈心低于柱尖；
 * - 连续稳定 0.3 秒后原地静默锁定，保留自然 3D 微倾；
 * - 锁定后检查同柱是否有同款圈（不要求相邻）：有则立即移出物理世界与柱槽，闪烁后销毁，
 *   上方已锁圈保留各自的 3D 微倾四元数与偏心 (dx, dz)，沿 Y 轴平滑落回新槽位。
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
    private readonly flashingRings = new Map<Ring, FlashingRingState>();
    private readonly droppingRings = new Map<Ring, DroppingRingState>();
    private readonly matchDeferElapsed: Record<PillarSide, number> = { left: 0, right: 0 };
    private readonly activeSetScratch = new Set<Ring>();
    private readonly lockListeners: RingLockedListener[] = [];
    private readonly matchListeners: MatchClearedListener[] = [];

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

    /** 查询指定已锁圈当前是否处于消除后平滑下落动画中（供 T023 SoakBot 区分合法下落与非法漂移） */
    isRingDropping(ring: Ring): boolean {
        return this.droppingRings.has(ring);
    }

    /** 查询指定处于平滑下落动画中圈的目标缸坐标 Y（未在下落返回 undefined） */
    getRingDropTargetY(ring: Ring): number | undefined {
        const state = this.droppingRings.get(ring);
        return state ? state.pillar.baseTopY + state.targetDyFromBase : undefined;
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

    onMatchCleared(cb: MatchClearedListener): () => void {
        if (!this.matchListeners.includes(cb)) {
            this.matchListeners.push(cb);
        }
        return () => {
            this.offMatchCleared(cb);
        };
    }

    offMatchCleared(cb: MatchClearedListener): void {
        const idx = this.matchListeners.indexOf(cb);
        if (idx >= 0) {
            this.matchListeners.splice(idx, 1);
        }
    }

    /** 清空槽位、稳定计时及正在进行的闪烁/下落动画状态（切关或 R 重置时调用） */
    reset(): void {
        this.stacks.left.clear();
        this.stacks.right.clear();
        this.holdProgress.clear();
        this.lockedOffsets.clear();
        this.flashingRings.clear();
        this.droppingRings.clear();
        this.matchDeferElapsed.left = 0;
        this.matchDeferElapsed.right = 0;
    }

    /** 将指定已锁定圈（及同柱上方已锁圈）解锁恢复为自由动态圈（供 T022 摆关移动/删改使用） */
    unlockRing(ring: Ring, unlockAboveOnSamePillar = true): Ring[] {
        this.holdProgress.delete(ring);
        const unlocked: Ring[] = [];
        for (const side of ['left', 'right'] as const) {
            const stack = this.stacks[side];
            const idx = stack.indexOf(ring);
            if (idx < 0) {
                continue;
            }
            const fromIdx = unlockAboveOnSamePillar ? stack.count - 1 : idx;
            for (let i = fromIdx; i >= idx; i--) {
                const target = stack.removeAt(i);
                if (!target) {
                    continue;
                }
                this.holdProgress.delete(target);
                this.lockedOffsets.delete(target);
                this.droppingRings.delete(target);
                target.locked = false;
                if (target.isBodyReady) {
                    target.body3D.type = 'dynamic';
                    target.body3D.clearVelocity();
                    target.body3D.clearForces();
                }
                unlocked.push(target);
            }
            this.matchDeferElapsed[side] = 0;
        }
        if (unlocked.length === 0 && ring.locked && !ring.clearing) {
            ring.locked = false;
            if (ring.isBodyReady) {
                ring.body3D.type = 'dynamic';
                ring.body3D.clearVelocity();
                ring.body3D.clearForces();
            }
            unlocked.push(ring);
        }
        return unlocked;
    }

    /** 立即完成所有正在闪烁消除中的圈并清理下落/稳定过渡状态（供摆关进入时防幽灵圈残留） */
    finishClearingImmediately(): void {
        if (this.flashingRings.size > 0) {
            for (const [ring] of Array.from(this.flashingRings.entries())) {
                this.flashingRings.delete(ring);
                this.ringLayer?.destroyRing(ring);
            }
        }
        if (this.droppingRings.size > 0) {
            for (const [ring, state] of Array.from(this.droppingRings.entries())) {
                if (ring.isValid && !ring.clearing && ring.isBodyReady) {
                    this.applyRingHeightAtPillar(ring, state.pillar, state.targetDyFromBase);
                }
            }
            this.droppingRings.clear();
        }
        this.holdProgress.clear();
        this.matchDeferElapsed.left = 0;
        this.matchDeferElapsed.right = 0;
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
                if (!ring.isValid || ring.clearing) {
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

        this.pruneRemovedRings(this.ringLayer.getRings());
        this.stepFlashingRings(dt);
        const finishedDropPillars = this.stepDroppingRings(dt);

        const rings = this.ringLayer.getRings();
        const onPillarBySide: Record<PillarSide, Ring[]> = { left: [], right: [] };
        const tipIncomingBySide: Record<PillarSide, Ring[]> = { left: [], right: [] };
        const pendingByPillar: Record<PillarSide, Array<{ ring: Ring; pillar: Pillar; slotCenterY: number }>> = {
            left: [],
            right: [],
        };

        for (let i = 0; i < rings.length; i++) {
            const ring = rings[i];
            if (!ring.isValid || ring.locked || ring.clearing || !ring.isBodyReady) {
                this.holdProgress.delete(ring);
                continue;
            }

            const matchedPillar = this.findMatchingPillar3D(ring);
            if (matchedPillar) {
                onPillarBySide[matchedPillar.side].push(ring);
                continue;
            }

            this.holdProgress.delete(ring);
            const incomingPillar = this.findIncomingTipPillar3D(ring);
            if (incomingPillar) {
                tipIncomingBySide[incomingPillar.side].push(ring);
            }
        }

        for (const side of ['left', 'right'] as const) {
            const pillar = side === 'left' ? this.leftPillar : this.rightPillar;
            const onPillar = onPillarBySide[side];
            if (!pillar || onPillar.length === 0) {
                continue;
            }

            onPillar.sort((a, b) => a.body3D.y - b.body3D.y);
            const stack = this.stacks[side];
            const baseThicknesses = stack.items.map((r) => r.dimensions.thickness);

            for (let i = 0; i < onPillar.length; i++) {
                const ring = onPillar[i];
                const physicalSlotIndex = stack.count + i;
                if (physicalSlotIndex >= GameConst.pillarCapacity) {
                    this.holdProgress.delete(ring);
                    continue;
                }

                const combinedThicknesses = baseThicknesses.slice();
                for (let k = 0; k < i; k++) {
                    combinedThicknesses.push(onPillar[k].dimensions.thickness);
                }

                const slotCenterY = calcSlotCenterY(
                    pillar.baseTopY,
                    combinedThicknesses,
                    ring.dimensions.thickness,
                    physicalSlotIndex,
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
                const elapsed = prev && prev.side === side ? prev.elapsed + dt : dt;
                if (elapsed < GameConst.ringLockDurationSec) {
                    this.holdProgress.set(ring, { side, elapsed });
                    continue;
                }

                this.holdProgress.delete(ring);
                pendingByPillar[side].push({ ring, pillar, slotCenterY });
            }
        }

        for (const side of ['left', 'right'] as const) {
            const pillar = side === 'left' ? this.leftPillar : this.rightPillar;
            if (!pillar) {
                continue;
            }
            const stack = this.stacks[side];
            const pending = pendingByPillar[side];
            const lockedBatch: Array<{ ring: Ring; slotIndex: number }> = [];

            if (pending.length > 0) {
                pending.sort((a, b) => a.ring.body3D.y - b.ring.body3D.y);

                for (let i = 0; i < pending.length; i++) {
                    const item = pending[i];
                    let insertIdx = 0;
                    while (insertIdx < stack.items.length && stack.items[insertIdx].body3D.y <= item.ring.body3D.y) {
                        insertIdx++;
                    }
                    const slotIndex = stack.insertAt(insertIdx, item.ring);
                    if (slotIndex < 0) {
                        continue;
                    }
                    this.lockRingOnPillar3D(item.ring, pillar, item.slotCenterY);
                    lockedBatch.push({ ring: item.ring, slotIndex });

                    const onIdx = onPillarBySide[side].indexOf(item.ring);
                    if (onIdx >= 0) {
                        onPillarBySide[side].splice(onIdx, 1);
                    }
                }

                if (lockedBatch.length > 0) {
                    this.matchDeferElapsed[side] = 0;
                }
            }

            const hasDrops = this.hasDroppingOnPillar(pillar);
            const dropFinishedOnPillar = finishedDropPillars.includes(pillar);

            if (lockedBatch.length === 0 && !dropFinishedOnPillar && stack.count < 2) {
                this.matchDeferElapsed[side] = 0;
                continue;
            }

            let matchCleared: MatchClearedEvent | null = null;
            if (!hasDrops && stack.count >= 2) {
                const topLocked = lockedBatch.length > 0 ? lockedBatch[lockedBatch.length - 1].ring : null;
                matchCleared = this.tryResolvePillarMatch(
                    topLocked,
                    pillar,
                    stack,
                    onPillarBySide[side],
                    tipIncomingBySide[side],
                    dt,
                    lockedBatch.length === 0,
                );
            } else if (lockedBatch.length > 0 && hasDrops) {
                const topLocked = lockedBatch[lockedBatch.length - 1].ring;
                const thicknesses = stack.items.map((r) => r.dimensions.thickness);
                const targetY = calcSlotCenterY(
                    pillar.baseTopY,
                    thicknesses,
                    topLocked.dimensions.thickness,
                    stack.indexOf(topLocked),
                    GameConst.pillarSlotPitchScale,
                );
                this.enqueueRingDrop(topLocked, pillar, targetY);
            }

            let creditRing: Ring | null = null;
            if (matchCleared) {
                for (let i = lockedBatch.length - 1; i >= 0; i--) {
                    if (matchCleared.clearedRings.includes(lockedBatch[i].ring)) {
                        creditRing = lockedBatch[i].ring;
                        break;
                    }
                }
                if (!creditRing) {
                    matchCleared.isChain = true;
                }
            }

            if (lockedBatch.length > 0) {
                const lockListeners = this.lockListeners.slice();
                for (let i = 0; i < lockedBatch.length; i++) {
                    const locked = lockedBatch[i];
                    const isCredit = matchCleared !== null && locked.ring === creditRing;
                    const lockEvent: RingLockedEvent = {
                        ring: locked.ring,
                        pillar,
                        side,
                        slotIndex: locked.slotIndex,
                        stack,
                        matched: isCredit,
                        matchedCount: isCredit && matchCleared ? matchCleared.matchCount : 0,
                    };
                    for (let j = 0; j < lockListeners.length; j++) {
                        lockListeners[j](lockEvent);
                    }
                }
            }

            if (matchCleared) {
                this.emitMatchCleared(matchCleared);
            }
        }
    };

    private emitMatchCleared(event: MatchClearedEvent): void {
        const matchListeners = this.matchListeners.slice();
        for (let j = 0; j < matchListeners.length; j++) {
            matchListeners[j](event);
        }
    }

    private tryResolvePillarMatch(
        triggerRing: Ring | null,
        pillar: Pillar,
        stack: PillarStack<Ring>,
        remainingOnPillar: readonly Ring[],
        tipIncoming: readonly Ring[],
        dt: number,
        isChain: boolean,
    ): MatchClearedEvent | null {
        const entries: MatchSlotInput<Ring>[] = stack.items.map((r) => ({
            item: r,
            spec: r.spec,
            thickness: r.dimensions.thickness,
        }));

        const preferredIndex = triggerRing ? stack.indexOf(triggerRing) : -1;
        const result = resolvePillarMatch(entries, {
            baseTopY: pillar.baseTopY,
            pitchScale: GameConst.pillarSlotPitchScale,
            preferredIndex: preferredIndex >= 0 ? preferredIndex : undefined,
        });

        if (!result.matched || !result.group) {
            this.matchDeferElapsed[pillar.side] = 0;
            return null;
        }

        const touchesTopOfStack = result.group.indices[result.group.indices.length - 1] === stack.count - 1;
        const pendingCandidates: PillarRingCandidate[] = remainingOnPillar.map((r) => ({
            spec: r.spec,
            thickness: r.dimensions.thickness,
            y: r.body3D.y,
            lockedIndex: -1,
        }));
        if (touchesTopOfStack) {
            for (let i = 0; i < tipIncoming.length; i++) {
                const r = tipIncoming[i];
                pendingCandidates.push({
                    spec: r.spec,
                    thickness: r.dimensions.thickness,
                    y: r.body3D.y,
                    lockedIndex: -1,
                });
            }
        }

        const lockedCandidates: PillarRingCandidate[] = stack.items.map((r, idx) => ({
            spec: r.spec,
            thickness: r.dimensions.thickness,
            y: r.body3D.y,
            lockedIndex: idx,
        }));

        if (
            this.matchDeferElapsed[pillar.side] < GameConst.matchDeferMaxSec &&
            shouldDeferPillarMatch(lockedCandidates, pendingCandidates, result.group.indices)
        ) {
            this.matchDeferElapsed[pillar.side] += dt;
            return null;
        }

        this.matchDeferElapsed[pillar.side] = 0;

        const clearedRings = result.group.entries.map((e) => e.item);
        for (let i = 0; i < clearedRings.length; i++) {
            stack.remove(clearedRings[i]);
            this.beginClearingRing(clearedRings[i]);
        }

        this.scheduleRemainingDrops(pillar, result.remaining);

        const baseSpec = clearedRings[0]?.spec ?? triggerRing?.spec ?? { kind: 'normal', color: 'red' };
        return {
            pillar,
            side: pillar.side,
            triggerRing,
            clearedRings,
            matchCount: clearedRings.length,
            remainingRings: stack.items.slice(),
            spec: { kind: baseSpec.kind, color: baseSpec.color },
            isChain,
        };
    }

    private findIncomingTipPillar3D(ring: Ring): Pillar | null {
        const b = ring.body3D;
        if (b.vy > 20) {
            return null;
        }
        const candidates = [this.leftPillar, this.rightPillar];
        for (let i = 0; i < candidates.length; i++) {
            const pillar = candidates[i];
            if (!pillar || this.stacks[pillar.side].isFull()) {
                continue;
            }
            if (b.y < pillar.tipY - 4 || b.y > pillar.tipY + ring.dimensions.outerDiameter * 0.75) {
                continue;
            }
            const radialDistXZ = Math.hypot(b.x - pillar.node.position.x, b.z);
            if (radialDistXZ <= ring.dimensions.innerRadius + 10) {
                return pillar;
            }
        }
        return null;
    }

    private beginClearingRing(ring: Ring): void {
        ring.locked = true;
        ring.clearing = true;
        ring.setClearingFlash(0);
        this.ringLayer?.detachBodyFromWorld(ring);
        this.holdProgress.delete(ring);
        this.lockedOffsets.delete(ring);
        this.droppingRings.delete(ring);
        this.flashingRings.set(ring, {
            ring,
            elapsed: 0,
            duration: GameConst.matchFlashDurationSec,
        });
    }

    private scheduleRemainingDrops(pillar: Pillar, remaining: readonly RemainingSlotLayout<Ring>[]): void {
        for (let i = 0; i < remaining.length; i++) {
            const layout = remaining[i];
            if (!layout.moved) {
                continue;
            }
            this.enqueueRingDrop(layout.item, pillar, layout.targetCenterY);
        }
    }

    private enqueueRingDrop(ring: Ring, pillar: Pillar, targetCenterY: number): void {
        if (!ring.isValid || ring.clearing || !ring.isBodyReady) {
            return;
        }
        const startDyFromBase = ring.body3D.y - pillar.baseTopY;
        const targetDyFromBase = targetCenterY - pillar.baseTopY;
        const duration = calcMatchDropDuration(targetDyFromBase - startDyFromBase);

        if (duration <= 0) {
            this.applyRingHeightAtPillar(ring, pillar, targetDyFromBase);
            this.droppingRings.delete(ring);
            return;
        }

        const existing = this.droppingRings.get(ring);
        const delay = existing && existing.elapsed >= existing.delay ? 0 : GameConst.matchDropDelaySec;
        this.droppingRings.set(ring, {
            ring,
            pillar,
            startDyFromBase,
            targetDyFromBase,
            elapsed: 0,
            delay,
            duration,
        });
    }

    private hasDroppingOnPillar(pillar: Pillar): boolean {
        for (const state of this.droppingRings.values()) {
            if (state.pillar === pillar) {
                return true;
            }
        }
        return false;
    }

    private stepFlashingRings(dt: number): void {
        if (this.flashingRings.size === 0) {
            return;
        }
        for (const [ring, state] of Array.from(this.flashingRings.entries())) {
            if (!ring.isValid) {
                this.flashingRings.delete(ring);
                continue;
            }
            state.elapsed += dt;
            const progress = state.duration > 0 ? Math.min(1, state.elapsed / state.duration) : 1;
            ring.setClearingFlash(progress);

            if (state.elapsed >= state.duration) {
                this.flashingRings.delete(ring);
                this.ringLayer?.destroyRing(ring);
            }
        }
    }

    private stepDroppingRings(dt: number): Pillar[] {
        if (this.droppingRings.size === 0) {
            return [];
        }
        const finishedPillars: Pillar[] = [];
        for (const [ring, state] of Array.from(this.droppingRings.entries())) {
            if (!ring.isValid || ring.clearing || !ring.isBodyReady) {
                this.droppingRings.delete(ring);
                continue;
            }
            state.elapsed += dt;
            if (state.elapsed <= state.delay) {
                continue;
            }
            const activeElapsed = state.elapsed - state.delay;
            const progress = state.duration > 0 ? Math.min(1, activeElapsed / state.duration) : 1;
            const nextDy = calcMatchDropY(state.startDyFromBase, state.targetDyFromBase, progress);
            this.applyRingHeightAtPillar(ring, state.pillar, nextDy);

            if (progress >= 1) {
                this.droppingRings.delete(ring);
                if (!finishedPillars.includes(state.pillar)) {
                    finishedPillars.push(state.pillar);
                }
            }
        }
        return finishedPillars;
    }

    private applyRingHeightAtPillar(ring: Ring, pillar: Pillar, dyFromBase: number): void {
        const pillarX = pillar.node.position.x;
        const off = this.lockedOffsets.get(ring);
        const dx = off ? off.dx : ring.body3D.x - pillarX;
        const dz = off ? off.dz : ring.body3D.z;
        if (off) {
            off.dyFromBase = dyFromBase;
        } else {
            this.lockedOffsets.set(ring, { dx, dyFromBase, dz });
        }

        const q = ring.body3D.quat;
        ring.body3D.setPose(pillarX + dx, pillar.baseTopY + dyFromBase, dz, q.x, q.y, q.z, q.w);
        ring.syncVisualFromBody();
    }

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
        const activeSet = this.activeSetScratch;
        activeSet.clear();
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

        for (const ring of this.flashingRings.keys()) {
            if (!activeSet.has(ring)) {
                this.flashingRings.delete(ring);
            }
        }

        for (const ring of this.droppingRings.keys()) {
            if (!activeSet.has(ring)) {
                this.droppingRings.delete(ring);
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
        activeSet.clear();
    }
}
