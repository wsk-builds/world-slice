import { _decorator, Color, Component, EventKeyboard, Graphics, Input, input, KeyCode, Node, UITransform } from 'cc';
import { GameConst } from '../config/GameConst';
import { TankSpace } from '../config/TankSpace';
import { PhysicsStepper } from '../game/PhysicsStepper';
import { RenderLayers } from '../render/Stage3DRig';

const { ccclass } = _decorator;

const WIRE_WALL = new Color(100, 223, 223, 190);
const WIRE_PILLAR = new Color(142, 230, 206, 220);
const WIRE_RING_FREE = new Color(255, 220, 102, 225);
const WIRE_RING_LOCKED = new Color(110, 250, 160, 225);

/**
 * 3D 物理碰撞轮廓调试绘制：按 P 键显示或隐藏水缸内壁、三段式锥形十字柱胶囊骨架与 3D 圆环中心碰撞圈。
 * 全程共用单个 Graphics，受 GameConst.DEBUG 控制。
 */
@ccclass('PhysicsDebugDraw')
export class PhysicsDebugDraw extends Component {
    private enabledDraw = false;
    private stepper: PhysicsStepper | null = null;
    private gfx: Graphics | null = null;

    onLoad(): void {
        this.stepper = this.getComponent(PhysicsStepper) ?? this.node.parent?.getComponent(PhysicsStepper) ?? null;

        const overlay = new Node('PhysicsDebugOverlay');
        overlay.layer = RenderLayers.FG_UI_2D;
        const tf = overlay.addComponent(UITransform);
        tf.setContentSize(TankSpace.width, TankSpace.height);
        tf.setAnchorPoint(0, 0);
        overlay.setPosition(0, 0, 0);
        this.node.addChild(overlay);
        this.gfx = overlay.addComponent(Graphics);
    }

    onEnable(): void {
        if (!GameConst.DEBUG) {
            return;
        }
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    onDisable(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        this.gfx?.clear();
    }

    toggle(): void {
        this.setDrawEnabled(!this.enabledDraw);
    }

    setDrawEnabled(show: boolean): void {
        this.enabledDraw = show;
        if (!show) {
            this.gfx?.clear();
        }
    }

    lateUpdate(): void {
        if (!this.enabledDraw || !this.gfx || !this.stepper) {
            return;
        }
        const gfx = this.gfx;
        gfx.clear();
        gfx.lineWidth = 2;

        const world = this.stepper.world;
        const { width, height, cornerRadius } = world.tank;

        // 1. 水缸与圆弧底角碰撞线
        gfx.strokeColor = WIRE_WALL;
        gfx.rect(0, 0, width, height);
        gfx.stroke();
        if (cornerRadius > 0) {
            gfx.arc(cornerRadius, cornerRadius, cornerRadius, Math.PI, Math.PI * 1.5, true);
            gfx.stroke();
            gfx.arc(width - cornerRadius, cornerRadius, cornerRadius, Math.PI * 1.5, Math.PI * 2, true);
            gfx.stroke();
        }

        // 2. 三段式锥形十字柱各胶囊段轮廓
        gfx.strokeColor = WIRE_PILLAR;
        for (const p of world.pillars) {
            for (const seg of p.segments) {
                gfx.moveTo(seg.ax, seg.ay);
                gfx.lineTo(seg.bx, seg.by);
                gfx.stroke();
                gfx.circle(seg.ax, seg.ay, seg.radiusA);
                gfx.stroke();
                gfx.circle(seg.bx, seg.by, seg.radiusB);
                gfx.stroke();
            }
        }

        // 3. 3D 圆环投影中心线与管半径采样点
        for (const b of world.bodies) {
            gfx.strokeColor = b.type === 'static' ? WIRE_RING_LOCKED : WIRE_RING_FREE;
            const steps = 16;
            for (let i = 0; i <= steps; i++) {
                const t = (i / steps) * Math.PI * 2;
                const c = Math.cos(t);
                const s = Math.sin(t);
                const px = b.x + b.majorRadius * (c * b.basisU.x + s * b.basisV.x);
                const py = b.y + b.majorRadius * (c * b.basisU.y + s * b.basisV.y);
                if (i === 0) {
                    gfx.moveTo(px, py);
                } else {
                    gfx.lineTo(px, py);
                }
            }
            gfx.stroke();
            gfx.circle(b.x, b.y, b.tubeRadius);
            gfx.stroke();
        }
    }

    private onKeyDown(event: EventKeyboard): void {
        if (event.keyCode === KeyCode.KEY_P) {
            this.toggle();
        }
    }
}
