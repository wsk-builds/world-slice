import { _decorator, Component, MeshRenderer, Node, UITransform } from 'cc';
import { FeelConfig } from '../config/FeelConfig';
import { calcRingPillarGeometry, RingPillarGeometry } from '../config/GameConst';
import { TankSpace } from '../config/TankSpace';
import { PillarCollider3D } from '../core/physics3d/PillarCollider3D';
import {
    bindRendererMaterial,
    createPillarCrossGuardMesh,
    createPillarSpindleMesh,
    getOrCreatePillarMaterials,
} from '../render/MeshFactory3D';
import { RenderLayers, Stage3DRig } from '../render/Stage3DRig';
import { PhysicsStepper } from './PhysicsStepper';

const { ccclass } = _decorator;

export type PillarSide = 'left' | 'right';

/**
 * 三段式锥形十字玉柱（复刻参考视频造型：上尖下粗圆锥杆 + 十字四翼卡托 + 下端悬空收尖尾椎）。
 * 2D 节点保留在 TankRoot 下提供缸坐标引用，3D 网格挂在 Stage3DRig.tank3DRoot 下参与深度缓冲与光照渲染，
 * 物理碰撞由 PillarCollider3D 注册进 TorusWorld3D。
 */
@ccclass('Pillar')
export class Pillar extends Component {
    side: PillarSide = 'left';
    collider3D!: PillarCollider3D;

    private geom: RingPillarGeometry = calcRingPillarGeometry(TankSpace.width);
    private view3DRoot: Node | null = null;
    private spindleRenderer: MeshRenderer | null = null;
    private crossRenderer: MeshRenderer | null = null;

    static createPair(tankRoot: Node, tank3DRoot: Node): [Pillar, Pillar] {
        const layerNode = new Node('Pillars');
        layerNode.layer = RenderLayers.BG_2D;
        const layerTransform = layerNode.addComponent(UITransform);
        layerTransform.setContentSize(TankSpace.width, TankSpace.height);
        layerTransform.setAnchorPoint(0, 0);
        layerNode.setPosition(0, 0, 0);
        tankRoot.addChild(layerNode);

        const stepper = tankRoot.getComponent(PhysicsStepper);

        const left = Pillar.createOne('left', tank3DRoot, stepper);
        const right = Pillar.createOne('right', tank3DRoot, stepper);

        layerNode.addChild(left.node);
        layerNode.addChild(right.node);

        left.applyLayout();
        right.applyLayout();

        return [left, right];
    }

    private static createOne(side: PillarSide, tank3DRoot: Node, stepper: PhysicsStepper | null): Pillar {
        const name = side === 'left' ? 'Pillar_Left' : 'Pillar_Right';
        const node = new Node(name);
        node.layer = RenderLayers.BG_2D;

        const transform = node.addComponent(UITransform);
        transform.setAnchorPoint(0.5, 0);

        const pillar = node.addComponent(Pillar);
        pillar.side = side;

        const geom = calcRingPillarGeometry(TankSpace.width);
        const xPct = side === 'left' ? FeelConfig.pillarPosPct : 100 - FeelConfig.pillarPosPct;
        const x = TankSpace.pctToPxX(xPct);
        const y = TankSpace.pctToPxY(FeelConfig.pillarBottomPct);

        pillar.collider3D = new PillarCollider3D(x, y, geom);
        stepper?.world.addPillar(pillar.collider3D);

        pillar.setup3DView(name, tank3DRoot, geom);
        return pillar;
    }

