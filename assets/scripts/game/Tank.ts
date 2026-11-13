import {
    _decorator, BoxCollider2D, Component, ERigidBody2DType, Graphics, Layers, Node, PolygonCollider2D, RigidBody2D,
    Size, UITransform, Vec2,
} from 'cc';
import { Palette } from '../config/Palette';
import { PhysicsGroupBit } from '../config/PhysicsGroups';
import { TankSpace } from '../config/TankSpace';
import { buildTankGeometry, TankGeometryData } from './TankGeometry';

const { ccclass } = _decorator;

/**
 * 水缸边界：静态物理墙体（四面直墙 + 左右向内圆弧底角折线）与灰盒内壁绘制。
 * 节点原点位于内屏左下角（缸坐标原点）。
 */
@ccclass('Tank')
export class Tank extends Component {
    private geometry: TankGeometryData | null = null;

    static create(tankRoot: Node): Tank {
        const node = new Node('Tank');
        node.layer = Layers.Enum.UI_2D;

        const transform = node.addComponent(UITransform);
        transform.setContentSize(TankSpace.width, TankSpace.height);
        transform.setAnchorPoint(0, 0);
        node.setPosition(0, 0, 0);

        const tank = node.addComponent(Tank);
        tankRoot.addChild(node);
        return tank;
    }

    onLoad(): void {
        const geom = buildTankGeometry();
        this.geometry = geom;

        this.createWallColliders(geom);
        this.drawWalls(geom);
    }

    private createWallColliders(geom: TankGeometryData): void {
        const body = this.node.addComponent(RigidBody2D);
        body.type = ERigidBody2DType.Static;
        body.group = PhysicsGroupBit.WALL;

        for (const rect of geom.wallRects) {
            const box = this.node.addComponent(BoxCollider2D);
            box.group = PhysicsGroupBit.WALL;
            box.offset = new Vec2(rect.x + rect.width / 2, rect.y + rect.height / 2);
            box.size = new Size(rect.width, rect.height);
            box.friction = 0.05;
            box.restitution = 0.1;
        }

        for (const strip of geom.cornerStrips) {
            const poly = this.node.addComponent(PolygonCollider2D);
            poly.group = PhysicsGroupBit.WALL;
            poly.points = strip.map((p) => new Vec2(p.x, p.y));
            poly.friction = 0.02;
            poly.restitution = 0.1;
        }
    }

    private drawWalls(geom: TankGeometryData): void {
        const gfx = this.node.addComponent(Graphics);
        const { width, height, leftCornerArc, rightCornerArc } = geom;

        // 填充左下角垫块（内壁弧线与直角外角 (0, 0) 之间）
        gfx.fillColor = Palette.tankCornerFill;
        gfx.moveTo(0, 0);
        for (const p of leftCornerArc) {
            gfx.lineTo(p.x, p.y);
        }
        gfx.close();
        gfx.fill();

        // 填充右下角垫块（内壁弧线与直角外角 (width, 0) 之间）
        gfx.moveTo(width, 0);
        for (const p of rightCornerArc) {
            gfx.lineTo(p.x, p.y);
        }
        gfx.close();
        gfx.fill();

        // 绘制内壁轮廓线与圆弧折线
        gfx.strokeColor = Palette.tankWallBorder;
        gfx.lineWidth = 2;

        const leftTop = leftCornerArc[0];
        const leftBottom = leftCornerArc[leftCornerArc.length - 1];
        const rightBottom = rightCornerArc[0];
        const rightTop = rightCornerArc[rightCornerArc.length - 1];

        gfx.moveTo(leftTop.x, height);
        gfx.lineTo(0, height);
        gfx.lineTo(leftTop.x, leftTop.y);
        for (let i = 1; i < leftCornerArc.length; i++) {
            gfx.lineTo(leftCornerArc[i].x, leftCornerArc[i].y);
        }
        gfx.lineTo(leftBottom.x, 0);
        gfx.lineTo(rightBottom.x, 0);
        for (let i = 1; i < rightCornerArc.length; i++) {
            gfx.lineTo(rightCornerArc[i].x, rightCornerArc[i].y);
        }
        gfx.lineTo(width, height);
        gfx.lineTo(rightTop.x, height);
        gfx.stroke();
    }

    getGeometry(): TankGeometryData | null {
        return this.geometry;
    }
}
