import { GameConst } from '../../config/GameConst';
import { QuatLike, quatNormalize, quatRotateVec, rotateQuatFromTo, Vec3Like } from '../physics3d/Math3D';

export interface RingCatchGeometryInput {
    leftEndX: number;
    leftEndY: number;
    rightEndX: number;
    rightEndY: number;
    pillarX: number;
    baseTopY: number;
    tipY: number;
}

export interface RingCatch3DInput {
    centerX: number;
    centerY: number;
    centerZ: number;
    /** 圆环中心孔轴在世界空间下的单位法向（水平正放时 ny = ±1，竖直侧立时 ny = 0） */
    normalX: number;
    normalY: number;
    normalZ: number;
    /** 圆环内孔半径 = (外径 - 2*管粗) / 2 */
    innerRadius: number;
    pillarX: number;
    pillarZ?: number;
    baseTopY: number;
    tipY: number;
    /** 柱杆在 centerY 高度处的半径 */
    shaftRadiusAtY: number;
}

export interface RingStabilityInput {
    linearSpeedPx: number;
    angularSpeedRad: number;
    tiltDeg: number;
    centerY: number;
    slotCenterY: number;
}

export interface LockedRingPose3DInput {
    x: number;
    y: number;
    z: number;
    quat: Readonly<QuatLike>;
    pillarX: number;
    pillarZ?: number;
    slotCenterY: number;
    innerRadius: number;
    shaftRadiusAtSlot: number;
    maxRestTiltDeg?: number;
}

export interface LockedRingPose3DResult {
    x: number;
    y: number;
    z: number;
    quat: QuatLike;
}

const tempNormal: Vec3Like = { x: 0, y: 1, z: 0 };

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
 * 计算目标槽位圈中心的缸坐标 Y 值（支持 pitchScale 为自然 3D 微倾叠放预留层高）。
 */
export function calcSlotCenterY(
    baseTopY: number,
    stackedThicknesses: readonly number[],
    ringThickness: number,
    targetSlotIndex: number = stackedThicknesses.length,
    pitchScale = 1,
): number {
    const limit = Math.min(Math.max(0, targetSlotIndex), stackedThicknesses.length);
    let sumBelow = 0;
    for (let i = 0; i < limit; i++) {
        sumBelow += stackedThicknesses[i] * pitchScale;
    }
    return baseTopY + sumBelow + ringThickness * pitchScale * 0.5;
}

/**
 * 计算两个端点连线相对水平线的倾角（度，范围 0..90）。
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
 * 计算真 3D 圆环孔轴法向 (nx, ny, nz) 相对竖直轴 (±Y) 的三维倾角（度，0°=水平，90°=竖直侧立；180°翻面仍为 0°）。
 */
export function calcRingTiltDeg3D(nx: number, ny: number, nz: number): number {
    const len = Math.hypot(nx, ny, nz);
    if (len <= 1e-8) {
        return 0;
    }
    const cosTilt = Math.min(1, Math.abs(ny) / len);
    return (Math.acos(cosTilt) * 180) / Math.PI;
}

/**
 * 二维兼容套中几何判定。
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
 * 真 3D 圆环套中几何判定：
 * 1. 圈心高度处于十字卡托承接面到柱尖之间 [baseTopY - 4, tipY)；
 * 2. 圈不是竖直贴靠柱外侧（孔轴竖直投影 |ny| >= cos(55°)）；
 * 3. 柱子轴线 (pillarX, pillarZ) 穿过圆环投影内孔范围。
 */
export function isRingOnPillar3D(input: RingCatch3DInput): boolean {
    if (input.centerY < input.baseTopY - 4 || input.centerY >= input.tipY) {
        return false;
    }
    const nLen = Math.hypot(input.normalX, input.normalY, input.normalZ);
    if (nLen <= 1e-6) {
        return false;
    }
    const absNy = Math.abs(input.normalY) / nLen;
    // 超过 55° 侧立的圈不可能正套在柱杆上
    if (absNy < 0.573576) {
        return false;
    }

    const pz = input.pillarZ ?? 0;
    const radialDistXZ = Math.hypot(input.centerX - input.pillarX, input.centerZ - pz);
    const effectiveHoleRadius = input.innerRadius * absNy - input.shaftRadiusAtY * 0.35;
    return effectiveHoleRadius > 0 && radialDistXZ < effectiveHoleRadius;
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

/**
 * 稳定锁定后计算保留自然 3D 错落微倾的静止姿态：
 * - 保留落定瞬间的自然三维倾斜方位角与绕柱旋转角（不死板归零），仅将过大倾角柔和夹紧到 maxRestTiltDeg（默认 15°）以内，确保叠满 6 层稳妥不超柱尖；
 * - 保留柱孔内自然的轻微偏心挂靠，但限制最大偏心量使锥杆绝不穿入圆环管壁。
 */
export function clampLockedRingPose3D(input: LockedRingPose3DInput): LockedRingPose3DResult {
    const outQuat: QuatLike = {
        x: input.quat.x,
        y: input.quat.y,
        z: input.quat.z,
        w: input.quat.w,
    };
    quatNormalize(outQuat);
    quatRotateVec(outQuat, 0, 1, 0, tempNormal);

    const maxTiltDeg = input.maxRestTiltDeg ?? GameConst.ringLockedRestMaxTiltDeg;
    const currentTiltDeg = calcRingTiltDeg3D(tempNormal.x, tempNormal.y, tempNormal.z);

    if (currentTiltDeg > maxTiltDeg && currentTiltDeg > 1e-4) {
        const signY = tempNormal.y >= 0 ? 1 : -1;
        const maxRad = (maxTiltDeg * Math.PI) / 180;
        const horizLen = Math.hypot(tempNormal.x, tempNormal.z);
        if (horizLen > 1e-6) {
            const targetSin = Math.sin(maxRad);
            const targetCos = Math.cos(maxRad) * signY;
            const targetNx = (tempNormal.x / horizLen) * targetSin;
            const targetNz = (tempNormal.z / horizLen) * targetSin;
            rotateQuatFromTo(tempNormal.x, tempNormal.y, tempNormal.z, targetNx, targetCos, targetNz, outQuat);
        }
    }

    const pz = input.pillarZ ?? 0;
    let dx = input.x - input.pillarX;
    let dz = input.z - pz;
    const maxOffset = Math.max(0, Math.min(7.5, input.innerRadius - input.shaftRadiusAtSlot - 2.0));
    const offsetLen = Math.hypot(dx, dz);
    if (offsetLen > maxOffset && offsetLen > 1e-6) {
        const k = maxOffset / offsetLen;
        dx *= k;
        dz *= k;
    }

    return {
        x: input.pillarX + dx,
        y: input.slotCenterY,
        z: pz + dz,
        quat: outQuat,
    };
}
