import {
    _decorator, BlockInputEvents, Color, Component, EventTouch, Graphics, Label, Node, UITransform,
} from 'cc';
import { GameConst } from '../config/GameConst';
import { LayoutConfig, LayoutRect, rectCenter } from '../config/LayoutConfig';
import { Palette } from '../config/Palette';
import { formatCountdown, LevelState, LevelStatus } from '../core/level/LevelState';
import { RenderLayers } from '../render/Stage3DRig';

const { ccclass } = _decorator;

export interface HudCreateOptions {
    levelState: LevelState;
    levelTitle?: string;
    onPauseToggle?: () => void;
    onResume?: () => void;
    onRestart?: () => void;
}

/**
 * 灰盒抬头与内屏暂停/结算提示组件（GDD §2.1、§8，T015）：
 * - 挂载在前景 UI 层 RenderLayers.FG_UI_2D，避免被背景/3D 相机重复渲染；
 * - 倒计时置于内屏上沿正中，暂停键与关卡号置于左上角（与调参按钮错开）；
 * - 游玩期内屏水缸零常驻 UI；仅在 paused / won / lost 时于内屏正中弹出灰盒提示，点一下继续或重开；
 * - 整个 Hud 共用节点上唯一一个 Graphics 组件，全部文字使用系统字体 Label。
 */
@ccclass('Hud')
export class Hud extends Component {
    private gfx!: Graphics;
    private levelState: LevelState | null = null;
    private levelTitle = '第 1 关';

    private onPauseToggleCb: (() => void) | null = null;
    private onResumeCb: (() => void) | null = null;
    private onRestartCb: (() => void) | null = null;

    private countdownLabel!: Label;
    private pauseBtnLabel!: Label;
    private levelTitleLabel!: Label;

    private overlayNode!: Node;
    private cardTitleLabel!: Label;
    private cardDetailLabel!: Label;
    private cardActionLabel!: Label;

    private lastStatus: LevelStatus | null = null;
    private lastCountdownText = '';
    private lastUrgent = false;
    private lastFreeRings = -1;
    private lastLevelTitle = '';

    static create(machine: Node, options: HudCreateOptions): Hud {
        const node = new Node('Hud');
        node.layer = RenderLayers.FG_UI_2D;

        const transform = node.addComponent(UITransform);
        transform.setContentSize(LayoutConfig.designWidth, LayoutConfig.designHeight);
        transform.setAnchorPoint(0, 0);
        node.setPosition(-LayoutConfig.designWidth / 2, -LayoutConfig.designHeight / 2, 0);

        const hud = node.addComponent(Hud);
        hud.levelState = options.levelState;
        hud.levelTitle = options.levelTitle ?? '第 1 关';
        hud.onPauseToggleCb = options.onPauseToggle ?? null;
        hud.onResumeCb = options.onResume ?? null;
        hud.onRestartCb = options.onRestart ?? null;

        machine.addChild(node);
        return hud;
    }

    onLoad(): void {
        this.gfx = this.getComponent(Graphics) ?? this.addComponent(Graphics);
        this.buildTopHud();
        this.buildOverlay();
        this.syncFromState(true);
    }

    update(): void {
        this.syncFromState(false);
    }

    bindLevelState(levelState: LevelState, levelTitle?: string): void {
        this.levelState = levelState;
        if (levelTitle !== undefined) {
            this.levelTitle = levelTitle;
        }
        this.syncFromState(true);
    }

    setLevelTitle(title: string): void {
        this.levelTitle = title;
        this.syncFromState(false);
    }

    setCallbacks(callbacks: Pick<HudCreateOptions, 'onPauseToggle' | 'onResume' | 'onRestart'>): void {
        if (callbacks.onPauseToggle !== undefined) {
            this.onPauseToggleCb = callbacks.onPauseToggle;
        }
        if (callbacks.onResume !== undefined) {
            this.onResumeCb = callbacks.onResume;
        }
        if (callbacks.onRestart !== undefined) {
            this.onRestartCb = callbacks.onRestart;
        }
    }

    /** 将 Hud 显示同步到当前 LevelState，仅在状态/文案变化时刷新文字与重绘 Graphics */
    syncFromState(force = false): void {
        if (!this.gfx || !this.levelState) {
            return;
        }

        const status = this.levelState.status;
        const remaining = this.levelState.remainingSec;
        const countdownText = formatCountdown(remaining);
        const urgent = status === 'playing' && remaining > 0 && remaining <= GameConst.countdownUrgentSec;
        const freeRings = this.levelState.lastFreeRings;

        if (force || this.lastLevelTitle !== this.levelTitle) {
            this.levelTitleLabel.string = this.levelTitle;
            this.lastLevelTitle = this.levelTitle;
        }

        if (force || this.lastCountdownText !== countdownText) {
            this.countdownLabel.string = countdownText;
            this.lastCountdownText = countdownText;
        }

        if (force || this.lastUrgent !== urgent) {
            this.countdownLabel.color = urgent ? Palette.hud.countdownUrgent : Palette.hud.countdownNormal;
            this.lastUrgent = urgent;
        }

        const statusChanged = force || this.lastStatus !== status;
        const detailChanged = status === 'lost' && this.lastFreeRings !== freeRings;

        if (statusChanged || detailChanged) {
            this.lastStatus = status;
            this.lastFreeRings = freeRings;
            this.updateOverlayContent(status, remaining, freeRings);
            this.redraw(status);
        }
    }

