import { _decorator, Component, EventTouch, Graphics, Label, Layers, Node, UITransform, Vec3 } from 'cc';
import { Palette } from '../config/Palette';
import { FeelSliderSpec, formatFeelValue, snapSliderValue } from './TuningPresets';

const { ccclass } = _decorator;

const STEP_BTN_W = 32;
const STEP_BTN_H = 28;
const TRACK_GAP = 8;
const TRACK_HEIGHT = 6;
const KNOB_RADIUS = 9;

const tempPos = new Vec3();

export type SliderChangeHandler = (value: number) => void;

/**
 * 调参面板单行滑块组件（T011）：
 * - 上方显示中文体感名称与当前值；
 * - 下方为 [−] 滑轨 [+]，支持拖拽滑轨或点 −/+ 实时改值；
 * - 不自带 Graphics，全部图形（−/+ 按钮、轨道、默认值标记、旋钮）画到面板共享 Graphics 上。
 */
@ccclass('TuningSlider')
export class TuningSlider extends Component {
    static readonly ROW_HEIGHT = 58;

    private spec!: FeelSliderSpec;
    private value = 0;
    private defaultValue = 0;
    private onChange: SliderChangeHandler | null = null;

    private trackNode!: Node;
    private trackTransform!: UITransform;
    private minusNode!: Node;
    private plusNode!: Node;
    private valueLabel!: Label;

    /** 节点锚点位于行左上角 (0, 1)，宽度为 width，高度为 ROW_HEIGHT */
    static create(
        parent: Node,
        width: number,
        spec: FeelSliderSpec,
        value: number,
        defaultValue: number,
        onChange: SliderChangeHandler,
    ): TuningSlider {
        const node = new Node(`Slider_${spec.key}`);
        node.layer = Layers.Enum.UI_2D;

        const transform = node.addComponent(UITransform);
        transform.setAnchorPoint(0, 1);
        transform.setContentSize(width, TuningSlider.ROW_HEIGHT);

        const slider = node.addComponent(TuningSlider);
        slider.spec = spec;
        slider.value = snapSliderValue(value, spec);
        slider.defaultValue = snapSliderValue(defaultValue, spec);
        slider.onChange = onChange;
        slider.build(width);

        parent.addChild(node);
        return slider;
    }

    get key(): FeelSliderSpec['key'] {
        return this.spec.key;
    }

    get currentValue(): number {
        return this.value;
    }

    /** 外部同步数值（读取预设或恢复默认时调用，不触发 onChange 回调） */
    setValue(next: number): void {
        const snapped = snapSliderValue(next, this.spec);
        if (snapped === this.value) {
            return;
        }
        this.value = snapped;
        this.updateValueLabel();
    }

    /** 在面板共享 Graphics 上绘制 −/+ 按钮、轨道、默认值竖线及旋钮 */
    draw(g: Graphics): void {
        const gTransform = g.node.getComponent(UITransform);
        if (!gTransform) {
            return;
        }

        this.drawStepBtn(g, gTransform, this.minusNode);
        this.drawStepBtn(g, gTransform, this.plusNode);

        const trackW = this.trackTransform.width;
        gTransform.convertToNodeSpaceAR(this.trackNode.worldPosition, tempPos);
        const x0 = tempPos.x;
        const y = tempPos.y;
        const knobX = x0 + this.ratioOf(this.value) * trackW;

        // 轨道底色
        g.fillColor = Palette.tuning.sliderTrack;
        g.roundRect(x0, y - TRACK_HEIGHT / 2, trackW, TRACK_HEIGHT, TRACK_HEIGHT / 2);
        g.fill();

        // 已填充高亮段
        if (knobX > x0) {
            g.fillColor = Palette.tuning.sliderFill;
            g.roundRect(x0, y - TRACK_HEIGHT / 2, knobX - x0, TRACK_HEIGHT, TRACK_HEIGHT / 2);
            g.fill();
        }

        // 默认值竖线标尺
        const defX = x0 + this.ratioOf(this.defaultValue) * trackW;
        g.strokeColor = Palette.tuning.sliderDefaultMark;
        g.lineWidth = 2;
        g.moveTo(defX, y - 10);
        g.lineTo(defX, y + 10);
        g.stroke();

        // 旋钮
        g.fillColor = Palette.tuning.sliderKnob;
        g.strokeColor = Palette.tuning.sliderFill;
        g.lineWidth = 2;
        g.circle(knobX, y, KNOB_RADIUS);
        g.fill();
        g.stroke();
    }

