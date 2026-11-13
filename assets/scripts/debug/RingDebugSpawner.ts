import { _decorator, Component, EventKeyboard, EventTouch, Input, input, KeyCode, Node, UITransform, Vec3 } from 'cc';
import { GameConst } from '../config/GameConst';
import { DEBUG_RING_SLOTS, ringSpecLabel, RingSpec } from '../core/rings/RingKinds';
import { RingLayer } from '../game/Ring';

const { ccclass } = _decorator;

const tempVec3 = new Vec3();

/**
 * 灰盒调试放圈组件（受 GameConst.DEBUG 控制）：
 * - 点击内屏在点击处放一个当前选中的圈
 * - 数字键 1–7 切换圈种（1红 2绿 3蓝 4橙 5小金环 6铁圈 7木圈）
 * - R 键清空所有圈
 */
@ccclass('RingDebugSpawner')
export class RingDebugSpawner extends Component {
    ringLayer: RingLayer | null = null;

    private slotIndex = 0;
    private tankTransform: UITransform | null = null;

    get currentSpec(): RingSpec {
        return DEBUG_RING_SLOTS[this.slotIndex];
    }

    onLoad(): void {
        this.tankTransform = this.getComponent(UITransform);
    }

    onEnable(): void {
        if (!GameConst.DEBUG) {
            return;
        }
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    onDisable(): void {
        this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    private onTouchStart = (event: EventTouch): void => {
        if (!this.ringLayer || !this.tankTransform) {
            return;
        }
        const uiLoc = event.getUILocation();
        this.tankTransform.convertToNodeSpaceAR(tempVec3.set(uiLoc.x, uiLoc.y, 0), tempVec3);
        this.ringLayer.spawn(tempVec3.x, tempVec3.y, this.currentSpec);
    };

    private onKeyDown = (event: EventKeyboard): void => {
        const slot = this.keyCodeToSlot(event.keyCode);
        if (slot >= 0) {
            this.slotIndex = slot;
            console.log(`[RingDebug] 切换为 ${slot + 1}: ${ringSpecLabel(this.currentSpec)}`);
            return;
        }
        if (event.keyCode === KeyCode.KEY_R) {
            this.ringLayer?.clearAll();
            console.log('[RingDebug] 已清空所有圈');
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