    private buildTopHud(): void {
        // 1. 内屏上沿正中：倒计时
        const cdCenter = rectCenter(LayoutConfig.countdown);
        this.countdownLabel = this.createLabel(
            this.node,
            'CountdownLabel',
            '01:00',
            cdCenter.x,
            cdCenter.y,
            LayoutConfig.countdown.width - 12,
            LayoutConfig.countdown.height - 6,
            28,
            Palette.hud.countdownNormal,
        );

        // 2. 左上角：暂停键（点击热区外扩）
        const pauseCenter = rectCenter(LayoutConfig.pauseBtn);
        const pad = GameConst.hudBtnHitPadding;
        const pauseNode = this.createTouchNode(
            this.node,
            'PauseBtn',
            pauseCenter.x,
            pauseCenter.y,
            LayoutConfig.pauseBtn.width + pad * 2,
            LayoutConfig.pauseBtn.height + pad * 2,
            () => this.handlePauseTap(),
        );
        this.pauseBtnLabel = this.createLabel(
            pauseNode,
            'PauseLabel',
            '暂停',
            0,
            0,
            LayoutConfig.pauseBtn.width - 6,
            LayoutConfig.pauseBtn.height - 6,
            20,
            Palette.labelPrimary,
        );

        // 3. 左上角：关卡号
        const lvlCenter = rectCenter(LayoutConfig.levelLabel);
        this.levelTitleLabel = this.createLabel(
            this.node,
            'LevelLabel',
            this.levelTitle,
            lvlCenter.x,
            lvlCenter.y,
            LayoutConfig.levelLabel.width - 12,
            LayoutConfig.levelLabel.height - 6,
            20,
            Palette.labelPrimary,
        );
    }

    private buildOverlay(): void {
        const inner = LayoutConfig.innerScreen;
        const innerCenter = rectCenter(inner);

        const overlay = new Node('HudOverlay');
        overlay.layer = RenderLayers.FG_UI_2D;
        const overlayTr = overlay.addComponent(UITransform);
        overlayTr.setContentSize(inner.width, inner.height);
        overlayTr.setAnchorPoint(0.5, 0.5);
        overlay.setPosition(innerCenter.x, innerCenter.y, 0);
        overlay.addComponent(BlockInputEvents);
        overlay.active = false;
        this.node.addChild(overlay);
        this.overlayNode = overlay;

        const card = LayoutConfig.hudCard;
        const cardCenter = rectCenter(card);
        const cardNode = this.createTouchNode(
            overlay,
            'HudCard',
            cardCenter.x - innerCenter.x,
            cardCenter.y - innerCenter.y,
            card.width,
            card.height,
            () => this.handleOverlayTap(),
        );

        this.cardTitleLabel = this.createLabel(
            cardNode,
            'CardTitle',
            '',
            0,
            66,
            card.width - 36,
            56,
            40,
            Palette.labelPrimary,
        );

        this.cardDetailLabel = this.createLabel(
            cardNode,
            'CardDetail',
            '',
            0,
            10,
            card.width - 44,
            40,
            22,
            Palette.labelMuted,
        );

        const btn = LayoutConfig.hudActionBtn;
        const btnCenter = rectCenter(btn);
        const pad = GameConst.hudBtnHitPadding;
        const actionBtnNode = this.createTouchNode(
            overlay,
            'HudActionBtn',
            btnCenter.x - innerCenter.x,
            btnCenter.y - innerCenter.y,
            btn.width + pad * 2,
            btn.height + pad * 2,
            () => this.handleOverlayTap(),
        );

        this.cardActionLabel = this.createLabel(
            actionBtnNode,
            'CardActionLabel',
            '',
            0,
            0,
            btn.width - 16,
            btn.height - 8,
            24,
            Palette.labelPrimary,
        );
    }

    private updateOverlayContent(status: LevelStatus, remainingSec: number, freeRings: number): void {
        this.pauseBtnLabel.string = status === 'paused' ? '继续' : '暂停';

        const showOverlay = status === 'paused' || status === 'won' || status === 'lost';
        this.overlayNode.active = showOverlay;
        if (!showOverlay) {
            return;
        }

        if (status === 'paused') {
            this.cardTitleLabel.string = '已暂停';
            this.cardTitleLabel.color = Palette.labelPrimary;
            this.cardDetailLabel.string = '物理与倒计时已停止';
            this.cardActionLabel.string = '继续';
            return;
        }

        if (status === 'won') {
            this.cardTitleLabel.string = '过关';
            this.cardTitleLabel.color = Palette.hud.cardWonBorder;
            this.cardDetailLabel.string = `全部锁脉环已归位（余 ${Math.ceil(remainingSec)} 秒）`;
            this.cardActionLabel.string = '点击重开';
            return;
        }

        this.cardTitleLabel.string = '时间到';
        this.cardTitleLabel.color = Palette.hud.cardLostBorder;
        this.cardDetailLabel.string =
            freeRings > 0 ? `水里还有 ${freeRings} 个圈未套上` : '时间已耗尽，未能及时封脉';
        this.cardActionLabel.string = '点击重开';
    }

