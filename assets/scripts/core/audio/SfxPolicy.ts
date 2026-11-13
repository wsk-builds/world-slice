import { GameConst } from '../../config/GameConst';

export const SFX_IDS = [
    'jet_tap',
    'jet_loop',
    'bladder_rebound',
    'glass_tap',
    'ring_hit',
    'pillar_rim',
    'ring_lock',
    'match_clear',
    'energy_full',
    'skill_tide',
    'skill_calm',
    'countdown_tick',
    'level_lose',
    'level_win',
] as const;

export type SfxId = (typeof SFX_IDS)[number];

export interface SfxEntryConfig {
    readonly id: SfxId;
    /** 同一种音效允许同时存在的最大声道数 */
    readonly maxConcurrent: number;
    /** 同一音效两次触发之间的最小冷却时间（秒） */
    readonly minIntervalSec: number;
    /** 该音效的基础平衡音量（0–1） */
    readonly baseVolume: number;
    /** 未获取真实 AudioClip 时长前的默认并发占用时长（秒） */
    readonly defaultDurationSec: number;
    /** 是否为持续循环音效 */
    readonly loop: boolean;
}

export const SFX_CONFIGS: Record<SfxId, SfxEntryConfig> = {
    jet_tap: {
        id: 'jet_tap',
        maxConcurrent: 2,
        minIntervalSec: 0.055,
        baseVolume: 0.62,
        defaultDurationSec: 0.15,
        loop: false,
    },
    jet_loop: {
        id: 'jet_loop',
        maxConcurrent: 1,
        minIntervalSec: 0,
        baseVolume: 0.38,
        defaultDurationSec: 1.2,
        loop: true,
    },
    bladder_rebound: {
        id: 'bladder_rebound',
        maxConcurrent: 1,
        minIntervalSec: 0.16,
        baseVolume: 0.40,
        defaultDurationSec: 0.16,
        loop: false,
    },
    glass_tap: {
        id: 'glass_tap',
        maxConcurrent: 3,
        minIntervalSec: 0.05,
        baseVolume: 0.65,
        defaultDurationSec: 0.11,
        loop: false,
    },
    ring_hit: {
        id: 'ring_hit',
        maxConcurrent: 3,
        minIntervalSec: 0.055,
        baseVolume: 0.56,
        defaultDurationSec: 0.10,
        loop: false,
    },
    pillar_rim: {
        id: 'pillar_rim',
        maxConcurrent: 3,
        minIntervalSec: 0.065,
        baseVolume: 0.60,
        defaultDurationSec: 0.13,
        loop: false,
    },
    ring_lock: {
        id: 'ring_lock',
        maxConcurrent: 3,
        minIntervalSec: 0.05,
        baseVolume: 0.72,
        defaultDurationSec: 0.26,
        loop: false,
    },
    match_clear: {
        id: 'match_clear',
        maxConcurrent: 2,
        minIntervalSec: 0.08,
        baseVolume: 0.80,
        defaultDurationSec: 0.44,
        loop: false,
    },
    energy_full: {
        id: 'energy_full',
        maxConcurrent: 2,
        minIntervalSec: 0.12,
        baseVolume: 0.62,
        defaultDurationSec: 0.48,
        loop: false,
    },
    skill_tide: {
        id: 'skill_tide',
        maxConcurrent: 1,
        minIntervalSec: 0.20,
        baseVolume: 0.68,
        defaultDurationSec: 0.60,
        loop: false,
    },
    skill_calm: {
        id: 'skill_calm',
        maxConcurrent: 1,
        minIntervalSec: 0.20,
        baseVolume: 0.68,
        defaultDurationSec: 0.65,
        loop: false,
    },
    countdown_tick: {
        id: 'countdown_tick',
        maxConcurrent: 1,
        minIntervalSec: 0.30,
        baseVolume: 0.64,
        defaultDurationSec: 0.09,
        loop: false,
    },
    level_lose: {
        id: 'level_lose',
        maxConcurrent: 1,
        minIntervalSec: 0.40,
        baseVolume: 0.80,
        defaultDurationSec: 0.60,
        loop: false,
    },
    level_win: {
        id: 'level_win',
        maxConcurrent: 1,
        minIntervalSec: 0.40,
        baseVolume: 0.85,
        defaultDurationSec: 0.74,
        loop: false,
    },
};

