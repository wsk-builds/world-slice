import { _decorator, Component, Node, UITransform } from 'cc';
import { calcRingPillarGeometry, GameConst } from '../config/GameConst';
import { TankSpace } from '../config/TankSpace';
import { SolvedFeelConfig } from '../core/flow/FeelSolver';
import { RingSpec } from '../core/rings/RingKinds';
import { SeededRandom } from '../core/util/SeededRandom';
import { RenderLayers } from '../render/Stage3DRig';
import { PhysicsStepper } from './PhysicsStepper';
import { calcRingDimensions, Ring } from './Ring';

const { ccclass } = _decorator;

export interface SpawnRingPoseOptions {
    z?: number;
    pitchXDeg?: number;
    yawYDeg?: number;
    rollZDeg?: number;
}

/**
 * 3D 圈管理层，挂在 TankRoot 下：
 * - 将每个 Ring 的 TorusBody3D 纳入 PhysicsStepper.world；
 * - 每个物理步之前施加净下沉力；
 * - 每帧末尾将三维刚体位置与四元数同步到 3D 圆环节点。
 */
@ccclass('RingLayer')
export class RingLayer extends Component {
    tank3DRoot: Node | null = null;

    private stepper: PhysicsStepper | null = null;
    private rings: Ring[] = [];
    private spawnRng = new SeededRandom(GameConst.defaultLevelSeed ^ 0x5f3759df);

    static create(tankRoot: Node, tank3DRoot: Node): RingLayer {
        const layerNode = new Node('Rings');
        layerNode.layer = RenderLayers.BG_2D;

        const transform = layerNode.addComponent(UITransform);
        transform.setContentSize(TankSpace.width, TankSpace.height);
        transform.setAnchorPoint(0, 0);
        layerNode.setPosition(0, 0, 0);

        const layer = layerNode.addComponent(RingLayer);
        layer.tank3DRoot = tank3DRoot;
        tankRoot.addChild(layerNode);
        return layer;
    }

    onLoad(): void {
        this.stepper = this.node.parent?.getComponent(PhysicsStepper) ?? null;
    }

    onEnable(): void {
        if (!this.stepper) {
            this.stepper = this.node.parent?.getComponent(PhysicsStepper) ?? null;
        }
        this.stepper?.onBeforeStep(this.onBeforeStep);
    }

    onDisable(): void {
        this.stepper?.offBeforeStep(this.onBeforeStep);
    }

    /**
     * 在缸坐标 (x, y) 生成一个真 3D 正圆环。
     * 未指定姿态时使用确定性种子赋予轻微随机前后纵深与三维微倾，落底自然形成立体斜靠堆叠。
     */
    spawn(tankX: number, tankY: number, spec: RingSpec, angleDeg = 0, pose?: SpawnRingPoseOptions): Ring {
        const dims = calcRingDimensions(spec);
        const geom = calcRingPillarGeometry(TankSpace.width);
        const outerR = dims.outerDiameter * 0.5;
        const margin = outerR + 2;

        const clampedX = Math.min(Math.max(tankX, margin), TankSpace.width - margin);
        let clampedY = Math.min(Math.max(tankY, dims.tubeRadius + 2), TankSpace.height - margin);

        const r = GameConst.tankCornerRadius;
        const safeR = Math.max(0, r - 2);
        const cornerDx = Math.max(r - (clampedX - outerR), clampedX + outerR - (TankSpace.width - r));
        if (cornerDx > 0 && cornerDx < r) {
            const minBottomY = r - Math.sqrt(Math.max(0, safeR * safeR - cornerDx * cornerDx));
            clampedY = Math.max(clampedY, minBottomY + dims.tubeRadius + 4);
        }

        const maxSafeZ = Math.max(4, geom.tankDepth * 0.5 - outerR - 2);
        const z =
            pose?.z !== undefined
                ? Math.max(-maxSafeZ, Math.min(maxSafeZ, pose.z))
                : this.spawnRng.range(-maxSafeZ * 0.75, maxSafeZ * 0.75);
        const pitchXDeg = pose?.pitchXDeg ?? this.spawnRng.range(-24, 24);
        const yawYDeg = pose?.yawYDeg ?? this.spawnRng.range(0, 360);
        const rollZDeg = pose?.rollZDeg ?? (angleDeg !== 0 ? angleDeg : this.spawnRng.range(-18, 18));

        const ring = Ring.createNode(spec, clampedX, clampedY, z, pitchXDeg, yawYDeg, rollZDeg, this.tank3DRoot);
        this.node.addChild(ring.node);
        this.stepper?.world.addBody(ring.body3D);
        this.rings.push(ring);
        return ring;
    }

    /** 清空所有圈与刚体 */
    clearAll(): void {
        for (const ring of this.rings) {
            this.stepper?.world.removeBody(ring.body3D);
            if (ring.isValid) {
                ring.node.destroy();
            }
        }
        this.rings.length = 0;
    }

    getRings(): readonly Ring[] {
        return this.rings;
    }

    /** 同步所有活跃圈的底层物理参数（供 applyFeel 实时生效） */
    applyConfigToAll(): void {
        for (let i = this.rings.length - 1; i >= 0; i--) {
            const ring = this.rings[i];
            if (!ring.isValid) {
                this.rings.splice(i, 1);
                continue;
            }
            ring.applyConfig();
        }
    }

    lateUpdate(): void {
        for (let i = this.rings.length - 1; i >= 0; i--) {
            const ring = this.rings[i];
            if (!ring.isValid) {
                this.stepper?.world.removeBody(ring.body3D);
                this.rings.splice(i, 1);
                continue;
            }
            ring.syncVisualFromBody();
        }
    }

    private onBeforeStep = (_dt: number): void => {
        for (let i = this.rings.length - 1; i >= 0; i--) {
            const ring = this.rings[i];
            if (!ring.isValid) {
                this.stepper?.world.removeBody(ring.body3D);
                this.rings.splice(i, 1);
                continue;
            }
            if (ring.locked || !ring.isBodyReady) {
                continue;
            }
            const accelPx = SolvedFeelConfig.baseSinkAccel * ring.kindConfig.sinkScale;
            ring.body3D.applyCentralForce(0, -ring.body3D.mass * accelPx, 0);
        }
    };
}
