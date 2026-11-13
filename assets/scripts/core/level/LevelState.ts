import { GameConst } from '../../config/GameConst';

/** 关卡运行五状态：准备、进行、暂停、过关、失败 */
export type LevelStatus = 'ready' | 'playing' | 'paused' | 'won' | 'lost';

export interface LevelRingSnapshot {
    /** 水里仍在漂浮/下沉、未锁定且未在消除闪烁中的自由圈数量 */
    freeRings: number;
    /** 柱上正在播放消除闪烁的圈数量（默认 0） */
    clearingRings?: number;
    /** 当前场上有效圈总数（含自由、已锁定与消除中；未传时按 freeRings + clearingRings 计算） */
    totalRings?: number;
}

export interface LevelStateOptions {
    /** 关卡总时间（秒，默认 GameConst.defaultLevelDurationSec） */
    durationSec?: number;
    /** 开局自由圈数量（>0 时立即视为有圈关卡，避免未同步首帧前误判） */
    initialFreeRings?: number;
}

export type LevelStatusListener = (next: LevelStatus, prev: LevelStatus) => void;

function sanitizeDuration(sec: number | undefined): number {
    if (sec === undefined || !Number.isFinite(sec) || sec <= 0) {
        return GameConst.defaultLevelDurationSec;
    }
    return sec;
}

/** 将剩余秒数格式化为 MM:SS（>0 秒向上取整，仅真正归零时显示 00:00） */
export function formatCountdown(remainingSec: number): string {
    const safeSec = Number.isFinite(remainingSec) && remainingSec > 0 ? Math.ceil(remainingSec) : 0;
    const minutes = Math.floor(safeSec / 60);
    const seconds = safeSec % 60;
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    return `${mm}:${ss}`;
}

/**
 * 关卡状态机与倒计时核心（纯逻辑，不依赖引擎）：
 * - 维护 ready / playing / paused / won / lost 五个状态；
 * - 仅在 playing 状态下随物理时间步扣减倒计时；
 * - 过关 = 已有圈的关卡水里自由圈归零（全部锁在柱上或已消除）；
 * - 失败 = 时间归零且尚未过关；
 * - 提供 addTime(sec) 给道具、灵蚌与续时复用。
 */
export class LevelState {
    private _status: LevelStatus = 'ready';
    private _durationSec: number = GameConst.defaultLevelDurationSec;
    private _remainingSec: number = GameConst.defaultLevelDurationSec;
    private _elapsedSec = 0;
    private _hasHadRings = false;
    private _lastFreeRings = 0;
    private readonly listeners: LevelStatusListener[] = [];

    constructor(options?: LevelStateOptions) {
        this.reset(options);
    }

    get status(): LevelStatus {
        return this._status;
    }

    get durationSec(): number {
        return this._durationSec;
    }

    get remainingSec(): number {
        return this._remainingSec;
    }

    get elapsedSec(): number {
        return this._elapsedSec;
    }

    get hasHadRings(): boolean {
        return this._hasHadRings;
    }

    get lastFreeRings(): number {
        return this._lastFreeRings;
    }

    get isPlaying(): boolean {
        return this._status === 'playing';
    }

    get isPaused(): boolean {
        return this._status === 'paused';
    }

    get isFinished(): boolean {
        return this._status === 'won' || this._status === 'lost';
    }

    /** 仅进行中状态允许推进物理步与气泡/流场 */
    get shouldRunPhysics(): boolean {
        return this._status === 'playing';
    }

    /** 重置为准备状态并设定总时长与初始圈数标记 */
    reset(options?: LevelStateOptions): void {
        const prev = this._status;
        this._durationSec = sanitizeDuration(options?.durationSec);
        this._remainingSec = this._durationSec;
        this._elapsedSec = 0;
        const initFree = Math.max(0, Math.floor(options?.initialFreeRings ?? 0));
        this._hasHadRings = initFree > 0;
        this._lastFreeRings = initFree;
        this._status = 'ready';
        if (prev !== 'ready') {
            this.notify(this._status, prev);
        }
    }

    /** 准备 -> 进行中 */
    start(): boolean {
        if (this._status !== 'ready') {
            return false;
        }
        this.setStatus('playing');
        return true;
    }

    /** 进行中 -> 暂停 */
    pause(): boolean {
        if (this._status !== 'playing') {
            return false;
        }
        this.setStatus('paused');
        return true;
    }

    /** 暂停 -> 进行中 */
    resume(): boolean {
        if (this._status !== 'paused') {
            return false;
        }
        this.setStatus('playing');
        return true;
    }

    /** 在进行中与暂停之间切换 */
    togglePause(): LevelStatus {
        if (this._status === 'playing') {
            this.pause();
        } else if (this._status === 'paused') {
            this.resume();
        }
        return this._status;
    }

    /** 为倒计时增加秒数（仅非终局状态生效，返回最新剩余秒数） */
    addTime(sec: number): number {
        if (!Number.isFinite(sec) || sec <= 0) {
            return this._remainingSec;
        }
        if (this._status === 'won' || this._status === 'lost') {
            return this._remainingSec;
        }
        this._remainingSec += sec;
        return this._remainingSec;
    }

    /**
     * 按物理步 dt（秒）推进倒计时并判定胜负。
     * snapshot 可直接传入自由圈数量或完整状态快照。
     */
    step(dt: number, snapshot: LevelRingSnapshot | number): LevelStatus {
        const snap: LevelRingSnapshot =
            typeof snapshot === 'number'
                ? { freeRings: snapshot, clearingRings: 0, totalRings: snapshot }
                : snapshot;

        const freeRings = Math.max(0, Math.floor(snap.freeRings));
        const clearingRings = Math.max(0, Math.floor(snap.clearingRings ?? 0));
        const totalRings = Math.max(
            freeRings + clearingRings,
            Math.floor(snap.totalRings ?? freeRings + clearingRings),
        );

        this._lastFreeRings = freeRings;
        if (freeRings > 0 || totalRings > 0) {
            this._hasHadRings = true;
        }

        if (this._status !== 'playing') {
            return this._status;
        }

        const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;

        // 过关：水里已无自由圈（均已锁定或消除）且场内确曾有圈
        if (this._hasHadRings && freeRings === 0 && clearingRings === 0) {
            this.setStatus('won');
            return this._status;
        }

        // 最后一对正在播放 0.22s 消除闪烁且水里已无自由圈时，等待闪烁完成再过关，不因闪烁耗时判超时
        if (this._hasHadRings && freeRings === 0 && clearingRings > 0) {
            this._elapsedSec += safeDt;
            return this._status;
        }

        this._elapsedSec += safeDt;
        this._remainingSec = Math.max(0, this._remainingSec - safeDt);

        if (this._remainingSec <= 0) {
            this._remainingSec = 0;
            this.setStatus('lost');
        }

        return this._status;
    }

    onStatusChange(cb: LevelStatusListener): () => void {
        if (!this.listeners.includes(cb)) {
            this.listeners.push(cb);
        }
        return () => {
            this.offStatusChange(cb);
        };
    }

    offStatusChange(cb: LevelStatusListener): void {
        const idx = this.listeners.indexOf(cb);
        if (idx >= 0) {
            this.listeners.splice(idx, 1);
        }
    }

    private setStatus(next: LevelStatus): void {
        if (this._status === next) {
            return;
        }
        const prev = this._status;
        this._status = next;
        this.notify(next, prev);
    }

    private notify(next: LevelStatus, prev: LevelStatus): void {
        const list = this.listeners.slice();
        for (let i = 0; i < list.length; i++) {
            list[i](next, prev);
        }
    }
}
