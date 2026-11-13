import {
    _decorator, Component, EventKeyboard, EventTouch, Game, game, Graphics, Input, input, KeyCode, Label, Layers,
    Node, UITransform,
} from 'cc';
import { GameConst } from '../config/GameConst';
import { LayoutConfig, LayoutRect, rectCenter } from '../config/LayoutConfig';
import { Palette } from '../config/Palette';
import { FlowSide } from '../core/flow/FlowField';
import { Bladder, calcSoftCapPose, SoftCapPose } from '../core/input/Bladder';

const { ccclass } = _decorator;

const CAP_CORNER_RADIUS = 28;
const SHADOW_OFFSET_Y = -8;
const DEPTH_SMOOTH_RATE = 45;

/**
 * 左右软胶喷射键组件（GDD §2.2、§8，T008）：
 * - 触屏/鼠标按下的那一刻 0 延迟出水，两根手指按左右键互不影响；
 * - 电脑键盘 F 控制左键、J 控制右键；
 * - 键帽随气囊余量下陷与回弹（向下位移 + 软胶挤压缩放），不画外圈读条；
 * - 左右两键共用父容器上的同一个 Graphics 绘制，省显存。
 */
@ccclass('JetButton')
export class JetButton extends Component {
    side: FlowSide = 'left';
    bladder: Bladder | null = null;

    private rect: LayoutRect = LayoutConfig.leftJetBtn;
    private sharedGraphics: Graphics | null = null;
    private siblingButton: JetButton | null = null;
    private isPrimaryRenderer = false;
    private capLabelNode: Node | null = null;

    private readonly activeTouchIds = new Set<number>();
    private keyHeld = false;
    private visualDepth = 0;
    private lastDrawnDepth = -1;
    private lastDrawnPressed = false;

    /** 在整机根节点下创建左右一对喷射键（位于 ShellView 之上，共用一个 Graphics） */
    static createPair(parent: Node, leftBladder: Bladder, rightBladder: Bladder): [JetButton, JetButton] {
        const layerNode = new Node('JetButtons');
        layerNode.layer = Layers.Enum.UI_2D;

        const layerTransform = layerNode.addComponent(UITransform);
        layerTransform.setContentSize(LayoutConfig.designWidth, LayoutConfig.designHeight);
        layerTransform.setAnchorPoint(0, 0);
        layerNode.setPosition(-LayoutConfig.designWidth / 2, -LayoutConfig.designHeight / 2, 0);

        const sharedGfx = layerNode.addComponent(Graphics);
        parent.addChild(layerNode);

        const left = JetButton.createOne('left', LayoutConfig.leftJetBtn, leftBladder, sharedGfx, true);
        const right = JetButton.createOne('right', LayoutConfig.rightJetBtn, rightBladder, sharedGfx, false);
        left.siblingButton = right;
        right.siblingButton = left;

        layerNode.addChild(left.node);
        layerNode.addChild(right.node);
        JetButton.redrawPair(sharedGfx, left, right);

        return [left, right];
    }

    private static createOne(
        side: FlowSide,
        rect: LayoutRect,
        bladder: Bladder,
        sharedGfx: Graphics,
        isPrimaryRenderer: boolean,
    ): JetButton {
        const node = new Node(side === 'left' ? 'JetButton_Left' : 'JetButton_Right');
        node.layer = Layers.Enum.UI_2D;

        const pad = GameConst.jetBtnHitPadding;
        const transform = node.addComponent(UITransform);
        transform.setAnchorPoint(0.5, 0.5);
        transform.setContentSize(rect.width + pad * 2, rect.height + pad * 2);

        const center = rectCenter(rect);
        node.setPosition(center.x, center.y, 0);

        const labelNode = new Node('CapLabel');
        labelNode.layer = Layers.Enum.UI_2D;
        const labelTransform = labelNode.addComponent(UITransform);
        labelTransform.setContentSize(rect.width - 16, rect.height - 16);
        const label = labelNode.addComponent(Label);
        label.string = side === 'left' ? '左喷射\n[F]' : '右喷射\n[J]';
        label.fontSize = 26;
        label.lineHeight = 34;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.color = Palette.labelPrimary;
        node.addChild(labelNode);

        const btn = node.addComponent(JetButton);
        btn.side = side;
        btn.rect = rect;
        btn.bladder = bladder;
        btn.sharedGraphics = sharedGfx;
        btn.isPrimaryRenderer = isPrimaryRenderer;
        btn.capLabelNode = labelNode;

        return btn;
    }

    get isPressed(): boolean {
        return this.bladder?.pressed ?? (this.activeTouchIds.size > 0 || this.keyHeld);
    }

    onEnable(): void {
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
        game.on(Game.EVENT_HIDE, this.releaseAllInputs, this);
    }

    onDisable(): void {
        this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        game.off(Game.EVENT_HIDE, this.releaseAllInputs, this);
        this.releaseAllInputs();
    }

    update(dt: number): void {
        this.stepVisual(dt);
    }

