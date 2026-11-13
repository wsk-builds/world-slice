import { _decorator, Component, Node } from 'cc';
import { SolvedFeelConfig } from '../core/flow/FeelSolver';
import { FlowField, FlowVec3 } from '../core/flow/FlowField';
import { calcEndpointFollowAccel } from '../core/flow/WaterFollow';
import { Bladder } from '../core/input/Bladder';
import { Vec3Like } from '../core/physics3d/Math3D';
import { PhysicsStepper } from './PhysicsStepper';
import { Ring } from './Ring';
import { RingLayer } from './RingLayer';

const { ccclass } = _decorator;

const samplePoints: readonly [Vec3Like, Vec3Like, Vec3Like, Vec3Like] = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
];
const sampleAccels: readonly [FlowVec3, FlowVec3, FlowVec3, FlowVec3] = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
];
const tempWaterVel3D: FlowVec3 = { x: 0, y: 0, z: 0 };
const tempPtVel: Vec3Like = { x: 0, y: 0, z: 0 };
const tempFollow2D = { x: 0, y: 0 };

/**
 * 三维水流施力组件（挂在 TankRoot 上）：
 * 每个物理步之前：
 * 1. 将左右气囊的当前出水强度喂给 FlowField，推进 FlowField 与气囊；
 * 2. 对每个未锁定正圆环圆周上的 4 个正交采样点（+U, -U, +V, -V）分别采样三维水速；
 * 3. 一端在喷流内、另一端在喷流外或受前后纵深涡流差作用时，天然产生绕 X/Y/Z 任意轴的真 3D 翻转力矩！
 */
@ccclass('WaterForce')
export class WaterForce extends Component {
    flowField!: FlowField;
    leftBladder: Bladder | null = null;
    rightBladder: Bladder | null = null;
    ringLayer: RingLayer | null = null;

    private stepper: PhysicsStepper | null = null;

    static attach(
        tankRoot: Node,
        flowField: FlowField,
        leftBladder: Bladder,
        rightBladder: Bladder,
        ringLayer: RingLayer,
    ): WaterForce {
        const wf = tankRoot.addComponent(WaterForce);
        wf.flowField = flowField;
        wf.leftBladder = leftBladder;
        wf.rightBladder = rightBladder;
        wf.ringLayer = ringLayer;
        return wf;
    }

    onLoad(): void {
        if (!this.flowField) {
            this.flowField = new FlowField();
        }
        this.stepper = this.getComponent(PhysicsStepper) ?? this.node.parent?.getComponent(PhysicsStepper) ?? null;
    }

    onEnable(): void {
        if (!this.stepper) {
            this.stepper = this.getComponent(PhysicsStepper) ?? this.node.parent?.getComponent(PhysicsStepper) ?? null;
        }
        this.stepper?.onBeforeStep(this.onBeforeStep);
    }

    onDisable(): void {
        this.stepper?.offBeforeStep(this.onBeforeStep);
    }

    /** 刷新底层水流与气囊配置（供调参动态生效） */
    applyConfig(): void {
        this.flowField?.applyConfig();
        this.leftBladder?.applyConfig();
        this.rightBladder?.applyConfig();
    }

    /** 重置水流与左右气囊状态 */
    reset(seed?: number): void {
        this.leftBladder?.reset();
        this.rightBladder?.reset();
        this.flowField?.reset(seed);
    }

    private onBeforeStep = (dt: number): void => {
        if (!this.flowField) {
            return;
        }

        const leftOut = this.leftBladder?.output ?? 0;
        const rightOut = this.rightBladder?.output ?? 0;
        this.flowField.setJetInputs(leftOut, rightOut);
        this.flowField.step(dt);
        this.leftBladder?.step(dt);
        this.rightBladder?.step(dt);

        if (!this.ringLayer || !this.stepper) {
            return;
        }

        const rings = this.ringLayer.getRings();
        if (rings.length === 0) {
            return;
        }

        /** 静躺缸底时向 z=0 中平面的微回中（让靠后玻璃的圈自然滑向缸底中线，彻底消除视觉浮空） */
        const halfDepth = this.stepper.world.tank.halfDepth;
        const torqueScale = SolvedFeelConfig.tumbleTorqueScale;
        const zSwirl = SolvedFeelConfig.zSwirlSpeed;
        const zCenterRate = SolvedFeelConfig.zCenteringRate;

        for (let i = 0; i < rings.length; i++) {
            const ring = rings[i];
            if (!ring.isValid || ring.locked || !ring.isBodyReady) {
                continue;
            }
            const b = ring.body3D;
            if (b.y < b.outerRadius * 1.35) {
                b.applyCentralForce(0, 0, -b.z * b.mass * 5.5);
            }
            this.applyWaterToRing(ring, halfDepth, torqueScale, zSwirl, zCenterRate);
        }
    };

