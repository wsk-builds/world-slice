import {
    _decorator, BoxCollider2D, CircleCollider2D, Color, Component, ERigidBody2DType, Graphics, Layers, Node,
    PHYSICS_2D_PTM_RATIO, RigidBody2D, Size, toRadian, UITransform, Vec2,
} from 'cc';
import { FeelConfig } from '../config/FeelConfig';
import { calcRingPillarGeometry } from '../config/GameConst';
import { Palette } from '../config/Palette';
import { PhysicsGroupBit } from '../config/PhysicsGroups';
import { TankSpace } from '../config/TankSpace';
import { getRingKindConfig, RingKindConfig, RingSpec } from '../core/rings/RingKinds';
import { PhysicsStepper } from './PhysicsStepper';

const { ccclass } = _decorator;

const ELLIPSE_SEGMENTS = 24;
const DEFAULT_FLIP_DEG = 22;
const tempLocal = new Vec2();
const tempForce = new Vec2();

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

    get dimensions(): RingDimensions {
        return this.dims;
    }

    onLoad(): void {
        this.kindConfig = getRingKindConfig(this.spec);
        this.dims = calcRingDimensions(this.spec);

        const transform = this.getComponent(UITransform) ?? this.addComponent(UITransform);
        transform.setAnchorPoint(0.5, 0.5);
        transform.setContentSize(this.dims.outerDiameter, this.dims.thickness);

        const body = this.addComponent(RigidBody2D);
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

/**
 * 圈管理与共享绘制层，挂在 TankRoot 下，原点位于缸坐标 (0, 0)。
 * 全场所有圈共用此节点上的唯一 Graphics 绘制。
 */
@ccclass('RingLayer')
export class RingLayer extends Component {
    private gfx!: Graphics;
    private stepper: PhysicsStepper | null = null;
    private rings: Ring[] = [];

    static create(tankRoot: Node): RingLayer {
        const layerNode = new Node('Rings');
        layerNode.layer = Layers.Enum.UI_2D;

        const transform = layerNode.addComponent(UITransform);
        transform.setContentSize(TankSpace.width, TankSpace.height);
        transform.setAnchorPoint(0, 0);
        layerNode.setPosition(0, 0, 0);

        const layer = layerNode.addComponent(RingLayer);
        tankRoot.addChild(layerNode);
        return layer;
    }

    onLoad(): void {
        this.gfx = this.addComponent(Graphics);
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

    /** 在缸坐标 (x, y) 生成一个圈，坐标会被安全限制在缸壁内侧 */
    spawn(tankX: number, tankY: number, spec: RingSpec, angleDeg = 0): Ring {
        const dims = calcRingDimensions(spec);
        const marginX = dims.outerDiameter / 2 + 2;
        const marginY = dims.thickness / 2 + 2;
        const clampedX = Math.min(Math.max(tankX, marginX), TankSpace.width - marginX);
        const clampedY = Math.min(Math.max(tankY, marginY), TankSpace.height - marginY);

        const ringNode = new Node(`Ring_${spec.kind}_${spec.color ?? 'special'}`);
        ringNode.layer = Layers.Enum.UI_2D;
        ringNode.setPosition(clampedX, clampedY, 0);
        ringNode.angle = angleDeg;

        const ring = ringNode.addComponent(Ring);
        ring.spec = { kind: spec.kind, color: spec.color };
        this.node.addChild(ringNode);
        this.rings.push(ring);
        return ring;
    }

    /** 清空所有圈 */
    clearAll(): void {
        for (const ring of this.rings) {
            if (ring.isValid) {
                ring.node.destroy();
            }
        }
        this.rings.length = 0;
        this.gfx.clear();
    }

    getRings(): readonly Ring[] {
        return this.rings;
    }

    lateUpdate(): void {
        this.redrawAll();
    }

    private onBeforeStep = (_dt: number): void => {
        const scale = this.node.worldScale.x || 1;
        for (let i = this.rings.length - 1; i >= 0; i--) {
            const ring = this.rings[i];
            if (!ring.isValid) {
                this.rings.splice(i, 1);
                continue;
            }
            if (ring.locked || !ring.body) {
                continue;
            }
            const accelPx = FeelConfig.baseSinkAccel * ring.kindConfig.sinkScale;
            const mass = ring.body.getMass();
            const fy = -(mass * accelPx * scale) / PHYSICS_2D_PTM_RATIO;
            ring.body.applyForceToCenter(tempForce.set(0, fy), true);
        }
    };

    private redrawAll(): void {
        const gfx = this.gfx;
        gfx.clear();

        for (let i = this.rings.length - 1; i >= 0; i--) {
            const ring = this.rings[i];
            if (!ring.isValid) {
                this.rings.splice(i, 1);
                continue;
            }
            this.drawRing(gfx, ring);
        }
    }

    private drawRing(gfx: Graphics, ring: Ring): void {
        const { outerDiameter, thickness } = ring.dimensions;
        const cx = ring.node.position.x;
        const cy = ring.node.position.y;
        const rot = toRadian(ring.node.angle);
        const cosR = Math.cos(rot);
        const sinR = Math.sin(rot);

        const rx = (outerDiameter - thickness) / 2;
        const minor = Math.max(thickness, outerDiameter * Math.abs(Math.sin(toRadian(ring.flipDeg))));
        const ry = Math.max(0, (minor - thickness) / 2);

        const [mainColor, accentColor] = this.getRingColors(ring.spec);

        if (ry < 1) {
            const dx = cosR * rx;
            const dy = sinR * rx;
            gfx.lineCap = Graphics.LineCap.ROUND;
            gfx.strokeColor = mainColor;
            gfx.lineWidth = thickness;
            gfx.moveTo(cx - dx, cy - dy);
            gfx.lineTo(cx + dx, cy + dy);
            gfx.stroke();

            gfx.strokeColor = accentColor;
            gfx.lineWidth = Math.max(2, thickness * 0.22);
            gfx.moveTo(cx - dx * 0.85, cy - dy * 0.85);
            gfx.lineTo(cx + dx * 0.85, cy + dy * 0.85);
            gfx.stroke();
            return;
        }

        gfx.lineJoin = Graphics.LineJoin.ROUND;
        gfx.strokeColor = mainColor;
        gfx.lineWidth = thickness;
        this.traceRotatedEllipse(gfx, cx, cy, rx, ry, cosR, sinR);
        gfx.stroke();

        gfx.strokeColor = accentColor;
        gfx.lineWidth = Math.max(2, thickness * 0.22);
        this.traceRotatedEllipse(gfx, cx, cy, rx, ry, cosR, sinR);
        gfx.stroke();
    }

    private traceRotatedEllipse(
        gfx: Graphics,
        cx: number,
        cy: number,
        rx: number,
        ry: number,
        cosR: number,
        sinR: number,
    ): void {
        for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
            const t = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
            const lx = Math.cos(t) * rx;
            const ly = Math.sin(t) * ry;
            const wx = cx + lx * cosR - ly * sinR;
            const wy = cy + lx * sinR + ly * cosR;
            if (i === 0) {
                gfx.moveTo(wx, wy);
            } else {
                gfx.lineTo(wx, wy);
            }
        }
        gfx.close();
    }

    private getRingColors(spec: RingSpec): [Color, Color] {
        switch (spec.kind) {
            case 'gold':
                return [Palette.ring.gold, Palette.ring.goldAccent];
            case 'iron':
                return [Palette.ring.iron, Palette.ring.ironAccent];
            case 'wood':
                return [Palette.ring.wood, Palette.ring.woodAccent];
            case 'normal':
            default: {
                const c = spec.color ?? 'red';
                return [Palette.ring[c], Palette.ring.highlight];
            }
        }
    }
}