export type SfxDenyReason =
    | 'ok'
    | 'muted'
    | 'zero_volume'
    | 'cooldown'
    | 'max_concurrent'
    | 'global_limit';

export interface SfxAcquireResult {
    allowed: boolean;
    volume: number;
    reason: SfxDenyReason;
}

export interface CollisionImpulseMapOptions {
    minImpulse?: number;
    maxImpulse?: number;
    minVolumeScale?: number;
}

export interface CollisionSfxDecision {
    shouldPlay: boolean;
    volumeScale: number;
}

function clamp01(v: number): number {
    if (!Number.isFinite(v) || v <= 0) {
        return 0;
    }
    return v >= 1 ? 1 : v;
}

/**
 * 将物理法向冲量映射为碰撞音效是否触发及音量缩放（纯逻辑，防微颤杂音）。
 */
export function mapCollisionImpulseToSfx(
    kind: 'ring_hit' | 'pillar_rim',
    normalImpulse: number,
    options?: CollisionImpulseMapOptions,
): CollisionSfxDecision {
    const minImp = Math.max(0.01, options?.minImpulse ?? GameConst.sfxCollisionMinImpulse);
    const maxImp = Math.max(minImp + 1, options?.maxImpulse ?? GameConst.sfxCollisionMaxImpulse);
    const minVol = clamp01(options?.minVolumeScale ?? GameConst.sfxCollisionMinVolumeScale);

    if (!Number.isFinite(normalImpulse) || normalImpulse < minImp) {
        return { shouldPlay: false, volumeScale: 0 };
    }

    const norm = clamp01((normalImpulse - minImp) / (maxImp - minImp));
    // 挂边略突出一些，用平方根响应让中等碰撞依然听感饱满
    const shaped = Math.sqrt(norm);
    const kindBoost = kind === 'pillar_rim' ? 1.05 : 1.0;
    const volumeScale = Math.min(1, (minVol + (1 - minVol) * shaped) * kindBoost);
    return { shouldPlay: true, volumeScale };
}

/**
 * 音效并发与节流门控（纯逻辑，不依赖引擎）：
 * - 限制单一音效的最大同时播放数与最小触发冷却（防止叠成噪音）；
 * - 限制全局同时发声上限；
 * - 管理静音与主音量缩放，供 game/Sfx.ts 复用与单测覆盖。
 */
export class SfxPlaybackGate {
    private _muted = false;
    private _masterVolume: number = GameConst.sfxMasterVolume;
    private _maxGlobalVoices: number = GameConst.sfxMaxGlobalVoices;

    private readonly configs: Record<SfxId, SfxEntryConfig>;
    private readonly lastPlayedAt = new Map<SfxId, number>();
    private readonly activeExpiries = new Map<SfxId, number[]>();
    private readonly acquireScratch: SfxAcquireResult = {
        allowed: false,
        volume: 0,
        reason: 'ok',
    };

    constructor(
        overrides?: Partial<Record<SfxId, Partial<SfxEntryConfig>>>,
        maxGlobalVoices: number = GameConst.sfxMaxGlobalVoices,
    ) {
        this._maxGlobalVoices = Math.max(1, Math.floor(maxGlobalVoices));
        const merged = { ...SFX_CONFIGS };
        if (overrides) {
            for (const id of SFX_IDS) {
                if (overrides[id]) {
                    merged[id] = { ...merged[id], ...overrides[id] };
                }
            }
        }
        this.configs = merged;
        for (const id of SFX_IDS) {
            this.lastPlayedAt.set(id, -Infinity);
            this.activeExpiries.set(id, []);
        }
    }

    get muted(): boolean {
        return this._muted;
    }

    setMuted(muted: boolean): void {
        this._muted = Boolean(muted);
    }

