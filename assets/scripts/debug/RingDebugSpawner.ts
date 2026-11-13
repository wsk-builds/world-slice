import { _decorator, Component, EventKeyboard, EventTouch, Game, game, Input, input, KeyCode, Node, UITransform, Vec3 } from 'cc';
import { GameConst } from '../config/GameConst';
import { DEBUG_RING_SLOTS, ringSpecLabel, RingSpec } from '../core/rings/RingKinds';
import { PhysicsStepper } from '../game/PhysicsStepper';
import { RingLayer } from '../game/RingLayer';
import { ScoreJudge } from '../game/ScoreJudge';

const { ccclass } = _decorator;

const tempVec3 = new Vec3();

/**
 * 灰盒调试放圈组件（受 GameConst.DEBUG 控制）：
 * - 按住 Shift 再点击内屏在点击处放一个当前选中的圈（普通点击归敲玻璃 GlassTap）
 * - 数字键 1–7 切换圈种（1红 2绿 3蓝 4橙 5小金环 6铁圈 7木圈）
 * - R 键清空所有圈
 */
@ccclass('RingDebugSpawner')
export class RingDebugSpawner extends Component {
    ringLayer: RingLayer | null = null;
    scoreJudge: ScoreJudge | null = null;
    onClearAll: (() => void) | null = null;

    private slotIndex = 0;
    private tankTransform: UITransform | null = null;
    private stepper: PhysicsStepper | null = null;
    private shiftLeftHeld = false;
    private shiftRightHeld = false;

    get currentSpec(): RingSpec {
        return DEBUG_RING_SLOTS[this.slotIndex];
    }

    onLoad(): void {
        this.tankTransform = this.getComponent(UITransform);
        this.stepper = this.getComponent(PhysicsStepper) ?? this.node.parent?.getComponent(PhysicsStepper) ?? null;
    }

    onEnable(): void {
        if (!GameConst.DEBUG) {
            return;
        }
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

    private isShiftHeld(): boolean {
        return this.shiftLeftHeld || this.shiftRightHeld;
    }

    private clearShiftState = (): void => {
        this.shiftLeftHeld = false;
        this.shiftRightHeld = false;
    };

    private onTouchStart = (event: EventTouch): void => {
        if (!this.isShiftHeld() || !this.ringLayer || !this.tankTransform || (this.stepper && !this.stepper.running)) {
            return;
        }
        const uiLoc = event.getUILocation();
        this.tankTransform.convertToNodeSpaceAR(tempVec3.set(uiLoc.x, uiLoc.y, 0), tempVec3);
        this.ringLayer.spawn(tempVec3.x, tempVec3.y, this.currentSpec);
    };

    private onKeyDown = (event: EventKeyboard): void => {
        if (event.keyCode === KeyCode.SHIFT_LEFT) {
            this.shiftLeftHeld = true;
            return;
        }
        if (event.keyCode === KeyCode.SHIFT_RIGHT) {
            this.shiftRightHeld = true;
            return;
        }
        const slot = this.keyCodeToSlot(event.keyCode);
        if (slot >= 0) {
            this.slotIndex = slot;
            console.log(`[RingDebug] 切换为 ${slot + 1}: ${ringSpecLabel(this.currentSpec)}`);
            return;
        }
        if (event.keyCode === KeyCode.KEY_R) {
            this.ringLayer?.clearAll();
            this.scoreJudge?.reset();
            this.onClearAll?.();
            console.log('[RingDebug] 已清空所有圈');
        }
    };

    private onKeyUp = (event: EventKeyboard): void => {
        if (event.keyCode === KeyCode.SHIFT_LEFT) {
            this.shiftLeftHeld = false;
        } else if (event.keyCode === KeyCode.SHIFT_RIGHT) {
            this.shiftRightHeld = false;
        }
    };

    private keyCodeToSlot(code: KeyCode): number {
        if (code >= KeyCode.DIGIT_1 && code <= KeyCode.DIGIT_7) {
            return code - KeyCode.DIGIT_1;
        }
        if (code >= KeyCode.NUM_1 && code <= KeyCode.NUM_7) {
            return code - KeyCode.NUM_1;
        }
        return -1;
    }
}
