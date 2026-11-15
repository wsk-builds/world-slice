import {
    _decorator, Color, Component, EventKeyboard, EventTouch, Game, game, Graphics, Input, input, KeyCode, Node,
    UITransform, Vec2, Vec3,
} from 'cc';
import { GameConst } from '../config/GameConst';
import { Palette } from '../config/Palette';
import { TankSpace } from '../config/TankSpace';
import { ClippedSegmentOut, clipSegmentToRect, GlassRipplePool } from '../core/input/GlassRipplePool';
import { TappableHitMatch } from '../core/input/TappableRegistry';
import { PhysicsStepper } from '../game/PhysicsStepper';
import { Sfx } from '../game/Sfx';
import { Tappable } from '../game/Tappable';
import { RenderLayers } from '../render/Stage3DRig';

const { ccclass } = _decorator;

const RIPPLE_SEGMENTS = 28;
const GLASS_EDGE_PAD = 1.5;

const tempUiLoc = new Vec2();
const tempLocalPos = new Vec3();
const scratchColor = new Color();
const scratchSeg: ClippedSegmentOut = { x0: 0, y0: 0, x1: 0, y1: 0 };

export interface GlassTapEvent {
    /** 敲玻璃落点缸坐标 X（原点在内屏左下角） */
    readonly x: number;
    /** 敲玻璃落点缸坐标 Y（原点在内屏左下角） */
    readonly y: number;
    /** 本次点击命中的可点对象（未命中任何对象时为 null） */
    readonly matchedTarget: TappableHitMatch | null;
}

export type GlassTapListener = (event: GlassTapEvent) => void;

export interface GlassTapAttachOptions {
    tappable?: Tappable | null;
    stepper?: PhysicsStepper | null;
}

/**
 * 敲玻璃输入与震纹反馈组件（GDD §2.2 第二条，T021）：
 * - 挂载在 TankRoot 上，点击/触控内屏时将屏幕坐标精确换算为缸坐标（兼容任意 Machine 缩放）；
 * - 按住 Shift 点击内屏时让位给 RingDebugSpawner 调试放圈，不触发敲玻璃；
 * - 暂停、结算遮罩、调参面板遮挡或外部调用 `setInputEnabled(false)`（如 T022 摆关模式）时不误触；
 * - 每次有效敲玻璃：分发给 `Tappable` 登记表触发最近对象、播放 `Sfx.play('glass_tap')`、发出 `onTap` 事件，
 *   并在前景层单个共用 `Graphics` 上用固定容量对象池绘制严格裁剪在内屏边界内的扩散淡出震纹。
 */
@ccclass('GlassTap')
export class GlassTap extends Component {
    tappable: Tappable | null = null;
    stepper: PhysicsStepper | null = null;

    readonly ripplePool = new GlassRipplePool(GameConst.glassTapRipplePoolSize);

    private tankTransform: UITransform | null = null;
    private gfx: Graphics | null = null;
    private inputEnabled = true;
    private shiftLeftHeld = false;
    private shiftRightHeld = false;
    private hasDrawnLastFrame = false;

    private readonly listeners: GlassTapListener[] = [];

    static attach(tankRoot: Node, options?: GlassTapAttachOptions): GlassTap {
        const comp = tankRoot.getComponent(GlassTap) ?? tankRoot.addComponent(GlassTap);
        comp.tappable = options?.tappable ?? tankRoot.getComponent(Tappable) ?? null;
        comp.stepper = options?.stepper ?? tankRoot.getComponent(PhysicsStepper) ?? null;
        return comp;
    }

    onLoad(): void {
        this.tankTransform = this.getComponent(UITransform);
        if (!this.stepper) {
            this.stepper = this.getComponent(PhysicsStepper) ?? this.node.parent?.getComponent(PhysicsStepper) ?? null;
        }
        if (!this.tappable) {
            this.tappable = this.getComponent(Tappable) ?? Tappable.getInstance();
        }
        this.ensureOverlayGraphics();
    }

