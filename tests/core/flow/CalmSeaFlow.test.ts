import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FEEL_CONFIG } from '../../../assets/scripts/config/FeelConfig';
import { calcRingPillarGeometry } from '../../../assets/scripts/config/GameConst';
import { TankSpace } from '../../../assets/scripts/config/TankSpace';
import {
    buildCalmSeaFlowConfig,
    CalmSeaFlowTerm,
    CalmSeaPillarInfo,
    CalmSeaRingRegulator,
    computeCalmSeaTargetY,
} from '../../../assets/scripts/core/flow/CalmSeaFlow';
import { solveFeel } from '../../../assets/scripts/core/flow/FeelSolver';
import { FlowField } from '../../../assets/scripts/core/flow/FlowField';
import {
    buildTidePullFunnelBoost,
    TidePullFlowTerm,
} from '../../../assets/scripts/core/flow/TidePullFlow';
import { calcEndpointFollowAccel } from '../../../assets/scripts/core/flow/WaterFollow';
import { quatFromEulerDeg } from '../../../assets/scripts/core/physics3d/Math3D';
import { PillarCollider3D } from '../../../assets/scripts/core/physics3d/PillarCollider3D';
import { TorusBody3D } from '../../../assets/scripts/core/physics3d/TorusBody3D';
import { TorusWorld3D } from '../../../assets/scripts/core/physics3d/TorusWorld3D';
import { getRingKindConfig, RingKind } from '../../../assets/scripts/core/rings/RingKinds';
import { PillarEnergy } from '../../../assets/scripts/core/rules/Energy';
import {
    applyFunnelToBody,
    FunnelPillarTarget,
    resolveEffectiveFunnelParams,
} from '../../../assets/scripts/core/rules/FunnelMath';
import {
    calcRingTiltDeg3D,
    isRingOnPillar3D,
} from '../../../assets/scripts/core/rules/PillarStack';
import { BubblePool } from '../../../assets/scripts/render/BubblePool';

