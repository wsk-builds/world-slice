import { DEFAULT_FEEL_CONFIG, FeelConfig, FeelParams } from '../config/FeelConfig';

export type FeelKey = keyof FeelParams;
export type PresetSlot = 1 | 2 | 3;

export interface FeelSliderSpec {
    readonly key: FeelKey;
    readonly label: string;
    readonly unit: string;
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly decimals: number;
}

export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem?(key: string): void;
}

export const PRESET_SLOTS: readonly PresetSlot[] = [1, 2, 3];

const STORAGE_PREFIX = 'tao_le_ge_quan:feel_preset_';

/**
 * 12 个体感滑块定义（GDD §3.4，T011）：
 * 左侧 6 项为水流与气囊体感，右侧 6 项为柱位、海眼与操控旋钮。
 */
export const FEEL_SLIDER_SPECS: readonly FeelSliderSpec[] = [
    { key: 'sinkSec', label: '沉底秒数', unit: '秒', min: 0.5, max: 8.0, step: 0.1, decimals: 1 },
    { key: 'tapLiftPct', label: '轻点推升', unit: '%', min: 10, max: 80, step: 1, decimals: 0 },
    { key: 'holdLiftPct', label: '按满推升', unit: '%', min: 30, max: 96, step: 1, decimals: 0 },
    { key: 'bladderMaxBreathSec', label: '单口气时长', unit: '秒', min: 0.2, max: 1.5, step: 0.05, decimals: 2 },
    { key: 'bladderRefillSec', label: '回充秒数', unit: '秒', min: 0.05, max: 0.8, step: 0.01, decimals: 2 },
    { key: 'circulationDecaySec', label: '环流衰减', unit: '秒', min: 0.5, max: 4.0, step: 0.05, decimals: 2 },

    { key: 'pillarPosPct', label: '柱子位置', unit: '%', min: 18, max: 40, step: 0.5, decimals: 1 },
    { key: 'pillarBottomPct', label: '柱底离底', unit: '%', min: 12, max: 45, step: 1, decimals: 0 },
    { key: 'nozzlePosPct', label: '海眼位置', unit: '%', min: 8, max: 28, step: 0.5, decimals: 1 },
    { key: 'nozzleTiltDeg', label: '海眼内倾', unit: '°', min: 0, max: 25, step: 1, decimals: 0 },
    { key: 'tumbleSensitivity', label: '翻滚灵敏度', unit: '', min: 0, max: 1, step: 0.05, decimals: 2 },
    { key: 'funnelTolerance', label: '入柱宽容', unit: '', min: 0, max: 1, step: 0.05, decimals: 2 },
];

const SPEC_BY_KEY: Readonly<Record<FeelKey, FeelSliderSpec>> = buildSpecMap();

function buildSpecMap(): Record<FeelKey, FeelSliderSpec> {
    const map = {} as Record<FeelKey, FeelSliderSpec>;
    for (const spec of FEEL_SLIDER_SPECS) {
        map[spec.key] = spec;
    }
    return map;
}

export function getFeelSliderSpec(key: FeelKey): FeelSliderSpec {
    return SPEC_BY_KEY[key];
}

/** 按步长对齐、夹紧到滑块范围并消除浮点尾数误差 */
export function snapSliderValue(raw: number, spec: FeelSliderSpec): number {
    if (!Number.isFinite(raw)) {
        return DEFAULT_FEEL_CONFIG[spec.key];
    }
    const stepped = spec.min + Math.round((raw - spec.min) / spec.step) * spec.step;
    const clamped = Math.min(Math.max(stepped, spec.min), spec.max);
    return Number(clamped.toFixed(spec.decimals));
}

export function formatFeelValue(spec: FeelSliderSpec, value: number): string {
    const numStr = value.toFixed(spec.decimals);
    return spec.unit ? `${numStr} ${spec.unit}` : numStr;
}

export function presetStorageKey(slot: PresetSlot): string {
    return `${STORAGE_PREFIX}${slot}`;
}

/** 校验并补齐任意读取对象为合法 FeelParams */
export function sanitizeFeelParams(raw: unknown): FeelParams {
    const src = raw && typeof raw === 'object' ? (raw as Partial<Record<FeelKey, unknown>>) : {};
    const out: FeelParams = { ...DEFAULT_FEEL_CONFIG };
    for (const spec of FEEL_SLIDER_SPECS) {
        const val = src[spec.key];
        if (typeof val === 'number' && Number.isFinite(val)) {
            out[spec.key] = snapSliderValue(val, spec);
        }
    }
    return out;
}

export function cloneFeelParams(feel: Readonly<FeelParams> = FeelConfig): FeelParams {
    return sanitizeFeelParams(feel);
}

export function resolveDefaultStorage(): StorageLike | null {
    try {
        const g = globalThis as { localStorage?: StorageLike };
        if (g && g.localStorage && typeof g.localStorage.getItem === 'function') {
            return g.localStorage;
        }
    } catch {
        // 忽略受限环境访问异常
    }
    return null;
}

export function saveFeelPreset(
    slot: PresetSlot,
    feel: Readonly<FeelParams> = FeelConfig,
    storage: StorageLike | null = resolveDefaultStorage(),
): boolean {
    if (!storage) {
        return false;
    }
    try {
        const clean = sanitizeFeelParams(feel);
        storage.setItem(presetStorageKey(slot), JSON.stringify(clean));
        return true;
    } catch {
        return false;
    }
}

export function loadFeelPreset(
    slot: PresetSlot,
    storage: StorageLike | null = resolveDefaultStorage(),
): FeelParams | null {
    if (!storage) {
        return null;
    }
    try {
        const raw = storage.getItem(presetStorageKey(slot));
        if (!raw) {
            return null;
        }
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }
        return sanitizeFeelParams(parsed);
    } catch {
        return null;
    }
}

export function hasFeelPreset(
    slot: PresetSlot,
    storage: StorageLike | null = resolveDefaultStorage(),
): boolean {
    return loadFeelPreset(slot, storage) !== null;
}

export function deleteFeelPreset(
    slot: PresetSlot,
    storage: StorageLike | null = resolveDefaultStorage(),
): void {
    if (!storage) {
        return;
    }
    try {
        if (typeof storage.removeItem === 'function') {
            storage.removeItem(presetStorageKey(slot));
        } else {
            storage.setItem(presetStorageKey(slot), '');
        }
    } catch {
        // 忽略存储删除异常
    }
}

/** 导出供控制台与剪贴板使用的标准多行 JSON */
export function formatFeelExportJson(feel: Readonly<FeelParams> = FeelConfig): string {
    return JSON.stringify(cloneFeelParams(feel), null, 4);
}

/** 导出供面板内显示复制的紧凑多行合法 JSON（4 行，一屏可读全） */
export function formatFeelCompactJson(feel: Readonly<FeelParams> = FeelConfig): string {
    const clean = cloneFeelParams(feel);
    const entries = FEEL_SLIDER_SPECS.map((s) => `"${s.key}": ${clean[s.key]}`);
    const lines: string[] = [];
    for (let i = 0; i < entries.length; i += 3) {
        lines.push('  ' + entries.slice(i, i + 3).join(', '));
    }
    return `{\n${lines.join(',\n')}\n}`;
}