    private redraw(status: LevelStatus): void {
        const g = this.gfx;
        if (!g) {
            return;
        }
        g.clear();

        // 1. 左上角暂停键底板
        this.drawPlate(
            g,
            LayoutConfig.pauseBtn,
            status === 'paused' ? Palette.hud.pauseBtnActive : Palette.hudFill,
            Palette.hudBorder,
            10,
        );

        // 2. 左上角关卡号底板
        this.drawPlate(g, LayoutConfig.levelLabel, Palette.hudFill, Palette.hudBorder, 10);

        // 3. 内屏上沿正中倒计时底板
        this.drawPlate(
            g,
            LayoutConfig.countdown,
            Palette.hudFill,
            this.lastUrgent ? Palette.hud.countdownUrgent : Palette.hudBorder,
            10,
        );

        // 4. 仅在暂停或结算时于内屏绘制灰盒提示遮罩与卡片
        if (status !== 'paused' && status !== 'won' && status !== 'lost') {
            return;
        }

        const inner = LayoutConfig.innerScreen;
        g.fillColor = Palette.hud.overlayBackdrop;
        g.fillRect(inner.x, inner.y, inner.width, inner.height);

        const cardBorder =
            status === 'won'
                ? Palette.hud.cardWonBorder
                : status === 'lost'
                    ? Palette.hud.cardLostBorder
                    : Palette.hud.cardBorder;
        this.drawPlate(g, LayoutConfig.hudCard, Palette.hud.cardBg, cardBorder, 16, 3);

        const btnFill = status === 'lost' ? Palette.hud.actionBtnLostFill : Palette.hud.actionBtnFill;
        const btnBorder = status === 'lost' ? Palette.hud.actionBtnLostBorder : Palette.hud.actionBtnBorder;
        this.drawPlate(g, LayoutConfig.hudActionBtn, btnFill, btnBorder, 12, 2);
    }

    private drawPlate(
        g: Graphics,
        rect: LayoutRect,
        fill: Color,
        border: Color,
        radius: number,
        lineWidth = 2,
    ): void {
        g.fillColor = fill;
        g.strokeColor = border;
        g.lineWidth = lineWidth;
        g.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
        g.fill();
        g.stroke();
    }

    private handlePauseTap(): void {
        if (!this.levelState) {
            return;
        }
        const status = this.levelState.status;
        if (status !== 'playing' && status !== 'paused') {
            return;
        }
        if (this.onPauseToggleCb) {
            this.onPauseToggleCb();
        } else {
            this.levelState.togglePause();
        }
        this.syncFromState(false);
    }

    private handleOverlayTap(): void {
        if (!this.levelState) {
            return;
        }
        const status = this.levelState.status;
        if (status === 'paused') {
            if (this.onResumeCb) {
                this.onResumeCb();
            } else {
                this.levelState.resume();
            }
            this.syncFromState(false);
            return;
        }
        if (status === 'won' || status === 'lost') {
            this.onRestartCb?.();
        }
    }

    private createTouchNode(
        parent: Node,
        name: string,
        x: number,
        y: number,
        width: number,
        height: number,
        onTap: () => void,
    ): Node {
        const node = new Node(name);
        node.layer = RenderLayers.FG_UI_2D;
        const tr = node.addComponent(UITransform);
        tr.setAnchorPoint(0.5, 0.5);
        tr.setContentSize(width, height);
        node.setPosition(x, y, 0);

        node.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
            e.propagationStopped = true;
            onTap();
        });
        node.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            e.propagationStopped = true;
        });
        node.on(Node.EventType.TOUCH_CANCEL, (e: EventTouch) => {
            e.propagationStopped = true;
        });

        parent.addChild(node);
        return node;
    }

    private createLabel(
        parent: Node,
        name: string,
        text: string,
        x: number,
        y: number,
        width: number,
        height: number,
        fontSize: number,
        color: Color,
    ): Label {
        const node = new Node(name);
        node.layer = RenderLayers.FG_UI_2D;
        const tr = node.addComponent(UITransform);
        tr.setAnchorPoint(0.5, 0.5);
        tr.setContentSize(width, height);
        node.setPosition(x, y, 0);

        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = Math.round(fontSize * 1.25);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.color = color;
        label.overflow = Label.Overflow.SHRINK;

        parent.addChild(node);
        return label;
    }
}
