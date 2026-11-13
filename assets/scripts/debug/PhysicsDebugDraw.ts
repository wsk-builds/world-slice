import {
    _decorator, Component, EPhysics2DDrawFlags, EventKeyboard, find, Input, input, KeyCode, Node, PhysicsSystem2D,
} from 'cc';
import { GameConst } from '../config/GameConst';

const { ccclass } = _decorator;

/**
 * 物理碰撞框调试开关：按 P 显示或隐藏碰撞体轮廓。
 * 受 GameConst.DEBUG 统一控制。
 */
@ccclass('PhysicsDebugDraw')
export class PhysicsDebugDraw extends Component {
    private enabledDraw = false;

    onEnable(): void {
        if (!GameConst.DEBUG) {
            return;
        }
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    onDisable(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    toggle(): void {
        this.setDrawEnabled(!this.enabledDraw);
    }

    setDrawEnabled(show: boolean): void {
        this.enabledDraw = show;
        const physics = PhysicsSystem2D.instance;
        if (show) {
            this.ensureDebugGraphicsAttached();
            physics.debugDrawFlags = EPhysics2DDrawFlags.Shape;
        } else {
            physics.debugDrawFlags = EPhysics2DDrawFlags.None;
        }
    }

    private onKeyDown(event: EventKeyboard): void {
        if (event.keyCode === KeyCode.KEY_P) {
            this.toggle();
        }
    }

    /**
     * 规避 Cocos 3.8.8 b2PhysicsWorld 在关闭 debugDrawFlags 时将 _debugGraphics.node.parent 置空、
     * 再次开启时访问 node.parent!.children 报空指针的引擎问题。
     */
    private ensureDebugGraphicsAttached(): void {
        const world = PhysicsSystem2D.instance.physicsWorld as unknown as {
            _debugGraphics?: { isValid?: boolean; node?: Node } | null;
        };
        const dbgNode = world?._debugGraphics?.isValid ? world._debugGraphics.node : null;
        if (dbgNode && !dbgNode.parent) {
            const canvas = find('Canvas');
            if (canvas) {
                dbgNode.parent = canvas;
            }
        }
    }
}
