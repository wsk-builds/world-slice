import { _decorator, Canvas, Component, Layers, Node, PhysicsSystem2D, screen, UITransform, view } from 'cc';
import { GameConst } from './config/GameConst';
import { calcMachineScale, LayoutConfig } from './config/LayoutConfig';
import { Palette } from './config/Palette';
import { applyCollisionMatrix } from './config/PhysicsGroups';
import { applyFeel, onFeelApplied } from './core/flow/FeelSolver';
import { FlowField } from './core/flow/FlowField';
import { Bladder } from './core/input/Bladder';
import { PhysicsDebugDraw } from './debug/PhysicsDebugDraw';
import { RingDebugSpawner } from './debug/RingDebugSpawner';
import { TuningPanel } from './debug/TuningPanel';
import { PhysicsStepper } from './game/PhysicsStepper';
import { Pillar } from './game/Pillar';
import { RingLayer } from './game/RingLayer';
import { ScoreJudge } from './game/ScoreJudge';
import { Tank } from './game/Tank';
import { WaterForce } from './game/WaterForce';
import { Bubbles } from './render/Bubbles';
import { JetButton } from './ui/JetButton';
import { ShellView } from './ui/ShellView';

const { ccclass } = _decorator;

/** 场景唯一入口，挂在 Canvas 上，运行时用代码搭建全部节点。 */
@ccclass('Boot')
export class Boot extends Component {
    private machineNode: Node | null = null;
    private unsubFeel: (() => void) | null = null;

    onLoad(): void {
        applyCollisionMatrix(PhysicsSystem2D.instance.collisionMatrix);
        applyFeel();

        const canvas = this.getComponent(Canvas);
        if (canvas?.cameraComponent) {
            canvas.cameraComponent.clearColor = Palette.shellBody;
        }

        const machine = new Node('Machine');
        machine.layer = Layers.Enum.UI_2D;
        const machineTransform = machine.addComponent(UITransform);
        machineTransform.setContentSize(LayoutConfig.designWidth, LayoutConfig.designHeight);
        machineTransform.setAnchorPoint(0.5, 0.5);
        this.node.addChild(machine);
        this.machineNode = machine;
        this.fitMachine();

        const leftBladder = new Bladder();
        const rightBladder = new Bladder();
        const flowField = new FlowField({ seed: GameConst.defaultLevelSeed });

        // 内屏节点（原点在机身内屏左下角），位于外壳之下
        const tankRoot = this.createTankRoot(machine);
        tankRoot.addComponent(PhysicsStepper);
        const tank = Tank.create(tankRoot);
        Bubbles.create(tankRoot, flowField);
        const [leftPillar, rightPillar] = Pillar.createPair(tankRoot);
        const ringLayer = RingLayer.create(tankRoot);
        const waterForce = WaterForce.attach(tankRoot, flowField, leftBladder, rightBladder, ringLayer);
        const scoreJudge = ScoreJudge.attach(tankRoot, leftPillar, rightPillar, ringLayer);
        const ringSpawner = tankRoot.addComponent(RingDebugSpawner);
        ringSpawner.ringLayer = ringLayer;
        tankRoot.addComponent(PhysicsDebugDraw);

        // 体感参数修改后（T010 / T011）实时同步水流、气囊、圈物理属性、双柱、已锁圈与海眼位置
        this.unsubFeel = onFeelApplied(() => {
            waterForce.applyConfig();
            ringLayer.applyConfigToAll();
            leftPillar.applyLayout(false);
            rightPillar.applyLayout(true);
            scoreJudge.syncLockedRings();
            tank.redraw();
        });

        // 外壳绘制在最上层，内屏位置挖空；左右喷射键挂在外壳之上
        ShellView.create(machine);
        JetButton.createPair(machine, leftBladder, rightBladder);
        if (GameConst.DEBUG) {
            TuningPanel.create(machine);
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
        tankRoot.layer = Layers.Enum.UI_2D;

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

    /** 按可视区域等比缩放整机并居中，窄屏不裁剪外壳。 */
    private fitMachine = (): void => {
        if (!this.machineNode) {
            return;
        }
        const visible = view.getVisibleSize();
        const scale = calcMachineScale(visible.width, visible.height);
        this.machineNode.setScale(scale, scale, 1);
        this.machineNode.setPosition(0, 0, 0);
    };
}
