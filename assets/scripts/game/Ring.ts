import { _decorator, Component, MeshRenderer, Node, Quat, UITransform } from 'cc';
import { calcRingPillarGeometry } from '../config/GameConst';
import { TankSpace } from '../config/TankSpace';
import { SolvedFeelConfig } from '../core/flow/FeelSolver';
import { quatFromEulerDeg, QuatLike } from '../core/physics3d/Math3D';
import { TorusBody3D } from '../core/physics3d/TorusBody3D';
import { getRingKindConfig, RingKindConfig, RingSpec } from '../core/rings/RingKinds';
import {
    bindRendererMaterial,
    getOrCreateRingFlashMaterial,
    getOrCreateRingMaterial,
    getOrCreateTorusMesh,
} from '../render/MeshFactory3D';
import { RenderLayers, Stage3DRig } from '../render/Stage3DRig';

const { ccclass } = _decorator;

const tempQuatLike: QuatLike = { x: 0, y: 0, z: 0, w: 1 };
const tempCcQuat = new Quat();

export interface RingDimensions {
    outerDiameter: number;
    thickness: number;
    innerDiameter: number;
    majorRadius: number;
    tubeRadius: number;
    innerRadius: number;
    endRadius: number;
    endOffset: number;
}

/** 根据缸宽与圈种计算真 3D 正圆环外径、管粗、主半径与内孔尺寸 */
export function calcRingDimensions(spec: RingSpec): RingDimensions {
    const base = calcRingPillarGeometry(TankSpace.width);
    const kindCfg = getRingKindConfig(spec);
    const outerDiameter = base.ringOuterDiameter * kindCfg.sizeScale;
    const thickness = base.ringThickness * kindCfg.sizeScale;
    const innerDiameter = Math.max(4, outerDiameter - thickness * 2);
    const tubeRadius = thickness * 0.5;
    const majorRadius = outerDiameter * 0.5 - tubeRadius;
    const innerRadius = innerDiameter * 0.5;
    return {
        outerDiameter,
        thickness,
        innerDiameter,
        majorRadius,
        tubeRadius,
        innerRadius,
        endRadius: tubeRadius,
        endOffset: majorRadius,
    };
}

/**
 * 锁脉环（真 3D 正圆环）组件：
 * - 物理：由纯逻辑三维圆环刚体 `TorusBody3D` 驱动，支持三轴自由翻转与前后斜靠堆叠；
 * - 渲染：在 `Stage3DRig.tank3DRoot` 下挂载标准正圆环 `Torus` 3D 网格，正面朝向镜头时为 100% 标准正圆。
 */
@ccclass('Ring')
export class Ring extends Component {
    spec: RingSpec = { kind: 'normal', color: 'red' };
    kindConfig: RingKindConfig = getRingKindConfig('normal');
    body3D!: TorusBody3D;
    view3DNode: Node | null = null;

    /** 是否已锁定在柱上（T012 使用）；锁定后切换为静态并保留自然微倾 */
    locked = false;

    /** 是否正在播放消除闪烁动画（T014 使用）；期间不再参与配对、碰撞或受力 */
    clearing = false;

    private dims: RingDimensions = calcRingDimensions({ kind: 'normal', color: 'red' });
    private meshRenderer: MeshRenderer | null = null;
    private unbindMat: (() => void) | null = null;
    private showingFlashMat = false;

    get dimensions(): RingDimensions {
        return this.dims;
    }

    get isBodyReady(): boolean {
        return Boolean(this.body3D);
    }

    static createNode(
        spec: RingSpec,
        x: number,
        y: number,
        z: number,
        pitchXDeg: number,
        yawYDeg: number,
        rollZDeg: number,
        tank3DRoot: Node | null,
    ): Ring {
        const ringNode = new Node(`Ring_${spec.kind}_${spec.color ?? 'special'}`);
        ringNode.layer = RenderLayers.BG_2D;
        ringNode.setPosition(x, y, 0);

        const ring = ringNode.addComponent(Ring);
        ring.spec = { kind: spec.kind, color: spec.color };
        ring.initBodyAndView(x, y, z, pitchXDeg, yawYDeg, rollZDeg, tank3DRoot);
        return ring;
    }

