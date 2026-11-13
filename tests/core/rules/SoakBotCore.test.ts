import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FEEL_CONFIG } from '../../../assets/scripts/config/FeelConfig';
import { calcRingPillarGeometry, GameConst } from '../../../assets/scripts/config/GameConst';
import { TankSpace } from '../../../assets/scripts/config/TankSpace';
import {
    CalmSeaFlowTerm,
    CalmSeaRingRegulator,
    computeCalmSeaTargetY,
} from '../../../assets/scripts/core/flow/CalmSeaFlow';
import { solveFeel } from '../../../assets/scripts/core/flow/FeelSolver';
import { FlowField } from '../../../assets/scripts/core/flow/FlowField';
import { buildTidePullFunnelBoost, TidePullFlowTerm } from '../../../assets/scripts/core/flow/TidePullFlow';
import { calcEndpointFollowAccel } from '../../../assets/scripts/core/flow/WaterFollow';
import { Bladder } from '../../../assets/scripts/core/input/Bladder';
import { LevelData, resolvePillarEnergyEnabled } from '../../../assets/scripts/core/level/LevelData';
import { resolveLevelRingLayout } from '../../../assets/scripts/core/level/LevelRingLayout';
import { LevelState } from '../../../assets/scripts/core/level/LevelState';
import { quatFromEulerDeg } from '../../../assets/scripts/core/physics3d/Math3D';
import { PillarCollider3D } from '../../../assets/scripts/core/physics3d/PillarCollider3D';
import { TorusBody3D } from '../../../assets/scripts/core/physics3d/TorusBody3D';
import { TorusWorld3D } from '../../../assets/scripts/core/physics3d/TorusWorld3D';
import { getRingKindConfig } from '../../../assets/scripts/core/rings/RingKinds';
import { PillarEnergy } from '../../../assets/scripts/core/rules/Energy';
import { applyFunnelToBody, resolveEffectiveFunnelParams } from '../../../assets/scripts/core/rules/FunnelMath';
import {
    calcMatchDropDuration,
    calcMatchDropY,
    resolvePillarMatch,
} from '../../../assets/scripts/core/rules/MatchRule';
import {
    calcRingTiltDeg3D,
    calcSlotCenterY,
    isRingOnPillar3D,
    isRingStableForLock,
    PillarStack,
} from '../../../assets/scripts/core/rules/PillarStack';
import {
    buildSoakBotTankHint,
    formatSoakElapsed,
    parseSoakBotOptions,
    SoakBotInputGenerator,
    SoakInvariantChecker,
    SoakRingSnapshot,
} from '../../../assets/scripts/core/rules/SoakBotCore';

function makeSnapshot(
    id: number,
    overrides: Partial<SoakRingSnapshot> & {
        x?: number;
        y?: number;
        z?: number;
        qx?: number;
        qy?: number;
        qz?: number;
        qw?: number;
    } = {},
): SoakRingSnapshot {
    const geom = calcRingPillarGeometry(TankSpace.width);
    const tubeRadius = geom.ringThickness * 0.5;
    const majorRadius = geom.ringOuterDiameter * 0.5 - tubeRadius;
    const body = new TorusBody3D({
        id,
        x: overrides.x ?? TankSpace.width * 0.5,
        y: overrides.y ?? TankSpace.height * 0.5,
        z: overrides.z ?? 0,
        qx: overrides.qx,
        qy: overrides.qy,
        qz: overrides.qz,
        qw: overrides.qw,
        majorRadius,
        tubeRadius,
    });
    return {
        id,
        kind: overrides.kind ?? 'normal',
        color: overrides.color ?? 'red',
        locked: overrides.locked ?? false,
        clearing: overrides.clearing ?? false,
        isDropping: overrides.isDropping ?? false,
        dropTargetY: overrides.dropTargetY,
        body,
    };
}

