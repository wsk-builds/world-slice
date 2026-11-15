import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SAMPLE_RATE = 22050;
const OUT_DIR = join(process.cwd(), 'assets', 'resources', 'sfx');

/** 确定性伪随机数生成器（Mulberry32），确保重复执行产物字节级完全一致 */
function createRng(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function createBuffer(durationSec) {
    return new Float64Array(Math.max(1, Math.round(durationSec * SAMPLE_RATE)));
}

/** 去除直流偏置并做平滑淡入淡出，避免起止爆音（click/pop） */
function finalizeOneShot(buf, fadeInSec, fadeOutSec, targetPeak) {
    let mean = 0;
    for (let i = 0; i < buf.length; i++) {
        mean += buf[i];
    }
    mean /= buf.length;
    for (let i = 0; i < buf.length; i++) {
        buf[i] -= mean;
    }

    const fadeInSamples = Math.min(buf.length, Math.max(1, Math.round(fadeInSec * SAMPLE_RATE)));
    for (let i = 0; i < fadeInSamples; i++) {
        const t = i / fadeInSamples;
        buf[i] *= 0.5 - 0.5 * Math.cos(Math.PI * t);
    }

    const fadeOutSamples = Math.min(buf.length, Math.max(1, Math.round(fadeOutSec * SAMPLE_RATE)));
    const startOut = buf.length - fadeOutSamples;
    for (let i = 0; i < fadeOutSamples; i++) {
        const t = i / fadeOutSamples;
        buf[startOut + i] *= 0.5 + 0.5 * Math.cos(Math.PI * t);
    }

    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
        const a = Math.abs(buf[i]);
        if (a > peak) {
            peak = a;
        }
    }
    if (peak > 1e-6) {
        const gain = targetPeak / peak;
        for (let i = 0; i < buf.length; i++) {
            buf[i] = Math.tanh(buf[i] * gain * 1.15) * (targetPeak / Math.tanh(targetPeak * 1.15));
        }
    }
    return buf;
}

/** 二阶带通/低通柔和滤波器（改变缓冲内容） */
function applyOnePoleLowpass(buf, cutoffHz) {
    const rc = 1 / (2 * Math.PI * cutoffHz);
    const dt = 1 / SAMPLE_RATE;
    const alpha = dt / (rc + dt);
    let y = 0;
    for (let i = 0; i < buf.length; i++) {
        y += alpha * (buf[i] - y);
        buf[i] = y;
    }
}

function applyOnePoleHighpass(buf, cutoffHz) {
    const rc = 1 / (2 * Math.PI * cutoffHz);
    const dt = 1 / SAMPLE_RATE;
    const alpha = rc / (rc + dt);
    let y = 0;
    let prevX = 0;
    for (let i = 0; i < buf.length; i++) {
        const x = buf[i];
        y = alpha * (y + x - prevX);
        prevX = x;
        buf[i] = y;
    }
}

/** 叠加单个柔和正弦/泛音音符 */
function addBellNote(buf, startSec, durationSec, freqHz, amp, decaySec, attackSec = 0.004, harmonicMix = 0.16) {
    const startIdx = Math.max(0, Math.round(startSec * SAMPLE_RATE));
    const endIdx = Math.min(buf.length, startIdx + Math.round(durationSec * SAMPLE_RATE));
    const attackSamples = Math.max(1, Math.round(attackSec * SAMPLE_RATE));

    for (let i = startIdx; i < endIdx; i++) {
        const t = (i - startIdx) / SAMPLE_RATE;
        const atk = i - startIdx < attackSamples ? (i - startIdx) / attackSamples : 1;
        const env = atk * Math.exp(-t / decaySec);
        const phase = 2 * Math.PI * freqHz * t;
        const wave = Math.sin(phase) + harmonicMix * Math.sin(phase * 2) * Math.exp(-t / (decaySec * 0.55));
        buf[i] += amp * env * wave;
    }
}

/** 叠加水下气泡上滑音（支持环绕取模以保证循环无缝） */
function addBubblePop(buf, startSec, durationSec, fStartHz, fEndHz, amp, wrapLoop = false) {
    const len = Math.max(8, Math.round(durationSec * SAMPLE_RATE));
    const startIdx = Math.round(startSec * SAMPLE_RATE);
    let phase = 0;

    for (let k = 0; k < len; k++) {
        const u = k / len;
        const freq = fStartHz + (fEndHz - fStartHz) * (u * u * 0.4 + 0.6 * u);
        phase += (2 * Math.PI * freq) / SAMPLE_RATE;
        const env = Math.sin(Math.PI * u) ** 1.4;
        const idx = wrapLoop ? ((startIdx + k) % buf.length + buf.length) % buf.length : startIdx + k;
        if (idx >= 0 && idx < buf.length) {
            buf[idx] += amp * env * Math.sin(phase);
        }
    }
}

