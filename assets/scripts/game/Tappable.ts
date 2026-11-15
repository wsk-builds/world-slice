import { _decorator, Component, Node } from 'cc';
import {
    TappableHitMatch,
    TappableHitShape,
    TappablePoint,
    TappableRegistry,
    TappableTapEvent,
    TappableTargetSpec,
} from '../core/input/TappableRegistry';

const { ccclass } = _decorator;

export type {
    TappableHitMatch,
    TappableHitShape,
    TappablePoint,
    TappableTapEvent,
    TappableTargetSpec,
};

/**
 * 敲玻璃可点对象登记表组件（T021）：
 * - 挂在 TankRoot 上，桥接纯逻辑 `TappableRegistry`；
 * - 供灵蚌、蟹将、虾兵、章鱼、老海龟、沸脉大泡等敲玻璃交互对象注册与统一命中分发；
 * - 命中范围默认按 `GameConst.tappableHitScale` 放大，单次点击只触发离点击点最近的对象。
 */
@ccclass('Tappable')
export class Tappable extends Component {
    private static activeInstance: Tappable | null = null;

    readonly registry = new TappableRegistry();

    static attach(tankRoot: Node): Tappable {
        const comp = tankRoot.getComponent(Tappable) ?? tankRoot.addComponent(Tappable);
        Tappable.activeInstance = comp;
        return comp;
    }

    static getInstance(): Tappable | null {
        return Tappable.activeInstance && Tappable.activeInstance.isValid ? Tappable.activeInstance : null;
    }

    onLoad(): void {
        Tappable.activeInstance = this;
    }

    onEnable(): void {
        Tappable.activeInstance = this;
    }

    onDestroy(): void {
        this.registry.clear();
        if (Tappable.activeInstance === this) {
            Tappable.activeInstance = null;
        }
    }

    get count(): number {
        return this.registry.count;
    }

    register(spec: TappableTargetSpec): string {
        return this.registry.register(spec);
    }

    unregister(id: string): boolean {
        return this.registry.unregister(id);
    }

    has(id: string): boolean {
        return this.registry.has(id);
    }

    setEnabled(id: string, enabled: boolean): boolean {
        return this.registry.setEnabled(id, enabled);
    }

    isEnabled(id: string): boolean {
        return this.registry.isEnabled(id);
    }

    findNearestHit(tapPt: TappablePoint): TappableHitMatch | null {
        return this.registry.findNearestHit(tapPt);
    }

    dispatchTap(tapPt: TappablePoint): TappableHitMatch | null {
        return this.registry.dispatchTap(tapPt);
    }

    clear(): void {
        this.registry.clear();
    }
}
