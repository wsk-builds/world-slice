import { describe, expect, it } from 'vitest';
import {
    applyCollisionMatrix,
    canGroupsCollide,
    PHYSICS_COLLISION_RULES,
    PhysicsGroupBit,
} from '../../assets/scripts/config/PhysicsGroups';

describe('PhysicsGroups', () => {
    it('所有自定义分组位掩码互不重叠且为 2 的幂', () => {
        const bits = Object.values(PhysicsGroupBit);
        expect(new Set(bits).size).toBe(bits.length);
        for (const b of bits) {
            expect(b).toBeGreaterThan(0);
            expect((b & (b - 1)) === 0).toBe(true);
        }
    });

    it('碰撞矩阵严格对称', () => {
        const bits = Object.values(PhysicsGroupBit);
        for (const a of bits) {
            for (const b of bits) {
                const ab = (PHYSICS_COLLISION_RULES[a] & b) !== 0;
                const ba = (PHYSICS_COLLISION_RULES[b] & a) !== 0;
                expect(ab).toBe(ba);
            }
        }
    });

    it('RING_END 只碰 PILLAR；RING_BAR 碰 RING_BAR、WALL、MECH', () => {
        const { RING_END, RING_BAR, PILLAR, WALL, MECH } = PhysicsGroupBit;

        expect(canGroupsCollide(RING_END, PILLAR)).toBe(true);
        expect(canGroupsCollide(RING_END, RING_END)).toBe(false);
        expect(canGroupsCollide(RING_END, RING_BAR)).toBe(false);
        expect(canGroupsCollide(RING_END, WALL)).toBe(false);
        expect(canGroupsCollide(RING_END, MECH)).toBe(false);

        expect(canGroupsCollide(RING_BAR, RING_BAR)).toBe(true);
        expect(canGroupsCollide(RING_BAR, WALL)).toBe(true);
        expect(canGroupsCollide(RING_BAR, MECH)).toBe(true);
        expect(canGroupsCollide(RING_BAR, PILLAR)).toBe(false);

        expect(canGroupsCollide(PILLAR, WALL)).toBe(false);
    });

    it('applyCollisionMatrix 正确写入数字与字符串键', () => {
        const matrix: Record<string | number, number> = {};
        applyCollisionMatrix(matrix);
        expect(matrix[PhysicsGroupBit.RING_END]).toBe(PhysicsGroupBit.PILLAR);
        expect(matrix[String(PhysicsGroupBit.RING_BAR)]).toBe(
            PhysicsGroupBit.RING_BAR | PhysicsGroupBit.WALL | PhysicsGroupBit.MECH,
        );
    });
});