/** 1. 轻点喷水（短促柔和的水柱冲涌与小气泡） */
function synthJetTap() {
    const rng = createRng(1001);
    const buf = createBuffer(0.15);
    const noise = createBuffer(0.15);

    for (let i = 0; i < noise.length; i++) {
        const t = i / SAMPLE_RATE;
        const env = (1 - Math.exp(-t / 0.008)) * Math.exp(-t / 0.042);
        noise[i] = (rng() * 2 - 1) * env;
    }
    applyOnePoleHighpass(noise, 180);
    applyOnePoleLowpass(noise, 720);

    for (let i = 0; i < buf.length; i++) {
        const t = i / SAMPLE_RATE;
        const thumpEnv = Math.exp(-t / 0.025);
        const thump = 0.32 * thumpEnv * Math.sin(2 * Math.PI * (145 - 50 * Math.min(1, t / 0.05)) * t);
        buf[i] = noise[i] * 1.4 + thump;
    }

    addBubblePop(buf, 0.008, 0.038, 320, 640, 0.24);
    addBubblePop(buf, 0.036, 0.042, 410, 790, 0.20);
    addBubblePop(buf, 0.068, 0.040, 500, 880, 0.14);
    return finalizeOneShot(buf, 0.004, 0.022, 0.72);
}

/** 2. 持续喷水（1.20s 数学无缝循环气泡水流声，首尾过零零爆音） */
function synthJetLoop() {
    const rng = createRng(1002);
    const duration = 1.2;
    const buf = createBuffer(duration);
    const n = buf.length;

    // 使用 1/duration 的整数倍频叠加带通水声底噪，数学上保证 sample[n-1] -> sample[0] 完全连续
    const minHarmonic = Math.round(160 * duration);
    const maxHarmonic = Math.round(680 * duration);
    const centerHz = 340;
    const spreadHz = 155;

    const partials = [];
    for (let k = minHarmonic; k <= maxHarmonic; k += 2) {
        const freq = k / duration;
        const d = (freq - centerHz) / spreadHz;
        const weight = Math.exp(-0.5 * d * d) * (0.65 + 0.35 * rng());
        partials.push({ k, weight, phase: rng() * Math.PI * 2 });
    }

    for (let i = 0; i < n; i++) {
        const u = i / n;
        const angleBase = 2 * Math.PI * u;
        const swell = 0.86 + 0.14 * Math.sin(angleBase * 2 + 0.4) * Math.cos(angleBase * 3 - 0.2);
        let sum = 0;
        for (let p = 0; p < partials.length; p++) {
            const pt = partials[p];
            sum += pt.weight * Math.sin(angleBase * pt.k + pt.phase);
        }
        // 低频轻柔水脉起伏（整数周期）
        const sub = 0.18 * Math.sin(angleBase * Math.round(115 * duration)) + 0.12 * Math.sin(angleBase * Math.round(165 * duration) + 1.1);
        buf[i] = (sum / Math.sqrt(partials.length) * 0.42 + sub * 0.16) * swell;
    }

    // 环绕取模叠加 14 颗轻柔气泡，避免循环接缝出现停顿或爆音
    for (let b = 0; b < 14; b++) {
        const startSec = (b / 14) * duration + (rng() - 0.5) * 0.04;
        const f0 = 360 + rng() * 320;
        const f1 = f0 * (1.38 + rng() * 0.28);
        const dur = 0.036 + rng() * 0.022;
        const amp = 0.085 + rng() * 0.055;
        addBubblePop(buf, startSec, dur, f0, f1, amp, true);
    }

    // 轻柔峰值控制（不改变首尾连续性，仅轻微调整幅度并在整块做等比缩放）
    let mean = 0;
    for (let i = 0; i < n; i++) {
        mean += buf[i];
    }
    mean /= n;
    let peak = 0;
    for (let i = 0; i < n; i++) {
        buf[i] -= mean;
        const a = Math.abs(buf[i]);
        if (a > peak) {
            peak = a;
        }
    }
    if (peak > 1e-6) {
        const scale = 0.48 / peak;
        for (let i = 0; i < n; i++) {
            buf[i] *= scale;
        }
    }
    return buf;
}

