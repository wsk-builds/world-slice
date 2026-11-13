import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_FEEL_CONFIG, FeelConfig, FeelParams } from '../../assets/scripts/config/FeelConfig';
import { applyFeel, SolvedFeelConfig } from '../../assets/scripts/core/flow/FeelSolver';
import {
    deleteFeelPreset,
    FEEL_SLIDER_SPECS,
    formatFeelCompactJson,
    formatFeelExportJson,
    getFeelSliderSpec,
    hasFeelPreset,
    loadFeelPreset,
    PRESET_SLOTS,
    sanitizeFeelParams,
    saveFeelPreset,
    snapSliderValue,
    StorageLike,
} from '../../assets/scripts/debug/TuningPresets';

function createMemoryStorage(): StorageLike {
    const map = new Map<string, string>();
    return {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => {
            map.set(key, value);
        },
        removeItem: (key: string) => {
            map.delete(key);
        },
    };
}

describe('TuningPresets', () => {
    afterEach(() => {
        applyFeel({ ...DEFAULT_FEEL_CONFIG });
    });

    it('覆盖全部 12 个 FeelParams 体感参数且默认起始值落在滑块范围内', () => {
        const expectedKeys = Object.keys(DEFAULT_FEEL_CONFIG) as (keyof FeelParams)[];
        expect(FEEL_SLIDER_SPECS).toHaveLength(12);
        expect(FEEL_SLIDER_SPECS.map((s) => s.key).sort()).toEqual(expectedKeys.slice().sort());

        for (const spec of FEEL_SLIDER_SPECS) {
            expect(spec.label.length).toBeGreaterThan(0);
            expect(spec.min).toBeLessThan(spec.max);
            expect(spec.step).toBeGreaterThan(0);
            const defVal = DEFAULT_FEEL_CONFIG[spec.key];
            expect(defVal).toBeGreaterThanOrEqual(spec.min);
            expect(defVal).toBeLessThanOrEqual(spec.max);
            expect(snapSliderValue(defVal, spec)).toBe(defVal);
        }
    });

    it('snapSliderValue 能对齐步长、消除浮点误差并夹紧越界值', () => {
        const sinkSpec = getFeelSliderSpec('sinkSec');
        expect(snapSliderValue(0.1 + 0.2 + 1.0, sinkSpec)).toBe(1.3);
        expect(snapSliderValue(-5, sinkSpec)).toBe(sinkSpec.min);
        expect(snapSliderValue(999, sinkSpec)).toBe(sinkSpec.max);
        expect(snapSliderValue(Number.NaN, sinkSpec)).toBe(DEFAULT_FEEL_CONFIG.sinkSec);

        const tumbleSpec = getFeelSliderSpec('tumbleSensitivity');
        expect(snapSliderValue(0.374, tumbleSpec)).toBe(0.35);
        expect(snapSliderValue(0.376, tumbleSpec)).toBe(0.4);
    });

    it('3 个预设槽位彼此独立存取且能安全处理损坏或残缺数据', () => {
        const storage = createMemoryStorage();
        for (const slot of PRESET_SLOTS) {
            expect(hasFeelPreset(slot, storage)).toBe(false);
            expect(loadFeelPreset(slot, storage)).toBeNull();
        }

        const custom1: FeelParams = { ...DEFAULT_FEEL_CONFIG, sinkSec: 1.8, pillarPosPct: 36.5 };
        const custom2: FeelParams = { ...DEFAULT_FEEL_CONFIG, tapLiftPct: 55, nozzleTiltDeg: 18 };
        expect(saveFeelPreset(1, custom1, storage)).toBe(true);
        expect(saveFeelPreset(2, custom2, storage)).toBe(true);

        expect(hasFeelPreset(1, storage)).toBe(true);
        expect(hasFeelPreset(2, storage)).toBe(true);
        expect(hasFeelPreset(3, storage)).toBe(false);

        expect(loadFeelPreset(1, storage)).toEqual(custom1);
        expect(loadFeelPreset(2, storage)).toEqual(custom2);

        deleteFeelPreset(1, storage);
        expect(hasFeelPreset(1, storage)).toBe(false);
        expect(hasFeelPreset(2, storage)).toBe(true);

        // 损坏 JSON 与越界字段防护
        storage.setItem('tao_le_ge_quan:feel_preset_3', '{not-json');
        expect(loadFeelPreset(3, storage)).toBeNull();

        const partial = sanitizeFeelParams({ sinkSec: 99, pillarPosPct: 28 });
        expect(partial.sinkSec).toBe(getFeelSliderSpec('sinkSec').max);
        expect(partial.pillarPosPct).toBe(28);
        expect(partial.holdLiftPct).toBe(DEFAULT_FEEL_CONFIG.holdLiftPct);
    });

    it('导出标准 JSON 与面板紧凑 JSON 均可反序列化为一致的参数且读取预设后可即时 applyFeel', () => {
        const storage = createMemoryStorage();
        const custom: FeelParams = {
            ...DEFAULT_FEEL_CONFIG,
            sinkSec: 2.0,
            pillarPosPct: 35,
            funnelTolerance: 0.85,
        };
        saveFeelPreset(1, custom, storage);

        const loaded = loadFeelPreset(1, storage)!;
        applyFeel(loaded);
        expect(FeelConfig.sinkSec).toBe(2.0);
        expect(FeelConfig.pillarPosPct).toBe(35);
        expect(SolvedFeelConfig.measured.sinkSec).toBeCloseTo(2.0, 1);

        const prettyParsed = JSON.parse(formatFeelExportJson(FeelConfig)) as FeelParams;
        const compactParsed = JSON.parse(formatFeelCompactJson(FeelConfig)) as FeelParams;
        expect(prettyParsed).toEqual(custom);
        expect(compactParsed).toEqual(custom);
    });
});
