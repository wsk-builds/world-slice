import { _decorator, Canvas, Component, Graphics, Label, Layers, Node, screen, UITransform, view } from 'cc';
import { calcMachineScale, LayoutConfig } from './config/LayoutConfig';
import { Palette } from './config/Palette';
import { ShellView } from './ui/ShellView';

const { ccclass } = _decorator;

/** 场景唯一入口，挂在 Canvas 上，运行时用代码搭建全部节点。 */
@ccclass('Boot')
export class Boot extends Component {
    private machineNode: Node | null = null;

    onLoad(): void {
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
        this.createInnerScreenBase(machine);

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

    /** 创建内屏底色与占位标注，置于外壳下方。 */
    private createInnerScreenBase(machine: Node): void {
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

        const labelNode = new Node('InnerScreenLabel');
        labelNode.layer = Layers.Enum.UI_2D;
        const labelTransform = labelNode.addComponent(UITransform);
        labelTransform.setContentSize(inner.width - 40, 120);
        labelNode.setPosition(inner.width / 2, inner.height / 2, 0);

        const label = labelNode.addComponent(Label);
        label.string = '内屏（水缸区）\n940 × 575';
        label.fontSize = 32;
        label.lineHeight = 44;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.color = Palette.labelMuted;

        tankRoot.addChild(labelNode);
        machine.addChild(tankRoot);
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