    lateUpdate(): void {
        if (!this.isPrimaryRenderer || !this.sharedGraphics || !this.siblingButton) {
            return;
        }
        if (this.needsRedraw() || this.siblingButton.needsRedraw()) {
            JetButton.redrawPair(this.sharedGraphics, this, this.siblingButton);
        }
    }

    private get boundKey(): KeyCode {
        return this.side === 'left' ? KeyCode.KEY_F : KeyCode.KEY_J;
    }

    private onTouchStart = (event: EventTouch): void => {
        event.propagationStopped = true;
        this.activeTouchIds.add(event.getID());
        this.syncBladderInput();
    };

    private onTouchEnd = (event: EventTouch): void => {
        event.propagationStopped = true;
        this.activeTouchIds.delete(event.getID());
        this.syncBladderInput();
    };

    private onKeyDown = (event: EventKeyboard): void => {
        if (event.keyCode !== this.boundKey || this.keyHeld) {
            return;
        }
        this.keyHeld = true;
        this.syncBladderInput();
    };

    private onKeyUp = (event: EventKeyboard): void => {
        if (event.keyCode !== this.boundKey || !this.keyHeld) {
            return;
        }
        this.keyHeld = false;
        this.syncBladderInput();
    };

    private releaseAllInputs = (): void => {
        if (this.activeTouchIds.size === 0 && !this.keyHeld) {
            return;
        }
        this.activeTouchIds.clear();
        this.keyHeld = false;
        this.syncBladderInput();
    };

    private syncBladderInput(): void {
        const down = this.activeTouchIds.size > 0 || this.keyHeld;
        this.bladder?.setPressed(down);
    }

    private stepVisual(dt: number): void {
        const target = calcSoftCapPose(this.isPressed, this.bladder?.reserve ?? 1);
        const clampedDt = Math.min(Math.max(dt, 0), 0.1);
        const alpha = clampedDt > 0 ? 1 - Math.exp(-clampedDt * DEPTH_SMOOTH_RATE) : 1;
        this.visualDepth += (target.depth - this.visualDepth) * alpha;
        if (Math.abs(target.depth - this.visualDepth) < 1e-4) {
            this.visualDepth = target.depth;
        }

        const pose = this.currentPose();
        if (this.capLabelNode) {
            this.capLabelNode.setPosition(0, pose.offsetY, 0);
            this.capLabelNode.setScale(pose.scaleX, pose.scaleY, 1);
        }
    }

    private currentPose(): SoftCapPose {
        const d = this.visualDepth;
        return {
            depth: d,
            offsetY: -d * 14,
            scaleX: 1 - d * 0.05,
            scaleY: 1 - d * 0.10,
        };
    }

    private needsRedraw(): boolean {
        return (
            Math.abs(this.visualDepth - this.lastDrawnDepth) > 5e-4 ||
            this.isPressed !== this.lastDrawnPressed
        );
    }

    private markDrawn(): void {
        this.lastDrawnDepth = this.visualDepth;
        this.lastDrawnPressed = this.isPressed;
    }

    private static redrawPair(gfx: Graphics, left: JetButton, right: JetButton): void {
        gfx.clear();
        for (const btn of [left, right]) {
            btn.drawSelf(gfx);
            btn.markDrawn();
        }
    }

    private drawSelf(gfx: Graphics): void {
        const { rect } = this;
        const center = rectCenter(rect);
        const pose = this.currentPose();

        // 1. 底座凹槽阴影（固定不随键帽移动，衬托下陷深度）
        gfx.fillColor = Palette.jetBtnShadow;
        gfx.strokeColor = Palette.shellBorder;
        gfx.lineWidth = 2;
        gfx.roundRect(
            rect.x - 2,
            rect.y + SHADOW_OFFSET_Y,
            rect.width + 4,
            rect.height + 4,
            CAP_CORNER_RADIUS + 2,
        );
        gfx.fill();
        gfx.stroke();

        // 2. 软胶键帽本体（随按压与气囊余量向下位移并挤压缩放，不画任何外圈读条）
        const capW = rect.width * pose.scaleX;
        const capH = rect.height * pose.scaleY;
        const capX = center.x - capW / 2;
        const capY = center.y + pose.offsetY - capH / 2;
        const radius = CAP_CORNER_RADIUS * Math.min(pose.scaleX, pose.scaleY);

        gfx.fillColor = this.isPressed ? Palette.jetBtnPressedFill : Palette.jetBtnFill;
        gfx.strokeColor = Palette.jetBtnBorder;
        gfx.lineWidth = 3;
        gfx.roundRect(capX, capY, capW, capH, radius);
        gfx.fill();
        gfx.stroke();

        // 3. 键帽上沿微高光条（增强软胶凸起质感）
        const glossMargin = 22 * pose.scaleX;
        const glossH = Math.max(6, 12 * pose.scaleY);
        gfx.fillColor = Palette.jetBtnHighlight;
        gfx.roundRect(
            capX + glossMargin,
            capY + capH - glossH - 12 * pose.scaleY,
            Math.max(16, capW - glossMargin * 2),
            glossH,
            glossH / 2,
        );
        gfx.fill();
    }
}
