import { GameConst } from '../config/GameConst';
import { TankSpace } from '../config/TankSpace';
import { SeededRandom } from '../core/util/SeededRandom';
import { FlowField, FlowSide, FlowVec2 } from '../core/flow/FlowField';

/** 气泡数量上限（读取全局常量） */
export const MAX_BUBBLES = GameConst.bubblePoolMaxCount;

const AMBIENT_TARGET_COUNT = 16;
const AMBIENT_SPAWN_PER_SEC = 5;
const JET_SPAWN_PER_SEC = 38;
const JET_MIN_LEVEL = 0.02;

/** 低于此水速时 1:1 跟随，高出部分平滑饱和以兼顾海眼喷柱感与环流辨识度 */
const LINEAR_FLOW_SPEED_CAP = 360;
const EXTRA_FLOW_SPEED_CAP = 520;
const EXTRA_FLOW_SCALE = 1400;

export type BubbleKind = 'ambient' | 'jet';

export interface BubbleItem {
    active: boolean;
    kind: BubbleKind;
    x: number;
    y: number;
    radius: number;
    buoyancy: number;
    age: number;
    life: number;
    alpha: number;
}

export interface BubblePoolOptions {
    maxCount?: number;
    seed?: number;
    tankWidth?: number;
    tankHeight?: number;
    cornerRadius?: number;
    seedInitialAmbient?: boolean;
}

/** 将真实物理水速映射为气泡视觉漂移速度（保留方向，低速 1:1，高压喷口平滑封顶） */
export function mapFlowVelocityToBubble(vx: number, vy: number, out: FlowVec2): FlowVec2 {
    const speed = Math.hypot(vx, vy);
    if (speed <= 1e-6) {
        out.x = 0;
        out.y = 0;
        return out;
    }
    if (speed <= LINEAR_FLOW_SPEED_CAP) {
        out.x = vx;
        out.y = vy;
        return out;
    }
    const mappedSpeed =
        LINEAR_FLOW_SPEED_CAP +
        EXTRA_FLOW_SPEED_CAP * Math.tanh((speed - LINEAR_FLOW_SPEED_CAP) / EXTRA_FLOW_SCALE);
    const scale = mappedSpeed / speed;
    out.x = vx * scale;
    out.y = vy * scale;
    return out;
}

const tempFlowVel: FlowVec2 = { x: 0, y: 0 };
const tempVisualVel: FlowVec2 = { x: 0, y: 0 };

/**
 * 水流气泡对象池（纯逻辑，不依赖 cc）。
 * 零 GC 固定槽位池：每帧按同一个 FlowField.velocityAt 漂移并叠加上浮；
 * 平时保持少量环境气泡，喷水时由对应海眼大量冒出，严格限制在内屏水缸边界内。
 */
export class BubblePool {
    readonly maxCount: number;
    readonly items: BubbleItem[];

    private readonly flowField: FlowField;
    private readonly tankWidth: number;
    private readonly tankHeight: number;
    private readonly cornerRadius: number;
    private rng: SeededRandom;

    private activeTotal = 0;
    private activeAmbient = 0;
    private ambientCarry = 0;
    private leftJetCarry = 0;
    private rightJetCarry = 0;

    constructor(flowField: FlowField, options: BubblePoolOptions = {}) {
        this.flowField = flowField;
        this.maxCount = Math.max(1, Math.floor(options.maxCount ?? MAX_BUBBLES));
        this.tankWidth = options.tankWidth ?? TankSpace.width;
        this.tankHeight = options.tankHeight ?? TankSpace.height;
        this.cornerRadius = options.cornerRadius ?? GameConst.tankCornerRadius;
        this.rng = new SeededRandom(options.seed ?? GameConst.defaultLevelSeed + 17);

        this.items = new Array<BubbleItem>(this.maxCount);
        for (let i = 0; i < this.maxCount; i++) {
            this.items[i] = {
                active: false,
                kind: 'ambient',
                x: 0,
                y: 0,
                radius: 3,
                buoyancy: 36,
                age: 0,
                life: 3,
                alpha: 0,
            };
        }

        if (options.seedInitialAmbient !== false) {
            this.seedInitialAmbient();
        }
    }

