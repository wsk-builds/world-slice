/**
 * 2D 物理碰撞分组与碰撞矩阵定义（纯 TS，不依赖 cc）。
 * 碰撞关系：
 * - RING_END 只碰 PILLAR
 * - RING_BAR 碰 RING_BAR、WALL、MECH
 */
export const PhysicsGroupBit = {
    DEFAULT: 1 << 0,
    /** 圈的端点 */
    RING_END: 1 << 1,
    /** 圈的横条 */
    RING_BAR: 1 << 2,
    /** 柱杆和底托 */
    PILLAR: 1 << 3,
    /** 缸壁 */
    WALL: 1 << 4,
    /** 机关 */
    MECH: 1 << 5,
} as const;

export type PhysicsGroupKey = keyof typeof PhysicsGroupBit;

/**
 * 各分组允许碰撞的目标分组掩码（对称关系）。
 */
export const PHYSICS_COLLISION_RULES: Readonly<Record<number, number>> = {
    [PhysicsGroupBit.DEFAULT]: PhysicsGroupBit.DEFAULT,
    [PhysicsGroupBit.RING_END]: PhysicsGroupBit.PILLAR,
    [PhysicsGroupBit.PILLAR]: PhysicsGroupBit.RING_END,
    [PhysicsGroupBit.RING_BAR]: PhysicsGroupBit.RING_BAR | PhysicsGroupBit.WALL | PhysicsGroupBit.MECH,
    [PhysicsGroupBit.WALL]: PhysicsGroupBit.RING_BAR,
    [PhysicsGroupBit.MECH]: PhysicsGroupBit.RING_BAR,
};

/** 判断两个分组位掩码在规则下是否发生碰撞。 */
export function canGroupsCollide(groupA: number, groupB: number): boolean {
    const maskA = PHYSICS_COLLISION_RULES[groupA] ?? 0;
    const maskB = PHYSICS_COLLISION_RULES[groupB] ?? 0;
    return (maskA & groupB) !== 0 && (maskB & groupA) !== 0;
}

/** 将碰撞规则写入引擎 PhysicsSystem2D.instance.collisionMatrix。 */
export function applyCollisionMatrix(matrix: Record<string | number, number>): void {
    for (const [groupStr, mask] of Object.entries(PHYSICS_COLLISION_RULES)) {
        const groupBit = Number(groupStr);
        matrix[groupBit] = mask;
        matrix[groupStr] = mask;
    }
}
