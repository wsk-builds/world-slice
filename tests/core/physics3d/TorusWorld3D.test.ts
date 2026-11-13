import { describe, expect, it } from 'vitest';
import { calcRingPillarGeometry } from '../../../assets/scripts/config/GameConst';
import { TankSpace } from '../../../assets/scripts/config/TankSpace';
import { quatFromEulerDeg } from '../../../assets/scripts/core/physics3d/Math3D';
import { PillarCollider3D } from '../../../assets/scripts/core/physics3d/PillarCollider3D';
import { TorusBody3D } from '../../../assets/scripts/core/physics3d/TorusBody3D';
import { TorusWorld3D } from '../../../assets/scripts/core/physics3d/TorusWorld3D';
import { calcRingTiltDeg3D, clampLockedRingPose3D, isRingOnPillar3D } from '../../../assets/scripts/core/rules/PillarStack';

describe('TorusWorld3D 真 3D 圆环翻转、锥形十字柱与立体堆叠', () => {
    const geom = calcRingPillarGeometry(TankSpace.width);
    const tubeR = geom.ringThickness * 0.5;
    const majorR = geom.ringOuterDiameter * 0.5 - tubeR;
    const innerR = geom.ringInnerDiameter * 0.5;

    it('偏心三维推力驱动正圆环产生绕 X/Y/Z 三轴的真 3D 翻转（可翻至接近 90° 正圆朝向镜头）', () => {
        const world = new TorusWorld3D();
        const ring = world.addBody(
            new TorusBody3D({
                x: 470,
                y: 260,
                z: 0,
                majorRadius: majorR,
                tubeRadius: tubeR,
                linearDamping: 0.4,
                angularDamping: 1.2,
            }),
        );

        let maxTiltDeg = 0;
        for (let step = 0; step < 90; step++) {
            // 在圆环前右边缘施加向上与向后的斜向冲力，激发三维翻滚
            ring.applyForceAtPoint(
                60,
                950,
                -180,
                ring.x + majorR * 0.8,
                ring.y,
                ring.z + majorR * 0.6,
            );
            world.step(1 / 60);
            const tilt = calcRingTiltDeg3D(ring.basisN.x, ring.basisN.y, ring.basisN.z);
            if (tilt > maxTiltDeg) {
                maxTiltDeg = tilt;
            }
        }

        // 显著突破旧版固定 22° 扁椭圆，发生大角度真 3D 翻转
        expect(maxTiltDeg).toBeGreaterThan(60);
        expect(Math.hypot(ring.wx, ring.wy, ring.wz)).toBeGreaterThan(0.5);
    });

    it('正圆环对准锥形十字柱下落时穿过锥杆并稳稳停在十字四翼卡托上，满足 3D 套中判定', () => {
        const world = new TorusWorld3D();
        const pillarX = TankSpace.pctToPxX(24);
        const pillarBottomY = TankSpace.pctToPxY(31);
        const pillar = world.addPillar(new PillarCollider3D(pillarX, pillarBottomY, geom));

        const q = quatFromEulerDeg(12, 25, -8, { x: 0, y: 0, z: 0, w: 1 });
        const ring = world.addBody(
            new TorusBody3D({
                x: pillarX + 4,
                y: pillar.tipY + 35,
                z: -3,
                qx: q.x,
                qy: q.y,
                qz: q.z,
                qw: q.w,
                majorRadius: majorR,
                tubeRadius: tubeR,
                linearDamping: 0.6,
                angularDamping: 3.5,
            }),
        );

        for (let step = 0; step < 180; step++) {
            ring.applyCentralForce(0, -520 * ring.mass, 0);
            world.step(1 / 60);
        }

        // 十字四翼卡托兜住圆环，不会漏到尾椎下方，且柱杆穿过圆环内孔
        expect(ring.y).toBeGreaterThan(pillar.baseTopY - 2);
        expect(ring.y).toBeLessThan(pillar.baseTopY + geom.ringThickness * 1.8);
        expect(
            isRingOnPillar3D({
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
            }),
        ).toBe(true);

        // 大号木圈（1.15x）与小金环（0.8x）对准柱杆落下同样稳稳停在收短后的卡托上不漏底
        for (const scale of [0.8, 1.15]) {
            const subWorld = new TorusWorld3D();
            const subPillar = subWorld.addPillar(new PillarCollider3D(pillarX, pillarBottomY, geom));
            const r = subWorld.addBody(
                new TorusBody3D({
                    x: pillarX + 3,
                    y: subPillar.tipY + 30,
                    z: -2,
                    majorRadius: majorR * scale,
                    tubeRadius: tubeR * scale,
                    linearDamping: 0.6,
                    angularDamping: 3.5,
                }),
            );
            for (let step = 0; step < 180; step++) {
                r.applyCentralForce(0, -520 * r.mass, 0);
                subWorld.step(1 / 60);
            }
            expect(r.y).toBeGreaterThan(subPillar.baseTopY - 2);
        }
    });

    it('多个圈在缸底沉降碰撞后形成含前后 Z 错位与自然斜靠的真实 3D 堆叠，不穿底不越界', () => {
        const world = new TorusWorld3D();
        const rings: TorusBody3D[] = [];
        for (let i = 0; i < 5; i++) {
            const q = quatFromEulerDeg(-25 + i * 14, i * 47, -18 + i * 11, { x: 0, y: 0, z: 0, w: 1 });
            rings.push(
                world.addBody(
                    new TorusBody3D({
                        x: 460 + (i % 2) * 26,
                        y: 65 + i * 38,
                        z: -14 + i * 7,
                        qx: q.x,
                        qy: q.y,
                        qz: q.z,
                        qw: q.w,
                        majorRadius: majorR,
                        tubeRadius: tubeR,
                    }),
                ),
            );
        }

        for (let step = 0; step < 240; step++) {
            for (const r of rings) {
                r.applyCentralForce(0, -520 * r.mass, 0);
            }
            world.step(1 / 60);
        }

        const zs = rings.map((r) => r.z);
        const tilts = rings.map((r) => calcRingTiltDeg3D(r.basisN.x, r.basisN.y, r.basisN.z));

        for (const r of rings) {
            expect(Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.z)).toBe(true);
            expect(r.y).toBeGreaterThanOrEqual(tubeR - 1.5);
            expect(Math.abs(r.z)).toBeLessThanOrEqual(world.tank.halfDepth);
        }
        // 堆叠后存在明显的前后 Z 分层与斜靠倾角，而非全部拍平在同一平面
        expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(2);
        expect(Math.max(...tilts)).toBeGreaterThan(3);
    });

    it('clampLockedRingPose3D 保留自然 3D 微倾方位，同时把过大歪斜夹紧在 15° 内并防穿柱', () => {
        const qSteep = quatFromEulerDeg(28, 40, -16, { x: 0, y: 0, z: 0, w: 1 });
        const clamped = clampLockedRingPose3D({
            x: 245,
            y: 255,
            z: 18,
            quat: qSteep,
            pillarX: 225.6,
            pillarZ: 0,
            slotCenterY: 254,
            innerRadius: innerR,
            shaftRadiusAtSlot: 12,
            maxRestTiltDeg: 15,
        });

        const probe = new TorusBody3D({
            x: clamped.x,
            y: clamped.y,
            z: clamped.z,
            qx: clamped.quat.x,
            qy: clamped.quat.y,
            qz: clamped.quat.z,
            qw: clamped.quat.w,
            majorRadius: majorR,
            tubeRadius: tubeR,
        });
        const lockedTilt = calcRingTiltDeg3D(probe.basisN.x, probe.basisN.y, probe.basisN.z);
        // 既不归零成死板 0°，也不超过 15° 上限
        expect(lockedTilt).toBeGreaterThan(10);
        expect(lockedTilt).toBeLessThanOrEqual(15.05);
        expect(Math.hypot(clamped.x - 225.6, clamped.z)).toBeLessThan(innerR - 12);
    });

    it('未套入柱杆的圈贴着柱杆外侧擦过十字卡托时不会卡在卡托翼尖上，而是顺滑翻落至缸底', () => {
        for (const scale of [1.0, 0.8]) {
            const world = new TorusWorld3D();
            const pillarX = TankSpace.pctToPxX(24);
            const pillarBottomY = TankSpace.pctToPxY(31);
            const pillar = world.addPillar(new PillarCollider3D(pillarX, pillarBottomY, geom));

            const curTubeR = tubeR * scale;
            const curMajorR = majorR * scale;
            const curOuterR = curMajorR + curTubeR;

            // 将圈放置在柱杆右侧外缘紧贴处（未套入柱杆，最易挂卡在过长卡托上的临界位置）
            const startX = pillarX + pillar.rootRadius + curOuterR + 1.5;
            const ring = world.addBody(
                new TorusBody3D({
                    x: startX,
                    y: pillar.baseTopY + 36,
                    z: 0,
                    majorRadius: curMajorR,
                    tubeRadius: curTubeR,
                    linearDamping: 0.5,
                    angularDamping: 3.3,
                }),
            );

            for (let step = 0; step < 180; step++) {
                ring.applyCentralForce(0, -520 * ring.mass, 0);
                world.step(1 / 60);
            }

            // 必须顺滑脱离十字卡托并落到尾椎下方的缸底区域，绝不卡在卡托高度
            expect(ring.y).toBeLessThan(pillar.tailBottomY);
        }
    });

    it('竖立圆环从下方或侧面冲向十字卡托时绝不会像挂钩一样竖挂在卡托翅膀上', () => {
        for (const [pitchX, rollZ] of [
            [8, 82],
            [82, 8],
        ] as const) {
            const world = new TorusWorld3D();
            const pillarX = TankSpace.pctToPxX(32.5);
            const pillarBottomY = TankSpace.pctToPxY(31);
            const pillar = world.addPillar(new PillarCollider3D(pillarX, pillarBottomY, geom));

            const qVert = quatFromEulerDeg(pitchX, 12, rollZ, { x: 0, y: 0, z: 0, w: 1 });
            const ring = world.addBody(
                new TorusBody3D({
                    x: pillarX - 18,
                    y: pillar.tailBottomY - 15,
                    z: 0,
                    qx: qVert.x,
                    qy: qVert.y,
                    qz: qVert.z,
                    qw: qVert.w,
                    majorRadius: majorR,
                    tubeRadius: tubeR,
                }),
            );

            // 先向上冲 0.35 秒撞击卡托底部/侧翼，随后停止冲力靠重力自然回落到缸底
            for (let step = 0; step < 220; step++) {
                const fy = step < 21 ? 1400 * ring.mass : -520 * ring.mass;
                ring.applyCentralForce(0, fy, 0);
                world.step(1 / 60);
            }

            expect(ring.y).toBeLessThan(60);
        }
    });

    it('落入水缸最右下角/左下角的多个圈会自动沿圆弧滑向海眼，按喷射键可直接全部冲起不卡死角', () => {
        const world = new TorusWorld3D();
        const outerR = majorR + tubeR;

        // 在最右下角紧贴右壁堆放 3 个圈（复现截图右下角三圈堆积场景）
        const cornerRings: TorusBody3D[] = [];
        for (let i = 0; i < 3; i++) {
            const q = quatFromEulerDeg(-10 + i * 8, i * 35, 14 - i * 9, { x: 0, y: 0, z: 0, w: 1 });
            cornerRings.push(
                world.addBody(
                    new TorusBody3D({
                        x: TankSpace.width - outerR - 2 - i * 4,
                        y: 128 + i * 28,
                        z: -6 + i * 6,
                        qx: q.x,
                        qy: q.y,
                        qz: q.z,
                        qw: q.w,
                        majorRadius: majorR,
                        tubeRadius: tubeR,
                    }),
                ),
            );
        }

        // 不喷水自然沉降 1.5 秒：所有圈都沿光滑 122px 圆弧向内滑入右海眼喷流覆盖区（x < width - 78）
        for (let step = 0; step < 90; step++) {
            for (const r of cornerRings) {
                r.applyCentralForce(0, -520 * r.mass, 0);
            }
            world.step(1 / 60);
        }

        const rightJetOuterEdge = TankSpace.pctToPxX(86) + 68;
        for (const r of cornerRings) {
            expect(r.x - majorR).toBeLessThan(rightJetOuterEdge);
        }
    });

    it('圈落定在柱上与相互堆叠时平滑静止不发生突变跳动', () => {
        const world = new TorusWorld3D();
        const pillarX = TankSpace.pctToPxX(32.5);
        const pillarBottomY = TankSpace.pctToPxY(31);
        const pillar = world.addPillar(new PillarCollider3D(pillarX, pillarBottomY, geom));

        const r1 = world.addBody(
            new TorusBody3D({
                x: pillarX + 2,
                y: pillar.baseTopY + tubeR + 18,
                z: 0,
                majorRadius: majorR,
                tubeRadius: tubeR,
                linearDamping: 0.6,
                angularDamping: 3.5,
            }),
        );
        const r2 = world.addBody(
            new TorusBody3D({
                x: pillarX - 2,
                y: pillar.baseTopY + tubeR * 3 + 38,
                z: 1,
                majorRadius: majorR,
                tubeRadius: tubeR,
                linearDamping: 0.6,
                angularDamping: 3.5,
            }),
        );

        let prevY1 = r1.y;
        let prevY2 = r2.y;
        let maxUpJumpAfterSettle = 0;

        for (let step = 0; step < 180; step++) {
            r1.applyCentralForce(0, -520 * r1.mass, 0);
            r2.applyCentralForce(0, -520 * r2.mass, 0);
            world.step(1 / 60);

            if (step > 60) {
                maxUpJumpAfterSettle = Math.max(maxUpJumpAfterSettle, Math.abs(r1.y - prevY1), Math.abs(r2.y - prevY2));
            }
            prevY1 = r1.y;
            prevY2 = r2.y;
        }

        // 落定后单帧位移严格小于 0.5px，无任何位置修正过推或锁定瞬移跳动
        expect(maxUpJumpAfterSettle).toBeLessThan(0.5);
    });

    it('onCollision 区分圈撞缸壁/圈撞圈 vs 圈碰柱，合并 120Hz 双子步多接触点，并过滤静止支撑微颤', () => {
        const world = new TorusWorld3D();
        const pillarX = TankSpace.pctToPxX(24);
        const pillarBottomY = TankSpace.pctToPxY(31);
        const pillar = world.addPillar(new PillarCollider3D(pillarX, pillarBottomY, geom));

        const events: Array<{ kind: string; pillarIndex: number; normalImpulse: number }> = [];
        const unsub = world.onCollision((ev) => {
            events.push({
                kind: ev.kind,
                pillarIndex: ev.pillarIndex,
                normalImpulse: ev.normalImpulse,
            });
        });

        // 1. 圈落撞缸底：单步内多接触点与双子步合并去重，触地帧仅触发 1 次 tank 回调，静止后不再误触发
        const floorRing = world.addBody(
            new TorusBody3D({
                x: TankSpace.width * 0.5,
                y: tubeR + 22,
                z: 0,
                majorRadius: majorR,
                tubeRadius: tubeR,
            }),
        );
        floorRing.vy = -180;

        let impactStep = -1;
        let impactEventsThisStep = 0;
        for (let step = 0; step < 90; step++) {
            const before = events.length;
            floorRing.applyCentralForce(0, -520 * floorRing.mass, 0);
            world.step(1 / 60);
            const delta = events.length - before;
            if (delta > 0 && impactStep < 0) {
                impactStep = step;
                impactEventsThisStep = delta;
            }
            // 落定静止后（后 40 步）不应再触发任何静止支撑噪声回调
            if (step >= 50) {
                expect(delta).toBe(0);
            }
        }
        expect(impactStep).toBeGreaterThanOrEqual(0);
        expect(impactEventsThisStep).toBe(1);
        expect(events.some((e) => e.kind === 'tank' && e.normalImpulse >= world.collisionImpulseThreshold)).toBe(true);

        // 2. 圈撞击已静止休眠圈（static）应触发 1 次 ring 碰撞，而两个 static 圈互不触发
        events.length = 0;
        floorRing.type = 'static';
        const hitRing = world.addBody(
            new TorusBody3D({
                x: floorRing.x,
                y: floorRing.y + tubeR * 2 + 18,
                z: 0,
                majorRadius: majorR,
                tubeRadius: tubeR,
            }),
        );
        hitRing.vy = -210;
        for (let step = 0; step < 30; step++) {
            const before = events.length;
            hitRing.applyCentralForce(0, -520 * hitRing.mass, 0);
            world.step(1 / 60);
            expect(events.length - before).toBeLessThanOrEqual(1);
        }
        expect(events.some((e) => e.kind === 'ring')).toBe(true);

        // 3. 圈擦撞柱杆应触发 pillar 回调且带对应 pillarIndex
        events.length = 0;
        world.clearBodies();
        const rimRing = world.addBody(
            new TorusBody3D({
                x: pillarX + majorR + pillar.tipRadius * 0.5,
                y: pillar.tipY + 26,
                z: 0,
                majorRadius: majorR,
                tubeRadius: tubeR,
            }),
        );
        rimRing.vy = -220;
        for (let step = 0; step < 30; step++) {
            const before = events.length;
            rimRing.applyCentralForce(0, -520 * rimRing.mass, 0);
            world.step(1 / 60);
            expect(events.length - before).toBeLessThanOrEqual(1);
        }
        expect(events.some((e) => e.kind === 'pillar' && e.pillarIndex === 0)).toBe(true);

        // 4. 取消订阅后不再收到任何碰撞事件
        events.length = 0;
        unsub();
        rimRing.y = tubeR + 20;
        rimRing.vy = -240;
        for (let step = 0; step < 20; step++) {
            world.step(1 / 60);
        }
        expect(events).toHaveLength(0);
    });
});