    /** 当前活跃气泡总数 */
    get activeCount(): number {
        return this.activeTotal;
    }

    /** 当前活跃环境气泡数量 */
    get ambientCount(): number {
        return this.activeAmbient;
    }

    /** 重置气泡池并重新撒入初始环境气泡 */
    reset(seed?: number): void {
        if (seed !== undefined) {
            this.rng = new SeededRandom(seed);
        }
        for (let i = 0; i < this.maxCount; i++) {
            this.items[i].active = false;
        }
        this.activeTotal = 0;
        this.activeAmbient = 0;
        this.ambientCarry = 0;
        this.leftJetCarry = 0;
        this.rightJetCarry = 0;
        this.seedInitialAmbient();
    }

    /** 推进一帧气泡生成、水流漂移、自身上浮与边界约束 */
    step(dt: number): void {
        if (!(dt > 0)) {
            return;
        }

        this.updateExisting(dt);
        this.spawnAmbient(dt);
        this.spawnJetSide('left', dt);
        this.spawnJetSide('right', dt);
    }

    private seedInitialAmbient(): void {
        const count = Math.min(12, this.maxCount);
        for (let i = 0; i < count; i++) {
            const slot = this.acquireSlot('ambient');
            if (!slot) {
                break;
            }
            const radius = this.rng.range(2.4, 4.4);
            const life = this.rng.range(3.2, 5.2);
            const x = this.rng.range(radius + 20, this.tankWidth - radius - 20);
            const y = this.rng.range(24, this.tankHeight * 0.82);

            this.activateBubble(slot, 'ambient', x, y, radius, this.rng.range(30, 46), life);
            slot.age = this.rng.range(0, life * 0.55);
            slot.alpha = this.calcAlpha(slot);
        }
    }

    private updateExisting(dt: number): void {
        let activeTotal = 0;
        let activeAmbient = 0;

        for (let i = 0; i < this.maxCount; i++) {
            const b = this.items[i];
            if (!b.active) {
                continue;
            }

            b.age += dt;
            if (b.age >= b.life) {
                b.active = false;
                continue;
            }

            this.flowField.velocityAt(b.x, b.y, tempFlowVel);
            mapFlowVelocityToBubble(tempFlowVel.x, tempFlowVel.y, tempVisualVel);

            b.x += tempVisualVel.x * dt;
            b.y += (tempVisualVel.y + b.buoyancy) * dt;

            // 浮出水面消散
            if (b.y >= this.tankHeight - b.radius - 1) {
                b.active = false;
                continue;
            }

            this.clampToTankInside(b);
            b.alpha = this.calcAlpha(b);

            activeTotal++;
            if (b.kind === 'ambient') {
                activeAmbient++;
            }
        }

        this.activeTotal = activeTotal;
        this.activeAmbient = activeAmbient;
    }

    private spawnAmbient(dt: number): void {
        if (this.activeAmbient >= AMBIENT_TARGET_COUNT) {
            this.ambientCarry = 0;
            return;
        }
        this.ambientCarry += AMBIENT_SPAWN_PER_SEC * dt;
        while (this.ambientCarry >= 1 && this.activeAmbient < AMBIENT_TARGET_COUNT) {
            this.ambientCarry -= 1;
            const slot = this.acquireSlot('ambient');
            if (!slot) {
                break;
            }
            const radius = this.rng.range(2.3, 4.3);
            const x = this.rng.range(radius + 18, this.tankWidth - radius - 18);
            const y = this.rng.range(10, this.tankHeight * 0.52);
            const buoyancy = this.rng.range(30, 46);
            const life = this.rng.range(3.2, 5.2);
            this.activateBubble(slot, 'ambient', x, y, radius, buoyancy, life);
        }
    }

