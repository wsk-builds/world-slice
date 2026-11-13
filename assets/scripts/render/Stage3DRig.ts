import { _decorator, Camera, Canvas, Component, Layers, Node, screen, toRadian, view } from 'cc';
import { GameConst } from '../config/GameConst';
import { calcMachineScale, LayoutConfig } from '../config/LayoutConfig';
import { Palette } from '../config/Palette';
import { TankSpace } from '../config/TankSpace';
import { ensureMatcapEffectLoaded } from './MeshFactory3D';

const { ccclass } = _decorator;

/**
 * 三相机夹心分层位掩码（使用用户可用位 0..3，避免与内置 UI_2D 混用）：
 * 1. LAYER_BG_2D：2D 水底背景、海眼与水流气泡（相机 1）
 * 2. LAYER_RING_PILLAR_3D：3D 正圆环与三段式锥形十字玉柱（相机 2，独立深度缓冲解决前后穿插遮挡）
 * 3. LAYER_FG_UI_2D：2D 前景特效、挖空掌机外壳、喷射键、调参面板与首领战破框层（相机 3）
 */
export const RenderLayers = {
    BG_2D: 1 << 0,
    RING_PILLAR_3D: 1 << 1,
    FG_UI_2D: 1 << 2,
    BOSS_BREAKOUT_2D: 1 << 3,
} as const;

/**
 * 三相机夹心渲染架构 + 3D 舞台坐标对齐器（GDD §3.1，提前落地以立即呈现真 3D 圈柱）。
 * - 相机 1（Priority 10）：正交 2D 背景层（SOLID_COLOR 清屏）
 * - 相机 2（Priority 20）：微透视 3D 圈柱层（DEPTH_ONLY 清深度，z=0 平面与缸内像素 1:1 严丝合缝对齐）
 * - 相机 3（Priority 30）：正交 2D 外壳与前景 UI 层（DEPTH_ONLY 叠在最上方，遮住任何越界边缘）
 */
@ccclass('Stage3DRig')
export class Stage3DRig extends Component {
    bgCamera!: Camera;
    stage3DCamera!: Camera;
    fgCamera!: Camera;
    /** 3D 舞台根节点：本地 1 单位 = GameConst.physics3dPtm (100) 缸内像素，原点在缸左下角 (0, 0, 0) */
    tank3DRoot!: Node;

    private canvasNode!: Node;

    static setup(canvasNode: Node): Stage3DRig {
        const rig = canvasNode.getComponent(Stage3DRig) ?? canvasNode.addComponent(Stage3DRig);
        rig.initRig(canvasNode);
        return rig;
    }

    /** 将缸内像素坐标换算为 tank3DRoot 本地 3D 坐标 */
    static pxTo3D(px: number): number {
        return px / GameConst.physics3dPtm;
    }

