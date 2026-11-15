import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FEEL_CONFIG } from '../../../assets/scripts/config/FeelConfig';
import { calcRingPillarGeometry, GameConst } from '../../../assets/scripts/config/GameConst';
import { TankSpace } from '../../../assets/scripts/config/TankSpace';
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
import { PillarEnergy } from '../../../assets/scripts/core/rules/Energy';
import {
    applyFunnelToBody,
    FunnelPillarTarget,
    resolveEffectiveFunnelParams,
} from '../../../assets/scripts/core/rules/FunnelMath';
import { isRingOnPillar3D } from '../../../assets/scripts/core/rules/PillarStack';
import { BubblePool } from '../../../assets/scripts/render/BubblePool';

describe('TidePullFlow 左柱技能「潮引」漩流场与吸纳校验（T018）', () => {
    const geom = calcRingPillarGeometry(TankSpace.width);
    const tubeR = geom.ringThickness * 0.5;
    const majorR = geom.ringOuterDiameter * 0.5 - tubeR;
    const innerR = geom.ringInnerDiameter * 0.5;

    const leftPillarX = TankSpace.pctToPxX(DEFAULT_FEEL_CONFIG.pillarPosPct);
    const pillarBottomY = TankSpace.pctToPxY(DEFAULT_FEEL_CONFIG.pillarBottomPct);
    const collider = new PillarCollider3D(leftPillarX, pillarBottomY, geom);

    it('在左柱上半区形成顺时针向心漩流，核心奇点与作用半径外严格为 0，且绝不调用 Math.random', () => {
        const randomSpy = vi.spyOn(Math, 'random');
        const term = new TidePullFlowTerm();
        term.activate(collider.x, collider.tipY);

        const cx = term.centerX;
        const cy = term.focusY;
        const out = { x: 0, y: 0 };

        // 中心点与半径外严格为 0
        term.sample(cx, cy, out);
        expect(out).toEqual({ x: 0, y: 0 });
        term.sample(cx + term.config.radiusPx + 5, cy, out);
        expect(out).toEqual({ x: 0, y: 0 });
        term.sample(cx, cy + term.config.radiusPx + 1, out);
        expect(out).toEqual({ x: 0, y: 0 });

        // 上半区四周采样点均具有向心汇聚（dot < 0）且顺时针切向分量（cross < 0）
        const probes: Array<[number, number]> = [
            [cx + 80, cy + 40],
            [cx - 80, cy + 40],
            [cx + 120, cy + 110],
            [cx - 110, cy + 120],
            [cx, cy + 100],
        ];
        for (const [px, py] of probes) {
            term.sample(px, py, out);
            const dx = px - cx;
            const dy = py - cy;
            const inwardDot = out.x * -dx + out.y * -dy;
            const crossZ = dx * out.y - dy * out.x;
            expect(inwardDot).toBeGreaterThan(0);
            expect(crossZ).toBeLessThan(0);
            expect(Math.hypot(out.x, out.y)).toBeGreaterThan(10);
        }

        // 低于柱尖的柱杆两侧点不会产生朝柱杆横向挤压的加速度分量
        const belowLeft = { x: 0, y: 0 };
        const belowRight = { x: 0, y: 0 };
        term.sample(cx - 48, collider.tipY - 24, belowLeft);
        term.sample(cx + 48, collider.tipY - 24, belowRight);
        expect(belowLeft.x).toBeLessThanOrEqual(0);
        expect(belowRight.x).toBeGreaterThanOrEqual(0);

        // 更低处完全衰减为 0
        term.sample(cx + 48, collider.tipY - 56, out);
        expect(out).toEqual({ x: 0, y: 0 });

        expect(randomSpy).not.toHaveBeenCalled();
        randomSpy.mockRestore();
    });

    it('挂载到 FlowField 后吸引左柱上半区气泡汇聚；suppressed 或 removeTerm 后立刻恢复基线水流', () => {
        const field = new FlowField({ seed: 2026, turbulenceScale: 0 });
        const term = new TidePullFlowTerm();
        term.activate(collider.x, collider.tipY);

        const probeX = collider.x + 110;
        const probeY = collider.tipY + 75;
        const baseVel = field.velocityAt(probeX, probeY);
        expect(baseVel).toEqual({ x: 0, y: 0 });

        const remove = field.addTerm(term);
        const activeVel = field.velocityAt(probeX, probeY);
        expect(activeVel.x).toBeLessThan(-10);
        expect(activeVel.y).toBeLessThan(-50);

        // 验证气泡池读取同一个 FlowField 时会被向左柱柱尖吸引
        const pool = new BubblePool(field, { maxCount: 8, seedInitialAmbient: false });
        const bubble = pool.items[0];
        bubble.active = true;
        bubble.kind = 'jet';
        bubble.x = probeX;
        bubble.y = probeY;
        bubble.radius = 3;
        bubble.buoyancy = 30;
        bubble.age = 0.5;
        bubble.life = 4;
        bubble.alpha = 0.8;
        const startDistToTip = Math.hypot(bubble.x - collider.x, bubble.y - term.focusY);
        for (let i = 0; i < 20; i++) {
            pool.step(1 / 60);
        }
        const endDistToTip = Math.hypot(bubble.x - collider.x, bubble.y - term.focusY);
        expect(endDistToTip).toBeLessThan(startDistToTip - 15);

        // 左柱满柱抑制时输出归零
        term.suppressed = true;
        expect(field.velocityAt(probeX, probeY)).toEqual({ x: 0, y: 0 });
        term.suppressed = false;
        expect(field.velocityAt(probeX, probeY).y).toBeLessThan(-50);

        // 移除漩流项后彻底恢复基线
        remove();
        expect(field.velocityAt(probeX, probeY)).toEqual(baseVel);
    });

    it('与 PillarEnergy + FunnelMath + TorusWorld3D 联调：默认 10% 与 0% 宽容度下均可在「潮引」5 秒内将左柱上半区斜圈扶正吸进柱尖，满柱/结束恢复常态', () => {
        const runScenario = (tolerance: number, useTidePull: boolean, isFull = false) => {
            const world = new TorusWorld3D();
            const pillar = world.addPillar(new PillarCollider3D(collider.x, pillarBottomY, geom));
            const solved = solveFeel({ ...DEFAULT_FEEL_CONFIG, funnelTolerance: tolerance });
            const field = new FlowField({ seed: 77, turbulenceScale: 0 }, { ...DEFAULT_FEEL_CONFIG, funnelTolerance: tolerance });
            const energy = new PillarEnergy();
            const term = new TidePullFlowTerm();
            const boost = buildTidePullFunnelBoost();

            let skillActive = false;
            energy.onSkillTrigger((e) => {
                if (e.side === 'left') {
                    skillActive = true;
                    term.activate(pillar.x, pillar.tipY);
                    term.suppressed = isFull;
                    field.addTerm(term);
                }
            });
            energy.onChange((snap) => {
                if (snap.side === 'left' && !snap.skillActive) {
                    skillActive = false;
                    term.deactivate();
                    field.removeTerm(term);
                }
            });

            if (useTidePull) {
                // 凑满 100% 触发左柱「潮引」（带 15% 溢出）
                energy.addEnergy('left', 115);
                expect(skillActive).toBe(true);
            }

            // 在左柱上半区右侧偏心 + 倾斜放置一枚自由合法圈（平时必落空）
            const qTilt = quatFromEulerDeg(26, 0, -28, { x: 0, y: 0, z: 0, w: 1 });
            const ring = world.addBody(
                new TorusBody3D({
                    x: pillar.x + 88,
                    y: pillar.tipY + 95,
                    z: 18,
                    qx: qTilt.x,
                    qy: qTilt.y,
                    qz: qTilt.z,
                    qw: qTilt.w,
                    majorRadius: majorR,
                    tubeRadius: tubeR,
                    linearDamping: solved.ringLinearDamping,
                    angularDamping: solved.ringAngularDamping,
                    friction: solved.ringFriction,
                    restitution: solved.ringRestitution,
                }),
            );

            const target: FunnelPillarTarget = {
                x: pillar.x,
                z: 0,
                tipY: pillar.tipY,
                baseTopY: pillar.baseTopY,
                isFull,
            };

            const waterVel = { x: 0, y: 0, z: 0 };
            const ptVel = { x: 0, y: 0, z: 0 };
            const follow = { x: 0, y: 0 };
            const effectiveFunnel = resolveEffectiveFunnelParams(
                solved.funnel,
                skillActive ? boost : null,
            );

            // 先模拟 2.5 秒物理过程
            for (let step = 0; step < 150; step++) {
                const dt = 1 / 60;
                field.step(dt);
                ring.applyCentralForce(0, -solved.baseSinkAccel * ring.mass, 0);

                // 模拟 WaterForce 四点水力
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
                    calcEndpointFollowAccel(waterVel.x, waterVel.y, ptVel.x, ptVel.y, solved.flowFollowRate, 1, follow);
                    const az = solved.flowFollowRate * (waterVel.z - ptVel.z);
                    ring.applyForceAtPoint(
                        0.25 * ring.mass * follow.x,
                        0.25 * ring.mass * follow.y,
                        0.25 * ring.mass * az,
                        px,
                        py,
                        pz,
                    );
                }

                resolveEffectiveFunnelParams(solved.funnel, skillActive ? boost : null, effectiveFunnel);
                applyFunnelToBody(ring, [target], [effectiveFunnel]);

                world.step(dt);
                energy.step(dt);
            }

            const caught = isRingOnPillar3D({
                centerX: ring.x,
                centerY: ring.y,
                centerZ: ring.z,
                normalX: ring.basisN.x,
                normalY: ring.basisN.y,
                normalZ: ring.basisN.z,
                innerRadius: innerR,
                pillarX: pillar.x,
                pillarZ: 0,
                baseTopY: pillar.baseTopY,
                tipY: pillar.tipY,
                shaftRadiusAtY: pillar.shaftRadiusAtY(ring.y),
            });

            // 走完剩余技能时长（多走 1 帧消除 IEEE-754 300*(1/60) 浮点误差），校验结束后恢复常态漏斗与充能
            for (let step = 0; step < 151; step++) {
                energy.step(1 / 60);
            }
            const restored = resolveEffectiveFunnelParams(solved.funnel, skillActive ? boost : null);
            const postCharge = energy.recordLock('left', 0);

            return {
                caught,
                ringX: ring.x,
                ringY: ring.y,
                skillActiveAfter5s: skillActive,
                restoredFunnelRadius: restored.radiusPx,
                expectedBaseRadius: solved.funnel.radiusPx,
                postChargeEnergy: postCharge.energy,
                postChargePaused: postCharge.pausedBySkill,
                velocityAfterEnd: field.velocityAt(pillar.x + 80, pillar.tipY + 60),
            };
        };

        // 默认 10% 宽容度：不触发潮引时偏心斜圈落空，触发潮引后被扶正并吸入左柱，5 秒后恢复充能与常态漏斗
        const baseline10 = runScenario(0.1, false);
        expect(baseline10.caught).toBe(false);

        const tide10 = runScenario(0.1, true);
        expect(tide10.caught).toBe(true);
        expect(tide10.skillActiveAfter5s).toBe(false);
        expect(tide10.restoredFunnelRadius).toBeCloseTo(tide10.expectedBaseRadius, 6);
        expect(tide10.postChargePaused).toBe(false);
        expect(tide10.postChargeEnergy).toBe(25); // 保留的 15% 溢出 + 恢复后的 +10%
        expect(tide10.velocityAfterEnd).toEqual({ x: 0, y: 0 });

        // 即使玩家在调参面板将 funnelTolerance 拉到 0，左柱潮引依然稳定把圈扶正吸入柱尖
        const tide0 = runScenario(0, true);
        expect(tide0.caught).toBe(true);
        expect(tide0.skillActiveAfter5s).toBe(false);
        expect(tide0.restoredFunnelRadius).toBe(0);

        // 左柱满柱（isFull = true）时不再硬吸该圈入柱
        const fullLeft = runScenario(0.1, true, true);
        expect(fullLeft.caught).toBe(false);
        expect(fullLeft.ringX).toBeGreaterThan(collider.x + innerR);
    });

    it('低于柱尖的柱侧自由圈在潮引期间不会被横向吸撞到柱杆外壁', () => {
        const world = new TorusWorld3D();
        const pillar = world.addPillar(new PillarCollider3D(collider.x, pillarBottomY, geom));
        const solved = solveFeel({ ...DEFAULT_FEEL_CONFIG, funnelTolerance: 0.1 });
        const field = new FlowField({ seed: 11, turbulenceScale: 0 });
        const term = new TidePullFlowTerm();
        term.activate(pillar.x, pillar.tipY);
        field.addTerm(term);
        const boost = buildTidePullFunnelBoost();
        const effectiveFunnel = resolveEffectiveFunnelParams(solved.funnel, boost);

        // 放在柱尖下方右侧外壁旁
        const startX = pillar.x + innerR + 18;
        const ring = world.addBody(
            new TorusBody3D({
                x: startX,
                y: pillar.tipY - tubeR - 14,
                z: 0,
                majorRadius: majorR,
                tubeRadius: tubeR,
                linearDamping: solved.ringLinearDamping,
                angularDamping: solved.ringAngularDamping,
            }),
        );

        const target: FunnelPillarTarget = {
            x: pillar.x,
            z: 0,
            tipY: pillar.tipY,
            baseTopY: pillar.baseTopY,
            isFull: false,
        };

        const waterVel = { x: 0, y: 0, z: 0 };
        const ptVel = { x: 0, y: 0, z: 0 };
        const follow = { x: 0, y: 0 };

        for (let step = 0; step < 30; step++) {
            const dt = 1 / 60;
            field.step(dt);
            ring.applyCentralForce(0, -solved.baseSinkAccel * ring.mass, 0);
            field.velocityAt3D(ring.x, ring.y, ring.z, world.tank.halfDepth, solved.zSwirlSpeed, solved.zCenteringRate, waterVel);
            ring.getPointVelocity(ring.x, ring.y, ring.z, ptVel);
            calcEndpointFollowAccel(waterVel.x, waterVel.y, ptVel.x, ptVel.y, solved.flowFollowRate, 1, follow);
            ring.applyCentralForce(ring.mass * follow.x, ring.mass * follow.y, 0);
            applyFunnelToBody(ring, [target], [effectiveFunnel]);
            world.step(dt);
        }

        // 不会向柱轴方向左移撞击柱杆
        expect(ring.x).toBeGreaterThanOrEqual(startX - 0.5);
    });
});
