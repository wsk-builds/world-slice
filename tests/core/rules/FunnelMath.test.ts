import { describe, expect, it } from 'vitest';
import { DEFAULT_FEEL_CONFIG } from '../../../assets/scripts/config/FeelConfig';
import { calcRingPillarGeometry } from '../../../assets/scripts/config/GameConst';
import { TankSpace } from '../../../assets/scripts/config/TankSpace';
import { solveFeel } from '../../../assets/scripts/core/flow/FeelSolver';
import { quatFromEulerDeg } from '../../../assets/scripts/core/physics3d/Math3D';
import { PillarCollider3D } from '../../../assets/scripts/core/physics3d/PillarCollider3D';
import { TorusBody3D } from '../../../assets/scripts/core/physics3d/TorusBody3D';
import { TorusWorld3D } from '../../../assets/scripts/core/physics3d/TorusWorld3D';
import {
    applyFunnelToBody,
    computeFunnelForce3D,
    FunnelPillarTarget,
    resolveEffectiveFunnelParams,
} from '../../../assets/scripts/core/rules/FunnelMath';
import { calcRingTiltDeg3D, isRingOnPillar3D } from '../../../assets/scripts/core/rules/PillarStack';

describe('FunnelMath 入柱宽容漏斗（T013）', () => {
    const geom = calcRingPillarGeometry(TankSpace.width);
    const tubeR = geom.ringThickness * 0.5;
    const majorR = geom.ringOuterDiameter * 0.5 - tubeR;
    const innerR = geom.ringInnerDiameter * 0.5;

    const pillarX = TankSpace.pctToPxX(DEFAULT_FEEL_CONFIG.pillarPosPct);
    const pillarBottomY = TankSpace.pctToPxY(DEFAULT_FEEL_CONFIG.pillarBottomPct);
    const collider = new PillarCollider3D(pillarX, pillarBottomY, geom);

    const pillarTarget: FunnelPillarTarget = {
        x: collider.x,
        z: 0,
        tipY: collider.tipY,
        baseTopY: collider.baseTopY,
        isFull: false,
    };

    const defaultFunnel = solveFeel(DEFAULT_FEEL_CONFIG).funnel;
    const midFunnel = solveFeel({ ...DEFAULT_FEEL_CONFIG, funnelTolerance: 0.5 }).funnel;

    it('默认 10% 入柱宽容度为 0.5 档的 20% 柔和吸纳范围与 7° 倾角上限', () => {
        expect(DEFAULT_FEEL_CONFIG.funnelTolerance).toBe(0.1);
        expect(defaultFunnel.maxAngleDeg).toBeCloseTo(7, 6);
        expect(defaultFunnel.radiusPx).toBeCloseTo(midFunnel.radiusPx * 0.2, 6);
        expect(defaultFunnel.pullAccel).toBeCloseTo(midFunnel.pullAccel * 0.2, 6);
    });

    it('仅在柱未满、圈正在下落（vy < 0）、处于柱尖碗口区且倾角小于上限时施加居中力与回正力矩', () => {
        const qTilt = quatFromEulerDeg(15, 0, -20, { x: 0, y: 0, z: 0, w: 1 });
        const body = new TorusBody3D({
            x: pillarX + 22,
            y: collider.tipY + 18,
            z: 10,
            qx: qTilt.x,
            qy: qTilt.y,
            qz: qTilt.z,
            qw: qTilt.w,
            majorRadius: majorR,
            tubeRadius: tubeR,
        });

        // 1. 静止（vy = 0）或上升（vy > 0）不吸圈
        body.vy = 0;
        expect(computeFunnelForce3D(body, pillarTarget, midFunnel).active).toBe(false);
        body.vy = 60;
        expect(computeFunnelForce3D(body, pillarTarget, midFunnel).active).toBe(false);

        // 2. 下落（vy < 0）时激活，fx/fz 朝向柱心，且倾角产生非零回正力矩
        body.vy = -80;
        const res = computeFunnelForce3D(body, pillarTarget, midFunnel);
        expect(res.active).toBe(true);
        expect(res.fx).toBeLessThan(0);
        expect(res.fy).toBe(0);
        expect(res.fz).toBeLessThan(0);
        expect(Math.hypot(res.tx, res.tz)).toBeGreaterThan(0);
        expect(res.ty).toBe(0);

        // 3. 已满柱子不吸圈
        expect(
            computeFunnelForce3D(body, { ...pillarTarget, isFull: true }, midFunnel).active,
        ).toBe(false);

        // 4. 宽容度为 0 时不吸圈
        const zeroFunnel = solveFeel({ ...DEFAULT_FEEL_CONFIG, funnelTolerance: 0 }).funnel;
        expect(computeFunnelForce3D(body, pillarTarget, zeroFunnel).active).toBe(false);

        // 5. 倾角超过上限（0.5 档为 35°）时不吸圈
        const qSteep = quatFromEulerDeg(45, 0, 0, { x: 0, y: 0, z: 0, w: 1 });
        body.setPose(pillarX + 18, collider.tipY + 18, 0, qSteep.x, qSteep.y, qSteep.z, qSteep.w);
        expect(computeFunnelForce3D(body, pillarTarget, midFunnel).active).toBe(false);

        // 6. 水平距离超出碗口半径不吸圈
        body.setPose(
            pillarX + midFunnel.radiusPx + 8,
            collider.tipY + 18,
            0,
            qTilt.x,
            qTilt.y,
            qTilt.z,
            qTilt.w,
        );
        expect(computeFunnelForce3D(body, pillarTarget, midFunnel).active).toBe(false);

        // 7. 已跌破柱尖且未套入内孔（擦柱外侧）时不侧向拉扯撞杆
        body.setPose(pillarX + innerR + 6, collider.tipY - tubeR - 8, 0, qTilt.x, qTilt.y, qTilt.z, qTilt.w);
        expect(computeFunnelForce3D(body, pillarTarget, midFunnel).active).toBe(false);
    });

    it('三维回正力矩能正确把倾斜孔轴拉向竖直，并支持 180° 倒扣状态就近回正', () => {
        // 情况 A：正面朝上但向右倾（basisN.x > 0, basisN.y > 0）
        const qPos = quatFromEulerDeg(0, 0, -25, { x: 0, y: 0, z: 0, w: 1 });
        const body = new TorusBody3D({
            x: pillarX,
            y: collider.tipY + 15,
            z: 0,
            qx: qPos.x,
            qy: qPos.y,
            qz: qPos.z,
            qw: qPos.w,
            majorRadius: majorR,
            tubeRadius: tubeR,
        });
        body.vy = -60;
        const resA = computeFunnelForce3D(body, pillarTarget, midFunnel);
        expect(resA.active).toBe(true);
        // 施加力矩一步后倾角应减小
        const world = new TorusWorld3D();
        world.addBody(body);
        for (let i = 0; i < 15; i++) {
            body.vy = -60;
            applyFunnelToBody(body, [pillarTarget], [midFunnel]);
            world.step(1 / 60);
        }
        const tiltAfterA = calcRingTiltDeg3D(body.basisN.x, body.basisN.y, body.basisN.z);
        expect(tiltAfterA).toBeLessThan(15);

        // 情况 B：倒扣 180° 再倾 22°（basisN.y < 0），就近拉向 (0, -1, 0) 而非强行翻 158°
        const qFlip = quatFromEulerDeg(158, 0, 0, { x: 0, y: 0, z: 0, w: 1 });
        const flipped = new TorusBody3D({
            x: pillarX,
            y: collider.tipY + 15,
            z: 0,
            qx: qFlip.x,
            qy: qFlip.y,
            qz: qFlip.z,
            qw: qFlip.w,
            majorRadius: majorR,
            tubeRadius: tubeR,
        });
        expect(flipped.basisN.y).toBeLessThan(0);
        const worldB = new TorusWorld3D();
        worldB.addBody(flipped);
        for (let i = 0; i < 15; i++) {
            flipped.vy = -60;
            applyFunnelToBody(flipped, [pillarTarget], [midFunnel]);
            worldB.step(1 / 60);
        }
        expect(flipped.basisN.y).toBeLessThan(0);
        expect(calcRingTiltDeg3D(flipped.basisN.x, flipped.basisN.y, flipped.basisN.z)).toBeLessThan(14);
    });

    it('resolveEffectiveFunnelParams 支持 T018 潮引 boost 放大半径、倾角上限与拉力', () => {
        const boosted = resolveEffectiveFunnelParams(midFunnel, {
            radiusScale: 2.2,
            maxTiltDeg: 70,
            pullScale: 1.8,
        });
        expect(boosted.radiusPx).toBeCloseTo(midFunnel.radiusPx * 2.2, 6);
        expect(boosted.maxAngleDeg).toBe(70);
        expect(boosted.pullAccel).toBeCloseTo(midFunnel.pullAccel * 1.8, 6);
        expect(boosted.alignRate).toBeCloseTo(midFunnel.alignRate * 1.8, 6);

        // 若基础倾角已高于传入值，不收缩基础倾角
        const keepBaseTilt = resolveEffectiveFunnelParams(
            { ...midFunnel, maxAngleDeg: 55 },
            { radiusScale: 1.5, maxTiltDeg: 40, pullScale: 1.5 },
        );
        expect(keepBaseTilt.maxAngleDeg).toBe(55);
    });

    it('applyFunnelToBody 在多根候选柱中仅向最近且未满的一根施力', () => {
        const rightPillarX = TankSpace.pctToPxX(100 - DEFAULT_FEEL_CONFIG.pillarPosPct);
        const leftTarget: FunnelPillarTarget = { ...pillarTarget };
        const rightTarget: FunnelPillarTarget = {
            x: rightPillarX,
            z: 0,
            tipY: collider.tipY,
            baseTopY: collider.baseTopY,
            isFull: false,
        };

        const body = new TorusBody3D({
            x: rightPillarX + 18,
            y: collider.tipY + 12,
            z: 6,
            majorRadius: majorR,
            tubeRadius: tubeR,
        });
        body.vy = -70;

        const applied = applyFunnelToBody(body, [leftTarget, rightTarget], [midFunnel, midFunnel]);
        expect(applied).toBe(true);
        expect(body.fx).toBeLessThan(0);
        expect(body.fz).toBeLessThan(0);
    });

    it('TorusWorld3D 联调：差一点偏斜落向柱尖的圈在宽容=0 时落空，在宽容=0.5/1.0 时被扶正并稳稳入柱', () => {
        const dropRingWithTolerance = (tolerance: number, dx: number, dz: number, tiltX: number, tiltZ: number) => {
            const world = new TorusWorld3D();
            const p = world.addPillar(new PillarCollider3D(pillarX, pillarBottomY, geom));
            const solved = solveFeel({ ...DEFAULT_FEEL_CONFIG, funnelTolerance: tolerance });
            const q = quatFromEulerDeg(tiltX, 15, tiltZ, { x: 0, y: 0, z: 0, w: 1 });

            const ring = world.addBody(
                new TorusBody3D({
                    x: p.x + dx,
                    y: p.tipY + 42,
                    z: dz,
                    qx: q.x,
                    qy: q.y,
                    qz: q.z,
                    qw: q.w,
                    majorRadius: majorR,
                    tubeRadius: tubeR,
                    linearDamping: solved.ringLinearDamping,
                    angularDamping: solved.ringAngularDamping,
                }),
            );

            const target: FunnelPillarTarget = {
                x: p.x,
                z: 0,
                tipY: p.tipY,
                baseTopY: p.baseTopY,
                isFull: false,
            };

            for (let step = 0; step < 180; step++) {
                ring.applyCentralForce(0, -solved.baseSinkAccel * ring.mass, 0);
                applyFunnelToBody(ring, [target], [solved.funnel]);
                world.step(1 / 60);
            }

            return {
                ring,
                caught: isRingOnPillar3D({
                    centerX: ring.x,
                    centerY: ring.y,
                    centerZ: ring.z,
                    normalX: ring.basisN.x,
                    normalY: ring.basisN.y,
                    normalZ: ring.basisN.z,
                    innerRadius: innerR,
                    pillarX: p.x,
                    pillarZ: 0,
                    baseTopY: p.baseTopY,
                    tipY: p.tipY,
                    shaftRadiusAtY: p.shaftRadiusAtY(ring.y),
                }),
            };
        };

        // 偏心 26px + 前后偏移 12px + 倾斜 22°：宽容=0 必落空，宽容=0.5 成功扶正入柱
        const miss = dropRingWithTolerance(0, 26, 12, 16, -15);
        expect(miss.caught).toBe(false);
        expect(miss.ring.y).toBeLessThan(collider.baseTopY);

        const hitDefault = dropRingWithTolerance(0.5, 26, 12, 16, -15);
        expect(hitDefault.caught).toBe(true);
        expect(hitDefault.ring.y).toBeGreaterThanOrEqual(collider.baseTopY - 2);

        // 更偏且更大倾角（dx=42, tilt≈42°）：0.5 不足以收拢，拉满 1.0 后可扶正带进柱尖
        const missHalf = dropRingWithTolerance(0.5, 42, 14, 34, -26);
        expect(missHalf.caught).toBe(false);

        const hitMax = dropRingWithTolerance(1.0, 42, 14, 34, -26);
        expect(hitMax.caught).toBe(true);
    });

    it('潮引 boost 保底阈值在默认 10% 与 0% 宽容度下均提供稳定吸纳范围、倾角容忍与居中回正，并严格避开柱杆侧撞', () => {
        const zeroFunnel = solveFeel({ ...DEFAULT_FEEL_CONFIG, funnelTolerance: 0 }).funnel;
        const tideBoost = {
            radiusScale: 2.5,
            maxTiltDeg: 68,
            pullScale: 2.2,
            alignScale: 2.2,
            minRadiusPx: 155,
            minPullAccel: 1200,
            minAlignRate: 9.0,
            maxVy: 85,
        };

        // 即使基础宽容度为 0 或 0.1，叠加潮引 boost 后仍保证有效吸纳下限
        const fromZero = resolveEffectiveFunnelParams(zeroFunnel, tideBoost);
        expect(fromZero.radiusPx).toBe(155);
        expect(fromZero.maxAngleDeg).toBe(68);
        expect(fromZero.pullAccel).toBe(1200);
        expect(fromZero.alignRate).toBe(9.0);
        expect(fromZero.maxVy).toBe(85);

        const fromDefault = resolveEffectiveFunnelParams(defaultFunnel, tideBoost);
        expect(fromDefault.radiusPx).toBeGreaterThanOrEqual(155);
        expect(fromDefault.pullAccel).toBeGreaterThanOrEqual(1200);

        // 缓慢上浮趋缓（vy = +35 < 85）的偏斜圈可被潮引漏斗接管，高速喷起（vy = +150）则不硬扯
        const qTilt = quatFromEulerDeg(38, 0, -25, { x: 0, y: 0, z: 0, w: 1 });
        const body = new TorusBody3D({
            x: pillarX + 90,
            y: collider.tipY + 70,
            z: 20,
            qx: qTilt.x,
            qy: qTilt.y,
            qz: qTilt.z,
            qw: qTilt.w,
            majorRadius: majorR,
            tubeRadius: tubeR,
        });
        body.vy = 35;
        const resSlowRise = computeFunnelForce3D(body, pillarTarget, fromDefault);
        expect(resSlowRise.active).toBe(true);
        expect(resSlowRise.fx).toBeLessThan(0);
        expect(resSlowRise.fz).toBeLessThan(0);
        expect(Math.hypot(resSlowRise.tx, resSlowRise.tz)).toBeGreaterThan(0);

        body.vy = 150;
        expect(computeFunnelForce3D(body, pillarTarget, fromDefault).active).toBe(false);

        // 低于柱尖肩部且未套入内孔的圈即使在潮引期间也不会被侧向拉撞柱杆外壁
        body.vy = -40;
        body.setPose(pillarX + innerR + 12, collider.tipY - tubeR - 10, 0, qTilt.x, qTilt.y, qTilt.z, qTilt.w);
        expect(computeFunnelForce3D(body, pillarTarget, fromDefault).active).toBe(false);

        // 满柱不吸圈
        body.setPose(pillarX + 70, collider.tipY + 60, 0, qTilt.x, qTilt.y, qTilt.z, qTilt.w);
        expect(computeFunnelForce3D(body, { ...pillarTarget, isFull: true }, fromDefault).active).toBe(false);
    });
});
