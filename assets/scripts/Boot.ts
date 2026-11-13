import { _decorator, Canvas, Component, Graphics, Layers, Node, PhysicsSystem2D, screen, UITransform, view } from 'cc';
import { calcMachineScale, LayoutConfig } from './config/LayoutConfig';
import { Palette } from './config/Palette';
import { applyCollisionMatrix } from './config/PhysicsGroups';
import { PhysicsDebugDraw } from './debug/PhysicsDebugDraw';
import { RingDebugSpawner } from './debug/RingDebugSpawner';
import { PhysicsStepper } from './game/PhysicsStepper';
import { Pillar } from './game/Pillar';
import { RingLayer } from './game/Ring';
import { Tank } from './game/Tank';
import { ShellView } from './ui/ShellView';

const { ccclass } = _decorator;

/** 场景唯一入口，挂在 Canvas 上，运行时用代码搭建全部节点。 */
@ccclass('Boot')
export class Boot extends Component {
    private machineNode: Node | null = null;

    onLoad(): void {
        applyCollisionMatrix(PhysicsSystem2D.instance.collisionMatrix);

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

        // 内屏节点（原点在机身内屏左下角），位于外壳之下
        const tankRoot = this.createTankRoot(machine);
        tankRoot.addComponent(PhysicsStepper);
        Tank.create(tankRoot);
        Pillar.createPair(tankRoot);
        const ringLayer = RingLayer.create(tankRoot);
        const ringSpawner = tankRoot.addComponent(RingDebugSpawner);
        ringSpawner.ringLayer = ringLayer;
        tankRoot.addComponent(PhysicsDebugDraw);

        // 外壳绘制在最上层，内屏位置挖空
        ShellView.create(machine);

        this.fitMachine();
        view.on('canvas-resize', this.fitMachine, this);
        screen.on('window-resize', this.fitMachine, this);
        this.node.on(Node.EventType.SIZE_CHANGED, this.fitMachine, this);
    }

    start(): void {
        this.fitMachine();
    }

    onDestroy(): void {
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

        const gfx = tankRoot.addComponent(Graphics);
        gfx.fillColor = Palette.innerWaterBg;
        gfx.fillRect(0, 0, inner.width, inner.height);

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