    onEnable(): void {
        this.ensureOverlayGraphics();
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
        game.on(Game.EVENT_HIDE, this.clearShiftState, this);
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('blur', this.clearShiftState);
        }
        game.canvas?.addEventListener?.('blur', this.clearShiftState);
    }

    onDisable(): void {
        this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        game.off(Game.EVENT_HIDE, this.clearShiftState, this);
        if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
            window.removeEventListener('blur', this.clearShiftState);
        }
        game.canvas?.removeEventListener?.('blur', this.clearShiftState);
        this.clearShiftState();
    }

    get isInputEnabled(): boolean {
        return this.inputEnabled;
    }

    /** 启用或禁用敲玻璃输入（暂停、结算及后续 T022 摆关模式可调用） */
    setInputEnabled(enabled: boolean): void {
        this.inputEnabled = enabled;
    }

    onTap(cb: GlassTapListener): () => void {
        if (!this.listeners.includes(cb)) {
            this.listeners.push(cb);
        }
        return () => {
            this.offTap(cb);
        };
    }

    offTap(cb: GlassTapListener): void {
        const idx = this.listeners.indexOf(cb);
        if (idx >= 0) {
            this.listeners.splice(idx, 1);
        }
    }

    /** 清空活跃震纹（切关 / 重开 / R 键清空时调用） */
    clearRipples(): void {
        this.ripplePool.clear();
        if (this.gfx && this.gfx.isValid && this.hasDrawnLastFrame) {
            this.gfx.clear();
            this.hasDrawnLastFrame = false;
        }
    }

    /** 以缸坐标主动触发一次敲玻璃（供内部及测试桥接调用） */
    triggerTap(tankX: number, tankY: number): GlassTapEvent {
        const x = Math.min(TankSpace.width, Math.max(0, tankX));
        const y = Math.min(TankSpace.height, Math.max(0, tankY));

        const matchedTarget = this.tappable ? this.tappable.dispatchTap({ x, y }) : null;
        Sfx.play('glass_tap');
        this.ripplePool.spawn(x, y, matchedTarget !== null);

        const event: GlassTapEvent = { x, y, matchedTarget };
        const snapshot = this.listeners.slice();
        for (let i = 0; i < snapshot.length; i++) {
            snapshot[i](event);
        }
        return event;
    }

    update(dt: number): void {
        if (this.stepper && !this.stepper.running) {
            return;
        }
        const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
        this.ripplePool.step(safeDt);
    }

    lateUpdate(): void {
        if (!this.gfx) {
            return;
        }
        if (this.ripplePool.activeCount === 0) {
            if (this.hasDrawnLastFrame) {
                this.gfx.clear();
                this.hasDrawnLastFrame = false;
            }
            return;
        }

        this.drawRipples(this.gfx);
        this.hasDrawnLastFrame = true;
    }

    private ensureOverlayGraphics(): void {
        if (this.gfx && this.gfx.isValid) {
            return;
        }
        const existing = this.node.getChildByName('GlassTapOverlay');
        if (existing) {
            this.gfx = existing.getComponent(Graphics) ?? existing.addComponent(Graphics);
            return;
        }
        const overlay = new Node('GlassTapOverlay');
        overlay.layer = RenderLayers.FG_UI_2D;
        const tf = overlay.addComponent(UITransform);
        tf.setContentSize(TankSpace.width, TankSpace.height);
        tf.setAnchorPoint(0, 0);
        overlay.setPosition(0, 0, 0);
        this.node.addChild(overlay);
        this.gfx = overlay.addComponent(Graphics);
    }

    private isShiftHeld(): boolean {
        return this.shiftLeftHeld || this.shiftRightHeld;
    }

    private clearShiftState = (): void => {
        this.shiftLeftHeld = false;
        this.shiftRightHeld = false;
    };

    private onKeyDown = (event: EventKeyboard): void => {
        if (event.keyCode === KeyCode.SHIFT_LEFT) {
            this.shiftLeftHeld = true;
        } else if (event.keyCode === KeyCode.SHIFT_RIGHT) {
            this.shiftRightHeld = true;
        }
    };

    private onKeyUp = (event: EventKeyboard): void => {
        if (event.keyCode === KeyCode.SHIFT_LEFT) {
            this.shiftLeftHeld = false;
        } else if (event.keyCode === KeyCode.SHIFT_RIGHT) {
            this.shiftRightHeld = false;
        }
    };

    private onTouchStart = (event: EventTouch): void => {
        if (!this.inputEnabled || !this.tankTransform) {
            return;
        }
        if (this.stepper && !this.stepper.running) {
            return;
        }
        if (GameConst.DEBUG && this.isShiftHeld()) {
            return;
        }

        const uiLoc = event.getUILocation(tempUiLoc);
        this.tankTransform.convertToNodeSpaceAR(tempLocalPos.set(uiLoc.x, uiLoc.y, 0), tempLocalPos);
        const tx = tempLocalPos.x;
        const ty = tempLocalPos.y;
        if (tx < 0 || tx > TankSpace.width || ty < 0 || ty > TankSpace.height) {
            return;
        }

        event.propagationStopped = true;
        this.triggerTap(tx, ty);
    };

    private drawRipples(gfx: Graphics): void {
        gfx.clear();

        const minX = GLASS_EDGE_PAD;
        const minY = GLASS_EDGE_PAD;
        const maxX = TankSpace.width - GLASS_EDGE_PAD;
        const maxY = TankSpace.height - GLASS_EDGE_PAD;

        const items = this.ripplePool.items;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (!item.active) {
                continue;
            }
            const progress = Math.min(1, Math.max(0, item.ageSec / item.durationSec));
            const easeOut = 1 - (1 - progress) * (1 - progress);
            const fade = (1 - progress) * (1 - progress);
            if (fade <= 0.01) {
                continue;
            }

            const outerR = item.startRadius + (item.endRadius - item.startRadius) * easeOut;
            scratchColor.set(Palette.glassTap.rippleOuter);
            scratchColor.a = Math.round(Palette.glassTap.rippleOuter.a * fade);
            gfx.strokeColor = scratchColor;
            gfx.lineWidth = 2.4 - 0.8 * progress;
            this.drawClippedCircle(gfx, item.x, item.y, outerR, minX, minY, maxX, maxY);

            const innerR = outerR * 0.54;
            if (innerR >= 4) {
                const innerBase = item.hitMatched ? Palette.glassTap.rippleHitAccent : Palette.glassTap.rippleInner;
                scratchColor.set(innerBase);
                scratchColor.a = Math.round(innerBase.a * fade * 0.85);
                gfx.strokeColor = scratchColor;
                gfx.lineWidth = item.hitMatched ? 2.0 : 1.4;
                this.drawClippedCircle(gfx, item.x, item.y, innerR, minX, minY, maxX, maxY);
            }
        }
    }

    private drawClippedCircle(
        gfx: Graphics,
        cx: number,
        cy: number,
        radius: number,
        minX: number,
        minY: number,
        maxX: number,
        maxY: number,
    ): void {
        let hasSegment = false;
        let prevX = cx + radius;
        let prevY = cy;
        for (let s = 1; s <= RIPPLE_SEGMENTS; s++) {
            const angle = (s / RIPPLE_SEGMENTS) * Math.PI * 2;
            const nextX = cx + Math.cos(angle) * radius;
            const nextY = cy + Math.sin(angle) * radius;
            if (clipSegmentToRect(prevX, prevY, nextX, nextY, minX, minY, maxX, maxY, scratchSeg)) {
                gfx.moveTo(scratchSeg.x0, scratchSeg.y0);
                gfx.lineTo(scratchSeg.x1, scratchSeg.y1);
                hasSegment = true;
            }
            prevX = nextX;
            prevY = nextY;
        }
        if (hasSegment) {
            gfx.stroke();
        }
    }
}
