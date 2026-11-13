import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const rootDir = process.cwd();
const moduleCache = new Map();

function loadTsModule(filePath) {
    const absPath = resolve(filePath);
    if (moduleCache.has(absPath)) {
        return moduleCache.get(absPath).exports;
    }

    const source = readFileSync(absPath, 'utf8');
    const transpiled = ts.transpileModule(source, {
        fileName: absPath,
        compilerOptions: {
            target: ts.ScriptTarget.ES2019,
            module: ts.ModuleKind.CommonJS,
            esModuleInterop: true,
        },
        reportDiagnostics: false,
    });

    const mod = { exports: {} };
    moduleCache.set(absPath, mod);

    const localRequire = (specifier) => {
        if (!specifier.startsWith('.')) {
            return require(specifier);
        }
        const base = resolve(dirname(absPath), specifier);
        const candidates = [base, `${base}.ts`, `${base}.js`, join(base, 'index.ts')];
        for (const candidate of candidates) {
            if (existsSync(candidate)) {
                return candidate.endsWith('.ts') ? loadTsModule(candidate) : require(candidate);
            }
        }
        throw new Error(`无法解析模块引用: ${specifier} (来自 ${absPath})`);
    };

    const wrapped = `(function (exports, require, module, __filename, __dirname) {\n${transpiled.outputText}\n})`;
    const fn = vm.runInThisContext(wrapped, { filename: absPath });
    fn(mod.exports, localRequire, mod, absPath, dirname(absPath));
    return mod.exports;
}

function parseCliArgs(argv) {
    const opts = {
        levelId: 'X03',
        targetSec: 1800,
        botSeed: 2026001,
        wallTolPx: 10,
    };
    for (const arg of argv) {
        if (arg.startsWith('--level=')) {
            opts.levelId = arg.slice('--level='.length);
        } else if (arg.startsWith('--sec=')) {
            const n = Number(arg.slice('--sec='.length));
            if (Number.isFinite(n) && n > 0) opts.targetSec = n;
        } else if (arg.startsWith('--seed=')) {
            const n = Number(arg.slice('--seed='.length));
            if (Number.isFinite(n)) opts.botSeed = Math.floor(n) >>> 0;
        }
    }
    return opts;
}

