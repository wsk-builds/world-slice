import { Color, Component, Graphics, Label, Layers, Node, UITransform } from 'cc';
import { LayoutConfig, LayoutRect, rectCenter } from '../config/LayoutConfig';
import { Palette } from '../config/Palette';

interface ZoneSpec {
    rect: LayoutRect;
    text: string;
    fill: Color;
    border: Color;
    fontSize: number;
    textColor?: Color;
    radius?: number;
}

/**
 * 灰盒掌机外壳视图。
 * 使用单个共享 Graphics 绘制挖空内屏的外壳与全部分区占位框，位于内屏内容之上。
 */
export class ShellView extends Component {
    /** 创建挂有 ShellView 的节点，原点在机身左下角（设计坐标 0..1624, 0..750）。 */
    static create(parent: Node): ShellView {
        const node = new Node('ShellView');
        node.layer = Layers.Enum.UI_2D;

        const transform = node.addComponent(UITransform);
        transform.setContentSize(LayoutConfig.designWidth, LayoutConfig.designHeight);
        transform.setAnchorPoint(0, 0);
        node.setPosition(-LayoutConfig.designWidth / 2, -LayoutConfig.designHeight / 2, 0);

        const view = node.addComponent(ShellView);
        parent.addChild(node);
        return view;
    }

    onLoad(): void {
        const gfx = this.node.addComponent(Graphics);
        this.drawShellMask(gfx);
        this.drawPartitions(gfx);
        this.createLabels();
    }

    /** 用上/下/左/右四块实心矩形拼出外壳，中间内屏区域完全挖空。 */
    private drawShellMask(gfx: Graphics): void {
        const W = LayoutConfig.designWidth;
        const H = LayoutConfig.designHeight;
        const inner = LayoutConfig.innerScreen;

        gfx.fillColor = Palette.shellBody;

        // 左侧外壳（含左握把）
        gfx.fillRect(0, 0, inner.x, H);
        // 右侧外壳（含右握把）
        const rightX = inner.x + inner.width;
        gfx.fillRect(rightX, 0, W - rightX, H);
        // 顶部额头
        const topY = inner.y + inner.height;
        gfx.fillRect(inner.x, topY, inner.width, H - topY);
        // 底部下巴外壳
        gfx.fillRect(inner.x, 0, inner.width, inner.y);

        // 整机外边框（方便在宽屏/窄屏下观察 1624×750 掌机边界）
        gfx.strokeColor = Palette.shellBorder;
        gfx.lineWidth = 3;
        gfx.rect(1.5, 1.5, W - 3, H - 3);
        gfx.stroke();

        // 内屏边框
        gfx.strokeColor = Palette.innerBorder;
        gfx.lineWidth = 3;
        gfx.rect(inner.x, inner.y, inner.width, inner.height);
        gfx.stroke();
    }

    /** 在同一个 Graphics 上绘制全部分区的占位框。 */
    private drawPartitions(gfx: Graphics): void {
        // 左右握把细线框
        gfx.strokeColor = Palette.gripOutline;
        gfx.lineWidth = 2;
        for (const grip of [LayoutConfig.leftGrip, LayoutConfig.rightGrip]) {
            gfx.rect(grip.x + 12, grip.y + 12, grip.width - 24, grip.height - 24);
            gfx.stroke();
        }

        for (const zone of this.getZoneSpecs()) {
            const { rect, fill, border, radius = 10 } = zone;
            gfx.fillColor = fill;
            gfx.strokeColor = border;
            gfx.lineWidth = 2;
            if (radius > 0) {
                gfx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
            } else {
                gfx.rect(rect.x, rect.y, rect.width, rect.height);
            }
            gfx.fill();
            gfx.stroke();
        }
    }

