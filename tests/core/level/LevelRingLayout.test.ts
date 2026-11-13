import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FEEL_CONFIG, FeelConfig } from '../../../assets/scripts/config/FeelConfig';
import { calcRingPillarGeometry, GameConst } from '../../../assets/scripts/config/GameConst';
import { TankSpace } from '../../../assets/scripts/config/TankSpace';
import { solveFeel } from '../../../assets/scripts/core/flow/FeelSolver';
import { LevelData, LevelRingEntry } from '../../../assets/scripts/core/level/LevelData';
import {
    isCircleInsideTank,
    isInPillarDropCorridor,
    overlapsPillar2D,
    pickStartPillarDrop,
    resolveLevelRingLayout,
} from '../../../assets/scripts/core/level/LevelRingLayout';
import { quatFromEulerDeg } from '../../../assets/scripts/core/physics3d/Math3D';
import { PillarCollider3D } from '../../../assets/scripts/core/physics3d/PillarCollider3D';
import { TorusBody3D } from '../../../assets/scripts/core/physics3d/TorusBody3D';
import { TorusWorld3D } from '../../../assets/scripts/core/physics3d/TorusWorld3D';
import { applyFunnelToBody, FunnelPillarTarget } from '../../../assets/scripts/core/rules/FunnelMath';
import { getRingKindConfig } from '../../../assets/scripts/core/rings/RingKinds';
import { isRingOnPillar3D } from '../../../assets/scripts/core/rules/PillarStack';
import { SeededRandom } from '../../../assets/scripts/core/util/SeededRandom';

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

    it('pickStartPillarDrop 在 10000 次采样中开局落柱概率约 5%，且左右柱大致均分', () => {
        const rng = new SeededRandom(20261113);
        const candidates = [1, 2, 4, 5, 7, 9, 10, 11];
        const trials = 10000;
        let hitCount = 0;
        let leftCount = 0;
        let rightCount = 0;

        for (let i = 0; i < trials; i++) {
            const pick = pickStartPillarDrop({
                candidateIndices: candidates,
                dropRoll: rng.next(),
                sideRoll: rng.next(),
                ringRoll: rng.next(),
            });
            if (pick) {
                hitCount++;
                expect(candidates).toContain(pick.ringIndex);
                if (pick.side === 'left') {
                    leftCount++;
                } else {
                    rightCount++;
                }
            }
        }

        const rate = hitCount / trials;
        expect(rate).toBeGreaterThan(0.04);
        expect(rate).toBeLessThan(0.06);
        expect(leftCount).toBeGreaterThan(hitCount * 0.35);
        expect(rightCount).toBeGreaterThan(hitCount * 0.35);
    });

    it('正常局（未命中 5%）时，X03 全部随机圈避开柱顶下落通道，静置 4 秒不会有任何圈开局落柱', () => {
        const x03 = JSON.parse(
            readFileSync(join(process.cwd(), 'assets', 'resources', 'levels', 'X03.json'), 'utf8'),
        ) as LevelData;

        const spawns = resolveLevelRingLayout(x03.rings, {
            seed: x03.seed,
            startPillarDropRoll: 0.5, // 未命中 5%
        });

        const { geom, left, right } = buildTestPillars();
        for (const s of spawns) {
            if (s.fromRandom) {
                expect(isInPillarDropCorridor(s.x, s.y, s.outerRadius, left)).toBe(false);
                expect(isInPillarDropCorridor(s.x, s.y, s.outerRadius, right)).toBe(false);
            }
        }

        // 在 TorusWorld3D 中不喷水静置 4 秒，确认 0 个圈落在柱子上
        const world = new TorusWorld3D();
        const pLeft = world.addPillar(left);
        const pRight = world.addPillar(right);
        const solved = solveFeel(DEFAULT_FEEL_CONFIG);
        const targets: FunnelPillarTarget[] = [
            { x: pLeft.x, z: 0, tipY: pLeft.tipY, baseTopY: pLeft.baseTopY, isFull: false },
            { x: pRight.x, z: 0, tipY: pRight.tipY, baseTopY: pRight.baseTopY, isFull: false },
        ];

        const bodies = spawns.map((s) => {
            const cfg = getRingKindConfig(s.spec);
            const outerD = geom.ringOuterDiameter * cfg.sizeScale;
            const thick = geom.ringThickness * cfg.sizeScale;
            const tubeR = thick * 0.5;
            const majorR = outerD * 0.5 - tubeR;
            const q = quatFromEulerDeg(s.pitchXDeg, s.yawYDeg, s.rollZDeg, { x: 0, y: 0, z: 0, w: 1 });
            return {
                spec: s.spec,
                innerR: outerD * 0.5 - thick,
                sinkScale: cfg.sinkScale,
                body: world.addBody(
                    new TorusBody3D({
                        x: s.x,
                        y: s.y,
                        z: s.z,
                        qx: q.x,
                        qy: q.y,
                        qz: q.z,
                        qw: q.w,
                        majorRadius: majorR,
                        tubeRadius: tubeR,
                        mass: Math.max(0.25, cfg.sinkScale),
                        linearDamping: solved.ringLinearDamping,
                        angularDamping: solved.ringAngularDamping,
                    }),
                ),
            };
        });

        for (let step = 0; step < 240; step++) {
            for (const item of bodies) {
                item.body.applyCentralForce(0, -solved.baseSinkAccel * item.sinkScale * item.body.mass, 0);
                applyFunnelToBody(item.body, targets, [solved.funnel, solved.funnel]);
            }
            world.step(1 / 60);
        }

        for (const item of bodies) {
            const b = item.body;
            expect(
                isRingOnPillar3D({
                    centerX: b.x,
                    centerY: b.y,
                    centerZ: b.z,
                    normalX: b.basisN.x,
                    normalY: b.basisN.y,
                    normalZ: b.basisN.z,
                    innerRadius: item.innerR,
                    pillarX: pLeft.x,
                    pillarZ: 0,
                    baseTopY: pLeft.baseTopY,
                    tipY: pLeft.tipY,
                    shaftRadiusAtY: pLeft.shaftRadiusAtY(b.y),
                }),
            ).toBe(false);
            expect(
                isRingOnPillar3D({
                    centerX: b.x,
                    centerY: b.y,
                    centerZ: b.z,
                    normalX: b.basisN.x,
                    normalY: b.basisN.y,
                    normalZ: b.basisN.z,
                    innerRadius: item.innerR,
                    pillarX: pRight.x,
                    pillarZ: 0,
                    baseTopY: pRight.baseTopY,
                    tipY: pRight.tipY,
                    shaftRadiusAtY: pRight.shaftRadiusAtY(b.y),
                }),
            ).toBe(false);
        }
    });

    it('命中 5% 开局落柱时，会在左右柱之一上方生成 1 个随机圈并在默认 10% 宽容下自然落柱', () => {
        const x03 = JSON.parse(
            readFileSync(join(process.cwd(), 'assets', 'resources', 'levels', 'X03.json'), 'utf8'),
        ) as LevelData;

        for (const [sideRoll, expectedSide] of [
            [0.2, 'left'],
            [0.8, 'right'],
        ] as const) {
            const spawns = resolveLevelRingLayout(x03.rings, {
                seed: x03.seed,
                startPillarDropRoll: 0.01, // 命中 < 0.05
                startPillarSideRoll: sideRoll,
                startPillarRingRoll: 0.65,
            });

            const { geom, left, right } = buildTestPillars();
            const targetPillar = expectedSide === 'left' ? left : right;

            const world = new TorusWorld3D();
            const pLeft = world.addPillar(left);
            const pRight = world.addPillar(right);
            const solved = solveFeel(DEFAULT_FEEL_CONFIG);
            const targets: FunnelPillarTarget[] = [
                { x: pLeft.x, z: 0, tipY: pLeft.tipY, baseTopY: pLeft.baseTopY, isFull: false },
                { x: pRight.x, z: 0, tipY: pRight.tipY, baseTopY: pRight.baseTopY, isFull: false },
            ];

            const bodies = spawns.map((s) => {
                const cfg = getRingKindConfig(s.spec);
                const outerD = geom.ringOuterDiameter * cfg.sizeScale;
                const thick = geom.ringThickness * cfg.sizeScale;
                const tubeR = thick * 0.5;
                const majorR = outerD * 0.5 - tubeR;
                const q = quatFromEulerDeg(s.pitchXDeg, s.yawYDeg, s.rollZDeg, { x: 0, y: 0, z: 0, w: 1 });
                return {
                    innerR: outerD * 0.5 - thick,
                    sinkScale: cfg.sinkScale,
                    body: world.addBody(
                        new TorusBody3D({
                            x: s.x,
                            y: s.y,
                            z: s.z,
                            qx: q.x,
                            qy: q.y,
                            qz: q.z,
                            qw: q.w,
                            majorRadius: majorR,
                            tubeRadius: tubeR,
                            mass: Math.max(0.25, cfg.sinkScale),
                            linearDamping: solved.ringLinearDamping,
                            angularDamping: solved.ringAngularDamping,
                        }),
                    ),
                };
            });

            for (let step = 0; step < 180; step++) {
                for (const item of bodies) {
                    item.body.applyCentralForce(0, -solved.baseSinkAccel * item.sinkScale * item.body.mass, 0);
                    applyFunnelToBody(item.body, targets, [solved.funnel, solved.funnel]);
                }
                world.step(1 / 60);
            }

            const onTargetCount = bodies.filter((item) => {
                const b = item.body;
                return isRingOnPillar3D({
                    centerX: b.x,
                    centerY: b.y,
                    centerZ: b.z,
                    normalX: b.basisN.x,
                    normalY: b.basisN.y,
                    normalZ: b.basisN.z,
                    innerRadius: item.innerR,
                    pillarX: targetPillar.x,
                    pillarZ: 0,
                    baseTopY: targetPillar.baseTopY,
                    tipY: targetPillar.tipY,
                    shaftRadiusAtY: targetPillar.shaftRadiusAtY(b.y),
                });
            }).length;

            expect(onTargetCount).toBe(1);
        }
    });
});
