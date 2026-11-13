import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FeelConfig } from '../../../assets/scripts/config/FeelConfig';
import { calcRingPillarGeometry, GameConst } from '../../../assets/scripts/config/GameConst';
import { TankSpace } from '../../../assets/scripts/config/TankSpace';
import { LevelData, LevelRingEntry } from '../../../assets/scripts/core/level/LevelData';
import {
    isCircleInsideTank,
    overlapsPillar2D,
    resolveLevelRingLayout,
} from '../../../assets/scripts/core/level/LevelRingLayout';
import { PillarCollider3D } from '../../../assets/scripts/core/physics3d/PillarCollider3D';

function buildTestPillars() {
    const geom = calcRingPillarGeometry(TankSpace.width);
    const tailBottomY = TankSpace.pctToPxY(FeelConfig.pillarBottomPct);
    const left = new PillarCollider3D(TankSpace.pctToPxX(FeelConfig.pillarPosPct), tailBottomY, geom);
    const right = new PillarCollider3D(TankSpace.pctToPxX(100 - FeelConfig.pillarPosPct), tailBottomY, geom);
    return { geom, left, right };
}

describe('LevelRingLayout 确定性初始摆位', () => {
    it('同种子多次生成产出完全一致的坐标与 3D 姿态，不同种子产出不同布局', () => {
        const entries: LevelRingEntry[] = Array.from({ length: 9 }, (_, i) => ({
            kind: 'normal' as const,
            color: (['red', 'green', 'blue'] as const)[i % 3],
            pos: 'random' as const,
        }));

        const runA1 = resolveLevelRingLayout(entries, { seed: 2026 });
        const runA2 = resolveLevelRingLayout(entries, { seed: 2026 });
        const runB = resolveLevelRingLayout(entries, { seed: 9999 });

        expect(runA1).toEqual(runA2);
        expect(runA1.map((r) => [r.x, r.y, r.z])).not.toEqual(runB.map((r) => [r.x, r.y, r.z]));
    });

    it('满编 12 个随机圈均严格位于水缸圆弧内、避开左右锥形十字柱且互不重叠', () => {
        const entries: LevelRingEntry[] = [
            ...Array.from({ length: 4 }, () => ({ kind: 'normal' as const, color: 'red' as const, pos: 'random' as const })),
            ...Array.from({ length: 4 }, () => ({ kind: 'normal' as const, color: 'green' as const, pos: 'random' as const })),
            { kind: 'gold', pos: 'random' },
            { kind: 'gold', pos: 'random' },
            { kind: 'iron', pos: 'random' },
            { kind: 'wood', pos: 'random' },
        ];

        const spawns = resolveLevelRingLayout(entries, { seed: 7788 });
        expect(spawns).toHaveLength(12);

        const { geom, left, right } = buildTestPillars();
        const halfDepth = geom.tankDepth * 0.5;

        for (let i = 0; i < spawns.length; i++) {
            const s = spawns[i];
            expect(
                isCircleInsideTank(s.x, s.y, s.outerRadius, TankSpace.width, TankSpace.height, GameConst.tankCornerRadius),
            ).toBe(true);
            expect(overlapsPillar2D(s.x, s.y, s.outerRadius, left)).toBe(false);
            expect(overlapsPillar2D(s.x, s.y, s.outerRadius, right)).toBe(false);
            expect(Math.abs(s.z)).toBeLessThanOrEqual(halfDepth - s.outerRadius);

            for (let j = i + 1; j < spawns.length; j++) {
                const other = spawns[j];
                const dist = Math.hypot(s.x - other.x, s.y - other.y);
                expect(dist).toBeGreaterThanOrEqual(s.outerRadius + other.outerRadius + GameConst.levelRingSpawnGapPx - 1e-4);
            }
        }
    });

    it('显式百分比圈与随机圈混排时，显式位置精准落地且随机圈避开显式圈', () => {
        const entries: LevelRingEntry[] = [
            { kind: 'normal', color: 'red', pos: { xPct: 50, yPct: 30 }, angleDeg: 12 },
            { kind: 'normal', color: 'blue', pos: 'random' },
            { kind: 'normal', color: 'green', pos: 'random' },
            { kind: 'normal', color: 'red', pos: 'random' },
        ];

        const spawns = resolveLevelRingLayout(entries, { seed: 42 });
        expect(spawns[0].fromRandom).toBe(false);
        expect(spawns[0].x).toBeCloseTo(TankSpace.pctToPxX(50), 4);
        expect(spawns[0].y).toBeCloseTo(TankSpace.pctToPxY(30), 4);
        expect(spawns[0].rollZDeg).toBe(12);

        for (let i = 1; i < spawns.length; i++) {
            const dist = Math.hypot(spawns[i].x - spawns[0].x, spawns[i].y - spawns[0].y);
            expect(dist).toBeGreaterThanOrEqual(
                spawns[i].outerRadius + spawns[0].outerRadius + GameConst.levelRingSpawnGapPx - 1e-4,
            );
        }
    });

    it('X01 / X02 / X03 全部关卡圈布局无重叠且均不压在柱子或缸壁外', () => {
        const { left, right } = buildTestPillars();
        for (const id of ['X01', 'X02', 'X03']) {
            const level = JSON.parse(
                readFileSync(join(process.cwd(), 'assets', 'resources', 'levels', `${id}.json`), 'utf8'),
            ) as LevelData;
            const spawns = resolveLevelRingLayout(level.rings, { seed: level.seed });
            expect(spawns).toHaveLength(level.rings.length);

            for (let i = 0; i < spawns.length; i++) {
                const s = spawns[i];
                expect(
                    isCircleInsideTank(s.x, s.y, s.outerRadius, TankSpace.width, TankSpace.height, GameConst.tankCornerRadius),
                ).toBe(true);
                expect(overlapsPillar2D(s.x, s.y, s.outerRadius, left)).toBe(false);
                expect(overlapsPillar2D(s.x, s.y, s.outerRadius, right)).toBe(false);
                for (let j = i + 1; j < spawns.length; j++) {
                    const other = spawns[j];
                    const dist = Math.hypot(s.x - other.x, s.y - other.y);
                    expect(dist).toBeGreaterThanOrEqual(
                        s.outerRadius + other.outerRadius + GameConst.levelRingSpawnGapPx - 1e-4,
                    );
                }
            }
        }
    });
});