/** 3. 气囊回弹（软胶吸气回弹的轻柔嗡噗声） */
function synthBladderRebound() {
    const rng = createRng(1003);
    const buf = createBuffer(0.16);
    const air = createBuffer(0.16);

    for (let i = 0; i < air.length; i++) {
        const t = i / SAMPLE_RATE;
        const env = Math.sin(Math.PI * Math.min(1, t / 0.14));
        air[i] = (rng() * 2 - 1) * env * 0.16;
    }
    applyOnePoleLowpass(air, 420);

    let phase = 0;
    for (let i = 0; i < buf.length; i++) {
        const t = i / SAMPLE_RATE;
        const u = Math.min(1, t / 0.13);
        const freq = 185 + 210 * (1 - (1 - u) * (1 - u));
        phase += (2 * Math.PI * freq) / SAMPLE_RATE;
        const env = (1 - Math.exp(-t / 0.012)) * Math.exp(-t / 0.052);
        const rubber = Math.sin(phase) + 0.18 * Math.sin(phase * 2);
        buf[i] = rubber * env * 0.55 + air[i];
    }

    return finalizeOneShot(buf, 0.005, 0.025, 0.58);
}

/** 4. 敲玻璃（清脆温润的玻璃水缸轻叩声，留给 T021 接） */
function synthGlassTap() {
    const rng = createRng(1004);
    const buf = createBuffer(0.11);
    const click = createBuffer(0.11);
    for (let i = 0; i < 60; i++) {
        click[i] = (rng() * 2 - 1) * Math.exp(-i / 14) * 0.35;
    }
    applyOnePoleLowpass(click, 2400);

    for (let i = 0; i < buf.length; i++) {
        const t = i / SAMPLE_RATE;
        const atk = 1 - Math.exp(-t / 0.0012);
        const p1 = Math.sin(2 * Math.PI * 1180 * t) * Math.exp(-t / 0.022);
        const p2 = 0.45 * Math.sin(2 * Math.PI * 1960 * t) * Math.exp(-t / 0.014);
        const p3 = 0.16 * Math.sin(2 * Math.PI * 2840 * t) * Math.exp(-t / 0.009);
        buf[i] = atk * (p1 + p2 + p3) + click[i];
    }
    return finalizeOneShot(buf, 0.0015, 0.018, 0.74);
}

/** 5. 圈碰撞（圈撞圈 / 圈撞缸壁，水下亚克力玉环轻磕声） */
function synthRingHit() {
    const rng = createRng(1005);
    const buf = createBuffer(0.10);
    const thudNoise = createBuffer(0.10);
    for (let i = 0; i < 90; i++) {
        thudNoise[i] = (rng() * 2 - 1) * Math.exp(-i / 20) * 0.25;
    }
    applyOnePoleLowpass(thudNoise, 1100);

    for (let i = 0; i < buf.length; i++) {
        const t = i / SAMPLE_RATE;
        const atk = 1 - Math.exp(-t / 0.002);
        const body = 0.35 * Math.sin(2 * Math.PI * 250 * t) * Math.exp(-t / 0.016);
        const p1 = 0.85 * Math.sin(2 * Math.PI * 620 * t) * Math.exp(-t / 0.022);
        const p2 = 0.45 * Math.sin(2 * Math.PI * 980 * t) * Math.exp(-t / 0.015);
        buf[i] = atk * (body + p1 + p2) + thudNoise[i];
    }
    return finalizeOneShot(buf, 0.002, 0.018, 0.70);
}

/** 6. 挂边（圈碰柱尖/柱杆/卡托，略带玉柱清响） */
function synthPillarRim() {
    const buf = createBuffer(0.13);
    for (let i = 0; i < buf.length; i++) {
        const t = i / SAMPLE_RATE;
        const atk = 1 - Math.exp(-t / 0.002);
        const warm = 0.55 * Math.sin(2 * Math.PI * 410 * t) * Math.exp(-t / 0.032);
        const jade = 0.85 * Math.sin(2 * Math.PI * 820 * t) * Math.exp(-t / 0.034);
        const glint = 0.30 * Math.sin(2 * Math.PI * 1310 * t) * Math.exp(-t / 0.020);
        buf[i] = atk * (warm + jade + glint);
    }
    return finalizeOneShot(buf, 0.002, 0.022, 0.70);
}

