import { _decorator, Component } from 'cc';
import { TorusWorld3D } from '../core/physics3d/TorusWorld3D';

const { ccclass } = _decorator;

export type StepCallback = (dt: number) => void;

const FIXED_STEP_DT = 1 / 60;
const MAX_SUB_STEPS_PER_FRAME = 4;

/**
 * 3D 物理步控制器：以固定 1/60s 步长推进 TorusWorld3D，
 * 提供每步之前 / 之后回调、running 暂停开关与累计物理时间。
 */
@ccclass('PhysicsStepper')
export class PhysicsStepper extends Component {
    /** false 时跳过物理步（暂停），保持刚体与视觉静止 */
    running = true;

    readonly world = new TorusWorld3D();

    private _elapsed = 0;
    private accumulator = 0;
    private beforeListeners: StepCallback[] = [];
    private afterListeners: StepCallback[] = [];

    /** 累计物理模拟时间（秒） */
    get elapsed(): number {
        return this._elapsed;
    }

    /** 重置累计物理时间与帧余量 */
    resetElapsed(): void {
        this._elapsed = 0;
        this.accumulator = 0;
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

    /** 手动走一步指定 dt（供挂机自测加速或调试单步使用） */
    stepOnce(dt: number = FIXED_STEP_DT): void {
        const before = this.beforeListeners.slice();
        for (let i = 0; i < before.length; i++) {
            before[i](dt);
        }

        this.world.step(dt);
        this._elapsed += dt;

        const after = this.afterListeners.slice();
        for (let i = 0; i < after.length; i++) {
            after[i](dt);
        }
    }

    update(dt: number): void {
        if (!this.running) {
            return;
        }
        const clampedDt = Math.min(Math.max(0, dt), FIXED_STEP_DT * MAX_SUB_STEPS_PER_FRAME);
        this.accumulator += clampedDt;

        let sub = 0;
        while (this.running && this.accumulator >= FIXED_STEP_DT && sub < MAX_SUB_STEPS_PER_FRAME) {
            this.stepOnce(FIXED_STEP_DT);
            this.accumulator -= FIXED_STEP_DT;
            sub++;
        }
    }
}
