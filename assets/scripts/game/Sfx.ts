import { _decorator, AudioClip, AudioSource, Component, Game, game, Node, resources } from 'cc';
import { GameConst } from '../config/GameConst';
import {
    mapCollisionImpulseToSfx,
    SFX_IDS,
    SfxId,
    SfxPlaybackGate,
} from '../core/audio/SfxPolicy';

const { ccclass } = _decorator;

/**
 * 灰盒音效播放器（T020）：
 * - 从 `resources/sfx/` 加载脚本合成的 14 个 WAV 音效；
 * - 复用 `SfxPlaybackGate` 控制并发上限、最小触发冷却、静音与主音量；
 * - 支持持续喷水循环声（`jet_loop`）平滑启停，并在暂停 / 结算 / 切后台 / 失焦时立即停声；
 * - 缺资源或无音频上下文（如挂机加速、自动化环境）时静默降级不报错。
 */
@ccclass('Sfx')
export class Sfx extends Component {
    private static activeInstance: Sfx | null = null;

    readonly gate = new SfxPlaybackGate();

    private oneShotSource: AudioSource | null = null;
    private loopSource: AudioSource | null = null;
    private readonly clips = new Map<SfxId, AudioClip>();
    private readonly failedIds = new Set<SfxId>();

    private nowSec = 0;
    private preloadStarted = false;
    private loopWanted = false;
    private loopStrength = 0;
    private loopVisualVolume = 0;
    private loopPlaying = false;

    static attach(parent: Node): Sfx {
        const existing = parent.getComponentInChildren(Sfx);
        if (existing && existing.isValid) {
            Sfx.activeInstance = existing;
            return existing;
        }
        const node = new Node('Sfx');
        parent.addChild(node);
        const sfx = node.addComponent(Sfx);
        Sfx.activeInstance = sfx;
        return sfx;
    }

    /** 静态便捷入口（供 T021 GlassTap 等模块直接调用 `Sfx.play('glass_tap')`） */
    static play(id: SfxId, volumeScale = 1): boolean {
        if (!Sfx.activeInstance || !Sfx.activeInstance.isValid) {
            return false;
        }
        return Sfx.activeInstance.play(id, volumeScale);
    }

    static getInstance(): Sfx | null {
        return Sfx.activeInstance && Sfx.activeInstance.isValid ? Sfx.activeInstance : null;
    }

    static setMuted(muted: boolean): void {
        Sfx.activeInstance?.setMuted(muted);
    }

    onLoad(): void {
        Sfx.activeInstance = this;
        this.ensureAudioSources();
        this.preloadAll();
    }

