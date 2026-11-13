import { _decorator, Component, PhysicsSystem2D } from 'cc';

const { ccclass } = _decorator;

export type StepCallback = (dt: number) => void;

/**
 * 物理步控制器：包住 PhysicsSystem2D.instance.physicsWorld.step，
 * 提供每步之前 / 之后回调、running 暂停开关与累计物理时间。
 */
@ccclass('PhysicsStepper')
export class PhysicsStepper extends Component {
    /** false 时跳过物理步（暂停），不关闭 PhysicsSystem2D 以保留节点-刚体同步 */
    running = true;

    private _elapsed = 0;
    private beforeListeners: StepCallback[] = [];
    private afterListeners: StepCallback[] = [];
    private restoreEngineStep: (() => void) | null = null;

    /** 累计物理模拟时间（秒） */
    get elapsed(): number {
        return this._elapsed;
    }

    /** 重置累计物理时间 */
    resetElapsed(): void {
        this._elapsed = 0;
    }

    onBeforeStep(cb: StepCallback): void {
        if (!this.beforeListeners.includes(cb)) {
            this.beforeListeners.push(cb);
        }
    }

    offBeforeStep(cb: StepCallback): void {
        const idx = this.beforeListeners.indexOf(cb);
        if (idx >= 0) {
            this.beforeListeners.splice(idx, 1);
        }
    }

    onAfterStep(cb: StepCallback): void {
        if (!this.afterListeners.includes(cb)) {
            this.afterListeners.push(cb);
        }
    }

    offAfterStep(cb: StepCallback): void {
        const idx = this.afterListeners.indexOf(cb);
        if (idx >= 0) {
            this.afterListeners.splice(idx, 1);
        }
    }

    onEnable(): void {
        if (this.restoreEngineStep) {
            return;
        }
        const world = PhysicsSystem2D.instance.physicsWorld;
        const engineStep = world.step;

        world.step = (dt: number, velocityIterations?: number, positionIterations?: number): void => {
            if (!this.running) {
                return;
            }
            const before = this.beforeListeners.slice();
            for (let i = 0; i < before.length; i++) {
                before[i](dt);
            }

            engineStep.call(world, dt, velocityIterations, positionIterations);
            this._elapsed += dt;

            const after = this.afterListeners.slice();
            for (let i = 0; i < after.length; i++) {
                after[i](dt);
            }
        };

        this.restoreEngineStep = () => {
            world.step = engineStep;
        };
    }

    onDisable(): void {
        if (this.restoreEngineStep) {
            this.restoreEngineStep();
            this.restoreEngineStep = null;
        }
    }
}