describe('CalmSeaFlow 右柱技能「定海」暖流托浮、平息乱流与 3D 回正校验（T019）', () => {
    const geom = calcRingPillarGeometry(TankSpace.width);
    const tubeR = geom.ringThickness * 0.5;
    const majorR = geom.ringOuterDiameter * 0.5 - tubeR;
    const outerR = geom.ringOuterDiameter * 0.5;
    const innerR = geom.ringInnerDiameter * 0.5;

    const leftPillarX = TankSpace.pctToPxX(DEFAULT_FEEL_CONFIG.pillarPosPct);
    const rightPillarX = TankSpace.pctToPxX(100 - DEFAULT_FEEL_CONFIG.pillarPosPct);
    const pillarBottomY = TankSpace.pctToPxY(DEFAULT_FEEL_CONFIG.pillarBottomPct);
    const leftCollider = new PillarCollider3D(leftPillarX, pillarBottomY, geom);
    const rightCollider = new PillarCollider3D(rightPillarX, pillarBottomY, geom);

    const pillarsInfo: CalmSeaPillarInfo[] = [
        { x: leftCollider.x, z: 0, baseTopY: leftCollider.baseTopY, tipY: leftCollider.tipY, isFull: false },
        { x: rightCollider.x, z: 0, baseTopY: rightCollider.baseTopY, tipY: rightCollider.tipY, isFull: false },
    ];

    it('CalmSeaFlowTerm 产生从缸底向上的柔和暖流并向目标带上方衰减为 0，且绝不调用 Math.random', () => {
        const randomSpy = vi.spyOn(Math, 'random');
        const term = new CalmSeaFlowTerm();
        const targetY = computeCalmSeaTargetY(pillarsInfo, outerR, TankSpace.height);
        expect(targetY).toBeGreaterThan(rightCollider.tipY + 15);
        expect(targetY).toBeLessThan(TankSpace.height - outerR - 20);

        const out = { x: 0, y: 0 };
        term.sample(300, 120, out);
        expect(out).toEqual({ x: 0, y: 0 });

        term.activate(targetY, TankSpace.height);
        term.sample(300, 40, out);
        expect(out.x).toBe(0);
        expect(out.y).toBeCloseTo(term.config.warmFlowSpeed, 6);

        // 柱尖高度以下依然有明确向上的暖流，目标带上方衰减归零
        term.sample(500, rightCollider.tipY - 40, out);
        expect(out.y).toBeGreaterThan(term.config.warmFlowSpeed * 0.5);

        term.sample(500, targetY + term.config.warmFlowTaperSpanPx, out);
        expect(out).toEqual({ x: 0, y: 0 });

        term.deactivate();
        term.sample(300, 40, out);
        expect(out).toEqual({ x: 0, y: 0 });

        expect(randomSpy).not.toHaveBeenCalled();
        randomSpy.mockRestore();
    });

    it('FlowField 压制接口把扰动（含 Z 向涡流）与全缸环流压到极低，不影响主喷流，并在 clear/reset 后恢复为 1', () => {
        const field = new FlowField({ seed: 2026 });
        const cfg = buildCalmSeaFlowConfig();

        // 建立明显的环流与扰动
        field.setJetInput('left', 1);
        for (let i = 0; i < 30; i++) {
            field.step(1 / 60);
        }
        field.setJetInput('left', 0);
        field.step(0.35); // 喷流余韵几乎归零，突出环流与扰动

        const circBefore = { x: 0, y: 0 };
        const turbBefore = { x: 0, y: 0 };
        field.circulation.sample(TankSpace.width * 0.5, TankSpace.height - 60, circBefore);
        field.turbulence.sample(420, 260, turbBefore);
        const zBefore = field.velocityAt3D(420, 260, 0, 60, 68, 1.65).z;

        expect(Math.abs(circBefore.x)).toBeGreaterThan(40);
        expect(Math.hypot(turbBefore.x, turbBefore.y)).toBeGreaterThan(1);

        // 激活「定海」压制 + 挂载暖流项
        const term = new CalmSeaFlowTerm();
        const targetY = computeCalmSeaTargetY(pillarsInfo, outerR, TankSpace.height);
        term.activate(targetY, TankSpace.height);
        field.addTerm(term);
        field.setFlowSuppression(cfg.turbulenceScale, cfg.circulationScale);

        const circAfter = { x: 0, y: 0 };
        const turbAfter = { x: 0, y: 0 };
        field.circulation.sample(TankSpace.width * 0.5, TankSpace.height - 60, circAfter);
        field.turbulence.sample(420, 260, turbAfter);
        const zAfter = field.velocityAt3D(420, 260, 0, 60, 68, 1.65).z;

        expect(Math.abs(circAfter.x)).toBeCloseTo(Math.abs(circBefore.x) * cfg.circulationScale, 4);
        expect(Math.hypot(turbAfter.x, turbAfter.y)).toBeCloseTo(
            Math.hypot(turbBefore.x, turbBefore.y) * cfg.turbulenceScale,
            4,
        );
        expect(Math.abs(zAfter)).toBeCloseTo(Math.abs(zBefore) * cfg.turbulenceScale, 4);

        // 主喷流在压制期间仍可正常激活，玩家可轻点微调托浮圈入柱
        const nozzle = field.jet.getNozzlePose('left');
        field.setJetInput('left', 1);
        const jetVel = field.velocityAt(nozzle.x, 24);
        expect(jetVel.y).toBeGreaterThan(1000);

        // 气泡在暖流下显著向上升起
        const pool = new BubblePool(field, { maxCount: 8, seedInitialAmbient: false });
        const bubble = pool.items[0];
        bubble.active = true;
        bubble.kind = 'ambient';
        bubble.x = TankSpace.width * 0.5;
        bubble.y = 60;
        bubble.radius = 3;
        bubble.buoyancy = 30;
        bubble.age = 0.5;
        bubble.life = 5;
        bubble.alpha = 0.5;
        field.setJetInput('left', 0);
        for (let i = 0; i < 30; i++) {
            pool.step(1 / 60);
        }
        expect(bubble.y).toBeGreaterThan(120);

        // clearFlowSuppression 与 reset 均可将压制倍率恢复为 1
        field.clearFlowSuppression();
        expect(field.getTurbulenceSuppression()).toBe(1);
        expect(field.getCirculationSuppression()).toBe(1);
        expect(field.turbulence.scale).toBe(1);
        expect(field.circulation.scale).toBe(1);

        field.setFlowSuppression(cfg.turbulenceScale, cfg.circulationScale);
        field.reset(2026);
        expect(field.getTurbulenceSuppression()).toBe(1);
        expect(field.getCirculationSuppression()).toBe(1);
        expect(field.turbulence.scale).toBe(1);
        expect(field.circulation.scale).toBe(1);
    });

    function runCalmSeaTrajectory(kind: RingKind, startX: number, startY: number, startZ = 0, tiltDegInput = 0) {
        const world = new TorusWorld3D();
        world.addPillar(new PillarCollider3D(leftPillarX, pillarBottomY, geom));
        world.addPillar(new PillarCollider3D(rightPillarX, pillarBottomY, geom));

        const solved = solveFeel(DEFAULT_FEEL_CONFIG);
        const field = new FlowField({ seed: 108 }, DEFAULT_FEEL_CONFIG);
        const energy = new PillarEnergy();
        const term = new CalmSeaFlowTerm();
        const regulator = new CalmSeaRingRegulator();
        const kindCfg = getRingKindConfig(kind);

        const ringOuterR = outerR * kindCfg.sizeScale;
        const ringTubeR = tubeR * kindCfg.sizeScale;
        const ringMajorR = ringOuterR - ringTubeR;

        const targetY = computeCalmSeaTargetY(pillarsInfo, outerR, TankSpace.height, term.config);

        let skillActive = false;
        energy.onSkillTrigger((e) => {
            if (e.side === 'right') {
                skillActive = true;
                regulator.reset();
                term.activate(targetY, TankSpace.height);
                field.addTerm(term);
                field.setFlowSuppression(term.config.turbulenceScale, term.config.circulationScale);
            }
        });
        energy.onChange((snap) => {
            if (snap.side === 'right' && !snap.skillActive) {
                skillActive = false;
                term.deactivate();
                field.removeTerm(term);
                field.clearFlowSuppression();
                regulator.reset();
            }
        });

        const qStart = quatFromEulerDeg(tiltDegInput, 0, tiltDegInput * 0.4, { x: 0, y: 0, z: 0, w: 1 });
        const ring = world.addBody(
            new TorusBody3D({
                x: startX,
                y: startY,
                z: startZ,
                qx: qStart.x,
                qy: qStart.y,
                qz: qStart.z,
                qw: qStart.w,
                majorRadius: ringMajorR,
                tubeRadius: ringTubeR,
                mass: Math.max(0.25, kindCfg.sinkScale),
                linearDamping: solved.ringLinearDamping,
                angularDamping: solved.ringAngularDamping,
                friction: solved.ringFriction,
                restitution: solved.ringRestitution,
            }),
        );

        // 满充触发右柱「定海」（带 12% 溢出）
        energy.addEnergy('right', 112);
        expect(skillActive).toBe(true);

        const waterVel = { x: 0, y: 0, z: 0 };
        const ptVel = { x: 0, y: 0, z: 0 };
        const follow = { x: 0, y: 0 };
        const warmSample = { x: 0, y: 0 };

        let maxY = ring.y;
        let yAtBandReach = -1;
        let vyAfterBand: number[] = [];

        const stepSim = (dt: number) => {
            field.step(dt);
            ring.applyCentralForce(0, -solved.baseSinkAccel * kindCfg.sinkScale * ring.mass, 0);

            const pts = [
                [ring.x + ring.basisU.x * ringMajorR, ring.y + ring.basisU.y * ringMajorR, ring.z + ring.basisU.z * ringMajorR],
                [ring.x - ring.basisU.x * ringMajorR, ring.y - ring.basisU.y * ringMajorR, ring.z - ring.basisU.z * ringMajorR],
                [ring.x + ring.basisV.x * ringMajorR, ring.y + ring.basisV.y * ringMajorR, ring.z + ring.basisV.z * ringMajorR],
                [ring.x - ring.basisV.x * ringMajorR, ring.y - ring.basisV.y * ringMajorR, ring.z - ring.basisV.z * ringMajorR],
            ];
            for (let k = 0; k < 4; k++) {
                const [px, py, pz] = pts[k];
                field.velocityAt3D(px, py, pz, world.tank.halfDepth, solved.zSwirlSpeed, solved.zCenteringRate, waterVel);
                ring.getPointVelocity(px, py, pz, ptVel);
                calcEndpointFollowAccel(waterVel.x, waterVel.y, ptVel.x, ptVel.y, solved.flowFollowRate, kindCfg.flowFollow, follow);
                const az = solved.flowFollowRate * kindCfg.flowFollow * (waterVel.z - ptVel.z);
                ring.applyForceAtPoint(
                    0.25 * ring.mass * follow.x,
                    0.25 * ring.mass * follow.y,
                    0.25 * ring.mass * az,
                    px,
                    py,
                    pz,
                );
            }

            if (skillActive) {
                term.sample(ring.x, ring.y, warmSample);
                regulator.applyToBody(
                    ring,
                    kindCfg,
                    solved,
                    pillarsInfo,
                    TankSpace.width,
                    TankSpace.height,
                    targetY,
                    warmSample.y,
                );
            }

            world.step(dt);
            energy.step(dt);

            if (ring.y > maxY) {
                maxY = ring.y;
            }
            if (regulator.hasReachedBand(ring.id) && yAtBandReach < 0) {
                yAtBandReach = ring.y;
            }
        };

        // 模拟 5 秒技能持续期（300 步）
        for (let step = 0; step < 300; step++) {
            stepSim(1 / 60);
            if (step >= 250 && step < 300) {
                vyAfterBand.push(ring.vy);
            }
        }

        const endOfSkillY = ring.y;
        const endOfSkillVy = ring.vy;
        const endOfSkillZ = ring.z;
        const endOfSkillTiltDeg = calcRingTiltDeg3D(ring.basisN.x, ring.basisN.y, ring.basisN.z);
        const endOfSkillAngSpeed = Math.hypot(ring.wx, ring.wy, ring.wz);

        // 再走 1 步确保 5 秒结束（消除浮点舍入）
        stepSim(1 / 60);
        expect(skillActive).toBe(false);

        // 技能结束后再模拟 0.6 秒验证恢复正常下沉与充能
        for (let step = 0; step < 36; step++) {
            stepSim(1 / 60);
        }
        const postSkillY = ring.y;
        const postSkillVy = ring.vy;
        const postCharge = energy.recordLock('right', 0);

        return {
            targetY,
            maxY,
            yAtBandReach,
            endOfSkillY,
            endOfSkillVy,
            vyAfterBand,
            endOfSkillZ,
            endOfSkillTiltDeg,
            endOfSkillAngSpeed,
            postSkillY,
            postSkillVy,
            postChargeEnergy: postCharge.energy,
            postChargePaused: postCharge.pausedBySkill,
            suppressionRestored: field.getTurbulenceSuppression() === 1 && field.getCirculationSuppression() === 1,
        };
    }

    it('普通圈、木圈、小金环与沉底铁圈（sinkScale=2.2）均在 5 秒内从缸底浮升至略高于柱尖并转为极慢下沉，不冲顶且 5 秒后恢复正常下沉', () => {
        const openChannelX = TankSpace.width * 0.5;
        const kinds: RingKind[] = ['normal', 'wood', 'gold', 'iron'];

        for (const kind of kinds) {
            const res = runCalmSeaTrajectory(kind, openChannelX, 12);
            // 1. 成功从缸底浮升至略高于两根柱尖的目标带
            expect(res.maxY).toBeGreaterThan(rightCollider.tipY + 15);
            // 2. 绝不冲顶撞壁（留足安全余量）
            expect(res.maxY).toBeLessThan(TankSpace.height - outerR - 20);
            // 3. 到达目标带后转为极慢下沉（5 秒末仍停留在柱尖上方附近且竖直速度缓慢向下）
            expect(res.yAtBandReach).toBeGreaterThan(rightCollider.tipY);
            expect(res.endOfSkillY).toBeGreaterThan(rightCollider.tipY);
            expect(res.endOfSkillVy).toBeLessThan(0);
            expect(res.endOfSkillVy).toBeGreaterThan(-22);
            for (const vy of res.vyAfterBand) {
                expect(vy).toBeLessThan(2);
                expect(vy).toBeGreaterThan(-25);
            }
            // 4. 5 秒结束后立即恢复正常下沉与充能
            expect(res.postSkillVy).toBeLessThan(-60);
            expect(res.postSkillY).toBeLessThan(res.endOfSkillY - 30);
            expect(res.postChargePaused).toBe(false);
            expect(res.postChargeEnergy).toBe(22); // 12% 溢出 + 10%
            expect(res.suppressionRestored).toBe(true);
        }
    });

    it('直接压在柱尾正下方的沉底铁圈能柔和绕过柱底十字卡托并浮升至柱尖上方', () => {
        const res = runCalmSeaTrajectory('iron', rightPillarX, 14);
        expect(res.maxY).toBeGreaterThan(rightCollider.tipY + 15);
        expect(res.endOfSkillY).toBeGreaterThan(rightCollider.tipY);
    });

    it('大倾角（~75°）与大幅 z 偏离（+42px）的圈在「定海」期间恢复水平正放并居中至 z=0', () => {
        const res = runCalmSeaTrajectory('normal', TankSpace.width * 0.5, 45, 42, 74);
        expect(res.endOfSkillTiltDeg).toBeLessThan(5);
        expect(Math.abs(res.endOfSkillZ)).toBeLessThan(2);
        expect(res.endOfSkillAngSpeed).toBeLessThan(0.25);
    });

    it('高位圈缓缓下沉至目标带、且柱位极高时目标带仍留足内屏顶壁余量', () => {
        const highPillars: CalmSeaPillarInfo[] = [
            { x: leftPillarX, z: 0, baseTopY: 450, tipY: 545, isFull: false },
            { x: rightPillarX, z: 0, baseTopY: 450, tipY: 545, isFull: false },
        ];
        const clampedTarget = computeCalmSeaTargetY(highPillars, outerR, TankSpace.height);
        expect(clampedTarget).toBeLessThanOrEqual(TankSpace.height - outerR - 26 + 1e-6);

        const highRingRes = runCalmSeaTrajectory('wood', TankSpace.width * 0.5, 510);
        expect(highRingRes.maxY).toBeLessThan(TankSpace.height - outerR - 10);
        expect(highRingRes.endOfSkillY).toBeGreaterThan(rightCollider.tipY);
        expect(highRingRes.endOfSkillY).toBeLessThan(500);
        expect(highRingRes.endOfSkillVy).toBeLessThan(0);
    });

    it('「定海」期间玩家轻点喷水仍可把托浮在柱尖上方的水平圈拨入柱尖', () => {
        const world = new TorusWorld3D();
        world.addPillar(new PillarCollider3D(leftPillarX, pillarBottomY, geom));
        world.addPillar(new PillarCollider3D(rightPillarX, pillarBottomY, geom));

        const solved = solveFeel(DEFAULT_FEEL_CONFIG);
        const field = new FlowField({ seed: 55 }, DEFAULT_FEEL_CONFIG);
        const term = new CalmSeaFlowTerm();
        const regulator = new CalmSeaRingRegulator();
        const kindCfg = getRingKindConfig('normal');
        const targetY = computeCalmSeaTargetY(pillarsInfo, outerR, TankSpace.height, term.config);

        term.activate(targetY, TankSpace.height);
        field.addTerm(term);
        field.setFlowSuppression(term.config.turbulenceScale, term.config.circulationScale);

        // 圈已托浮在左海眼与左柱之间（略高于柱尖），玩家轻点左键 0.12s 把它向右上方推入左柱
        const nozzleX = field.jet.getNozzlePose('left').x;
        const ring = world.addBody(
            new TorusBody3D({
                x: nozzleX + 85,
                y: targetY - 6,
                z: 0,
                majorRadius: majorR,
                tubeRadius: tubeR,
                linearDamping: solved.ringLinearDamping,
                angularDamping: solved.ringAngularDamping,
            }),
        );

        const waterVel = { x: 0, y: 0, z: 0 };
        const ptVel = { x: 0, y: 0, z: 0 };
        const follow = { x: 0, y: 0 };
        const warmSample = { x: 0, y: 0 };
        const startX = ring.x;

        for (let step = 0; step < 48; step++) {
            const dt = 1 / 60;
            field.setJetInput('left', step < 14 ? 1 : 0);
            field.step(dt);
            ring.applyCentralForce(0, -solved.baseSinkAccel * ring.mass, 0);

            field.velocityAt3D(ring.x, ring.y, ring.z, world.tank.halfDepth, solved.zSwirlSpeed, solved.zCenteringRate, waterVel);
            ring.getPointVelocity(ring.x, ring.y, ring.z, ptVel);
            calcEndpointFollowAccel(waterVel.x, waterVel.y, ptVel.x, ptVel.y, solved.flowFollowRate, 1, follow);
            ring.applyCentralForce(ring.mass * follow.x, ring.mass * follow.y, 0);

            term.sample(ring.x, ring.y, warmSample);
            regulator.applyToBody(ring, kindCfg, solved, pillarsInfo, TankSpace.width, TankSpace.height, targetY, warmSample.y);
            world.step(dt);
        }

        // 轻点左喷口后，圈明显向右侧左柱移动且未冲顶
        expect(ring.x).toBeGreaterThan(startX + 20);
        expect(ring.y).toBeLessThan(TankSpace.height - outerR - 10);
    });

    it('左柱「潮引」与右柱「定海」同时激活时互不冲突：沉底圈被定海托起后顺利被潮引吸入左柱并各自独立结束恢复', () => {
        const world = new TorusWorld3D();
        const leftP = world.addPillar(new PillarCollider3D(leftPillarX, pillarBottomY, geom));
        const rightP = world.addPillar(new PillarCollider3D(rightPillarX, pillarBottomY, geom));

        const solved = solveFeel(DEFAULT_FEEL_CONFIG);
        const field = new FlowField({ seed: 303 }, DEFAULT_FEEL_CONFIG);
        const energy = new PillarEnergy();

        const tideTerm = new TidePullFlowTerm();
        const tideBoost = buildTidePullFunnelBoost();
        const calmTerm = new CalmSeaFlowTerm();
        const regulator = new CalmSeaRingRegulator();
        const targetY = computeCalmSeaTargetY(pillarsInfo, outerR, TankSpace.height, calmTerm.config);

        let leftActive = false;
        let rightActive = false;

        energy.onSkillTrigger((e) => {
            if (e.side === 'left') {
                leftActive = true;
                tideTerm.activate(leftP.x, leftP.tipY);
                field.addTerm(tideTerm);
            } else {
                rightActive = true;
                regulator.reset();
                calmTerm.activate(targetY, TankSpace.height);
                field.addTerm(calmTerm);
                field.setFlowSuppression(calmTerm.config.turbulenceScale, calmTerm.config.circulationScale);
            }
        });
        energy.onChange((snap) => {
            if (snap.side === 'left' && !snap.skillActive && leftActive) {
                leftActive = false;
                tideTerm.deactivate();
                field.removeTerm(tideTerm);
            }
            if (snap.side === 'right' && !snap.skillActive && rightActive) {
                rightActive = false;
                calmTerm.deactivate();
                field.removeTerm(calmTerm);
                field.clearFlowSuppression();
                regulator.reset();
            }
        });

        // 先触发右柱定海，1 秒后触发左柱潮引（验证独立计时与清理）
        energy.addEnergy('right', 100);
        expect(rightActive).toBe(true);

        const qTilt = quatFromEulerDeg(32, 0, -25, { x: 0, y: 0, z: 0, w: 1 });
        const ring = world.addBody(
            new TorusBody3D({
                x: leftP.x + 85,
                y: 35,
                z: 22,
                qx: qTilt.x,
                qy: qTilt.y,
                qz: qTilt.z,
                qw: qTilt.w,
                majorRadius: majorR,
                tubeRadius: tubeR,
                mass: 2.2, // 沉底铁圈
                linearDamping: solved.ringLinearDamping,
                angularDamping: solved.ringAngularDamping,
            }),
        );
        const ironCfg = getRingKindConfig('iron');

        const funnelTargets: FunnelPillarTarget[] = [
            { x: leftP.x, z: 0, tipY: leftP.tipY, baseTopY: leftP.baseTopY, isFull: false },
            { x: rightP.x, z: 0, tipY: rightP.tipY, baseTopY: rightP.baseTopY, isFull: false },
        ];
        const funnelParams = [
            resolveEffectiveFunnelParams(solved.funnel, null),
            resolveEffectiveFunnelParams(solved.funnel, null),
        ];

        const waterVel = { x: 0, y: 0, z: 0 };
        const ptVel = { x: 0, y: 0, z: 0 };
        const follow = { x: 0, y: 0 };
        const warmSample = { x: 0, y: 0 };

        let caughtOnLeft = false;
        for (let step = 0; step < 301; step++) {
            const dt = 1 / 60;
            if (step === 60) {
                energy.addEnergy('left', 100);
                expect(leftActive).toBe(true);
            }

            field.step(dt);
            ring.applyCentralForce(0, -solved.baseSinkAccel * ironCfg.sinkScale * ring.mass, 0);

            const pts = [
                [ring.x + ring.basisU.x * majorR, ring.y + ring.basisU.y * majorR, ring.z + ring.basisU.z * majorR],
                [ring.x - ring.basisU.x * majorR, ring.y - ring.basisU.y * majorR, ring.z - ring.basisU.z * majorR],
                [ring.x + ring.basisV.x * majorR, ring.y + ring.basisV.y * majorR, ring.z + ring.basisV.z * majorR],
                [ring.x - ring.basisV.x * majorR, ring.y - ring.basisV.y * majorR, ring.z - ring.basisV.z * majorR],
            ];
            for (let k = 0; k < 4; k++) {
                const [px, py, pz] = pts[k];
                field.velocityAt3D(px, py, pz, world.tank.halfDepth, solved.zSwirlSpeed, solved.zCenteringRate, waterVel);
                ring.getPointVelocity(px, py, pz, ptVel);
                calcEndpointFollowAccel(waterVel.x, waterVel.y, ptVel.x, ptVel.y, solved.flowFollowRate, ironCfg.flowFollow, follow);
                const az = solved.flowFollowRate * ironCfg.flowFollow * (waterVel.z - ptVel.z);
                ring.applyForceAtPoint(
                    0.25 * ring.mass * follow.x,
                    0.25 * ring.mass * follow.y,
                    0.25 * ring.mass * az,
                    px,
                    py,
                    pz,
                );
            }

            resolveEffectiveFunnelParams(solved.funnel, leftActive ? tideBoost : null, funnelParams[0]);
            resolveEffectiveFunnelParams(solved.funnel, null, funnelParams[1]);
            applyFunnelToBody(ring, funnelTargets, funnelParams);

            if (rightActive) {
                calmTerm.sample(ring.x, ring.y, warmSample);
                regulator.applyToBody(ring, ironCfg, solved, pillarsInfo, TankSpace.width, TankSpace.height, targetY, warmSample.y);
            }

            world.step(dt);
            energy.step(dt);

            if (
                isRingOnPillar3D({
                    centerX: ring.x,
                    centerY: ring.y,
                    centerZ: ring.z,
                    normalX: ring.basisN.x,
                    normalY: ring.basisN.y,
                    normalZ: ring.basisN.z,
                    innerRadius: innerR,
                    pillarX: leftP.x,
                    pillarZ: 0,
                    baseTopY: leftP.baseTopY,
                    tipY: leftP.tipY,
                    shaftRadiusAtY: leftP.shaftRadiusAtY(ring.y),
                })
            ) {
                caughtOnLeft = true;
            }
        }

        // t = 5.0s 后：右柱定海已结束并恢复扰动/环流，左柱潮引仍剩余 ~1.0 秒且继续独立运行
        expect(rightActive).toBe(false);
        expect(leftActive).toBe(true);
        expect(field.getTurbulenceSuppression()).toBe(1);
        expect(field.getCirculationSuppression()).toBe(1);
        expect(caughtOnLeft).toBe(true);

        // 再推进 1.1 秒后左柱潮引也结束
        for (let step = 0; step < 66; step++) {
            energy.step(1 / 60);
        }
        expect(leftActive).toBe(false);
    });
});