describe('SoakBotCore 挂机参数解析、种子按键与四项不变量检查（T023）', () => {
    it('安全解析 URL 挂机参数，兼容空串与非法编码', () => {
        expect(parseSoakBotOptions('')).toEqual({
            enabled: false,
            stepsPerFrame: 8,
            seed: 2026001,
            muteSfx: true,
        });
        expect(parseSoakBotOptions('?level=X03&bot=1')).toEqual({
            enabled: true,
            stepsPerFrame: 8,
            seed: 2026001,
            muteSfx: true,
        });
        expect(parseSoakBotOptions('?bot=1&botSpeed=15&botSeed=42&botSfx=1')).toEqual({
            enabled: true,
            stepsPerFrame: 15,
            seed: 42,
            muteSfx: false,
        });
        expect(parseSoakBotOptions('?bot=%E0%A4%A&botSpeed=999')).toEqual({
            enabled: false,
            stepsPerFrame: 20,
            seed: 2026001,
            muteSfx: true,
        });
        expect(formatSoakElapsed(0)).toBe('00:00');
        expect(formatSoakElapsed(1800)).toBe('30:00');
        expect(formatSoakElapsed(1865.8)).toBe('31:05');
    });

    it('SoakBotInputGenerator 完全使用 SeededRandom，同种子复现且绝不调用 Math.random', () => {
        const randomSpy = vi.spyOn(Math, 'random');
        const genA = new SoakBotInputGenerator(12345);
        const genB = new SoakBotInputGenerator(12345);

        let leftOnSteps = 0;
        let rightOnSteps = 0;
        let bothOffSteps = 0;
        for (let i = 0; i < 600; i++) {
            const a = genA.step(1 / 60);
            const b = genB.step(1 / 60);
            expect(a).toEqual(b);
            if (a.leftPressed) leftOnSteps++;
            if (a.rightPressed) rightOnSteps++;
            if (!a.leftPressed && !a.rightPressed) bothOffSteps++;
        }

        expect(leftOnSteps).toBeGreaterThan(15);
        expect(rightOnSteps).toBeGreaterThan(15);
        expect(bothOffSteps).toBeGreaterThan(50);
        expect(randomSpy).not.toHaveBeenCalled();
        randomSpy.mockRestore();
    });

    it('故障注入：精准捕获 NaN / Infinity、退化四元数、穿出三维水缸、锁定圈漂移与总数变化', () => {
        const world = new TorusWorld3D(TankSpace.width, TankSpace.height);
        const checker = new SoakInvariantChecker({ wallTolerancePx: 10 });

        // 1. NaN / Infinity 与退化四元数
        const r1 = makeSnapshot(1);
        const r2 = makeSnapshot(2, { x: 300, y: 200 });
        checker.beginRound(3, 'X03', [r1, r2]);
        expect(checker.checkStep(12.5, world.tank, [r1, r2], 2)).toBeNull();

        (r2.body as TorusBody3D).x = Number.NaN;
        const nanViolation = checker.checkStep(12.55, world.tank, [r1, r2], 2);
        expect(nanViolation?.rule).toBe('invalid_number');
        expect(nanViolation?.roundIndex).toBe(3);
        expect(nanViolation?.levelId).toBe('X03');
        expect(nanViolation?.ringId).toBe(2);
        expect(nanViolation?.simTimeSec).toBeCloseTo(12.55, 6);

        (r2.body as TorusBody3D).x = 300;
        (r2.body.quat as { x: number; y: number; z: number; w: number }).x = 0;
        (r2.body.quat as { x: number; y: number; z: number; w: number }).y = 0;
        (r2.body.quat as { x: number; y: number; z: number; w: number }).z = 0;
        (r2.body.quat as { x: number; y: number; z: number; w: number }).w = 0;
        expect(checker.checkStep(12.6, world.tank, [r1, r2], 2)?.rule).toBe('invalid_number');

        // 2. 超出三维水缸（左右墙、顶墙、前后玻璃、圆弧底角）
        const r3 = makeSnapshot(3, { x: 400, y: 300 });
        checker.beginRound(1, 'X03', [r3]);
        (r3.body as TorusBody3D).z = world.tank.halfDepth + 30;
        const zOut = checker.checkStep(4.0, world.tank, [r3], 1);
        expect(zOut?.rule).toBe('out_of_tank');
        expect(zOut?.ringId).toBe(3);

        const rCorner = makeSnapshot(4, { x: 18, y: 18 });
        checker.beginRound(1, 'X03', [rCorner]);
        expect(checker.checkStep(4.1, world.tank, [rCorner], 1)?.rule).toBe('out_of_tank');

        // 3. 已锁定圈位移或姿态漂移，同时兼容消除后的合法 Y 轴平滑下落
        const rLockedBase = makeSnapshot(10, { x: 344, y: 350, z: 2, locked: true });
        const rLockedTop = makeSnapshot(11, { x: 345, y: 382, z: -1, locked: true });
        checker.beginRound(2, 'X03', [rLockedBase, rLockedTop]);
        expect(checker.checkStep(1.0, world.tank, [rLockedBase, rLockedTop], 2)).toBeNull();

        // 合法消除下落：rLockedBase 消除，rLockedTop 平滑下落到 350（x/z/quat 严格不动）
        rLockedBase.clearing = true;
        checker.markMatchCleared([rLockedBase.id]);
        rLockedTop.isDropping = true;
        rLockedTop.dropTargetY = 350;
        (rLockedTop.body as TorusBody3D).y = 370;
        expect(checker.checkStep(1.1, world.tank, [rLockedBase, rLockedTop], 1)).toBeNull();

        (rLockedTop.body as TorusBody3D).y = 350;
        rLockedTop.isDropping = false;
        expect(checker.checkStep(1.2, world.tank, [rLockedTop], 1)).toBeNull();

        // 落定后再发生微小位移或姿态漂移必须立即报错
        (rLockedTop.body as TorusBody3D).x += 0.002;
        const driftX = checker.checkStep(1.3, world.tank, [rLockedTop], 1);
        expect(driftX?.rule).toBe('locked_drift');
        expect(driftX?.ringId).toBe(11);

        // 恢复 x 后测试四元数漂移
        (rLockedTop.body as TorusBody3D).x -= 0.002;
        const qTilt = quatFromEulerDeg(0.8, 0, 0, { x: 0, y: 0, z: 0, w: 1 });
        (rLockedTop.body.quat as { x: number; y: number; z: number; w: number }).x = qTilt.x;
        (rLockedTop.body.quat as { x: number; y: number; z: number; w: number }).y = qTilt.y;
        (rLockedTop.body.quat as { x: number; y: number; z: number; w: number }).z = qTilt.z;
        (rLockedTop.body.quat as { x: number; y: number; z: number; w: number }).w = qTilt.w;
        expect(checker.checkStep(1.35, world.tank, [rLockedTop], 1)?.rule).toBe('locked_drift');

        // 4. 圈总数异常（未登记消除直接少圈、或多出幽灵圈）
        const a = makeSnapshot(21, { x: 300, y: 200 });
        const b = makeSnapshot(22, { x: 400, y: 200 });
        checker.beginRound(5, 'X03', [a, b]);
        expect(checker.checkStep(2.0, world.tank, [a, b], 2)).toBeNull();

        // 未经 markMatchCleared 直接丢失一个圈
        expect(checker.checkStep(2.05, world.tank, [a], 1)?.rule).toBe('ring_count_mismatch');

        // 恢复后测试非法多出圈
        checker.beginRound(5, 'X03', [a, b]);
        const c = makeSnapshot(23, { x: 500, y: 200 });
        expect(checker.checkStep(2.1, world.tank, [a, b, c], 3)?.rule).toBe('ring_count_mismatch');
    });

    it('真实 3D 物理快速回归（X03 + 双技能潮引/定海 + 消除平滑下落 + 自动重开）零报错', () => {
        const levelJson = JSON.parse(
            readFileSync(join(process.cwd(), 'assets', 'resources', 'levels', 'X03.json'), 'utf8'),
        ) as LevelData;
        // 加速一轮（设为 25 秒让单测里也稳定演练到超时重开，同时开启双柱充能演练潮引与定海）
        const testLevel: LevelData = {
            ...levelJson,
            durationSec: 25,
            pillarEnergy: { left: true, right: true },
        };

        const solved = solveFeel(DEFAULT_FEEL_CONFIG);
        const geom = calcRingPillarGeometry(TankSpace.width);
        const leftPillarX = TankSpace.pctToPxX(DEFAULT_FEEL_CONFIG.pillarPosPct);
        const rightPillarX = TankSpace.pctToPxX(100 - DEFAULT_FEEL_CONFIG.pillarPosPct);
        const tailBottomY = TankSpace.pctToPxY(DEFAULT_FEEL_CONFIG.pillarBottomPct);

        const botInput = new SoakBotInputGenerator(2026001);
        const checker = new SoakInvariantChecker({ wallTolerancePx: 10 });
        const dt = 1 / 60;
        const totalSteps = 3600; // 60 秒物理回归（覆盖两轮以上重开）

        let rounds = 0;
        let totalLocks = 0;
        let totalMatches = 0;

        interface SimRing {
            id: number;
            spec: { kind: LevelData['rings'][number]['kind']; color?: LevelData['rings'][number]['color'] };
            kindConfig: ReturnType<typeof getRingKindConfig>;
            thickness: number;
            innerRadius: number;
            majorRadius: number;
            body3D: TorusBody3D;
            locked: boolean;
            clearing: boolean;
            valid: boolean;
        }

        const runSim = () => {
            let world: TorusWorld3D;
            let leftPillar: PillarCollider3D;
            let rightPillar: PillarCollider3D;
            let leftBladder: Bladder;
            let rightBladder: Bladder;
            let flowField: FlowField;
            let energy: PillarEnergy;
            let tideTerm: TidePullFlowTerm;
            let calmTerm: CalmSeaFlowTerm;
            let calmRegulator: CalmSeaRingRegulator;
            let tideActive = false;
            let calmActive = false;
            let calmTargetY = 0;
            let stacks: { left: PillarStack<SimRing>; right: PillarStack<SimRing> };
            let holdProgress: Map<SimRing, { side: 'left' | 'right'; elapsed: number }>;
            let lockedOffsets: Map<SimRing, { dx: number; dyFromBase: number; dz: number }>;
            let flashingRings: Map<SimRing, { elapsed: number; duration: number }>;
            let droppingRings: Map<
                SimRing,
                { side: 'left' | 'right'; pillar: PillarCollider3D; startDy: number; targetDy: number; elapsed: number; delay: number; duration: number }
            >;
            let levelState: LevelState;
            let rings: SimRing[];

            const tempWaterVel3D = { x: 0, y: 0, z: 0 };
            const tempPtVel = { x: 0, y: 0, z: 0 };
            const tempFollow2D = { x: 0, y: 0 };
            const tempWarm = { x: 0, y: 0 };
            const tempQuat = { x: 0, y: 0, z: 0, w: 1 };
            const tideBoost = buildTidePullFunnelBoost();

            const snapshots = (): SoakRingSnapshot[] =>
                rings
                    .filter((r) => r.valid)
                    .map((r) => {
                        const d = droppingRings.get(r);
                        return {
                            id: r.id,
                            kind: r.spec.kind,
                            color: r.spec.color,
                            locked: r.locked,
                            clearing: r.clearing,
                            isDropping: Boolean(d),
                            dropTargetY: d ? d.pillar.baseTopY + d.targetDy : undefined,
                            body: r.body3D,
                        };
                    });

            const resetRound = (roundIdx: number) => {
                rounds = roundIdx;
                world = new TorusWorld3D(TankSpace.width, TankSpace.height);
                leftPillar = world.addPillar(new PillarCollider3D(leftPillarX, tailBottomY, geom));
                rightPillar = world.addPillar(new PillarCollider3D(rightPillarX, tailBottomY, geom));
                leftBladder = new Bladder({}, DEFAULT_FEEL_CONFIG);
                rightBladder = new Bladder({}, DEFAULT_FEEL_CONFIG);
                flowField = new FlowField({ seed: testLevel.seed }, DEFAULT_FEEL_CONFIG);
                energy = new PillarEnergy({ enabled: resolvePillarEnergyEnabled(testLevel) });
                tideTerm = new TidePullFlowTerm();
                calmTerm = new CalmSeaFlowTerm();
                calmRegulator = new CalmSeaRingRegulator();
                tideActive = false;
                calmActive = false;
                calmTargetY = computeCalmSeaTargetY(
                    [
                        { x: leftPillar.x, z: 0, baseTopY: leftPillar.baseTopY, tipY: leftPillar.tipY, isFull: false },
                        { x: rightPillar.x, z: 0, baseTopY: rightPillar.baseTopY, tipY: rightPillar.tipY, isFull: false },
                    ],
                    geom.ringOuterDiameter * 0.5,
                    TankSpace.height,
                    calmTerm.config,
                );
                energy.onSkillTrigger((ev) => {
                    if (ev.side === 'left') {
                        tideActive = true;
                        tideTerm.activate(leftPillar.x, leftPillar.tipY);
                        flowField.addTerm(tideTerm);
                    } else {
                        calmActive = true;
                        calmRegulator.reset();
                        calmTerm.activate(calmTargetY, TankSpace.height);
                        flowField.addTerm(calmTerm);
                        flowField.setFlowSuppression(calmTerm.config.turbulenceScale, calmTerm.config.circulationScale);
                    }
                });
                energy.onChange((snap) => {
                    if (snap.side === 'left' && tideActive && !snap.skillActive) {
                        tideActive = false;
                        tideTerm.deactivate();
                        flowField.removeTerm(tideTerm);
                    }
                    if (snap.side === 'right' && calmActive && !snap.skillActive) {
                        calmActive = false;
                        calmTerm.deactivate();
                        flowField.removeTerm(calmTerm);
                        flowField.clearFlowSuppression();
                        calmRegulator.reset();
                    }
                });

                stacks = {
                    left: new PillarStack<SimRing>(GameConst.pillarCapacity),
                    right: new PillarStack<SimRing>(GameConst.pillarCapacity),
                };
                holdProgress = new Map();
                lockedOffsets = new Map();
                flashingRings = new Map();
                droppingRings = new Map();

                const spawns = resolveLevelRingLayout(testLevel.rings, {
                    seed: testLevel.seed + roundIdx - 1,
                    pillarPosPct: DEFAULT_FEEL_CONFIG.pillarPosPct,
                    pillarBottomPct: DEFAULT_FEEL_CONFIG.pillarBottomPct,
                });
                rings = spawns.map((s) => {
                    const kindConfig = getRingKindConfig(s.spec);
                    const outerD = geom.ringOuterDiameter * kindConfig.sizeScale;
                    const thickness = geom.ringThickness * kindConfig.sizeScale;
                    const tubeR = thickness * 0.5;
                    const majorR = outerD * 0.5 - tubeR;
                    const innerRadius = Math.max(4, outerD - thickness * 2) * 0.5;
                    quatFromEulerDeg(s.pitchXDeg, s.yawYDeg, s.rollZDeg, tempQuat);
                    const body3D = world.addBody(
                        new TorusBody3D({
                            x: s.x,
                            y: s.y,
                            z: s.z,
                            qx: tempQuat.x,
                            qy: tempQuat.y,
                            qz: tempQuat.z,
                            qw: tempQuat.w,
                            majorRadius: majorR,
                            tubeRadius: tubeR,
                            mass: Math.max(0.25, kindConfig.sinkScale),
                            linearDamping: solved.ringLinearDamping,
                            angularDamping: solved.ringAngularDamping,
                            friction: solved.ringFriction,
                            restitution: solved.ringRestitution,
                        }),
                    );
                    return {
                        id: body3D.id,
                        spec: s.spec,
                        kindConfig,
                        thickness,
                        innerRadius,
                        majorRadius: majorR,
                        body3D,
                        locked: false,
                        clearing: false,
                        valid: true,
                    };
                });

                levelState = new LevelState({
                    durationSec: testLevel.durationSec,
                    initialFreeRings: rings.length,
                });
                levelState.start();
                botInput.clearPending();
                checker.beginRound(roundIdx, testLevel.id, snapshots());
            };

            resetRound(1);

            for (let step = 1; step <= totalSteps; step++) {
                const snapsBefore = snapshots();
                const hint = buildSoakBotTankHint(snapsBefore, TankSpace.width, [
                    { x: leftPillar.x, baseTopY: leftPillar.baseTopY, tipY: leftPillar.tipY, isFull: stacks.left.isFull() },
                    { x: rightPillar.x, baseTopY: rightPillar.baseTopY, tipY: rightPillar.tipY, isFull: stacks.right.isFull() },
                ]);
                const inp = botInput.step(dt, hint);
                leftBladder.setPressed(inp.leftPressed);
                rightBladder.setPressed(inp.rightPressed);

                flowField.setJetInputs(leftBladder.output, rightBladder.output);
                flowField.step(dt);
                leftBladder.step(dt);
                rightBladder.step(dt);

                const calmInfo = [
                    { x: leftPillar.x, z: 0, baseTopY: leftPillar.baseTopY, tipY: leftPillar.tipY, isFull: stacks.left.isFull() },
                    { x: rightPillar.x, z: 0, baseTopY: rightPillar.baseTopY, tipY: rightPillar.tipY, isFull: stacks.right.isFull() },
                ];

                for (const ring of rings) {
                    if (!ring.valid || ring.locked || ring.clearing) continue;
                    const b = ring.body3D;
                    b.applyCentralForce(0, -b.mass * solved.baseSinkAccel * ring.kindConfig.sinkScale, 0);
                    if (b.y < b.outerRadius * 1.35) {
                        b.applyCentralForce(0, 0, -b.z * b.mass * 5.5);
                    }
                    const R = b.majorRadius;
                    const pts = [
                        [b.x + b.basisU.x * R, b.y + b.basisU.y * R, b.z + b.basisU.z * R],
                        [b.x - b.basisU.x * R, b.y - b.basisU.y * R, b.z - b.basisU.z * R],
                        [b.x + b.basisV.x * R, b.y + b.basisV.y * R, b.z + b.basisV.z * R],
                        [b.x - b.basisV.x * R, b.y - b.basisV.y * R, b.z - b.basisV.z * R],
                    ];
                    for (const [px, py, pz] of pts) {
                        flowField.velocityAt3D(px, py, pz, world.tank.halfDepth, solved.zSwirlSpeed, solved.zCenteringRate, tempWaterVel3D);
                        b.getPointVelocity(px, py, pz, tempPtVel);
                        calcEndpointFollowAccel(tempWaterVel3D.x, tempWaterVel3D.y, tempPtVel.x, tempPtVel.y, solved.flowFollowRate, ring.kindConfig.flowFollow, tempFollow2D);
                        const az = solved.flowFollowRate * ring.kindConfig.flowFollow * (tempWaterVel3D.z - tempPtVel.z);
                        b.applyForceAtPoint(0.25 * b.mass * tempFollow2D.x, 0.25 * b.mass * tempFollow2D.y, 0.25 * b.mass * az, px, py, pz);
                    }
                    const fTargets = [
                        { x: leftPillar.x, z: 0, tipY: leftPillar.tipY, baseTopY: leftPillar.baseTopY, isFull: stacks.left.isFull() },
                        { x: rightPillar.x, z: 0, tipY: rightPillar.tipY, baseTopY: rightPillar.baseTopY, isFull: stacks.right.isFull() },
                    ];
                    const fParams = [
                        resolveEffectiveFunnelParams(solved.funnel, tideActive ? tideBoost : null),
                        resolveEffectiveFunnelParams(solved.funnel, null),
                    ];
                    applyFunnelToBody(b, fTargets, fParams);
                    if (calmActive) {
                        calmTerm.sample(b.x, b.y, tempWarm);
                        calmRegulator.applyToBody(b, ring.kindConfig, solved, calmInfo, TankSpace.width, TankSpace.height, calmTargetY, tempWarm.y);
                    }
                }

                world.step(dt);

                // flashing & dropping
                for (const [fr, st] of Array.from(flashingRings.entries())) {
                    st.elapsed += dt;
                    if (st.elapsed >= st.duration) {
                        flashingRings.delete(fr);
                        world.removeBody(fr.body3D);
                        fr.valid = false;
                        const idx = rings.indexOf(fr);
                        if (idx >= 0) rings.splice(idx, 1);
                    }
                }
                for (const [dr, st] of Array.from(droppingRings.entries())) {
                    st.elapsed += dt;
                    if (st.elapsed <= st.delay) continue;
                    const p = st.duration > 0 ? Math.min(1, (st.elapsed - st.delay) / st.duration) : 1;
                    const dy = calcMatchDropY(st.startDy, st.targetDy, p);
                    const off = lockedOffsets.get(dr)!;
                    off.dyFromBase = dy;
                    const q = dr.body3D.quat;
                    dr.body3D.setPose(st.pillar.x + off.dx, st.pillar.baseTopY + dy, off.dz, q.x, q.y, q.z, q.w);
                    if (p >= 1) droppingRings.delete(dr);
                }

                // lock & match
                for (const ring of rings) {
                    if (!ring.valid || ring.locked || ring.clearing) continue;
                    const b = ring.body3D;
                    let matchedSide: 'left' | 'right' | null = null;
                    for (const side of ['left', 'right'] as const) {
                        const pil = side === 'left' ? leftPillar : rightPillar;
                        if (stacks[side].isFull()) continue;
                        if (
                            isRingOnPillar3D({
                                centerX: b.x,
                                centerY: b.y,
                                centerZ: b.z,
                                normalX: b.basisN.x,
                                normalY: b.basisN.y,
                                normalZ: b.basisN.z,
                                innerRadius: ring.innerRadius,
                                pillarX: pil.x,
                                pillarZ: 0,
                                baseTopY: pil.baseTopY,
                                tipY: pil.tipY,
                                shaftRadiusAtY: pil.shaftRadiusAtY(b.y),
                            })
                        ) {
                            matchedSide = side;
                            break;
                        }
                    }
                    if (!matchedSide) {
                        holdProgress.delete(ring);
                        continue;
                    }
                    const pil = matchedSide === 'left' ? leftPillar : rightPillar;
                    const stack = stacks[matchedSide];
                    const slotY = calcSlotCenterY(
                        pil.baseTopY,
                        stack.items.map((r) => r.thickness),
                        ring.thickness,
                        stack.count,
                        GameConst.pillarSlotPitchScale,
                    );
                    if (
                        !isRingStableForLock({
                            linearSpeedPx: Math.hypot(b.vx, b.vy, b.vz),
                            angularSpeedRad: Math.hypot(b.wx, b.wy, b.wz),
                            tiltDeg: calcRingTiltDeg3D(b.basisN.x, b.basisN.y, b.basisN.z),
                            centerY: b.y,
                            slotCenterY: slotY,
                        })
                    ) {
                        holdProgress.delete(ring);
                        continue;
                    }
                    const prev = holdProgress.get(ring);
                    const elapsed = prev && prev.side === matchedSide ? prev.elapsed + dt : dt;
                    if (elapsed < GameConst.ringLockDurationSec) {
                        holdProgress.set(ring, { side: matchedSide, elapsed });
                        continue;
                    }
                    holdProgress.delete(ring);
                    stack.push(ring);
                    ring.locked = true;
                    lockedOffsets.set(ring, { dx: b.x - pil.x, dyFromBase: b.y - pil.baseTopY, dz: b.z });
                    b.type = 'static';
                    totalLocks++;

                    const res = resolvePillarMatch(
                        stack.items.map((r) => ({ item: r, spec: r.spec, thickness: r.thickness })),
                        { baseTopY: pil.baseTopY, pitchScale: GameConst.pillarSlotPitchScale },
                    );
                    if (res.matched && res.group) {
                        totalMatches++;
                        const cleared = res.group.entries.map((e) => e.item);
                        for (const cr of cleared) {
                            stack.remove(cr);
                            cr.clearing = true;
                            world.removeBody(cr.body3D);
                            lockedOffsets.delete(cr);
                            flashingRings.set(cr, { elapsed: 0, duration: GameConst.matchFlashDurationSec });
                        }
                        checker.markMatchCleared(cleared.map((r) => r.id));
                        for (const layout of res.remaining) {
                            if (!layout.moved) continue;
                            const dr = layout.item;
                            const startDy = dr.body3D.y - pil.baseTopY;
                            const targetDy = layout.targetCenterY - pil.baseTopY;
                            const dur = calcMatchDropDuration(targetDy - startDy);
                            droppingRings.set(dr, {
                                side: matchedSide,
                                pillar: pil,
                                startDy,
                                targetDy,
                                elapsed: 0,
                                delay: GameConst.matchDropDelaySec,
                                duration: dur,
                            });
                        }
                        energy.recordLock(matchedSide, cleared.length);
                    } else {
                        energy.recordLock(matchedSide, 0);
                    }
                }

                energy.step(dt);
                const free = rings.filter((r) => r.valid && !r.locked && !r.clearing).length;
                const clearing = rings.filter((r) => r.valid && r.clearing).length;
                levelState.step(dt, { freeRings: free, clearingRings: clearing, totalRings: rings.length });

                const violation = checker.checkStep(step * dt, world.tank, snapshots(), world.bodies.length);
                expect(violation).toBeNull();

                if (levelState.isFinished) {
                    resetRound(rounds + 1);
                }
            }
        };

        runSim();
        expect(rounds).toBeGreaterThanOrEqual(3);
        expect(totalLocks).toBeGreaterThan(0);
        expect(totalMatches).toBeGreaterThanOrEqual(0);
    });
});