    private applyWaterToRing(
        ring: Ring,
        halfDepth: number,
        torqueScale: number,
        zSwirl: number,
        zCenterRate: number,
    ): void {
        const b = ring.body3D;
        const R = b.majorRadius;

        // 圆环中心圆上的 4 个对称采样点：+U, -U, +V, -V
        samplePoints[0].x = b.x + b.basisU.x * R;
        samplePoints[0].y = b.y + b.basisU.y * R;
        samplePoints[0].z = b.z + b.basisU.z * R;

        samplePoints[1].x = b.x - b.basisU.x * R;
        samplePoints[1].y = b.y - b.basisU.y * R;
        samplePoints[1].z = b.z - b.basisU.z * R;

        samplePoints[2].x = b.x + b.basisV.x * R;
        samplePoints[2].y = b.y + b.basisV.y * R;
        samplePoints[2].z = b.z + b.basisV.z * R;

        samplePoints[3].x = b.x - b.basisV.x * R;
        samplePoints[3].y = b.y - b.basisV.y * R;
        samplePoints[3].z = b.z - b.basisV.z * R;

        const baseRate = SolvedFeelConfig.flowFollowRate;
        const kindFollow = ring.kindConfig.flowFollow;
        const effRate = Math.max(0, baseRate * kindFollow);

        let avgAx = 0;
        let avgAy = 0;
        let avgAz = 0;

        for (let k = 0; k < 4; k++) {
            const pt = samplePoints[k];
            const acc = sampleAccels[k];

            this.flowField.velocityAt3D(pt.x, pt.y, pt.z, halfDepth, zSwirl, zCenterRate, tempWaterVel3D);
            b.getPointVelocity(pt.x, pt.y, pt.z, tempPtVel);

            calcEndpointFollowAccel(
                tempWaterVel3D.x,
                tempWaterVel3D.y,
                tempPtVel.x,
                tempPtVel.y,
                baseRate,
                kindFollow,
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

        const quarterMass = 0.25 * b.mass;
        for (let k = 0; k < 4; k++) {
            const pt = samplePoints[k];
            const acc = sampleAccels[k];
            const ax = avgAx + torqueScale * (acc.x - avgAx);
            const ay = avgAy + torqueScale * (acc.y - avgAy);
            const az = avgAz + torqueScale * (acc.z - avgAz);

            b.applyForceAtPoint(quarterMass * ax, quarterMass * ay, quarterMass * az, pt.x, pt.y, pt.z);
        }

        // 水流体盘面俯仰流体动力：正圆环穿水运动时，盘面迎水偏角会产生自然的叶子飘落/翻滚流体力矩
        const relVx = tempWaterVel3D.x - b.vx;
        const relVy = tempWaterVel3D.y - b.vy;
        const relVz = tempWaterVel3D.z - b.vz;
        const relSpd = Math.hypot(relVx, relVy, relVz);
        if (relSpd > 25 && torqueScale > 0.05) {
            const dotN = (relVx * b.basisN.x + relVy * b.basisN.y + relVz * b.basisN.z) / relSpd;
            // cross(N, v_rel) 推动圆环随水流翻滚，产生视频里标志性的 3D 翻花感
            const cx = b.basisN.y * relVz - b.basisN.z * relVy;
            const cy = b.basisN.z * relVx - b.basisN.x * relVz;
            const cz = b.basisN.x * relVy - b.basisN.y * relVx;
            const flutterGain = 0.22 * b.mass * R * dotN * torqueScale;
            b.applyTorque(cx * flutterGain, cy * flutterGain, cz * flutterGain);
        }
    }
}