    private setup3DView(name: string, tank3DRoot: Node, geom: RingPillarGeometry): void {
        const root3D = new Node(`${name}_3D`);
        root3D.layer = RenderLayers.RING_PILLAR_3D;
        tank3DRoot.addChild(root3D);
        this.view3DRoot = root3D;

        const spindleNode = new Node('Spindle');
        spindleNode.layer = RenderLayers.RING_PILLAR_3D;
        root3D.addChild(spindleNode);
        const spindleMr = spindleNode.addComponent(MeshRenderer);
        spindleMr.mesh = createPillarSpindleMesh(geom);
        bindRendererMaterial(
            () => getOrCreatePillarMaterials().shaftMat,
            (m) => {
                if (spindleMr.isValid) spindleMr.material = m;
            },
        );
        this.spindleRenderer = spindleMr;

        const crossNode = new Node('CrossGuard');
        crossNode.layer = RenderLayers.RING_PILLAR_3D;
        crossNode.setPosition(0, Stage3DRig.pxTo3D(geom.pillarTailHeight + geom.pillarBaseHeight * 0.5), 0);
        root3D.addChild(crossNode);
        const crossMr = crossNode.addComponent(MeshRenderer);
        crossMr.mesh = createPillarCrossGuardMesh(geom);
        bindRendererMaterial(
            () => getOrCreatePillarMaterials().crossMat,
            (m) => {
                if (crossMr.isValid) crossMr.material = m;
            },
        );
        this.crossRenderer = crossMr;
    }

    /** 按 FeelConfig 与 GameConst 刷新位置、3D 物理碰撞与 3D 模型 */
    applyLayout(_redraw = false): void {
        const prevTotal = this.geom.pillarTotalHeight;
        const geom = calcRingPillarGeometry(TankSpace.width);
        this.geom = geom;

        const xPct = this.side === 'left' ? FeelConfig.pillarPosPct : 100 - FeelConfig.pillarPosPct;
        const x = TankSpace.pctToPxX(xPct);
        const y = TankSpace.pctToPxY(FeelConfig.pillarBottomPct);
        this.node.setPosition(x, y, 0);

        this.node.getComponent(UITransform)?.setContentSize(geom.pillarBaseWidth, geom.pillarTotalHeight);
        this.collider3D?.updateLayout(x, y, geom);

        if (this.view3DRoot) {
            this.view3DRoot.setPosition(Stage3DRig.pxTo3D(x), Stage3DRig.pxTo3D(y), 0);
            if (Math.abs(prevTotal - geom.pillarTotalHeight) > 0.01) {
                if (this.spindleRenderer) {
                    this.spindleRenderer.mesh = createPillarSpindleMesh(geom);
                }
                if (this.crossRenderer) {
                    this.crossRenderer.mesh = createPillarCrossGuardMesh(geom);
                    this.crossRenderer.node.setPosition(
                        0,
                        Stage3DRig.pxTo3D(geom.pillarTailHeight + geom.pillarBaseHeight * 0.5),
                        0,
                    );
                }
            }
        }
    }

    onDestroy(): void {
        if (this.view3DRoot && this.view3DRoot.isValid) {
            this.view3DRoot.destroy();
            this.view3DRoot = null;
        }
    }

    /** 柱尖在缸坐标系下的 Y 坐标 */
    get tipY(): number {
        return this.collider3D ? this.collider3D.tipY : this.node.position.y + this.geom.pillarTotalHeight;
    }

    /** 十字卡托顶面（叠圈起始面）在缸坐标系下的 Y 坐标 */
    get baseTopY(): number {
        return this.collider3D
            ? this.collider3D.baseTopY
            : this.node.position.y + this.geom.pillarTailHeight + this.geom.pillarBaseHeight;
    }

    /** 锥形柱杆在指定缸高 y 处的半径（像素） */
    shaftRadiusAtY(y: number): number {
        return this.collider3D ? this.collider3D.shaftRadiusAtY(y) : this.geom.pillarWidth * 0.5;
    }

    /** 柱杆平均宽度 */
    get rodWidth(): number {
        return this.geom.pillarWidth;
    }

    /** 上段套圈柱杆高度 */
    get rodHeight(): number {
        return this.geom.pillarHeight;
    }

    /** 十字四翼卡托横向总宽 */
    get baseWidth(): number {
        return this.geom.pillarBaseWidth;
    }
}
