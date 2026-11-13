import { _decorator, Color, Component, Label, Layers, Node, UITransform } from 'cc';

const { ccclass } = _decorator;

/** 场景唯一入口，挂在 Canvas 上，运行时用代码搭建全部节点。 */
@ccclass('Boot')
export class Boot extends Component {
    onLoad(): void {
        const labelNode = new Node('ReadyLabel');
        labelNode.layer = Layers.Enum.UI_2D;
        labelNode.addComponent(UITransform);

        const label = labelNode.addComponent(Label);
        label.string = '套圈大冒险 · 工程就绪';
        label.fontSize = 42;
        label.lineHeight = 56;
        label.color = new Color(235, 240, 245, 255);

        this.node.addChild(labelNode);
    }
}
