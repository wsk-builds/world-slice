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
});