/** 7. 套中（温润上扬的双音确认叮咚） */
function synthRingLock() {
    const buf = createBuffer(0.26);
    addBellNote(buf, 0.0, 0.18, 523.25, 0.55, 0.065, 0.004, 0.14);
    addBellNote(buf, 0.065, 0.19, 783.99, 0.72, 0.085, 0.004, 0.16);
    return finalizeOneShot(buf, 0.003, 0.030, 0.76);
}

/** 8. 消除（清亮水灵四音琶音 + 气泡闪烁） */
function synthMatchClear() {
    const buf = createBuffer(0.44);
    const notes = [523.25, 659.25, 783.99, 1046.5];
    for (let i = 0; i < notes.length; i++) {
        addBellNote(buf, i * 0.052, 0.28, notes[i], 0.45 + i * 0.06, 0.095, 0.004, 0.18);
    }
    addBubblePop(buf, 0.04, 0.045, 700, 1280, 0.12);
    addBubblePop(buf, 0.12, 0.045, 860, 1480, 0.11);
    return finalizeOneShot(buf, 0.003, 0.045, 0.78);
}

/** 9. 充能满（柱尖灵珠盈满共鸣和弦） */
function synthEnergyFull() {
    const buf = createBuffer(0.48);
    const notes = [392.0, 493.88, 587.33, 783.99];
    for (let i = 0; i < notes.length; i++) {
        addBellNote(buf, i * 0.028, 0.40, notes[i], 0.36, 0.16, 0.012, 0.12);
    }
    for (let i = 0; i < buf.length; i++) {
        const t = i / SAMPLE_RATE;
        buf[i] *= 0.88 + 0.12 * Math.sin(2 * Math.PI * 8.5 * t);
    }
    return finalizeOneShot(buf, 0.006, 0.055, 0.74);
}

/** 10. 潮引（左柱漩流吸纳与上扬灵音） */
function synthSkillTide() {
    const rng = createRng(1010);
    const duration = 0.60;
    const buf = createBuffer(duration);
    const noise = createBuffer(duration);

    for (let i = 0; i < noise.length; i++) {
        const t = i / SAMPLE_RATE;
        const u = t / duration;
        const env = Math.sin(Math.PI * u) * (0.4 + 0.6 * u);
        noise[i] = (rng() * 2 - 1) * env * 0.28;
    }
    applyOnePoleHighpass(noise, 200);
    applyOnePoleLowpass(noise, 780);

    let swirlPhase = 0;
    for (let i = 0; i < buf.length; i++) {
        const t = i / SAMPLE_RATE;
        const u = t / duration;
        const freq = 230 + 420 * u;
        swirlPhase += (2 * Math.PI * freq) / SAMPLE_RATE;
        const env = Math.sin(Math.PI * u) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 5.5 * t));
        buf[i] = noise[i] + 0.22 * env * Math.sin(swirlPhase);
    }

    addBellNote(buf, 0.04, 0.35, 587.33, 0.36, 0.13, 0.015, 0.14);
    addBellNote(buf, 0.12, 0.36, 783.99, 0.38, 0.14, 0.015, 0.14);
    addBellNote(buf, 0.20, 0.36, 880.0, 0.42, 0.16, 0.015, 0.16);
    addBubblePop(buf, 0.06, 0.06, 420, 860, 0.14);
    addBubblePop(buf, 0.18, 0.06, 540, 1060, 0.13);
    return finalizeOneShot(buf, 0.010, 0.060, 0.74);
}

/** 11. 定海（右柱温润托浮暖流和弦） */
function synthSkillCalm() {
    const duration = 0.65;
    const buf = createBuffer(duration);
    const chord = [349.23, 440.0, 523.25, 698.46];
    for (let c = 0; c < chord.length; c++) {
        addBellNote(buf, c * 0.035, 0.55, chord[c], 0.32, 0.24, 0.055, 0.08);
    }
    // 叠加轻柔深水暖流低频包络
    for (let i = 0; i < buf.length; i++) {
        const t = i / SAMPLE_RATE;
        const u = t / duration;
        const padEnv = Math.sin(Math.PI * u);
        buf[i] += 0.18 * padEnv * Math.sin(2 * Math.PI * 174.61 * t);
    }
    return finalizeOneShot(buf, 0.018, 0.080, 0.74);
}

