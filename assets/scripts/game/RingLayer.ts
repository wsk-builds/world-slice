import {
    _decorator, Color, Component, Graphics, Layers, Node, PHYSICS_2D_PTM_RATIO, toRadian, UITransform, Vec2,
} from 'cc';
import { FeelConfig } from '../config/FeelConfig';
import { Palette } from '../config/Palette';
import { TankSpace } from '../config/TankSpace';
import { RingSpec } from '../core/rings/RingKinds';
import { PhysicsStepper } from './PhysicsStepper';
import { calcRingDimensions, Ring } from './Ring';

const { ccclass } = _decorator;

const ELLIPSE_SEGMENTS = 24;
const tempForce = new Vec2();

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
        this.gfx = this.getComponent(Graphics) ?? this.addComponent(Graphics);
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

        const ring = Ring.createNode(spec, clampedX, clampedY, angleDeg);
        this.node.addChild(ring.node);
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
