import {
    _decorator, BoxCollider2D, CircleCollider2D, Component, ERigidBody2DType, Layers, Node, RigidBody2D, Size,
    toRadian, UITransform, Vec2,
} from 'cc';
import { FeelConfig } from '../config/FeelConfig';
import { calcRingPillarGeometry } from '../config/GameConst';
import { PhysicsGroupBit } from '../config/PhysicsGroups';
import { TankSpace } from '../config/TankSpace';
import { getRingKindConfig, RingKindConfig, RingSpec } from '../core/rings/RingKinds';

const { ccclass } = _decorator;

const DEFAULT_FLIP_DEG = 22;
const tempLocal = new Vec2();

export interface RingDimensions {
    outerDiameter: number;
    thickness: number;
    endRadius: number;
    endOffset: number;
}

/** 根据缸宽与圈种计算实际外径、管粗和端点圆心偏移 */
export function calcRingDimensions(spec: RingSpec): RingDimensions {
    const base = calcRingPillarGeometry(TankSpace.width);
    const kindCfg = getRingKindConfig(spec);
    const outerDiameter = base.ringOuterDiameter * kindCfg.sizeScale;
    const thickness = base.ringThickness * kindCfg.sizeScale;
    const endRadius = thickness / 2;
    const endOffset = outerDiameter / 2 - endRadius;
    return { outerDiameter, thickness, endRadius, endOffset };
}

/**
 * 锁脉环（圈）物理体组件（GDD §3.2、§3.4、§4.1）。
 * 结构：1 个开启 bullet 的动态刚体 + 2 个端点小圆（RING_END）+ 1 根横贯细条（RING_BAR）。
 * 所有圈共用父容器 RingLayer 上的同一个 Graphics 绘制。
 */
@ccclass('Ring')
export class Ring extends Component {
    spec: RingSpec = { kind: 'normal', color: 'red' };
    kindConfig: RingKindConfig = getRingKindConfig('normal');
    body!: RigidBody2D;

    /** 是否已锁定在柱上（T012 使用）；锁定后跳过净下沉力 */
    locked = false;
    /** 视觉倾角（度），决定灰盒扁椭圆的短轴与后续 3D 侧翻角 */
    flipDeg = DEFAULT_FLIP_DEG;

    private dims: RingDimensions = calcRingDimensions({ kind: 'normal', color: 'red' });
    private leftEnd!: CircleCollider2D;
    private rightEnd!: CircleCollider2D;
    private centerBar!: BoxCollider2D;
    private initialized = false;

    get dimensions(): RingDimensions {
        return this.dims;
    }

    /**
     * 在挂入父节点前创建并配好节点与物理组件，确保 RigidBody2D.bullet 等仅在初始化时读取的属性生效。
     */
    static createNode(spec: RingSpec, x: number, y: number, angleDeg = 0): Ring {
        const ringNode = new Node(`Ring_${spec.kind}_${spec.color ?? 'special'}`);
        ringNode.layer = Layers.Enum.UI_2D;
        ringNode.setPosition(x, y, 0);
        ringNode.angle = angleDeg;

        const ring = ringNode.addComponent(Ring);
        ring.spec = { kind: spec.kind, color: spec.color };
        ring.setupPhysics();
        return ring;
    }

    onLoad(): void {
        if (!this.initialized) {
            this.setupPhysics();
        }
    }

    private setupPhysics(): void {
        if (this.initialized) {
            return;
        }
        this.initialized = true;
        this.kindConfig = getRingKindConfig(this.spec);
        this.dims = calcRingDimensions(this.spec);

        const transform = this.getComponent(UITransform) ?? this.addComponent(UITransform);
        transform.setAnchorPoint(0.5, 0.5);
        transform.setContentSize(this.dims.outerDiameter, this.dims.thickness);

        const body = this.getComponent(RigidBody2D) ?? this.addComponent(RigidBody2D);
        body.type = ERigidBody2DType.Dynamic;
        body.bullet = true;
        body.gravityScale = 0;
        body.group = PhysicsGroupBit.RING_BAR;
        this.body = body;

        this.leftEnd = this.addComponent(CircleCollider2D);
        this.leftEnd.group = PhysicsGroupBit.RING_END;
        this.leftEnd.density = 0.5;
        this.leftEnd.friction = 0.15;
        this.leftEnd.restitution = 0.05;

        this.rightEnd = this.addComponent(CircleCollider2D);
        this.rightEnd.group = PhysicsGroupBit.RING_END;
        this.rightEnd.density = 0.5;
        this.rightEnd.friction = 0.15;
        this.rightEnd.restitution = 0.05;

        this.centerBar = this.addComponent(BoxCollider2D);
        this.centerBar.group = PhysicsGroupBit.RING_BAR;
        this.centerBar.density = 1.0;

        this.applyConfig();
    }

    /** 同步 FeelConfig 阻尼/摩擦与碰撞体几何尺寸 */
    applyConfig(): void {
        this.kindConfig = getRingKindConfig(this.spec);
        this.dims = calcRingDimensions(this.spec);

        this.body.linearDamping = FeelConfig.ringLinearDamping;
        this.body.angularDamping = FeelConfig.ringAngularDamping;

        const transform = this.getComponent(UITransform);
        transform?.setContentSize(this.dims.outerDiameter, this.dims.thickness);

        this.leftEnd.radius = this.dims.endRadius;
        this.leftEnd.offset = new Vec2(-this.dims.endOffset, 0);
        this.leftEnd.apply();

        this.rightEnd.radius = this.dims.endRadius;
        this.rightEnd.offset = new Vec2(this.dims.endOffset, 0);
        this.rightEnd.apply();

        this.centerBar.offset = new Vec2(0, 0);
        this.centerBar.size = new Size(this.dims.outerDiameter, this.dims.thickness);
        this.centerBar.friction = FeelConfig.ringFriction;
        this.centerBar.restitution = FeelConfig.ringRestitution;
        this.centerBar.apply();
    }

    /** 获取两个端点圆心在物理世界坐标系下的位置（给物理施力与判定使用） */
    getWorldEnds(outLeft: Vec2, outRight: Vec2): void {
        this.body.getWorldPoint(tempLocal.set(-this.dims.endOffset, 0), outLeft);
        this.body.getWorldPoint(tempLocal.set(this.dims.endOffset, 0), outRight);
    }

    /** 获取两个端点圆心在缸坐标系下的近似位置（基于当前节点位姿） */
    getTankEnds(outLeft: Vec2, outRight: Vec2): void {
        const rad = toRadian(this.node.angle);
        const dx = Math.cos(rad) * this.dims.endOffset;
        const dy = Math.sin(rad) * this.dims.endOffset;
        const cx = this.node.position.x;
        const cy = this.node.position.y;
        outLeft.set(cx - dx, cy - dy);
        outRight.set(cx + dx, cy + dy);
    }
}
