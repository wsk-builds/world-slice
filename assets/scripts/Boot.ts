import { _decorator, Component, Node, screen, UITransform, view } from 'cc';
import { GameConst } from './config/GameConst';
import { calcMachineScale, LayoutConfig } from './config/LayoutConfig';
import { applyFeel, onFeelApplied } from './core/flow/FeelSolver';
import { FlowField } from './core/flow/FlowField';
import { Bladder } from './core/input/Bladder';
import { PhysicsDebugDraw } from './debug/PhysicsDebugDraw';
import { RingDebugSpawner } from './debug/RingDebugSpawner';
import { TuningPanel } from './debug/TuningPanel';
import { Funnel } from './game/Funnel';
import { PhysicsStepper } from './game/PhysicsStepper';
import { Pillar } from './game/Pillar';
import { RingLayer } from './game/RingLayer';
import { ScoreJudge } from './game/ScoreJudge';
import { Tank } from './game/Tank';
import { WaterForce } from './game/WaterForce';
import { Bubbles } from './render/Bubbles';
import { RenderLayers, Stage3DRig } from './render/Stage3DRig';
import { JetButton } from './ui/JetButton';
import { ShellView } from './ui/ShellView';

const { ccclass } = _decorator;

/** 场景唯一入口，挂在 Canvas 上，运行时用代码搭建三相机夹心架构、3D 圈柱舞台与掌机界面。 */
@ccclass('Boot')
export class Boot extends Component {
    private machineNode: Node | null = null;
    private stageRig: Stage3DRig | null = null;
    private unsubFeel: (() => void) | null = null;

    onLoad(): void {
        applyFeel();

        // 1. 初始化三相机夹心架构（Camera1 2D背景 -> Camera2 3D圈柱 -> Camera3 2D外壳与UI）
        const stageRig = Stage3DRig.setup(this.node);
        this.stageRig = stageRig;

        const machine = new Node('Machine');
        machine.layer = RenderLayers.FG_UI_2D;
        const machineTransform = machine.addComponent(UITransform);
        machineTransform.setContentSize(LayoutConfig.designWidth, LayoutConfig.designHeight);
        machineTransform.setAnchorPoint(0.5, 0.5);
        this.node.addChild(machine);
        this.machineNode = machine;
        this.fitMachine();

        const leftBladder = new Bladder();
        const rightBladder = new Bladder();
        const flowField = new FlowField({ seed: GameConst.defaultLevelSeed });

        // 2. 内屏节点（原点在机身内屏左下角），背景与气泡由 Camera 1 拍摄，圈柱在 3D 舞台由 Camera 2 拍摄
        const tankRoot = this.createTankRoot(machine);
        tankRoot.addComponent(PhysicsStepper);
        const tank = Tank.create(tankRoot);
        Bubbles.create(tankRoot, flowField);
        const [leftPillar, rightPillar] = Pillar.createPair(tankRoot, stageRig.tank3DRoot);
        const ringLayer = RingLayer.create(tankRoot, stageRig.tank3DRoot);
        const waterForce = WaterForce.attach(tankRoot, flowField, leftBladder, rightBladder, ringLayer);
        const scoreJudge = ScoreJudge.attach(tankRoot, leftPillar, rightPillar, ringLayer);
        Funnel.attach(tankRoot, leftPillar, rightPillar, ringLayer, scoreJudge);
        const ringSpawner = tankRoot.addComponent(RingDebugSpawner);
        ringSpawner.ringLayer = ringLayer;
        ringSpawner.scoreJudge = scoreJudge;
        tankRoot.addComponent(PhysicsDebugDraw);

        // 体感参数修改后（T010 / T011）实时同步水流、气囊、3D 圈物理属性、双柱、已锁圈与海眼位置
        this.unsubFeel = onFeelApplied(() => {
            waterForce.applyConfig();
            ringLayer.applyConfigToAll();
            leftPillar.applyLayout(false);
            rightPillar.applyLayout(true);
            scoreJudge.syncLockedRings();
            tank.redraw();
        });

        // 3. 外壳绘制在最上层（Camera 3），内屏位置挖空；左右喷射键与调参面板挂在外壳之上
        ShellView.create(machine);
        JetButton.createPair(machine, leftBladder, rightBladder);
        if (GameConst.DEBUG) {
            TuningPanel.create(machine);
        }

        // 灰盒默认开局预放 9 个三色正圆环（红、绿、蓝各 3 个），一打开即可直观验收 3D 翻转与缸底真实堆叠
        if (GameConst.DEBUG) {
            this.spawnInitialDemoRings(ringLayer);
        }

        this.fitMachine();
        view.on('canvas-resize', this.fitMachine, this);
        screen.on('window-resize', this.fitMachine, this);
        this.node.on(Node.EventType.SIZE_CHANGED, this.fitMachine, this);
    }

    start(): void {
        this.fitMachine();
    }

    onDestroy(): void {
        this.unsubFeel?.();
        this.unsubFeel = null;
        view.off('canvas-resize', this.fitMachine, this);
        screen.off('window-resize', this.fitMachine, this);
        this.node.off(Node.EventType.SIZE_CHANGED, this.fitMachine, this);
    }

    /** 创建内屏水缸根节点，原点位于内屏左下角。 */
    private createTankRoot(machine: Node): Node {
        const inner = LayoutConfig.innerScreen;
        const tankRoot = new Node('TankRoot');
        tankRoot.layer = RenderLayers.BG_2D;

        const transform = tankRoot.addComponent(UITransform);
        transform.setContentSize(inner.width, inner.height);
        transform.setAnchorPoint(0, 0);
        tankRoot.setPosition(
            inner.x - LayoutConfig.designWidth / 2,
            inner.y - LayoutConfig.designHeight / 2,
            0,
        );

        machine.addChild(tankRoot);
        return tankRoot;
    }

    private spawnInitialDemoRings(ringLayer: RingLayer): void {
        const colors = ['red', 'green', 'blue'] as const;
        const innerW = LayoutConfig.innerScreen.width;
        const margin = 175;
        const span = Math.max(200, innerW - margin * 2);
        for (let i = 0; i < 9; i++) {
            const col = colors[i % 3];
            const x = margin + ((i * 97) % span);
            const y = 65 + Math.floor(i / 3) * 80;
            ringLayer.spawn(x, y, { kind: 'normal', color: col });
        }
    }

    /** 按可视区域等比缩放整机并居中，同时同步 3D 圈柱相机对齐。 */
    private fitMachine = (): void => {
        if (!this.machineNode) {
            return;
        }
        const visible = view.getVisibleSize();
        const scale = calcMachineScale(visible.width, visible.height);
        this.machineNode.setScale(scale, scale, 1);
        this.machineNode.setPosition(0, 0, 0);
        this.stageRig?.syncCameras();
    };
}