    onEnable(): void {
        Sfx.activeInstance = this;
        game.on(Game.EVENT_HIDE, this.onAppHideOrBlur, this);
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('blur', this.onAppHideOrBlur);
        }
        game.canvas?.addEventListener?.('blur', this.onAppHideOrBlur);
    }

    onDisable(): void {
        game.off(Game.EVENT_HIDE, this.onAppHideOrBlur, this);
        if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
            window.removeEventListener('blur', this.onAppHideOrBlur);
        }
        game.canvas?.removeEventListener?.('blur', this.onAppHideOrBlur);
        this.stopAll();
    }

    onDestroy(): void {
        this.stopAll();
        if (Sfx.activeInstance === this) {
            Sfx.activeInstance = null;
        }
    }

    update(dt: number): void {
        const clampedDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
        this.nowSec += clampedDt;
        this.stepJetLoop(clampedDt);
    }

    /** 预加载全部灰盒 WAV 音效，缺包或无资源时不报错 */
    preloadAll(): void {
        if (this.preloadStarted) {
            return;
        }
        this.preloadStarted = true;

        if (!resources || typeof resources.load !== 'function') {
            return;
        }

        for (let i = 0; i < SFX_IDS.length; i++) {
            const id = SFX_IDS[i];
            resources.load(`sfx/${id}`, AudioClip, (err, clip) => {
                if (!this.isValid) {
                    return;
                }
                if (err || !clip) {
                    this.failedIds.add(id);
                    return;
                }
                this.clips.set(id, clip);
            });
        }
    }

    get isMuted(): boolean {
        return this.gate.muted;
    }

    setMuted(muted: boolean): void {
        this.gate.setMuted(muted);
        if (muted) {
            this.stopAll();
        }
    }

    get masterVolume(): number {
        return this.gate.masterVolume;
    }

    setMasterVolume(volume: number): void {
        this.gate.setMasterVolume(volume);
        if (this.gate.masterVolume <= 0.001) {
            this.stopAll();
        }
    }

    /** 重置门控节流状态并立即停止循环与当前声道（切关 / 重开时调用） */
    reset(): void {
        this.gate.reset();
        this.stopAll();
    }

    /** 按名字播放一次音效（受并发上限、最小间隔节流与静音控制） */
    play(id: SfxId, volumeScale = 1): boolean {
        if (id === 'jet_loop') {
            this.setJetLoopState(volumeScale > 0, volumeScale);
            return true;
        }

        const clip = this.clips.get(id);
        const clipDuration = clip ? this.safeGetDuration(clip) : undefined;
        const gateRes = this.gate.tryAcquire(id, this.nowSec, volumeScale, clipDuration);
        if (!gateRes.allowed) {
            return false;
        }

        if (!clip || !this.oneShotSource) {
            return false;
        }

        try {
            this.oneShotSource.playOneShot(clip, gateRes.volume);
            return true;
        } catch {
            return false;
        }
    }

    /** 根据物理法向冲量播放圈碰撞 / 挂边音效 */
    playCollision(kind: 'ring_hit' | 'pillar_rim', normalImpulse: number): boolean {
        const decision = mapCollisionImpulseToSfx(kind, normalImpulse);
        if (!decision.shouldPlay) {
            return false;
        }
        return this.play(kind, decision.volumeScale);
    }

    /** 控制持续喷水循环声：active=true 且强度 > 0 时平滑开启，否则立即停止 */
    setJetLoopState(active: boolean, strength = 1): void {
        const safeStrength = Number.isFinite(strength) && strength > 0 ? Math.min(1, strength) : 0;
        if (!active || safeStrength <= GameConst.sfxJetLoopOutflowThreshold || this.gate.muted) {
            this.stopJetLoop();
            return;
        }
        this.loopWanted = true;
        this.loopStrength = safeStrength;
        if (!this.loopPlaying) {
            this.tryStartJetLoop();
        }
    }

    /** 立即停止持续喷水循环声 */
    stopJetLoop(): void {
        this.loopWanted = false;
        this.loopStrength = 0;
        this.loopVisualVolume = 0;
        if (this.loopSource) {
            try {
                if (this.loopPlaying || this.loopSource.playing) {
                    this.loopSource.stop();
                }
                this.loopSource.volume = 0;
            } catch {
                // 无音频上下文时静默降级
            }
        }
        this.loopPlaying = false;
    }

    /** 停止全部正在播放的单次及循环音效 */
    stopAll(): void {
        this.stopJetLoop();
        if (this.oneShotSource) {
            try {
                this.oneShotSource.stop();
            } catch {
                // 无音频上下文时静默降级
            }
        }
    }

    private ensureAudioSources(): void {
        if (!this.oneShotSource || !this.oneShotSource.isValid) {
            try {
                const src = this.getComponent(AudioSource) ?? this.addComponent(AudioSource);
                src.playOnAwake = false;
                src.loop = false;
                src.volume = 1;
                this.oneShotSource = src;
            } catch {
                this.oneShotSource = null;
            }
        }

        if (!this.loopSource || !this.loopSource.isValid) {
            try {
                let loopNode = this.node.getChildByName('SfxJetLoop');
                if (!loopNode) {
                    loopNode = new Node('SfxJetLoop');
                    this.node.addChild(loopNode);
                }
                const loopSrc = loopNode.getComponent(AudioSource) ?? loopNode.addComponent(AudioSource);
                loopSrc.playOnAwake = false;
                loopSrc.loop = true;
                loopSrc.volume = 0;
                this.loopSource = loopSrc;
            } catch {
                this.loopSource = null;
            }
        }
    }

    private tryStartJetLoop(): void {
        if (!this.loopWanted || this.gate.muted || !this.loopSource) {
            return;
        }
        const clip = this.clips.get('jet_loop');
        if (!clip) {
            return;
        }
        const targetVol = this.gate.calcLoopVolume('jet_loop', 0.55 + 0.45 * this.loopStrength);
        if (targetVol <= 0.001) {
            return;
        }
        try {
            if (this.loopSource.clip !== clip) {
                this.loopSource.clip = clip;
            }
            this.loopSource.loop = true;
            this.loopVisualVolume = Math.min(targetVol, Math.max(0.05, this.loopVisualVolume));
            this.loopSource.volume = this.loopVisualVolume;
            this.loopSource.play();
            this.loopPlaying = true;
        } catch {
            this.loopPlaying = false;
        }
    }

    private stepJetLoop(dt: number): void {
        if (!this.loopWanted || this.gate.muted) {
            if (this.loopPlaying) {
                this.stopJetLoop();
            }
            return;
        }

        if (!this.loopPlaying) {
            this.tryStartJetLoop();
            return;
        }

        if (!this.loopSource) {
            return;
        }

        const targetVol = this.gate.calcLoopVolume('jet_loop', 0.55 + 0.45 * this.loopStrength);
        if (targetVol <= 0.001) {
            this.stopJetLoop();
            return;
        }

        const alpha = dt > 0 ? 1 - Math.exp(-dt * GameConst.sfxJetLoopVolumeSmoothRate) : 1;
        this.loopVisualVolume += (targetVol - this.loopVisualVolume) * alpha;
        try {
            this.loopSource.volume = this.loopVisualVolume;
        } catch {
            // 无音频上下文时静默降级
        }
    }

    private safeGetDuration(clip: AudioClip): number | undefined {
        try {
            const d = clip.getDuration();
            return Number.isFinite(d) && d > 0 ? d : undefined;
        } catch {
            return undefined;
        }
    }

    private onAppHideOrBlur = (): void => {
        this.stopJetLoop();
    };
}
