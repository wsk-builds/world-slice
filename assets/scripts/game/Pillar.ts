import {
    _decorator, BoxCollider2D, Component, ERigidBody2DType, Graphics, Layers, Node, RigidBody2D, Size, UITransform,
    Vec2,
} from 'cc';
import { FeelConfig } from '../config/FeelConfig';
import { calcRingPillarGeometry, RingPillarGeometry } from '../config/GameConst';
import { Palette } from '../config/Palette';
import { PhysicsGroupBit } from '../config/PhysicsGroups';
import { TankSpace } from '../config/TankSpace';

const { ccclass } = _decorator;

export type PillarSide = 'left' | 'right';

/**
 * 悬空镇脉玉柱（灰盒）。
 * 节点原点位于底托底边中心（缸坐标）：底托向上为 [0, baseHeight]，柱杆向上为 [baseHeight, baseHeight + rodHeight]。
 * 两根柱子共用父容器上的同一个 Graphics 绘图，节省显存。
 */
@ccclass('Pillar')
export class Pillar extends Component {
    side: PillarSide = 'left';

    private baseCollider: BoxCollider2D | null = null;
    private rodCollider: BoxCollider2D | null = null;
    private sharedGraphics: Graphics | null = null;
    private siblingPillar: Pillar | null = null;
    private geom: RingPillarGeometry = calcRingPillarGeometry(TankSpace.width);

    /** 创建左右一对悬空柱（共用同一个 Graphics 节点绘制） */
    static createPair(tankRoot: Node): [Pillar, Pillar] {
        const layerNode = new Node('Pillars');
        layerNode.layer = Layers.Enum.UI_2D;
        const layerTransform = layerNode.addComponent(UITransform);
        layerTransform.setContentSize(TankSpace.width, TankSpace.height);
        layerTransform.setAnchorPoint(0, 0);
        layerNode.setPosition(0, 0, 0);
        tankRoot.addChild(layerNode);

        const sharedGfx = layerNode.addComponent(Graphics);

        const left = Pillar.createOne('left', sharedGfx);
        const right = Pillar.createOne('right', sharedGfx);
        left.siblingPillar = right;
        right.siblingPillar = left;

        left.applyLayout();
        right.applyLayout();
        layerNode.addChild(left.node);
        layerNode.addChild(right.node);
        Pillar.redrawPair(sharedGfx, left, right);

        return [left, right];
    }

    private static createOne(side: PillarSide, sharedGfx: Graphics): Pillar {
        const node = new Node(side === 'left' ? 'Pillar_Left' : 'Pillar_Right');
        node.layer = Layers.Enum.UI_2D;

        const transform = node.addComponent(UITransform);
        transform.setAnchorPoint(0.5, 0);

        const body = node.addComponent(RigidBody2D);
        body.type = ERigidBody2DType.Static;
        body.group = PhysicsGroupBit.PILLAR;

        const baseCollider = node.addComponent(BoxCollider2D);
        baseCollider.group = PhysicsGroupBit.PILLAR;
        baseCollider.friction = 0.2;
        baseCollider.restitution = 0.05;

        const rodCollider = node.addComponent(BoxCollider2D);
        rodCollider.group = PhysicsGroupBit.PILLAR;
        rodCollider.friction = 0.15;
        rodCollider.restitution = 0.05;

        const pillar = node.addComponent(Pillar);
        pillar.side = side;
        pillar.baseCollider = baseCollider;
        pillar.rodCollider = rodCollider;
        pillar.sharedGraphics = sharedGfx;

        return pillar;
    }

    /** 按 FeelConfig 与 GameConst 刷新位置、碰撞体尺寸及共享绘制 */
    applyLayout(redraw = false): void {
        const geom = calcRingPillarGeometry(TankSpace.width);
        this.geom = geom;

        const xPct = this.side === 'left' ? FeelConfig.pillarPosPct : 100 - FeelConfig.pillarPosPct;
        const x = TankSpace.pctToPxX(xPct);
        const y = TankSpace.pctToPxY(FeelConfig.pillarBottomPct);
        this.node.setPosition(x, y, 0);

        const totalH = geom.pillarBaseHeight + geom.pillarHeight;
        this.node.getComponent(UITransform)?.setContentSize(geom.pillarBaseWidth, totalH);

        if (this.baseCollider) {
            this.baseCollider.offset = new Vec2(0, geom.pillarBaseHeight / 2);
            this.baseCollider.size = new Size(geom.pillarBaseWidth, geom.pillarBaseHeight);
            this.baseCollider.apply();
        }

        if (this.rodCollider) {
            this.rodCollider.offset = new Vec2(0, geom.pillarBaseHeight + geom.pillarHeight / 2);
            this.rodCollider.size = new Size(geom.pillarWidth, geom.pillarHeight);
            this.rodCollider.apply();
        }

        if (redraw && this.sharedGraphics && this.siblingPillar) {
            Pillar.redrawPair(this.sharedGraphics, this, this.siblingPillar);
        }
    }

    /** 柱尖在缸坐标系下的 Y 坐标 */
    get tipY(): number {
        return this.node.position.y + this.geom.pillarBaseHeight + this.geom.pillarHeight;
    }

    /** 底托顶面在缸坐标系下的 Y 坐标 */
    get baseTopY(): number {
        return this.node.position.y + this.geom.pillarBaseHeight;
    }

    /** 柱杆宽度 */
    get rodWidth(): number {
        return this.geom.pillarWidth;
    }

    /** 柱杆高度（等于 6 个圈叠放高度） */
    get rodHeight(): number {
        return this.geom.pillarHeight;
    }

    /** 底托宽度（比中号圈内径宽） */
    get baseWidth(): number {
        return this.geom.pillarBaseWidth;
    }

    private static redrawPair(gfx: Graphics, a: Pillar, b: Pillar): void {
        gfx.clear();
        for (const p of [a, b]) {
            const x = p.node.position.x;
            const y = p.node.position.y;
            const { pillarWidth, pillarHeight, pillarBaseWidth, pillarBaseHeight } = p.geom;

            // 底托
            gfx.fillColor = Palette.pillarBaseFill;
            gfx.strokeColor = Palette.pillarBorder;
            gfx.lineWidth = 2;
            gfx.roundRect(x - pillarBaseWidth / 2, y, pillarBaseWidth, pillarBaseHeight, 4);
            gfx.fill();
            gfx.stroke();

            // 柱杆
            gfx.fillColor = Palette.pillarRodFill;
            gfx.roundRect(x - pillarWidth / 2, y + pillarBaseHeight, pillarWidth, pillarHeight, 4);
            gfx.fill();
            gfx.stroke();
        }
    }
}