function main() {
    const args = parseCliArgs(process.argv.slice(2));
    const core = (rel) => loadTsModule(join(rootDir, 'assets', 'scripts', rel));

    const { DEFAULT_FEEL_CONFIG } = core('config/FeelConfig.ts');
    const { calcRingPillarGeometry, GameConst } = core('config/GameConst.ts');
    const { TankSpace } = core('config/TankSpace.ts');
    const { solveFeel } = core('core/flow/FeelSolver.ts');
    const { FlowField } = core('core/flow/FlowField.ts');
    const { buildTidePullFunnelBoost, TidePullFlowTerm } = core('core/flow/TidePullFlow.ts');
    const { CalmSeaFlowTerm, CalmSeaRingRegulator, computeCalmSeaTargetY } = core('core/flow/CalmSeaFlow.ts');
    const { calcEndpointFollowAccel } = core('core/flow/WaterFollow.ts');
    const { Bladder } = core('core/input/Bladder.ts');
    const { resolvePillarEnergyEnabled } = core('core/level/LevelData.ts');
    const { resolveLevelRingLayout } = core('core/level/LevelRingLayout.ts');
    const { LevelState } = core('core/level/LevelState.ts');
    const { validateLevel } = core('core/level/validateLevel.ts');
    const { quatFromEulerDeg } = core('core/physics3d/Math3D.ts');
    const { PillarCollider3D } = core('core/physics3d/PillarCollider3D.ts');
    const { TorusBody3D } = core('core/physics3d/TorusBody3D.ts');
    const { TorusWorld3D } = core('core/physics3d/TorusWorld3D.ts');
    const { getRingKindConfig } = core('core/rings/RingKinds.ts');
    const { PillarEnergy } = core('core/rules/Energy.ts');
    const { applyFunnelToBody, resolveEffectiveFunnelParams } = core('core/rules/FunnelMath.ts');
    const {
        calcMatchDropDuration,
        calcMatchDropY,
        resolvePillarMatch,
        shouldDeferPillarMatch,
    } = core('core/rules/MatchRule.ts');
    const {
        calcRingTiltDeg3D,
        calcSlotCenterY,
        isRingOnPillar3D,
        isRingStableForLock,
        PillarStack,
    } = core('core/rules/PillarStack.ts');
    const {
        buildSoakBotTankHint,
        formatSoakElapsed,
        SoakBotInputGenerator,
        SoakInvariantChecker,
    } = core('core/rules/SoakBotCore.ts');

    const levelPath = join(rootDir, 'assets', 'resources', 'levels', `${args.levelId}.json`);
    const levelJson = JSON.parse(readFileSync(levelPath, 'utf8'));
    const validation = validateLevel(levelJson);
    if (!validation.valid || !validation.level) {
        console.error(`[soak] 关卡 ${args.levelId} 校验失败:`, validation.errors);
        process.exit(1);
    }
    const level = validation.level;

    const solved = solveFeel(DEFAULT_FEEL_CONFIG);
    const geom = calcRingPillarGeometry(TankSpace.width);
    const leftPillarX = TankSpace.pctToPxX(DEFAULT_FEEL_CONFIG.pillarPosPct);
    const rightPillarX = TankSpace.pctToPxX(100 - DEFAULT_FEEL_CONFIG.pillarPosPct);
    const tailBottomY = TankSpace.pctToPxY(DEFAULT_FEEL_CONFIG.pillarBottomPct);

    const botInput = new SoakBotInputGenerator(args.botSeed);
    const checker = new SoakInvariantChecker({ wallTolerancePx: args.wallTolPx });

    const dt = 1 / 60;
    const totalSteps = Math.round(args.targetSec / dt);

    const stats = {
        rounds: 0,
        wins: 0,
        losses: 0,
        locks: 0,
        matches: 0,
        clearedRings: 0,
        chainMatches: 0,
        tidePullTriggers: 0,
        calmSeaTriggers: 0,
        maxSimultaneousActiveDrops: 0,
    };

    const tempWaterVel3D = { x: 0, y: 0, z: 0 };
    const tempPtVel = { x: 0, y: 0, z: 0 };
    const tempFollow2D = { x: 0, y: 0 };
    const tempWarm = { x: 0, y: 0 };
    const tempQuat = { x: 0, y: 0, z: 0, w: 1 };
    const samplePts = [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
    ];
    const sampleAccels = [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
    ];

    const startWallMs = Date.now();
    let simTimeSec = 0;

    let world;
    let leftPillar;
    let rightPillar;
    let leftBladder;
    let rightBladder;
    let flowField;
    let energy;
    let tideTerm;
    let calmTerm;
    let calmRegulator;
    let tideActive;
    let calmActive;
    let calmTargetY;
    let stacks;
    let holdProgress;
    let lockedOffsets;
    let flashingRings;
    let droppingRings;
    let matchDeferElapsed;
    let levelState;
    let rings;

    const tideBoost = buildTidePullFunnelBoost();
    const funnelTargets = [
        { x: 0, z: 0, tipY: 0, baseTopY: 0, isFull: false },
        { x: 0, z: 0, tipY: 0, baseTopY: 0, isFull: false },
    ];
    const funnelParams = [
        { radiusPx: 0, maxAngleDeg: 0, pullAccel: 0, alignRate: 0, maxVy: 0 },
        { radiusPx: 0, maxAngleDeg: 0, pullAccel: 0, alignRate: 0, maxVy: 0 },
    ];

    function initRound(roundIndex) {
        stats.rounds++;
        world = new TorusWorld3D(TankSpace.width, TankSpace.height);
        leftPillar = world.addPillar(new PillarCollider3D(leftPillarX, tailBottomY, geom));
        rightPillar = world.addPillar(new PillarCollider3D(rightPillarX, tailBottomY, geom));

        leftBladder = new Bladder({}, DEFAULT_FEEL_CONFIG);
        rightBladder = new Bladder({}, DEFAULT_FEEL_CONFIG);
        flowField = new FlowField({ seed: level.seed }, DEFAULT_FEEL_CONFIG);

        const energySwitch = resolvePillarEnergyEnabled(level);
        energy = new PillarEnergy({ enabled: energySwitch });
        tideTerm = new TidePullFlowTerm();
        calmTerm = new CalmSeaFlowTerm();
        calmRegulator = new CalmSeaRingRegulator();
        tideActive = false;
        calmActive = false;

        const outerR = geom.ringOuterDiameter * 0.5;
        const calmPillarsInfo = [
            { x: leftPillar.x, z: 0, baseTopY: leftPillar.baseTopY, tipY: leftPillar.tipY, isFull: false },
            { x: rightPillar.x, z: 0, baseTopY: rightPillar.baseTopY, tipY: rightPillar.tipY, isFull: false },
        ];
        calmTargetY = computeCalmSeaTargetY(calmPillarsInfo, outerR, TankSpace.height, calmTerm.config);

        energy.onSkillTrigger((ev) => {
            if (ev.side === 'left') {
                stats.tidePullTriggers++;
                tideActive = true;
                tideTerm.activate(leftPillar.x, leftPillar.tipY);
                flowField.addTerm(tideTerm);
            } else {
                stats.calmSeaTriggers++;
                calmActive = true;
                calmRegulator.reset();
                calmTerm.activate(calmTargetY, TankSpace.height);
                flowField.addTerm(calmTerm);
                flowField.setFlowSuppression(calmTerm.config.turbulenceScale, calmTerm.config.circulationScale);
            }
        });

        energy.onChange((snap) => {
            if (snap.side === 'left' && tideActive && (!snap.skillActive || !snap.enabled)) {
                tideActive = false;
                tideTerm.deactivate();
                flowField.removeTerm(tideTerm);
            }
            if (snap.side === 'right' && calmActive && (!snap.skillActive || !snap.enabled)) {
                calmActive = false;
                calmTerm.deactivate();
                flowField.removeTerm(calmTerm);
                flowField.clearFlowSuppression();
                calmRegulator.reset();
            }
        });

        stacks = {
            left: new PillarStack(GameConst.pillarCapacity),
            right: new PillarStack(GameConst.pillarCapacity),
        };
        holdProgress = new Map();
        lockedOffsets = new Map();
        flashingRings = new Map();
        droppingRings = new Map();
        matchDeferElapsed = { left: 0, right: 0 };

        const spawns = resolveLevelRingLayout(level.rings, {
            seed: level.seed + roundIndex - 1,
            pillarPosPct: DEFAULT_FEEL_CONFIG.pillarPosPct,
            pillarBottomPct: DEFAULT_FEEL_CONFIG.pillarBottomPct,
            startPillarDropChance: GameConst.startPillarDropChance,
        });

        rings = spawns.map((s) => {
            const kindCfg = getRingKindConfig(s.spec);
            const outerD = geom.ringOuterDiameter * kindCfg.sizeScale;
            const thick = geom.ringThickness * kindCfg.sizeScale;
            const tubeR = thick * 0.5;
            const majorR = outerD * 0.5 - tubeR;
            const innerR = Math.max(4, outerD - thick * 2) * 0.5;
            quatFromEulerDeg(s.pitchXDeg, s.yawYDeg, s.rollZDeg, tempQuat);

            const body = world.addBody(
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
                    mass: Math.max(0.25, kindCfg.sinkScale),
                    linearDamping: solved.ringLinearDamping,
                    angularDamping: solved.ringAngularDamping,
                    friction: solved.ringFriction,
                    restitution: solved.ringRestitution,
                    type: 'dynamic',
                }),
            );

            return {
                id: body.id,
                spec: s.spec,
                kindConfig: kindCfg,
                dimensions: {
                    outerDiameter: outerD,
                    thickness: thick,
                    innerRadius: innerR,
                    majorRadius: majorR,
                    tubeRadius: tubeR,
                },
                body3D: body,
                locked: false,
                clearing: false,
                valid: true,
            };
        });

        levelState = new LevelState({
            durationSec: level.durationSec,
            initialFreeRings: rings.length,
        });
        levelState.start();
        botInput.clearPending();
        checker.beginRound(roundIndex, level.id, buildSnapshots());
    }

    function buildSnapshots() {
        const out = [];
        for (let i = 0; i < rings.length; i++) {
            const r = rings[i];
            if (!r.valid) continue;
            const drop = droppingRings.get(r);
            out.push({
                id: r.id,
                kind: r.spec.kind,
                color: r.spec.color,
                locked: r.locked,
                clearing: r.clearing,
                isDropping: Boolean(drop),
                dropTargetY: drop ? drop.pillar.baseTopY + drop.targetDyFromBase : undefined,
                body: r.body3D,
            });
        }
        return out;
    }

    function findMatchingPillar3D(ring) {
        const b = ring.body3D;
        for (const side of ['left', 'right']) {
            const pillar = side === 'left' ? leftPillar : rightPillar;
            if (stacks[side].isFull()) continue;
            if (
                isRingOnPillar3D({
                    centerX: b.x,
                    centerY: b.y,
                    centerZ: b.z,
                    normalX: b.basisN.x,
                    normalY: b.basisN.y,
                    normalZ: b.basisN.z,
                    innerRadius: ring.dimensions.innerRadius,
                    pillarX: pillar.x,
                    pillarZ: 0,
                    baseTopY: pillar.baseTopY,
                    tipY: pillar.tipY,
                    shaftRadiusAtY: pillar.shaftRadiusAtY(b.y),
                })
            ) {
                return { side, pillar };
            }
        }
        return null;
    }

    function findIncomingTipPillar3D(ring) {
        const b = ring.body3D;
        if (b.vy > 20) return null;
        for (const side of ['left', 'right']) {
            const pillar = side === 'left' ? leftPillar : rightPillar;
            if (stacks[side].isFull()) continue;
            if (b.y < pillar.tipY - 4 || b.y > pillar.tipY + ring.dimensions.outerDiameter * 0.75) {
                continue;
            }
            const radialDistXZ = Math.hypot(b.x - pillar.x, b.z);
            if (radialDistXZ <= ring.dimensions.innerRadius + 10) {
                return { side, pillar };
            }
        }
        return null;
    }

    function stepAfterScoreJudge() {
        // 1. flashing
        for (const [ring, state] of Array.from(flashingRings.entries())) {
            state.elapsed += dt;
            if (state.elapsed >= state.duration) {
                flashingRings.delete(ring);
                world.removeBody(ring.body3D);
                ring.valid = false;
                const idx = rings.indexOf(ring);
                if (idx >= 0) rings.splice(idx, 1);
            }
        }

        // 2. dropping
        const finishedDropSides = new Set();
        for (const [ring, state] of Array.from(droppingRings.entries())) {
            if (!ring.valid || ring.clearing) {
                droppingRings.delete(ring);
                continue;
            }
            state.elapsed += dt;
            if (state.elapsed <= state.delay) continue;
            const activeElapsed = state.elapsed - state.delay;
            const progress = state.duration > 0 ? Math.min(1, activeElapsed / state.duration) : 1;
            const nextDy = calcMatchDropY(state.startDyFromBase, state.targetDyFromBase, progress);
            const off = lockedOffsets.get(ring);
            const dx = off ? off.dx : ring.body3D.x - state.pillar.x;
            const dz = off ? off.dz : ring.body3D.z;
            if (off) {
                off.dyFromBase = nextDy;
            } else {
                lockedOffsets.set(ring, { dx, dyFromBase: nextDy, dz });
            }
            const q = ring.body3D.quat;
            ring.body3D.setPose(state.pillar.x + dx, state.pillar.baseTopY + nextDy, dz, q.x, q.y, q.z, q.w);

            if (progress >= 1) {
                droppingRings.delete(ring);
                finishedDropSides.add(state.side);
            }
        }

        const onPillarBySide = { left: [], right: [] };
        const tipIncomingBySide = { left: [], right: [] };
        const pendingBySide = { left: [], right: [] };

        for (let i = 0; i < rings.length; i++) {
            const ring = rings[i];
            if (!ring.valid || ring.locked || ring.clearing) {
                holdProgress.delete(ring);
                continue;
            }
            const matched = findMatchingPillar3D(ring);
            if (matched) {
                onPillarBySide[matched.side].push(ring);
                continue;
            }
            holdProgress.delete(ring);
            const incoming = findIncomingTipPillar3D(ring);
            if (incoming) {
                tipIncomingBySide[incoming.side].push(ring);
            }
        }

        for (const side of ['left', 'right']) {
            const pillar = side === 'left' ? leftPillar : rightPillar;
            const onPillar = onPillarBySide[side];
            if (onPillar.length === 0) continue;

            onPillar.sort((a, b) => a.body3D.y - b.body3D.y);
            const stack = stacks[side];
            const baseThicknesses = stack.items.map((r) => r.dimensions.thickness);

            for (let i = 0; i < onPillar.length; i++) {
                const ring = onPillar[i];
                const physicalSlotIndex = stack.count + i;
                if (physicalSlotIndex >= GameConst.pillarCapacity) {
                    holdProgress.delete(ring);
                    continue;
                }
                const combined = baseThicknesses.slice();
                for (let k = 0; k < i; k++) combined.push(onPillar[k].dimensions.thickness);
                const slotCenterY = calcSlotCenterY(
                    pillar.baseTopY,
                    combined,
                    ring.dimensions.thickness,
                    physicalSlotIndex,
                    GameConst.pillarSlotPitchScale,
                );
                const b = ring.body3D;
                if (
                    !isRingStableForLock({
                        linearSpeedPx: Math.hypot(b.vx, b.vy, b.vz),
                        angularSpeedRad: Math.hypot(b.wx, b.wy, b.wz),
                        tiltDeg: calcRingTiltDeg3D(b.basisN.x, b.basisN.y, b.basisN.z),
                        centerY: b.y,
                        slotCenterY,
                    })
                ) {
                    holdProgress.delete(ring);
                    continue;
                }
                const prev = holdProgress.get(ring);
                const elapsed = prev && prev.side === side ? prev.elapsed + dt : dt;
                if (elapsed < GameConst.ringLockDurationSec) {
                    holdProgress.set(ring, { side, elapsed });
                    continue;
                }
                holdProgress.delete(ring);
                pendingBySide[side].push({ ring, pillar, slotCenterY });
            }
        }

        for (const side of ['left', 'right']) {
            const pillar = side === 'left' ? leftPillar : rightPillar;
            const stack = stacks[side];
            const pending = pendingBySide[side];
            const lockedBatch = [];

            if (pending.length > 0) {
                pending.sort((a, b) => a.ring.body3D.y - b.ring.body3D.y);
                for (const item of pending) {
                    let insertIdx = 0;
                    while (insertIdx < stack.items.length && stack.items[insertIdx].body3D.y <= item.ring.body3D.y) {
                        insertIdx++;
                    }
                    const slotIndex = stack.insertAt(insertIdx, item.ring);
                    if (slotIndex < 0) continue;

                    item.ring.locked = true;
                    const b = item.ring.body3D;
                    lockedOffsets.set(item.ring, {
                        dx: b.x - pillar.x,
                        dyFromBase: b.y - pillar.baseTopY,
                        dz: b.z,
                    });
                    b.type = 'static';
                    stats.locks++;
                    lockedBatch.push({ ring: item.ring, slotIndex });
                    const idx = onPillarBySide[side].indexOf(item.ring);
                    if (idx >= 0) onPillarBySide[side].splice(idx, 1);
                }
                if (lockedBatch.length > 0) matchDeferElapsed[side] = 0;
            }

            let hasDrops = false;
            for (const st of droppingRings.values()) {
                if (st.side === side) {
                    hasDrops = true;
                    break;
                }
            }
            const dropFinished = finishedDropSides.has(side);
            if (lockedBatch.length === 0 && !dropFinished && stack.count < 2) {
                matchDeferElapsed[side] = 0;
                continue;
            }

            let matchResult = null;
            if (!hasDrops && stack.count >= 2) {
                const topLocked = lockedBatch.length > 0 ? lockedBatch[lockedBatch.length - 1].ring : null;
                const entries = stack.items.map((r) => ({
                    item: r,
                    spec: r.spec,
                    thickness: r.dimensions.thickness,
                }));
                const preferredIndex = topLocked ? stack.indexOf(topLocked) : -1;
                const res = resolvePillarMatch(entries, {
                    baseTopY: pillar.baseTopY,
                    pitchScale: GameConst.pillarSlotPitchScale,
                    preferredIndex: preferredIndex >= 0 ? preferredIndex : undefined,
                });

                if (res.matched && res.group) {
                    const touchesTop = res.group.indices[res.group.indices.length - 1] === stack.count - 1;
                    const pendingCands = onPillarBySide[side].map((r) => ({
                        spec: r.spec,
                        thickness: r.dimensions.thickness,
                        y: r.body3D.y,
                        lockedIndex: -1,
                    }));
                    if (touchesTop) {
                        for (const r of tipIncomingBySide[side]) {
                            pendingCands.push({
                                spec: r.spec,
                                thickness: r.dimensions.thickness,
                                y: r.body3D.y,
                                lockedIndex: -1,
                            });
                        }
                    }
                    const lockedCands = stack.items.map((r, idx) => ({
                        spec: r.spec,
                        thickness: r.dimensions.thickness,
                        y: r.body3D.y,
                        lockedIndex: idx,
                    }));
                    if (
                        matchDeferElapsed[side] < GameConst.matchDeferMaxSec &&
                        shouldDeferPillarMatch(lockedCands, pendingCands, res.group.indices)
                    ) {
                        matchDeferElapsed[side] += dt;
                    } else {
                        matchDeferElapsed[side] = 0;
                        const clearedRings = res.group.entries.map((e) => e.item);
                        for (const cr of clearedRings) {
                            stack.remove(cr);
                            cr.locked = true;
                            cr.clearing = true;
                            world.removeBody(cr.body3D);
                            holdProgress.delete(cr);
                            lockedOffsets.delete(cr);
                            droppingRings.delete(cr);
                            flashingRings.set(cr, {
                                ring: cr,
                                elapsed: 0,
                                duration: GameConst.matchFlashDurationSec,
                            });
                        }
                        checker.markMatchCleared(clearedRings.map((r) => r.id));
                        stats.matches++;
                        stats.clearedRings += clearedRings.length;
                        if (lockedBatch.length === 0) stats.chainMatches++;

                        for (const layout of res.remaining) {
                            if (!layout.moved) continue;
                            const dropRing = layout.item;
                            const startDy = dropRing.body3D.y - pillar.baseTopY;
                            const targetDy = layout.targetCenterY - pillar.baseTopY;
                            const dur = calcMatchDropDuration(targetDy - startDy);
                            if (dur <= 0) {
                                const off = lockedOffsets.get(dropRing);
                                const dx = off ? off.dx : dropRing.body3D.x - pillar.x;
                                const dz = off ? off.dz : dropRing.body3D.z;
                                const q = dropRing.body3D.quat;
                                dropRing.body3D.setPose(pillar.x + dx, pillar.baseTopY + targetDy, dz, q.x, q.y, q.z, q.w);
                                if (off) off.dyFromBase = targetDy;
                            } else {
                                droppingRings.set(dropRing, {
                                    ring: dropRing,
                                    side,
                                    pillar,
                                    startDyFromBase: startDy,
                                    targetDyFromBase: targetDy,
                                    elapsed: 0,
                                    delay: GameConst.matchDropDelaySec,
                                    duration: dur,
                                });
                            }
                        }
                        matchResult = { clearedRings, matchCount: clearedRings.length, isChain: lockedBatch.length === 0 };
                    }
                } else {
                    matchDeferElapsed[side] = 0;
                }
            }

            if (lockedBatch.length > 0) {
                let creditRing = null;
                if (matchResult) {
                    for (let i = lockedBatch.length - 1; i >= 0; i--) {
                        if (matchResult.clearedRings.includes(lockedBatch[i].ring)) {
                            creditRing = lockedBatch[i].ring;
                            break;
                        }
                    }
                }
                for (const locked of lockedBatch) {
                    const isCredit = matchResult !== null && locked.ring === creditRing;
                    energy.recordLock(side, isCredit ? matchResult.matchCount : 0);
                }
            }
            if (matchResult && matchResult.isChain) {
                energy.recordMatchBonus(side, matchResult.matchCount);
            }
        }

        if (droppingRings.size > stats.maxSimultaneousActiveDrops) {
            stats.maxSimultaneousActiveDrops = droppingRings.size;
        }
    }

    initRound(1);

    for (let step = 1; step <= totalSteps; step++) {
        // 1. Bot 按键（结合轻量当前分布提示与 SeededRandom 拟真序列）
        const snapshotsBefore = buildSnapshots();
        const botHint = buildSoakBotTankHint(snapshotsBefore, TankSpace.width, [
            { x: leftPillar.x, baseTopY: leftPillar.baseTopY, tipY: leftPillar.tipY, isFull: stacks.left.isFull() },
            { x: rightPillar.x, baseTopY: rightPillar.baseTopY, tipY: rightPillar.tipY, isFull: stacks.right.isFull() },
        ]);
        const input = botInput.step(dt, botHint);
        leftBladder.setPressed(input.leftPressed);
        rightBladder.setPressed(input.rightPressed);

        // 2. BeforeStep: 下沉力 + WaterForce + Funnel + TidePull + CalmSea
        flowField.setJetInputs(leftBladder.output, rightBladder.output);
        flowField.step(dt);
        leftBladder.step(dt);
        rightBladder.step(dt);

        if (tideActive) {
            tideTerm.suppressed = stacks.left.isFull();
        }

        const calmPillarsInfo = [
            { x: leftPillar.x, z: 0, baseTopY: leftPillar.baseTopY, tipY: leftPillar.tipY, isFull: stacks.left.isFull() },
            { x: rightPillar.x, z: 0, baseTopY: rightPillar.baseTopY, tipY: rightPillar.tipY, isFull: stacks.right.isFull() },
        ];

        for (let i = 0; i < rings.length; i++) {
            const ring = rings[i];
            if (!ring.valid || ring.locked || ring.clearing) continue;
            const b = ring.body3D;

            // 下沉力
            const sinkAccel = solved.baseSinkAccel * ring.kindConfig.sinkScale;
            b.applyCentralForce(0, -b.mass * sinkAccel, 0);

            // 缸底 z=0 微回中
            if (b.y < b.outerRadius * 1.35) {
                b.applyCentralForce(0, 0, -b.z * b.mass * 5.5);
            }

            // 4 点三维水力 + 迎水力矩
            const R = b.majorRadius;
            samplePts[0].x = b.x + b.basisU.x * R;
            samplePts[0].y = b.y + b.basisU.y * R;
            samplePts[0].z = b.z + b.basisU.z * R;
            samplePts[1].x = b.x - b.basisU.x * R;
            samplePts[1].y = b.y - b.basisU.y * R;
            samplePts[1].z = b.z - b.basisU.z * R;
            samplePts[2].x = b.x + b.basisV.x * R;
            samplePts[2].y = b.y + b.basisV.y * R;
            samplePts[2].z = b.z + b.basisV.z * R;
            samplePts[3].x = b.x - b.basisV.x * R;
            samplePts[3].y = b.y - b.basisV.y * R;
            samplePts[3].z = b.z - b.basisV.z * R;

            const effRate = Math.max(0, solved.flowFollowRate * ring.kindConfig.flowFollow);
            let avgAx = 0;
            let avgAy = 0;
            let avgAz = 0;
            for (let k = 0; k < 4; k++) {
                const pt = samplePts[k];
                const acc = sampleAccels[k];
                flowField.velocityAt3D(
                    pt.x,
                    pt.y,
                    pt.z,
                    world.tank.halfDepth,
                    solved.zSwirlSpeed,
                    solved.zCenteringRate,
                    tempWaterVel3D,
                );
                b.getPointVelocity(pt.x, pt.y, pt.z, tempPtVel);
                calcEndpointFollowAccel(
                    tempWaterVel3D.x,
                    tempWaterVel3D.y,
                    tempPtVel.x,
                    tempPtVel.y,
                    solved.flowFollowRate,
                    ring.kindConfig.flowFollow,
                    tempFollow2D,
                );
                acc.x = tempFollow2D.x;
                acc.y = tempFollow2D.y;
                acc.z = effRate * (tempWaterVel3D.z - tempPtVel.z);
                avgAx += acc.x;
                avgAy += acc.y;
                avgAz += acc.z;
            }
            avgAx *= 0.25;
            avgAy *= 0.25;
            avgAz *= 0.25;

            const qMass = 0.25 * b.mass;
            const torqueScale = solved.tumbleTorqueScale;
            for (let k = 0; k < 4; k++) {
                const pt = samplePts[k];
                const acc = sampleAccels[k];
                const ax = avgAx + torqueScale * (acc.x - avgAx);
                const ay = avgAy + torqueScale * (acc.y - avgAy);
                const az = avgAz + torqueScale * (acc.z - avgAz);
                b.applyForceAtPoint(qMass * ax, qMass * ay, qMass * az, pt.x, pt.y, pt.z);
            }

            const relVx = tempWaterVel3D.x - b.vx;
            const relVy = tempWaterVel3D.y - b.vy;
            const relVz = tempWaterVel3D.z - b.vz;
            const relSpd = Math.hypot(relVx, relVy, relVz);
            if (relSpd > 25 && torqueScale > 0.05) {
                const dotN = (relVx * b.basisN.x + relVy * b.basisN.y + relVz * b.basisN.z) / relSpd;
                const cx = b.basisN.y * relVz - b.basisN.z * relVy;
                const cy = b.basisN.z * relVx - b.basisN.x * relVz;
                const cz = b.basisN.x * relVy - b.basisN.y * relVx;
                const flutterGain = 0.22 * b.mass * R * dotN * torqueScale;
                b.applyTorque(cx * flutterGain, cy * flutterGain, cz * flutterGain);
            }

            // Funnel
            let eligibleCount = 0;
            if (!stacks.left.isFull()) {
                funnelTargets[eligibleCount].x = leftPillar.x;
                funnelTargets[eligibleCount].z = 0;
                funnelTargets[eligibleCount].tipY = leftPillar.tipY;
                funnelTargets[eligibleCount].baseTopY = leftPillar.baseTopY;
                funnelTargets[eligibleCount].isFull = false;
                resolveEffectiveFunnelParams(solved.funnel, tideActive ? tideBoost : null, funnelParams[eligibleCount]);
                eligibleCount++;
            }
            if (!stacks.right.isFull()) {
                funnelTargets[eligibleCount].x = rightPillar.x;
                funnelTargets[eligibleCount].z = 0;
                funnelTargets[eligibleCount].tipY = rightPillar.tipY;
                funnelTargets[eligibleCount].baseTopY = rightPillar.baseTopY;
                funnelTargets[eligibleCount].isFull = false;
                resolveEffectiveFunnelParams(solved.funnel, null, funnelParams[eligibleCount]);
                eligibleCount++;
            }
            if (eligibleCount > 0) {
                applyFunnelToBody(b, funnelTargets, funnelParams, eligibleCount);
            }

            // CalmSea
            if (calmActive) {
                calmTerm.sample(b.x, b.y, tempWarm);
                calmRegulator.applyToBody(
                    b,
                    ring.kindConfig,
                    solved,
                    calmPillarsInfo,
                    TankSpace.width,
                    TankSpace.height,
                    calmTargetY,
                    tempWarm.y,
                );
            }
        }

        // 3. 物理步
        world.step(dt);
        simTimeSec = step * dt;

        // 4. AfterStep: 判定/消除/充能/关卡状态
        stepAfterScoreJudge();
        energy.step(dt);

        let freeRings = 0;
        let clearingRings = 0;
        for (let i = 0; i < rings.length; i++) {
            const r = rings[i];
            if (!r.valid) continue;
            if (r.clearing) clearingRings++;
            else if (!r.locked) freeRings++;
        }
        levelState.step(dt, { freeRings, clearingRings, totalRings: rings.length });

        // 5. 四项不变量严格检查
        const violation = checker.checkStep(simTimeSec, world.tank, buildSnapshots(), world.bodies.length);
        if (violation) {
            console.error(
                `[soak] FAIL @ ${formatSoakElapsed(violation.simTimeSec)} (${violation.simTimeSec.toFixed(2)}s, step=${step})`,
            );
            console.error(`  规则: ${violation.ruleLabel} (${violation.rule})`);
            console.error(`  关卡/局数: ${violation.levelId} 第 ${violation.roundIndex} 局`);
            console.error(`  目标圈: ${violation.ringDesc}`);
            console.error(`  详情: ${violation.detail}`);
            process.exit(1);
        }

        // 6. 过关或失败后自动重开
        if (levelState.isFinished) {
            if (levelState.status === 'won') stats.wins++;
            else stats.losses++;
            initRound(stats.rounds + 1);
        }
    }

    const wallSec = (Date.now() - startWallMs) / 1000;
    const inputStats = botInput.stats;
    console.log(
        `[soak] PASS ${args.levelId} 连续挂机 ${formatSoakElapsed(simTimeSec)} (${simTimeSec.toFixed(1)}s / ${totalSteps} 物理步) 零报错！`,
    );
    console.log(
        `[soak] 局数=${stats.rounds} (过关=${stats.wins}, 超时=${stats.losses}), 套中锁定=${stats.locks}, 消除=${stats.matches}次(共${stats.clearedRings}圈, 连锁=${stats.chainMatches}次), 潮引触发=${stats.tidePullTriggers}, 定海触发=${stats.calmSeaTriggers}`,
    );
    console.log(
        `[soak] 按键次数(左=${inputStats.leftPresses}, 右=${inputStats.rightPresses}), 最大观测壁面压缩=${checker.maxObservedWallPenetrationPx.toFixed(3)}px, 实际耗时=${wallSec.toFixed(2)}s`,
    );
}

main();
