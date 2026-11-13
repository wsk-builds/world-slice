import { DEFAULT_FEEL_CONFIG, FeelConfig, FeelParams } from '../config/FeelConfig';
import {
    DEFAULT_HOT_ZONE_WIDTH_PCT,
    MAX_HOT_ZONE_WIDTH_PCT,
    MIN_HOT_ZONE_WIDTH_PCT,
} from '../config/HotZones';

export type FeelKey = keyof FeelParams;
export type TuningKey = FeelKey | 'hotZoneWidthPct';
export type PresetSlot = 1 | 2 | 3;

export interface TuningSliderSpec<K extends string = TuningKey> {
    readonly key: K;
    readonly label: string;
    readonly unit: string;
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly decimals: number;
}

export type FeelSliderSpec = TuningSliderSpec<FeelKey>;

export interface TuningPresetBundle {
    feel: FeelParams;
    hotZoneWidthPct: number;
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

/** T021 拇指热区宽度滑块定义（独立于 FeelParams 12 个物理体感字段） */
export const HOT_ZONE_SLIDER_SPEC: TuningSliderSpec<'hotZoneWidthPct'> = {
    key: 'hotZoneWidthPct',
    label: '热区宽度',
    unit: '%',
    min: MIN_HOT_ZONE_WIDTH_PCT,
    max: MAX_HOT_ZONE_WIDTH_PCT,
    step: 1,
    decimals: 0,
};

export const ALL_TUNING_SLIDER_SPECS: readonly TuningSliderSpec[] = [
    ...FEEL_SLIDER_SPECS,
    HOT_ZONE_SLIDER_SPEC,
];

const SPEC_BY_KEY: Readonly<Record<TuningKey, TuningSliderSpec>> = buildSpecMap();

function buildSpecMap(): Record<TuningKey, TuningSliderSpec> {
    const map = {} as Record<TuningKey, TuningSliderSpec>;
    for (const spec of ALL_TUNING_SLIDER_SPECS) {
        map[spec.key] = spec;
    }
    return map;
}

export function getFeelSliderSpec(key: FeelKey): FeelSliderSpec {
    return SPEC_BY_KEY[key] as FeelSliderSpec;
}

export function getTuningSliderSpec(key: TuningKey): TuningSliderSpec {
    return SPEC_BY_KEY[key];
}

/** 按步长对齐、夹紧到滑块范围并消除浮点尾数误差 */
export function snapSliderValue<K extends string>(raw: number, spec: TuningSliderSpec<K>): number {
    if (!Number.isFinite(raw)) {
        return spec.key === 'hotZoneWidthPct'
            ? DEFAULT_HOT_ZONE_WIDTH_PCT
            : DEFAULT_FEEL_CONFIG[spec.key as FeelKey];
    }
    const stepped = spec.min + Math.round((raw - spec.min) / spec.step) * spec.step;
    const clamped = Math.min(Math.max(stepped, spec.min), spec.max);
    return Number(clamped.toFixed(spec.decimals));
}

export function snapHotZoneWidthPct(raw: number): number {
    return snapSliderValue(raw, HOT_ZONE_SLIDER_SPEC);
}

export function formatFeelValue<K extends string>(spec: TuningSliderSpec<K>, value: number): string {
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

/** 校验并补齐含热区宽度的调参快照 */
export function sanitizeTuningPreset(raw: unknown): TuningPresetBundle {
    const src = raw && typeof raw === 'object' ? (raw as Partial<Record<TuningKey, unknown>>) : {};
    const feel = sanitizeFeelParams(src);
    const rawHz = src.hotZoneWidthPct;
    const hotZoneWidthPct =
        typeof rawHz === 'number' && Number.isFinite(rawHz)
            ? snapHotZoneWidthPct(rawHz)
            : DEFAULT_HOT_ZONE_WIDTH_PCT;
    return { feel, hotZoneWidthPct };
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

export function saveTuningPreset(
    slot: PresetSlot,
    feel: Readonly<FeelParams> = FeelConfig,
    hotZoneWidthPct: number = DEFAULT_HOT_ZONE_WIDTH_PCT,
    storage: StorageLike | null = resolveDefaultStorage(),
): boolean {
    if (!storage) {
        return false;
    }
    try {
        const clean = sanitizeFeelParams(feel);
        const payload = {
            ...clean,
            hotZoneWidthPct: snapHotZoneWidthPct(hotZoneWidthPct),
        };
        storage.setItem(presetStorageKey(slot), JSON.stringify(payload));
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

export function loadTuningPreset(
    slot: PresetSlot,
    storage: StorageLike | null = resolveDefaultStorage(),
): TuningPresetBundle | null {
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
        return sanitizeTuningPreset(parsed);
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

/** 导出供控制台与剪贴板使用的标准多行 JSON（传 hotZoneWidthPct 时一并包含热区宽度） */
export function formatFeelExportJson(
    feel: Readonly<FeelParams> = FeelConfig,
    hotZoneWidthPct?: number,
): string {
    const clean = cloneFeelParams(feel);
    if (hotZoneWidthPct === undefined) {
        return JSON.stringify(clean, null, 4);
    }
    return JSON.stringify(
        {
            ...clean,
            hotZoneWidthPct: snapHotZoneWidthPct(hotZoneWidthPct),
        },
        null,
        4,
    );
}

/** 导出供面板内显示复制的紧凑多行合法 JSON（一屏可读全） */
export function formatFeelCompactJson(
    feel: Readonly<FeelParams> = FeelConfig,
    hotZoneWidthPct?: number,
): string {
    const clean = cloneFeelParams(feel);
    const entries = FEEL_SLIDER_SPECS.map((s) => `"${s.key}": ${clean[s.key]}`);
    if (hotZoneWidthPct !== undefined) {
        entries.push(`"hotZoneWidthPct": ${snapHotZoneWidthPct(hotZoneWidthPct)}`);
    }
    const perLine = entries.length > 12 ? 4 : 3;
    const lines: string[] = [];
    for (let i = 0; i < entries.length; i += perLine) {
        lines.push('  ' + entries.slice(i, i + perLine).join(', '));
    }
    return `{\n${lines.join(',\n')}\n}`;
}
