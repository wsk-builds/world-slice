import { GameConst } from '../../config/GameConst';

export interface RingCatchGeometryInput {
    leftEndX: number;
    leftEndY: number;
    rightEndX: number;
    rightEndY: number;
    pillarX: number;
    baseTopY: number;
    tipY: number;
}

export interface RingStabilityInput {
    linearSpeedPx: number;
    angularSpeedRad: number;
    tiltDeg: number;
    centerY: number;
    slotCenterY: number;
}

/**
 * 单根柱子的槽位管理（纯逻辑，不依赖引擎）。
 * 槽位 0 为最底部，递增向上叠放，容量由 GameConst.pillarCapacity 读取（起始值 6）。
 */
export class PillarStack<T = unknown> {
    readonly capacity: number;
    private readonly slots: T[] = [];

    constructor(capacity: number = GameConst.pillarCapacity) {
        this.capacity = Math.max(0, Math.floor(capacity));
    }

    get count(): number {
        return this.slots.length;
    }

    get items(): readonly T[] {
        return this.slots;
    }

    isFull(): boolean {
        return this.slots.length >= this.capacity;
    }

    isEmpty(): boolean {
        return this.slots.length === 0;
    }

    has(item: T): boolean {
        return this.slots.includes(item);
    }

    indexOf(item: T): number {
        return this.slots.indexOf(item);
    }

    getAt(slotIndex: number): T | undefined {
        return this.slots[slotIndex];
    }

    /** 放入顶部槽位，成功返回槽位下标；若已满或已存在则返回 -1 */
    push(item: T): number {
        if (this.isFull() || this.has(item)) {
            return -1;
        }
        this.slots.push(item);
        return this.slots.length - 1;
    }

    /** 取出顶部槽位 */
    pop(): T | undefined {
        return this.slots.pop();
    }

    /** 按槽位取出，上方条目顺序下移一格 */
    removeAt(slotIndex: number): T | undefined {
        if (slotIndex < 0 || slotIndex >= this.slots.length) {
            return undefined;
        }
        return this.slots.splice(slotIndex, 1)[0];
    }

    /** 按条目取出，返回取出前的槽位下标，不存在返回 -1 */
    remove(item: T): number {
        const idx = this.slots.indexOf(item);
        if (idx < 0) {
            return -1;
        }
        this.slots.splice(idx, 1);
        return idx;
    }

    clear(): void {
        this.slots.length = 0;
    }
}

/**
 * 计算目标槽位圈中心的缸坐标 Y 值（紧密贴合底托顶面与下方已锁定圈）。
 */
export function calcSlotCenterY(
    baseTopY: number,
    stackedThicknesses: readonly number[],
    ringThickness: number,
    targetSlotIndex: number = stackedThicknesses.length,
): number {
    const limit = Math.min(Math.max(0, targetSlotIndex), stackedThicknesses.length);
    let sumBelow = 0;
    for (let i = 0; i < limit; i++) {
        sumBelow += stackedThicknesses[i];
    }
    return baseTopY + sumBelow + ringThickness * 0.5;
}

/**
 * 计算两个端点连线相对水平线的倾角（度，范围 0..90）。
 * 圆环左右对称，倒扣 180° 时仍视为 0° 水平。
 */
export function calcRingTiltDeg(leftEndX: number, leftEndY: number, rightEndX: number, rightEndY: number): number {
    const dx = Math.abs(rightEndX - leftEndX);
    const dy = Math.abs(rightEndY - leftEndY);
    if (dx === 0 && dy === 0) {
        return 0;
    }
    return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/**
 * 判断圈是否满足"柱子在圈的两个端点之间，并且圈心低于柱尖（且位于底托上方）"。
 */
export function isRingOnPillar(input: RingCatchGeometryInput): boolean {
    const minEndX = Math.min(input.leftEndX, input.rightEndX);
    const maxEndX = Math.max(input.leftEndX, input.rightEndX);
    if (!(minEndX < input.pillarX && input.pillarX < maxEndX)) {
        return false;
    }
    const centerY = 0.5 * (input.leftEndY + input.rightEndY);
    return centerY >= input.baseTopY - 2 && centerY < input.tipY;
}

/**
 * 判断处于柱上的圈当前物理状态是否满足连续稳定锁定条件。
 */
export function isRingStableForLock(input: RingStabilityInput): boolean {
    return (
        input.linearSpeedPx <= GameConst.ringLockMaxLinearSpeedPx &&
        Math.abs(input.angularSpeedRad) <= GameConst.ringLockMaxAngularSpeedRad &&
        Math.abs(input.tiltDeg) <= GameConst.ringLockMaxTiltDeg &&
        input.centerY <= input.slotCenterY + GameConst.ringLockSlotMarginPx
    );
}
