import { _decorator, Component, Node, PHYSICS_2D_PTM_RATIO, Vec2 } from 'cc';
import { FeelConfig } from '../config/FeelConfig';
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
const tempAccel: FlowVec2 = { x: 0, y: 0 };

/**
 * 水流施力组件（GDD §3.3，T008），挂在 TankRoot 上：
 * 每个物理步之前：
 * 1. 将左右气囊的当前出水强度喂给 FlowField，并按物理步长 dt 推进 FlowField 与气囊；
 * 2. 对每个未锁定圈的左右两个端点分别采样缸坐标水速；
 * 3. 按「跟随度 ×（水速 − 端点速度）」计算加速度，换算为 Box2D 米制单位力并分别作用在左右端点上（天然产生翻滚力矩）。
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

        for (let i = 0; i < rings.length; i++) {
            const ring = rings[i];
            if (!ring.isValid || ring.locked || !ring.body?.impl) {
                continue;
            }

            ring.getWorldEnds(tempWorldLeft, tempWorldRight);
            const halfMass = 0.5 * ring.body.getMass();

            this.applyForceAtEndpoint(ring, tempWorldLeft, origin.x, origin.y, sx, sy, halfMass);
            this.applyForceAtEndpoint(ring, tempWorldRight, origin.x, origin.y, sx, sy, halfMass);
        }
    };

    private applyForceAtEndpoint(
        ring: Ring,
        worldEnd: Vec2,
        originX: number,
        originY: number,
        sx: number,
        sy: number,
        halfMass: number,
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
            FeelConfig.flowFollowRate,
            ring.kindConfig.flowFollow,
            tempAccel,
        );

        const fx = (halfMass * tempAccel.x * sx) / PHYSICS_2D_PTM_RATIO;
        const fy = (halfMass * tempAccel.y * sy) / PHYSICS_2D_PTM_RATIO;

        if (Math.abs(fx) > FORCE_EPSILON || Math.abs(fy) > FORCE_EPSILON) {
            ring.body.applyForce(tempForce.set(fx, fy), worldEnd, true);
        }
    }
}
