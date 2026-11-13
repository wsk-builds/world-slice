import { FeelConfig, FeelParams } from '../../config/FeelConfig';

const EPSILON = 1e-6;
const MIN_DURATION_SEC = 0.01;

export interface BladderConfig {
    /** 单口气最长持续出水时间（秒，起始值 0.65） */
    maxBreathSec: number;
    /** 松手后气囊回弹吸满时间（秒，起始值 0.22） */
    refillSec: number;
}

export function buildBladderConfig(
    overrides: Partial<BladderConfig> = {},
    feel: Readonly<FeelParams> = FeelConfig,
): BladderConfig {
    return {
        maxBreathSec: Math.max(MIN_DURATION_SEC, overrides.maxBreathSec ?? feel.bladderMaxBreathSec),
        refillSec: Math.max(MIN_DURATION_SEC, overrides.refillSec ?? feel.bladderRefillSec),
    };
}

/**
 * 软胶气囊模型（纯逻辑，不依赖引擎，GDD §2.2 第一条）。
 * - 按下 0 延迟立刻出水，一口气最多持续 maxBreathSec（0.65 秒），耗尽后强度归零；
 * - 松手立刻停水，气囊在 refillSec（0.2–0.25 秒）内回弹吸满；
 * - 未吸满就再次按下时，本口气出水强度按按下瞬间的气囊余量打折。
 */
export class Bladder {
    private maxBreathSec = 0.65;
    private refillSec = 0.22;

    private _pressed = false;
    private _reserve = 1;
    private _pressStrength = 0;
    private _releaseStartReserve = 1;
    private _releaseElapsed = 0;

    constructor(overrides: Partial<BladderConfig> = {}, feel: Readonly<FeelParams> = FeelConfig) {
        this.applyConfig(overrides, feel);
    }

    /** 当前是否处于按住状态 */
    get pressed(): boolean {
        return this._pressed;
    }

    /** 当前出水强度（0–1）：按下且气囊未耗尽时输出本口气打折后的强度，松手或耗尽为 0 */
    get output(): number {
        return this._pressed && this._reserve > 0 ? this._pressStrength : 0;
    }

    /** 当前气囊余量（0–1）：1 为吸满回弹态，0 为压扁排空态，供按键下陷动画与再按打折读取 */
    get reserve(): number {
        return this._reserve;
    }

    /** 按最新手感配置刷新时长参数（供调参面板动态生效） */
    applyConfig(overrides: Partial<BladderConfig> = {}, feel: Readonly<FeelParams> = FeelConfig): void {
        const prevRefillSec = this.refillSec;
        const cfg = buildBladderConfig(overrides, feel);
        this.maxBreathSec = cfg.maxBreathSec;
        this.refillSec = cfg.refillSec;

        if (!this._pressed && this._reserve < 1 && prevRefillSec > 0) {
            this._releaseElapsed = (this._releaseElapsed / prevRefillSec) * this.refillSec;
        }
    }

    /** 按下气囊（已在按住态时重复调用幂等，不受键盘长按连发影响） */
    press(): void {
        if (this._pressed) {
            return;
        }
        this._pressed = true;
        this._pressStrength = this._reserve > EPSILON ? this._reserve : 0;
    }

    /** 松开气囊（已在松开态时重复调用幂等）：立刻停止出水并开始回弹吸气 */
    release(): void {
        if (!this._pressed) {
            return;
        }
        this._pressed = false;
        this._pressStrength = 0;
        this._releaseStartReserve = this._reserve;
        this._releaseElapsed = 0;
    }

    /** 统一设置按压状态（等价于边沿触发 press / release） */
    setPressed(pressed: boolean): void {
        if (pressed) {
            this.press();
        } else {
            this.release();
        }
    }

    /** 重置为初始未按压吸满状态 */
    reset(): void {
        this._pressed = false;
        this._reserve = 1;
        this._pressStrength = 0;
        this._releaseStartReserve = 1;
        this._releaseElapsed = 0;
    }

    /** 推进物理时间 dt（秒）：按住时消耗余量，松开时回弹吸满 */
    step(dt: number): void {
        if (!(dt > 0)) {
            return;
        }

        if (this._pressed) {
            if (this._reserve <= 0) {
                return;
            }
            const nextReserve = this._reserve - dt / this.maxBreathSec;
            if (nextReserve <= EPSILON) {
                this._reserve = 0;
                this._pressStrength = 0;
            } else {
                this._reserve = nextReserve;
            }
            return;
        }

        if (this._reserve >= 1) {
            this._reserve = 1;
            return;
        }

        this._releaseElapsed += dt;
        if (this._releaseElapsed >= this.refillSec - EPSILON) {
            this._reserve = 1;
            return;
        }

        const progress = this._releaseElapsed / this.refillSec;
        const next = this._releaseStartReserve + (1 - this._releaseStartReserve) * progress;
        this._reserve = next >= 1 - EPSILON ? 1 : next;
    }
}