    /** 生成各分区文字标签。 */
    private createLabels(): void {
        this.addZoneLabel(
            'LeftGripLabel',
            LayoutConfig.leftGrip.x + LayoutConfig.leftGrip.width / 2,
            560,
            LayoutConfig.leftGrip.width - 32,
            36,
            '左握把',
            22,
            Palette.labelMuted,
        );
        this.addZoneLabel(
            'RightGripLabel',
            LayoutConfig.rightGrip.x + LayoutConfig.rightGrip.width / 2,
            560,
            LayoutConfig.rightGrip.width - 32,
            36,
            '右握把',
            22,
            Palette.labelMuted,
        );

        for (const zone of this.getZoneSpecs()) {
            const center = rectCenter(zone.rect);
            this.addZoneLabel(
                `Label_${zone.text.replace(/\s+/g, '_')}`,
                center.x,
                center.y,
                zone.rect.width - 8,
                zone.rect.height - 6,
                zone.text,
                zone.fontSize,
                zone.textColor ?? Palette.labelPrimary,
            );
        }
    }

    private getZoneSpecs(): ZoneSpec[] {
        return [
            {
                rect: LayoutConfig.chin,
                text: '下巴铭牌区 (940×85)',
                fill: Palette.chinFill,
                border: Palette.chinBorder,
                fontSize: 22,
                textColor: Palette.labelMuted,
                radius: 8,
            },
            {
                rect: LayoutConfig.leftJetBtn,
                text: '左喷射键\n220×220',
                fill: Palette.jetBtnFill,
                border: Palette.jetBtnBorder,
                fontSize: 24,
                radius: 28,
            },
            {
                rect: LayoutConfig.rightJetBtn,
                text: '右喷射键\n220×220',
                fill: Palette.jetBtnFill,
                border: Palette.jetBtnBorder,
                fontSize: 24,
                radius: 28,
            },
            {
                rect: LayoutConfig.itemBtns.waterHourglass,
                text: '玉水漏\n100×100',
                fill: Palette.itemBtnFill,
                border: Palette.itemBtnBorder,
                fontSize: 18,
                radius: 14,
            },
            {
                rect: LayoutConfig.itemBtns.traction,
                text: '牵引\n100×100',
                fill: Palette.itemBtnFill,
                border: Palette.itemBtnBorder,
                fontSize: 18,
                radius: 14,
            },
            {
                rect: LayoutConfig.itemBtns.enlighten,
                text: '点化\n100×100',
                fill: Palette.itemBtnFill,
                border: Palette.itemBtnBorder,
                fontSize: 18,
                radius: 14,
            },
            {
                rect: LayoutConfig.itemBtns.resonance,
                text: '齐鸣\n100×100',
                fill: Palette.itemBtnFill,
                border: Palette.itemBtnBorder,
                fontSize: 18,
                radius: 14,
            },
            {
                rect: LayoutConfig.countdown,
                text: '倒计时 (180×56)',
                fill: Palette.hudFill,
                border: Palette.hudBorder,
                fontSize: 18,
                radius: 10,
            },
            {
                rect: LayoutConfig.miasmaBar,
                text: '浊气条 (首领战 300×24)',
                fill: Palette.miasmaFill,
                border: Palette.miasmaBorder,
                fontSize: 14,
                radius: 6,
            },
            {
                rect: LayoutConfig.pauseBtn,
                text: '暂停',
                fill: Palette.hudFill,
                border: Palette.hudBorder,
                fontSize: 18,
                radius: 10,
            },
            {
                rect: LayoutConfig.levelLabel,
                text: '关卡号',
                fill: Palette.hudFill,
                border: Palette.hudBorder,
                fontSize: 20,
                radius: 10,
            },
            {
                rect: LayoutConfig.capsuleSafeArea,
                text: '平台胶囊留空',
                fill: Palette.capsuleFill,
                border: Palette.capsuleBorder,
                fontSize: 18,
                textColor: Palette.labelMuted,
                radius: 14,
            },
        ];
    }

    private addZoneLabel(
        name: string,
        x: number,
        y: number,
        width: number,
        height: number,
        text: string,
        fontSize: number,
        color: Color,
    ): void {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;

        const transform = node.addComponent(UITransform);
        transform.setContentSize(width, height);
        node.setPosition(x, y, 0);

        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = Math.round(fontSize * 1.25);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.color = color;
        label.overflow = Label.Overflow.SHRINK;

        this.node.addChild(node);
    }
}