    private build(width: number): void {
        // 标题（左对齐）
        const titleNode = new Node('Title');
        titleNode.layer = Layers.Enum.UI_2D;
        const titleTr = titleNode.addComponent(UITransform);
        titleTr.setAnchorPoint(0, 0.5);
        titleTr.setContentSize(width * 0.65, 22);
        titleNode.setPosition(0, -12, 0);

        const titleLabel = titleNode.addComponent(Label);
        titleLabel.string = this.spec.label;
        titleLabel.fontSize = 18;
        titleLabel.lineHeight = 22;
        titleLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        titleLabel.verticalAlign = Label.VerticalAlign.CENTER;
        titleLabel.color = Palette.labelPrimary;
        this.node.addChild(titleNode);

        // 数值（右对齐）
        const valueNode = new Node('Value');
        valueNode.layer = Layers.Enum.UI_2D;
        const valueTr = valueNode.addComponent(UITransform);
        valueTr.setAnchorPoint(1, 0.5);
        valueTr.setContentSize(width * 0.35, 22);
        valueNode.setPosition(width, -12, 0);

        this.valueLabel = valueNode.addComponent(Label);
        this.valueLabel.fontSize = 18;
        this.valueLabel.lineHeight = 22;
        this.valueLabel.horizontalAlign = Label.HorizontalAlign.RIGHT;
        this.valueLabel.verticalAlign = Label.VerticalAlign.CENTER;
        this.valueLabel.color = Palette.tuning.accentText;
        this.node.addChild(valueNode);

        // 下排控件：[-] 滑轨 [+]
        const rowY = -40;
        this.minusNode = this.createStepBtn('Minus', '−', STEP_BTN_W / 2, rowY, () => this.nudge(-1));
        this.plusNode = this.createStepBtn('Plus', '+', width - STEP_BTN_W / 2, rowY, () => this.nudge(1));

        const trackW = width - (STEP_BTN_W + TRACK_GAP) * 2;
        this.trackNode = new Node('Track');
        this.trackNode.layer = Layers.Enum.UI_2D;
        this.trackTransform = this.trackNode.addComponent(UITransform);
        this.trackTransform.setAnchorPoint(0, 0.5);
        this.trackTransform.setContentSize(trackW, 34);
        this.trackNode.setPosition(STEP_BTN_W + TRACK_GAP, rowY, 0);
        this.node.addChild(this.trackNode);

        this.trackNode.on(Node.EventType.TOUCH_START, this.onTrackTouch, this);
        this.trackNode.on(Node.EventType.TOUCH_MOVE, this.onTrackTouch, this);
        this.trackNode.on(Node.EventType.TOUCH_END, this.stopPropagation, this);
        this.trackNode.on(Node.EventType.TOUCH_CANCEL, this.stopPropagation, this);

        this.updateValueLabel();
    }

    private createStepBtn(name: string, text: string, x: number, y: number, onTap: () => void): Node {
        const btn = new Node(name);
        btn.layer = Layers.Enum.UI_2D;
        const tr = btn.addComponent(UITransform);
        tr.setAnchorPoint(0.5, 0.5);
        tr.setContentSize(STEP_BTN_W, STEP_BTN_H);
        btn.setPosition(x, y, 0);

        const lbl = btn.addComponent(Label);
        lbl.string = text;
        lbl.fontSize = 20;
        lbl.lineHeight = 24;
        lbl.horizontalAlign = Label.HorizontalAlign.CENTER;
        lbl.verticalAlign = Label.VerticalAlign.CENTER;
        lbl.color = Palette.labelPrimary;

        btn.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
            e.propagationStopped = true;
            onTap();
        });
        btn.on(Node.EventType.TOUCH_END, this.stopPropagation, this);
        btn.on(Node.EventType.TOUCH_CANCEL, this.stopPropagation, this);

        this.node.addChild(btn);
        return btn;
    }

    private drawStepBtn(g: Graphics, gTransform: UITransform, btnNode: Node): void {
        gTransform.convertToNodeSpaceAR(btnNode.worldPosition, tempPos);
        const x = tempPos.x - STEP_BTN_W / 2;
        const y = tempPos.y - STEP_BTN_H / 2;
        g.fillColor = Palette.tuning.btnFill;
        g.strokeColor = Palette.tuning.btnBorder;
        g.lineWidth = 1.5;
        g.roundRect(x, y, STEP_BTN_W, STEP_BTN_H, 6);
        g.fill();
        g.stroke();
    }

    private onTrackTouch = (event: EventTouch): void => {
        event.propagationStopped = true;
        const ui = event.getUILocation();
        tempPos.set(ui.x, ui.y, 0);
        this.trackTransform.convertToNodeSpaceAR(tempPos, tempPos);
        const ratio = Math.min(Math.max(tempPos.x / this.trackTransform.width, 0), 1);
        this.applyRawValue(this.spec.min + ratio * (this.spec.max - this.spec.min));
    };

    private stopPropagation = (event: EventTouch): void => {
        event.propagationStopped = true;
    };

    private nudge(dir: number): void {
        this.applyRawValue(this.value + dir * this.spec.step);
    }

    private applyRawValue(raw: number): void {
        const next = snapSliderValue(raw, this.spec);
        if (next === this.value) {
            return;
        }
        this.value = next;
        this.updateValueLabel();
        this.onChange?.(next);
    }

    private ratioOf(val: number): number {
        const span = this.spec.max - this.spec.min;
        if (!(span > 0)) {
            return 0;
        }
        return Math.min(Math.max((val - this.spec.min) / span, 0), 1);
    }

    private updateValueLabel(): void {
        if (this.valueLabel) {
            this.valueLabel.string = formatFeelValue(this.spec, this.value);
        }
    }
}