/** 12. 最后 10 秒滴答（清晰不刺耳的水滴木鱼秒点提示） */
function synthCountdownTick() {
    const buf = createBuffer(0.09);
    for (let i = 0; i < buf.length; i++) {
        const t = i / SAMPLE_RATE;
        const atk = 1 - Math.exp(-t / 0.0015);
        const low = 0.30 * Math.sin(2 * Math.PI * 440 * t) * Math.exp(-t / 0.018);
        const main = 0.85 * Math.sin(2 * Math.PI * 880 * t) * Math.exp(-t / 0.016);
        const top = 0.30 * Math.sin(2 * Math.PI * 1320 * t) * Math.exp(-t / 0.010);
        buf[i] = atk * (low + main + top);
    }
    return finalizeOneShot(buf, 0.002, 0.016, 0.66);
}

/** 13. 时间到（轻柔下行叹息三音，不刺耳） */
function synthLevelLose() {
    const buf = createBuffer(0.60);
    addBellNote(buf, 0.00, 0.26, 392.0, 0.50, 0.11, 0.008, 0.10);
    addBellNote(buf, 0.16, 0.28, 329.63, 0.48, 0.12, 0.008, 0.10);
    addBellNote(buf, 0.32, 0.28, 261.63, 0.54, 0.15, 0.010, 0.08);
    return finalizeOneShot(buf, 0.008, 0.070, 0.72);
}

/** 14. 通关（明亮轻盈的胜利上扬组音与和弦） */
function synthLevelWin() {
    const buf = createBuffer(0.74);
    addBellNote(buf, 0.00, 0.25, 523.25, 0.46, 0.10, 0.005, 0.14);
    addBellNote(buf, 0.085, 0.26, 659.25, 0.48, 0.11, 0.005, 0.14);
    addBellNote(buf, 0.17, 0.28, 783.99, 0.52, 0.12, 0.005, 0.15);
    addBellNote(buf, 0.26, 0.48, 1046.5, 0.65, 0.22, 0.006, 0.16);
    addBellNote(buf, 0.26, 0.48, 523.25, 0.26, 0.22, 0.010, 0.08);
    addBellNote(buf, 0.26, 0.48, 659.25, 0.24, 0.22, 0.010, 0.08);
    return finalizeOneShot(buf, 0.004, 0.080, 0.78);
}

/** 编码为标准 PCM 16-bit 单声道 WAV 文件 */
function encodeWavMono16(samples, sampleRate) {
    const numSamples = samples.length;
    const dataBytes = numSamples * 2;
    const buffer = Buffer.alloc(44 + dataBytes);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataBytes, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // PCM chunk size
    buffer.writeUInt16LE(1, 20); // PCM format
    buffer.writeUInt16LE(1, 22); // mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
    buffer.writeUInt16LE(2, 32); // block align
    buffer.writeUInt16LE(16, 34); // bits per sample
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataBytes, 40);

    for (let i = 0; i < numSamples; i++) {
        const clamped = Math.max(-1, Math.min(1, samples[i]));
        const int16 = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
        buffer.writeInt16LE(int16, 44 + i * 2);
    }
    return buffer;
}

const SFX_GENERATORS = [
    ['jet_tap', synthJetTap],
    ['jet_loop', synthJetLoop],
    ['bladder_rebound', synthBladderRebound],
    ['glass_tap', synthGlassTap],
    ['ring_hit', synthRingHit],
    ['pillar_rim', synthPillarRim],
    ['ring_lock', synthRingLock],
    ['match_clear', synthMatchClear],
    ['energy_full', synthEnergyFull],
    ['skill_tide', synthSkillTide],
    ['skill_calm', synthSkillCalm],
    ['countdown_tick', synthCountdownTick],
    ['level_lose', synthLevelLose],
    ['level_win', synthLevelWin],
];

function main() {
    mkdirSync(OUT_DIR, { recursive: true });
    let totalBytes = 0;
    for (const [id, gen] of SFX_GENERATORS) {
        const samples = gen();
        const wav = encodeWavMono16(samples, SAMPLE_RATE);
        const outPath = join(OUT_DIR, `${id}.wav`);
        writeFileSync(outPath, wav);
        totalBytes += wav.byteLength;
        const durMs = Math.round((samples.length / SAMPLE_RATE) * 1000);
        console.log(`[sfx] ${id}.wav (${durMs}ms, ${(wav.byteLength / 1024).toFixed(1)} KB)`);
    }
    console.log(`[sfx] 共生成 ${SFX_GENERATORS.length} 个 WAV 音效，合计 ${(totalBytes / 1024).toFixed(1)} KB`);
}

main();
