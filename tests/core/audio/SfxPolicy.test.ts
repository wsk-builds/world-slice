import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    mapCollisionImpulseToSfx,
    SFX_CONFIGS,
    SFX_IDS,
    SfxPlaybackGate,
} from '../../../assets/scripts/core/audio/SfxPolicy';

describe('SfxPolicy 音效并发控制、节流与冲量映射', () => {
    it('14 个灰盒音效配置齐全且对应 WAV 文件头合法', () => {
        expect(SFX_IDS).toHaveLength(14);

        const sfxDir = join(process.cwd(), 'assets', 'resources', 'sfx');
        for (const id of SFX_IDS) {
            expect(SFX_CONFIGS[id].id).toBe(id);
            const wavPath = join(sfxDir, `${id}.wav`);
            expect(existsSync(wavPath)).toBe(true);

            const buf = readFileSync(wavPath);
            expect(buf.byteLength).toBeGreaterThan(44);
            expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
            expect(buf.toString('ascii', 8, 12)).toBe('WAVE');
            expect(buf.readUInt16LE(20)).toBe(1); // PCM
            expect(buf.readUInt16LE(22)).toBe(1); // 单声道
            expect(buf.readUInt16LE(34)).toBe(16); // 16-bit
        }
    });

    it('同一音效受最小触发冷却节流，过冷却窗口后才可再次播放', () => {
        const gate = new SfxPlaybackGate({
            ring_hit: { minIntervalSec: 0.08, maxConcurrent: 4, defaultDurationSec: 0.1 },
        });

        const r1 = gate.tryAcquire('ring_hit', 1.0);
        expect(r1.allowed).toBe(true);
        expect(r1.volume).toBeGreaterThan(0);

        const r2 = gate.tryAcquire('ring_hit', 1.04);
        expect(r2.allowed).toBe(false);
        expect(r2.reason).toBe('cooldown');

        const r3 = gate.tryAcquire('ring_hit', 1.09);
        expect(r3.allowed).toBe(true);
    });

    it('同一音效受最大并发声道数限制，声道播完到期后自动释放', () => {
        const gate = new SfxPlaybackGate({
            ring_hit: { minIntervalSec: 0, maxConcurrent: 2, defaultDurationSec: 0.2 },
        });

        expect(gate.tryAcquire('ring_hit', 0.0).allowed).toBe(true);
        expect(gate.tryAcquire('ring_hit', 0.05).allowed).toBe(true);

        const blocked = gate.tryAcquire('ring_hit', 0.1);
        expect(blocked.allowed).toBe(false);
        expect(blocked.reason).toBe('max_concurrent');
        expect(gate.getActiveCount('ring_hit', 0.1)).toBe(2);

        // 0.21s 时第一个声道（0.0 + 0.2 = 0.2）已过期，释放出 1 个名额
        expect(gate.tryAcquire('ring_hit', 0.21).allowed).toBe(true);
        expect(gate.getActiveCount('ring_hit', 0.21)).toBe(2);
    });

    it('全局最大同时发声上限防止多类音效同时叠音成噪音', () => {
        const gate = new SfxPlaybackGate(
            {
                jet_tap: { minIntervalSec: 0, defaultDurationSec: 0.5 },
                ring_hit: { minIntervalSec: 0, defaultDurationSec: 0.5 },
                pillar_rim: { minIntervalSec: 0, defaultDurationSec: 0.5 },
            },
            2,
        );

        expect(gate.tryAcquire('jet_tap', 0).allowed).toBe(true);
        expect(gate.tryAcquire('ring_hit', 0).allowed).toBe(true);
        expect(gate.getTotalActiveCount(0)).toBe(2);

        const blocked = gate.tryAcquire('pillar_rim', 0.1);
        expect(blocked.allowed).toBe(false);
        expect(blocked.reason).toBe('global_limit');

        // 到期后全局槽位清空
        expect(gate.tryAcquire('pillar_rim', 0.6).allowed).toBe(true);
    });

    it('静音、主音量为 0 与 reset 行为正确', () => {
        const gate = new SfxPlaybackGate();
        gate.setMuted(true);
        expect(gate.tryAcquire('glass_tap', 1.0).reason).toBe('muted');
        expect(gate.calcLoopVolume('jet_loop', 1)).toBe(0);

        gate.setMuted(false);
        gate.setMasterVolume(0);
        expect(gate.tryAcquire('glass_tap', 1.0).reason).toBe('zero_volume');

        gate.setMasterVolume(0.8);
        expect(gate.tryAcquire('countdown_tick', 1.0).allowed).toBe(true);
        expect(gate.tryAcquire('countdown_tick', 1.05).reason).toBe('cooldown');

        gate.reset();
        expect(gate.getTotalActiveCount(1.05)).toBe(0);
        expect(gate.tryAcquire('countdown_tick', 1.05).allowed).toBe(true);
    });

    it('mapCollisionImpulseToSfx 过滤低于阈值的微颤冲量并随冲量单调增大音量', () => {
        expect(mapCollisionImpulseToSfx('ring_hit', 0).shouldPlay).toBe(false);
        expect(mapCollisionImpulseToSfx('ring_hit', 5, { minImpulse: 10 }).shouldPlay).toBe(false);

        const soft = mapCollisionImpulseToSfx('ring_hit', 15, { minImpulse: 10, maxImpulse: 200 });
        const mid = mapCollisionImpulseToSfx('ring_hit', 90, { minImpulse: 10, maxImpulse: 200 });
        const hard = mapCollisionImpulseToSfx('ring_hit', 260, { minImpulse: 10, maxImpulse: 200 });

        expect(soft.shouldPlay).toBe(true);
        expect(mid.shouldPlay).toBe(true);
        expect(hard.shouldPlay).toBe(true);
        expect(soft.volumeScale).toBeGreaterThan(0);
        expect(mid.volumeScale).toBeGreaterThan(soft.volumeScale);
        expect(hard.volumeScale).toBe(1);

        const rim = mapCollisionImpulseToSfx('pillar_rim', 60, { minImpulse: 10, maxImpulse: 200 });
        expect(rim.shouldPlay).toBe(true);
        expect(rim.volumeScale).toBeGreaterThan(0);
    });
});
