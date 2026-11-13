import { _decorator, Component, Node, PHYSICS_2D_PTM_RATIO, Vec2 } from 'cc';
import { SolvedFeelConfig } from '../core/flow/FeelSolver';
import { FlowField, FlowVec2 } from '../core/flow/FlowField';
import { calcEndpointFollowAccel } from '../core/flow/WaterFollow';
import { Bladder } from '../core/input/Bladder';
import { PhysicsStepper } from './PhysicsStepper';
import { Ring } from './Ring';
import { RingLayer } from './RingLayer';

const { ccclass } = _decorator;

const FORCE_EPSILON = 1e-5;

const tempWorldLeft = new Vec2();
const tempWorldRight = new Vec2();
const tempEndWorldVel = new Vec2();
const tempForce = new Vec2();
const tempWaterVel: FlowVec2 = { x: 0, y: 0 };
const tempLeftAccel: FlowVec2 = { x: 0, y: 0 };
const tempRightAccel: FlowVec2 = { x: 0, y: 0 };

/**
 * 水流施力组件（GDD §3.3，T008 / T010），挂在 TankRoot 上：
 * 每个物理步之前：
 * 1. 将左右气囊的当前出水强度喂给 FlowField，并按物理步长 dt 推进 FlowField 与气囊；
 * 2. 对每个未锁定圈的左右两个端点分别采样缸坐标水速；
 * 3. 按「跟随度 ×（水速 − 端点速度）」计算加速度（按翻滚灵敏度调整差分力矩），换算为 Box2D 米制单位力并施于左右端点。
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

    /** 刷新底层水流与气囊配置（供 T010/T011 调参动态生效） */
    applyConfig(): void {
        this.flowField?.applyConfig();
        this.leftBladder?.applyConfig();
        this.rightBladder?.applyConfig();
    }

    /** 重置水流与左右气囊状态（重开或切关时使用） */
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

        if (!this.ringLayer) {
            return;
        }

        const rings = this.ringLayer.getRings();
        if (rings.length === 0) {
            return;
        }

        const origin = this.node.worldPosition;
        const sx = this.node.worldScale.x || 1;
        const sy = this.node.worldScale.y || 1;
        const torqueScale = SolvedFeelConfig.tumbleTorqueScale;

        for (let i = 0; i < rings.length; i++) {
            const ring = rings[i];
            if (!ring.isValid || ring.locked || !ring.isBodyReady) {
                continue;
            }

            ring.getWorldEnds(tempWorldLeft, tempWorldRight);
            const halfMass = 0.5 * ring.body.getMass();

            this.computeAccelAtEndpoint(ring, tempWorldLeft, origin.x, origin.y, sx, sy, tempLeftAccel);
            this.computeAccelAtEndpoint(ring, tempWorldRight, origin.x, origin.y, sx, sy, tempRightAccel);

            if (torqueScale !== 1) {
                const avgX = 0.5 * (tempLeftAccel.x + tempRightAccel.x);
                const avgY = 0.5 * (tempLeftAccel.y + tempRightAccel.y);
                tempLeftAccel.x = avgX + torqueScale * (tempLeftAccel.x - avgX);
                tempLeftAccel.y = avgY + torqueScale * (tempLeftAccel.y - avgY);
                tempRightAccel.x = avgX + torqueScale * (tempRightAccel.x - avgX);
                tempRightAccel.y = avgY + torqueScale * (tempRightAccel.y - avgY);
            }

            this.applyAccelAtPoint(ring, tempWorldLeft, tempLeftAccel, sx, sy, halfMass);
            this.applyAccelAtPoint(ring, tempWorldRight, tempRightAccel, sx, sy, halfMass);
        }
    };

    private computeAccelAtEndpoint(
        ring: Ring,
        worldEnd: Vec2,
        originX: number,
        originY: number,
        sx: number,
        sy: number,
        outAccel: FlowVec2,
    ): void {
        const tankX = (worldEnd.x - originX) / sx;
        const tankY = (worldEnd.y - originY) / sy;

        this.flowField.velocityAt(tankX, tankY, tempWaterVel);
        ring.body.getLinearVelocityFromWorldPoint(worldEnd, tempEndWorldVel);

        const endTankVx = tempEndWorldVel.x / sx;
        const endTankVy = tempEndWorldVel.y / sy;

        calcEndpointFollowAccel(
            tempWaterVel.x,
            tempWaterVel.y,
            endTankVx,
            endTankVy,
            SolvedFeelConfig.flowFollowRate,
            ring.kindConfig.flowFollow,
            outAccel,
        );
    }

    private applyAccelAtPoint(
        ring: Ring,
        worldEnd: Vec2,
        accel: FlowVec2,
        sx: number,
        sy: number,
        halfMass: number,
    ): void {
        const fx = (halfMass * accel.x * sx) / PHYSICS_2D_PTM_RATIO;
        const fy = (halfMass * accel.y * sy) / PHYSICS_2D_PTM_RATIO;

        if (Math.abs(fx) > FORCE_EPSILON || Math.abs(fy) > FORCE_EPSILON) {
            ring.body.applyForce(tempForce.set(fx, fy), worldEnd, true);
        }
    }
}