    private initBodyAndView(
        x: number,
        y: number,
        z: number,
        pitchXDeg: number,
        yawYDeg: number,
        rollZDeg: number,
        tank3DRoot: Node | null,
    ): void {
        this.kindConfig = getRingKindConfig(this.spec);
        this.dims = calcRingDimensions(this.spec);

        const transform = this.getComponent(UITransform) ?? this.addComponent(UITransform);
        transform.setAnchorPoint(0.5, 0.5);
        transform.setContentSize(this.dims.outerDiameter, this.dims.outerDiameter);

        quatFromEulerDeg(pitchXDeg, yawYDeg, rollZDeg, tempQuatLike);

        this.body3D = new TorusBody3D({
            x,
            y,
            z,
            qx: tempQuatLike.x,
            qy: tempQuatLike.y,
            qz: tempQuatLike.z,
            qw: tempQuatLike.w,
            majorRadius: this.dims.majorRadius,
            tubeRadius: this.dims.tubeRadius,
            mass: Math.max(0.25, this.kindConfig.sinkScale),
            linearDamping: SolvedFeelConfig.ringLinearDamping,
            angularDamping: SolvedFeelConfig.ringAngularDamping,
            friction: SolvedFeelConfig.ringFriction,
            restitution: SolvedFeelConfig.ringRestitution,
            type: 'dynamic',
        });

        if (tank3DRoot) {
            const vNode = new Node(`${this.node.name}_3D`);
            vNode.layer = RenderLayers.RING_PILLAR_3D;
            tank3DRoot.addChild(vNode);
            this.view3DNode = vNode;

            const mr = vNode.addComponent(MeshRenderer);
            mr.mesh = getOrCreateTorusMesh(this.dims.majorRadius, this.dims.tubeRadius);
            this.unbindMat = bindRendererMaterial(
                () => (this.clearing ? getOrCreateRingFlashMaterial() : getOrCreateRingMaterial(this.spec)),
                (m) => {
                    if (mr.isValid) mr.material = m;
                },
            );
            this.meshRenderer = mr;
        }

        this.syncVisualFromBody();
    }

    /** 同步 FeelSolver 换算后的阻尼/摩擦与几何尺寸 */
    applyConfig(): void {
        this.kindConfig = getRingKindConfig(this.spec);
        this.dims = calcRingDimensions(this.spec);

        this.body3D.setDimensions(this.dims.majorRadius, this.dims.tubeRadius);
        this.body3D.linearDamping = SolvedFeelConfig.ringLinearDamping;
        this.body3D.angularDamping = SolvedFeelConfig.ringAngularDamping;
        this.body3D.friction = SolvedFeelConfig.ringFriction;
        this.body3D.restitution = SolvedFeelConfig.ringRestitution;

        if (this.meshRenderer) {
            this.meshRenderer.mesh = getOrCreateTorusMesh(this.dims.majorRadius, this.dims.tubeRadius);
            if (!this.clearing) {
                this.meshRenderer.material = getOrCreateRingMaterial(this.spec);
                this.showingFlashMat = false;
            }
        }
        this.syncVisualFromBody();
    }

    /** 驱动消除闪烁效果（progress01: 0..1），前半程明暗闪烁脉冲，后半程高亮缩隐 */
    setClearingFlash(progress01: number): void {
        this.clearing = true;
        if (!this.view3DNode || !this.view3DNode.isValid) {
            return;
        }
        const t = Math.min(1, Math.max(0, progress01));
        let useFlashMat = true;
        let scale = 1;

        if (t < 0.65) {
            useFlashMat = Math.floor(t * 9) % 2 === 0;
            scale = 1 + 0.14 * Math.abs(Math.sin(t * Math.PI * 3));
        } else {
            const shrinkT = (t - 0.65) / 0.35;
            useFlashMat = true;
            scale = Math.max(0.08, 1.12 * (1 - shrinkT));
        }

        this.view3DNode.setScale(scale, scale, scale);
        if (this.meshRenderer && this.meshRenderer.isValid && useFlashMat !== this.showingFlashMat) {
            this.meshRenderer.material = useFlashMat
                ? getOrCreateRingFlashMaterial()
                : getOrCreateRingMaterial(this.spec);
            this.showingFlashMat = useFlashMat;
        }
    }

    /** 将 3D 物理刚体的位置与四元数同步到 2D 锚点节点与 3D 渲染节点 */
    syncVisualFromBody(): void {
        const b = this.body3D;
        this.node.setPosition(b.x, b.y, 0);
        if (this.view3DNode && this.view3DNode.isValid) {
            this.view3DNode.setPosition(Stage3DRig.pxTo3D(b.x), Stage3DRig.pxTo3D(b.y), Stage3DRig.pxTo3D(b.z));
            tempCcQuat.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
            this.view3DNode.setRotation(tempCcQuat);
        }
    }

    onDestroy(): void {
        this.unbindMat?.();
        this.unbindMat = null;
        if (this.view3DNode && this.view3DNode.isValid) {
            this.view3DNode.destroy();
            this.view3DNode = null;
        }
    }
}
