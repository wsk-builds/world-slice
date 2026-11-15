import { _decorator, Color, Component, EventKeyboard, Graphics, Input, input, KeyCode, Node, UITransform } from 'cc';
import { GameConst } from '../config/GameConst';
import { HotZones } from '../config/HotZones';
import { Palette } from '../config/Palette';
import { TankSpace } from '../config/TankSpace';
import { RenderLayers } from '../render/Stage3DRig';

const { ccclass } = _decorator;

const EDGE_INSET = 1.5;
const scratchColor = new Color();

function isHtmlTextInputFocused(): boolean {
    if (typeof document === 'undefined') {
        return false;
    }
    const active = document.activeElement as { tagName?: string; isContentEditable?: boolean } | null;
    if (!active) {
        return false;
    }
    const tag = active.tagName?.toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(active.isContentEditable);
}

/**
 * 拇指热区调试绘制组件（受 GameConst.DEBUG 控制，T021）：
 * - 按 H 键显示 / 隐藏左右两块半透明拇指热区（输入框聚焦时不误触）；
 * - 拖动调参面板「热区宽度」滑块时实时重绘；
 * - 共用单个 Graphics 组件，严格绘制在内屏边界之内。
 */
@ccclass('HotZoneDebugDraw')
export class HotZoneDebugDraw extends Component {
    private enabledDraw = false;
    private gfx: Graphics | null = null;
    private dirty = false;
    private unsubHotZone: (() => void) | null = null;

    onLoad(): void {
        this.ensureOverlayGraphics();
    }

    onEnable(): void {
        if (!GameConst.DEBUG) {
            return;
        }
        this.ensureOverlayGraphics();
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        this.unsubHotZone = HotZones.onChange(this.onHotZoneChanged);
    }

    onDisable(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        this.unsubHotZone?.();
        this.unsubHotZone = null;
        this.gfx?.clear();
    }

    get isShown(): boolean {
        return this.enabledDraw;
    }

    toggle(): void {
        this.setDrawEnabled(!this.enabledDraw);
    }

    setDrawEnabled(show: boolean): void {
        this.enabledDraw = show;
        if (!show) {
            this.dirty = false;
            this.gfx?.clear();
            return;
        }
        this.dirty = true;
        this.redraw();
    }

    lateUpdate(): void {
        if (!this.enabledDraw || !this.dirty) {
            return;
        }
        this.redraw();
    }

    redraw(): void {
        if (!this.enabledDraw || !this.gfx || !this.gfx.isValid) {
            return;
        }
        this.dirty = false;
        const g = this.gfx;
        g.clear();

        const [leftRect, rightRect] = HotZones.getRects();
        const minY = EDGE_INSET;
        const drawH = Math.max(0, TankSpace.height - EDGE_INSET * 2);

        const leftW = Math.max(0, leftRect.width - EDGE_INSET);
        const rightX = Math.max(EDGE_INSET, rightRect.x);
        const rightW = Math.max(0, TankSpace.width - EDGE_INSET - rightX);

        // 1. 半透明热区填充（严格不超出内屏边界）
        scratchColor.set(Palette.hotZone.fill);
        g.fillColor = scratchColor;
        g.fillRect(EDGE_INSET, minY, leftW, drawH);
        g.fillRect(rightX, minY, rightW, drawH);

        // 2. 热区外框描边
        scratchColor.set(Palette.hotZone.border);
        g.strokeColor = scratchColor;
        g.lineWidth = 2;
        g.rect(EDGE_INSET, minY, leftW, drawH);
        g.rect(rightX, minY, rightW, drawH);
        g.stroke();

        // 3. 热区内侧分界虚线与中线标尺，便于真机握持时辨识拇指极限边缘
        scratchColor.set(Palette.hotZone.boundary);
        g.strokeColor = scratchColor;
        g.lineWidth = 2.5;
        const leftBoundaryX = Math.min(TankSpace.width - EDGE_INSET, leftRect.width);
        const rightBoundaryX = Math.max(EDGE_INSET, rightRect.x);
        this.drawDashedVertical(g, leftBoundaryX, minY, minY + drawH);
        this.drawDashedVertical(g, rightBoundaryX, minY, minY + drawH);
    }

    private drawDashedVertical(g: Graphics, x: number, yStart: number, yEnd: number): void {
        const dash = 14;
        const gap = 10;
        let y = yStart;
        while (y < yEnd) {
            const next = Math.min(yEnd, y + dash);
            g.moveTo(x, y);
            g.lineTo(x, next);
            y = next + gap;
        }
        g.stroke();
    }

    private ensureOverlayGraphics(): void {
        if (this.gfx && this.gfx.isValid) {
            return;
        }
        const existing = this.node.getChildByName('HotZoneDebugOverlay');
        if (existing) {
            this.gfx = existing.getComponent(Graphics) ?? existing.addComponent(Graphics);
            return;
        }
        const overlay = new Node('HotZoneDebugOverlay');
        overlay.layer = RenderLayers.FG_UI_2D;
        const tf = overlay.addComponent(UITransform);
        tf.setContentSize(TankSpace.width, TankSpace.height);
        tf.setAnchorPoint(0, 0);
        overlay.setPosition(0, 0, 0);
        this.node.addChild(overlay);
        this.gfx = overlay.addComponent(Graphics);
    }

    private onHotZoneChanged = (): void => {
        if (this.enabledDraw) {
            this.dirty = true;
            this.redraw();
        }
    };

    private onKeyDown = (event: EventKeyboard): void => {
        if (!GameConst.DEBUG || event.keyCode !== KeyCode.KEY_H || isHtmlTextInputFocused()) {
            return;
        }
        this.toggle();
    };
}