    private initRig(canvasNode: Node): void {
        if (this.tank3DRoot) {
            return;
        }
        this.canvasNode = canvasNode;
        const scene = canvasNode.scene;
        const canvas = canvasNode.getComponent(Canvas);

        // 1. 改造场景自带 Canvas Camera 为前景与外壳相机（Camera 3）
        const fgCam = canvas?.cameraComponent ?? canvasNode.getComponentInChildren(Camera)!;
        fgCam.priority = 30;
        fgCam.visibility = RenderLayers.FG_UI_2D | RenderLayers.BOSS_BREAKOUT_2D | Layers.Enum.UI_2D;
        fgCam.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
        this.fgCamera = fgCam;

        // 2. 创建底层 2D 背景相机（Camera 1），挂在 Canvas 下与前景相机保持同位置
        const bgCamNode = new Node('Camera_BG_2D');
        bgCamNode.layer = Layers.Enum.DEFAULT;
        canvasNode.addChild(bgCamNode);
        const bgCam = bgCamNode.addComponent(Camera);
        bgCam.projection = Camera.ProjectionType.ORTHO;
        bgCam.priority = 10;
        bgCam.visibility = RenderLayers.BG_2D;
        bgCam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        bgCam.clearColor = Palette.shellBody;
        bgCam.near = 0;
        bgCam.far = 2000;
        this.bgCamera = bgCam;

        // 3. 在 Scene 根下创建独立 3D 世界（零灯光零阴影，由 matcap.effect 提供球面流转高光）
        ensureMatcapEffectLoaded();
        const world3D = new Node('World3D');
        world3D.layer = RenderLayers.RING_PILLAR_3D;
        scene.addChild(world3D);

        const cam3DNode = new Node('Camera_RingPillar_3D');
        cam3DNode.layer = RenderLayers.RING_PILLAR_3D;
        world3D.addChild(cam3DNode);
        const cam3D = cam3DNode.addComponent(Camera);
        cam3D.projection = Camera.ProjectionType.PERSPECTIVE;
        cam3D.fovAxis = Camera.FOVAxis.VERTICAL;
        cam3D.fov = GameConst.camera3dFovDeg;
        cam3D.priority = 20;
        cam3D.visibility = RenderLayers.RING_PILLAR_3D;
        cam3D.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
        cam3D.near = 1;
        cam3D.far = 80;
        this.stage3DCamera = cam3D;

        const tank3DRoot = new Node('Tank3DRoot');
        tank3DRoot.layer = RenderLayers.RING_PILLAR_3D;
        world3D.addChild(tank3DRoot);
        this.tank3DRoot = tank3DRoot;

        this.syncCameras();
        view.on('canvas-resize', this.syncCameras, this);
        screen.on('window-resize', this.syncCameras, this);
        canvasNode.on(Node.EventType.SIZE_CHANGED, this.syncCameras, this);
    }

    onDestroy(): void {
        view.off('canvas-resize', this.syncCameras, this);
        screen.off('window-resize', this.syncCameras, this);
        this.canvasNode?.off(Node.EventType.SIZE_CHANGED, this.syncCameras, this);
    }

    /** 窗口尺寸或整机缩放变化时，保持三台相机在 z=0 平面上 1:1 像素对齐 */
    syncCameras = (): void => {
        if (!this.fgCamera || !this.bgCamera || !this.stage3DCamera || !this.tank3DRoot) {
            return;
        }

        const visible = view.getVisibleSize();
        const machineScale = calcMachineScale(visible.width, visible.height) || 1;

        // 同步 2D 背景相机与 Canvas 前景相机完全一致的正交参数与世界坐标
        const orthoH = visible.height * 0.5;
        this.bgCamera.orthoHeight = orthoH;
        const cwPos = this.canvasNode.worldPosition;
        this.bgCamera.node.setWorldPosition(cwPos.x, cwPos.y, 1000);

        // 计算 3D 透视相机距离，使得在 z = 0 平面上可视高度恰好等于 visible.height / (machineScale * ptm)
        const ptm = GameConst.physics3dPtm;
        const visHeight3D = visible.height / (machineScale * ptm);
        const halfFovRad = toRadian(this.stage3DCamera.fov * 0.5);
        const camDist = (visHeight3D * 0.5) / Math.tan(halfFovRad);

        // 内屏中心相对于整机中心 (0, 0) 的偏移（像素）
        const inner = LayoutConfig.innerScreen;
        const innerCenterOffsetX = inner.x + inner.width * 0.5 - LayoutConfig.designWidth * 0.5;
        const innerCenterOffsetY = inner.y + inner.height * 0.5 - LayoutConfig.designHeight * 0.5;

        // Tank3DRoot 原点对应缸坐标 (0, 0, 0)，将相机对准整机屏幕中心以消除窄屏/宽屏偏差
        this.tank3DRoot.setPosition(
            (-TankSpace.width * 0.5 + innerCenterOffsetX) / ptm,
            (-TankSpace.height * 0.5 + innerCenterOffsetY) / ptm,
            0,
        );
        // 相机以 camera3dPitchDownDeg 轻微向下俯看整机中心：平躺在缸底的圈也能清晰露出立体圆环孔洞，不再像扁平药丸
        const pitchDeg = GameConst.camera3dPitchDownDeg;
        const pitchRad = toRadian(pitchDeg);
        this.stage3DCamera.node.setPosition(0, camDist * Math.sin(pitchRad), camDist * Math.cos(pitchRad));
        this.stage3DCamera.node.setRotationFromEuler(-pitchDeg, 0, 0);
    };
}