    get masterVolume(): number {
        return this._masterVolume;
    }

    setMasterVolume(volume: number): void {
        this._masterVolume = clamp01(volume);
    }

    get maxGlobalVoices(): number {
        return this._maxGlobalVoices;
    }

    setMaxGlobalVoices(limit: number): void {
        this._maxGlobalVoices = Math.max(1, Math.floor(limit));
    }

    getConfig(id: SfxId): SfxEntryConfig {
        return this.configs[id];
    }

    /** 清空冷却计时与活跃声道统计（不改变静音与音量偏好） */
    reset(): void {
        for (const id of SFX_IDS) {
            this.lastPlayedAt.set(id, -Infinity);
            const list = this.activeExpiries.get(id);
            if (list) {
                list.length = 0;
            }
        }
    }

    /** 清理已到期的发声槽位并返回该音效当前活跃数 */
    getActiveCount(id: SfxId, nowSec: number): number {
        const list = this.activeExpiries.get(id);
        if (!list || list.length === 0) {
            return 0;
        }
        this.pruneList(list, nowSec);
        return list.length;
    }

    /** 清理所有到期声道并返回当前全局活跃单次音效总数 */
    getTotalActiveCount(nowSec: number): number {
        let total = 0;
        for (const id of SFX_IDS) {
            total += this.getActiveCount(id, nowSec);
        }
        return total;
    }

    /**
     * 请求占用一次单次播放资格。
     * 注意：返回的 SfxAcquireResult 对象会被实例复用，调用方应即时读取其字段。
     */
    tryAcquire(
        id: SfxId,
        nowSec: number,
        volumeScale = 1,
        durationOverrideSec?: number,
    ): SfxAcquireResult {
        const out = this.acquireScratch;
        if (this._muted) {
            out.allowed = false;
            out.volume = 0;
            out.reason = 'muted';
            return out;
        }

        const cfg = this.configs[id];
        const finalVol = clamp01(this._masterVolume * cfg.baseVolume * clamp01(volumeScale));
        if (finalVol <= 0.001) {
            out.allowed = false;
            out.volume = 0;
            out.reason = 'zero_volume';
            return out;
        }

        const safeNow = Number.isFinite(nowSec) ? nowSec : 0;
        const lastAt = this.lastPlayedAt.get(id) ?? -Infinity;
        if (cfg.minIntervalSec > 0 && safeNow - lastAt < cfg.minIntervalSec - 1e-6) {
            out.allowed = false;
            out.volume = 0;
            out.reason = 'cooldown';
            return out;
        }

        const activeCount = this.getActiveCount(id, safeNow);
        if (activeCount >= cfg.maxConcurrent) {
            out.allowed = false;
            out.volume = 0;
            out.reason = 'max_concurrent';
            return out;
        }

        const totalActive = this.getTotalActiveCount(safeNow);
        if (totalActive >= this._maxGlobalVoices) {
            out.allowed = false;
            out.volume = 0;
            out.reason = 'global_limit';
            return out;
        }

        const dur =
            durationOverrideSec !== undefined && Number.isFinite(durationOverrideSec) && durationOverrideSec > 0
                ? durationOverrideSec
                : cfg.defaultDurationSec;
        this.lastPlayedAt.set(id, safeNow);
        this.activeExpiries.get(id)!.push(safeNow + dur);

        out.allowed = true;
        out.volume = finalVol;
        out.reason = 'ok';
        return out;
    }

    /** 计算持续循环音效的目标最终音量（已含静音与主音量） */
    calcLoopVolume(id: SfxId, strength = 1): number {
        if (this._muted) {
            return 0;
        }
        const cfg = this.configs[id];
        return clamp01(this._masterVolume * cfg.baseVolume * clamp01(strength));
    }

    private pruneList(list: number[], nowSec: number): void {
        let write = 0;
        for (let i = 0; i < list.length; i++) {
            if (list[i] > nowSec + 1e-6) {
                list[write++] = list[i];
            }
        }
        list.length = write;
    }
}