    private spawnJetSide(side: FlowSide, dt: number): void {
        const level = this.flowField.getJetLevel(side);
        if (level <= JET_MIN_LEVEL) {
            if (side === 'left') {
                this.leftJetCarry = 0;
            } else {
                this.rightJetCarry = 0;
            }
            return;
        }

        const rate = JET_SPAWN_PER_SEC * level;
        let carry = (side === 'left' ? this.leftJetCarry : this.rightJetCarry) + rate * dt;

        const nozzle = this.flowField.jet.getNozzlePose(side);
        const spreadHalfW = GameConst.jetMouthHalfWidth * 0.62;

        while (carry >= 1) {
            carry -= 1;
            const slot = this.acquireSlot('jet');
            if (!slot) {
                break;
            }
            const offsetAcross = this.rng.range(-spreadHalfW, spreadHalfW);
            const along = this.rng.range(6, 22);
            const x = nozzle.x + nozzle.axisX * along + nozzle.axisY * offsetAcross;
            const y = nozzle.y + nozzle.axisY * along - nozzle.axisX * offsetAcross;
            const radius = this.rng.range(2.2, 5.4);
            const buoyancy = this.rng.range(24, 46);
            const life = this.rng.range(1.9, 3.0);
            this.activateBubble(slot, 'jet', x, y, radius, buoyancy, life);
        }

        if (side === 'left') {
            this.leftJetCarry = carry;
        } else {
            this.rightJetCarry = carry;
        }
    }

    private activateBubble(
        slot: BubbleItem,
        kind: BubbleKind,
        x: number,
        y: number,
        radius: number,
        buoyancy: number,
        life: number,
    ): void {
        if (!slot.active) {
            this.activeTotal++;
            if (kind === 'ambient') {
                this.activeAmbient++;
            }
        } else if (slot.kind !== kind) {
            this.activeAmbient += kind === 'ambient' ? 1 : -1;
        }

        slot.active = true;
        slot.kind = kind;
        slot.x = x;
        slot.y = y;
        slot.radius = radius;
        slot.buoyancy = buoyancy;
        slot.age = 0;
        slot.life = life;
        this.clampToTankInside(slot);
        slot.alpha = this.calcAlpha(slot);
    }

    /** 查找空闲槽位；池满时新喷射气泡可覆盖最老环境气泡或剩余寿命最短的气泡 */
    private acquireSlot(kind: BubbleKind): BubbleItem | null {
        for (let i = 0; i < this.maxCount; i++) {
            if (!this.items[i].active) {
                return this.items[i];
            }
        }
        if (kind === 'ambient') {
            return null;
        }

        let victim: BubbleItem | null = null;
        let victimScore = Infinity;
        for (let i = 0; i < this.maxCount; i++) {
            const b = this.items[i];
            // 优先替换环境气泡，其次替换剩余寿命最短的喷射气泡
            const remaining = b.life - b.age;
            const score = b.kind === 'ambient' ? remaining - 10 : remaining;
            if (score < victimScore) {
                victimScore = score;
                victim = b;
            }
        }
        return victim;
    }

    private clampToTankInside(b: BubbleItem): void {
        const margin = b.radius + 1;
        if (b.x < margin) {
            b.x = margin;
        } else if (b.x > this.tankWidth - margin) {
            b.x = this.tankWidth - margin;
        }
        if (b.y < margin) {
            b.y = margin;
        }

        const r = this.cornerRadius;
        if (r > margin && b.y < r) {
            const safeR = r - margin;
            if (b.x < r) {
                const dx = r - b.x;
                const dy = r - b.y;
                const dist = Math.hypot(dx, dy);
                if (dist > safeR && dist > 1e-6) {
                    const s = safeR / dist;
                    b.x = r - dx * s;
                    b.y = r - dy * s;
                }
            } else if (b.x > this.tankWidth - r) {
                const dx = b.x - (this.tankWidth - r);
                const dy = r - b.y;
                const dist = Math.hypot(dx, dy);
                if (dist > safeR && dist > 1e-6) {
                    const s = safeR / dist;
                    b.x = this.tankWidth - r + dx * s;
                    b.y = r - dy * s;
                }
            }
        }
    }

    private calcAlpha(b: BubbleItem): number {
        const fadeIn = Math.min(1, b.age / 0.14);
        const remaining = b.life - b.age;
        const fadeOut = Math.min(1, Math.max(0, remaining / 0.45));
        const base = b.kind === 'ambient' ? 0.55 : 0.92;
        return base * fadeIn * fadeOut;
    }
}
