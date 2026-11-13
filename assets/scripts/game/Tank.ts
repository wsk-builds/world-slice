import { _decorator, Component, Graphics, Node, toRadian, UITransform } from 'cc';
import { FeelConfig } from '../config/FeelConfig';
import { Palette } from '../config/Palette';
import { TankSpace } from '../config/TankSpace';
import { RenderLayers } from '../render/Stage3DRig';
import { PhysicsStepper } from './PhysicsStepper';
import { buildTankGeometry, TankGeometryData } from './TankGeometry';

const { ccclass } = _decorator;

/**
 * 水缸边界：同步 TorusWorld3D 六面墙与圆弧底角尺寸，并在 2D 背景层绘制深水底色、圆弧内壁与海眼标记。
 * 节点原点位于内屏左下角（缸坐标原点）。
 */
@ccclass('Tank')
export class Tank extends Component {
    private geometry: TankGeometryData | null = null;
    private gfx: Graphics | null = null;

    static create(tankRoot: Node): Tank {
        const node = new Node('Tank');
        node.layer = RenderLayers.BG_2D;

        const transform = node.addComponent(UITransform);
        transform.setContentSize(TankSpace.width, TankSpace.height);
        transform.setAnchorPoint(0, 0);
        node.setPosition(0, 0, 0);

        const tank = node.addComponent(Tank);
        tankRoot.addChild(node);
        return tank;
    }

    onLoad(): void {
        this.geometry = buildTankGeometry();
        const stepper = this.node.parent?.getComponent(PhysicsStepper);
        stepper?.world.updateTankBounds(TankSpace.width, TankSpace.height);

        this.gfx = this.node.getComponent(Graphics) ?? this.node.addComponent(Graphics);
        this.redraw();
    }

    /** 按最新几何与海眼位置重绘水缸底色、圆弧底角及左右海眼标记（共用同一 Graphics） */
    redraw(): void {
        this.geometry = buildTankGeometry();
        const stepper = this.node.parent?.getComponent(PhysicsStepper);
        stepper?.world.updateTankBounds(TankSpace.width, TankSpace.height);

        if (!this.gfx || !this.geometry) {
            return;
        }
        this.gfx.clear();
        this.drawWalls(this.gfx, this.geometry);
        this.drawNozzles(this.gfx);
    }

    private drawWalls(gfx: Graphics, geom: TankGeometryData): void {
        const { width, height, leftCornerArc, rightCornerArc } = geom;

        // 内屏深水底色（与水缸内壁共用同一 Graphics）
        gfx.fillColor = Palette.innerWaterBg;
        gfx.fillRect(0, 0, width, height);

        // 填充左下角圆弧垫块
        gfx.fillColor = Palette.tankCornerFill;
        gfx.moveTo(0, 0);
        for (const p of leftCornerArc) {
            gfx.lineTo(p.x, p.y);
        }
        gfx.close();
        gfx.fill();

        // 填充右下角圆弧垫块
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

    /** 在缸底绘制左右海眼出水口灰盒标识（标示喷口位置与内倾朝向） */
    private drawNozzles(gfx: Graphics): void {
        const leftX = TankSpace.pctToPxX(FeelConfig.nozzlePosPct);
        const rightX = TankSpace.pctToPxX(100 - FeelConfig.nozzlePosPct);
        const tiltRad = toRadian(FeelConfig.nozzleTiltDeg);

        this.drawSingleNozzle(gfx, leftX, tiltRad);
        this.drawSingleNozzle(gfx, rightX, -tiltRad);
    }

    private drawSingleNozzle(gfx: Graphics, centerX: number, tiltRad: number): void {
        const baseHalfW = 24;
        const mouthHalfW = 16;
        const spoutH = 12;
        const shiftX = Math.sin(tiltRad) * spoutH;
        const topY = Math.cos(tiltRad) * spoutH;

        gfx.fillColor = Palette.nozzleFill;
        gfx.strokeColor = Palette.nozzleBorder;
        gfx.lineWidth = 2;

        gfx.moveTo(centerX - baseHalfW, 1);
        gfx.lineTo(centerX + baseHalfW, 1);
        gfx.lineTo(centerX + shiftX + mouthHalfW, topY);
        gfx.lineTo(centerX + shiftX - mouthHalfW, topY);
        gfx.close();
        gfx.fill();
        gfx.stroke();
    }

    getGeometry(): TankGeometryData | null {
        return this.geometry;
    }
}
