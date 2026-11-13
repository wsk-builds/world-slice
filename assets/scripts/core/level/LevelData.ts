import { GameConst } from '../../config/GameConst';
import { RingColor, RingKind, RingSpec } from '../rings/RingKinds';

/** 关卡类型（GDD §4.4：普通关、清障解救关、配方分类关、首领战） */
export type LevelType = 'normal' | 'rescue' | 'classify' | 'boss';

export const LEVEL_TYPES: readonly LevelType[] = ['normal', 'rescue', 'classify', 'boss'];

/** 缸内百分比坐标（原点在内屏左下角，xPct/yPct ∈ 0~100） */
export interface LevelPercentPos {
    xPct: number;
    yPct: number;
}

export type LevelRingPos = LevelPercentPos | 'random';

export interface LevelRingEntry {
    kind: RingKind;
    /** 仅 normal 普通圈使用；特殊圈不区分颜色 */
    color?: RingColor;
    /** 初始位置（缸内百分比 0~100 或 'random' 由种子确定性摆位） */
    pos: LevelRingPos;
    /** 可选初始平面角（度），不填时由关卡 seed 生成 */
    angleDeg?: number;
    /** 解救关初始受困形式（供 T048 读取） */
    trappedBy?: 'ice' | 'octopus';
}

/** 关卡机关类型（GDD §4.3） */
export type LevelMechanismType = 'gate' | 'vortex' | 'bubbleSpring' | 'abyssCurrent';

export const LEVEL_MECHANISM_TYPES: readonly LevelMechanismType[] = [
    'gate',
    'vortex',
    'bubbleSpring',
    'abyssCurrent',
];

export interface LevelMechanismEntry {
    type: LevelMechanismType;
    pos?: LevelPercentPos;
    params?: Record<string, number | string | boolean>;
}

/** 关卡角色类型（GDD §4.2） */
export type LevelActorType = 'turtle' | 'clam' | 'crab' | 'shrimp' | 'octopus';

export const LEVEL_ACTOR_TYPES: readonly LevelActorType[] = [
    'turtle',
    'clam',
    'crab',
    'shrimp',
    'octopus',
];

export type LevelSide = 'left' | 'right';

export interface LevelActorEntry {
    type: LevelActorType;
    /** 出场时间（秒，>= 0） */
    spawnSec: number;
    side?: LevelSide;
    pos?: LevelPercentPos;
    /** 若周期重现，记录间隔秒数（> 0） */
    repeatSec?: number;
    params?: Record<string, number | string | boolean>;
}

/** 关卡叙事文本（GDD §6.1 场记卡与下巴隐形浮字） */
export interface LevelNarrative {
    slateTitle?: string;
    slateSubtitle?: string;
    chinCue?: string;
    chinClearCue?: string;
}

/** 左右柱充能开关（供 T017 读取，缺省默认开启） */
export interface LevelPillarEnergySwitch {
    left?: boolean;
    right?: boolean;
}

/** 配方分类关双柱色带配置（供 T049 读取） */
export interface LevelClassifyColors {
    left: readonly [RingColor, RingColor];
    right: readonly [RingColor, RingColor];
}

/** 关卡完整数据结构（纯逻辑，位置一律采用缸内百分比 0~100） */
export interface LevelData {
    id: string;
    title: string;
    durationSec: number;
    type: LevelType;
    rings: LevelRingEntry[];
    mechanisms: LevelMechanismEntry[];
    actors: LevelActorEntry[];
    narrative?: LevelNarrative;
    seed: number;
    note?: string;
    pillarEnergy?: LevelPillarEnergySwitch;
    classifyColors?: LevelClassifyColors;
}

const SAFE_LEVEL_ID_RE = /^[A-Za-z0-9_-]+$/;

/** 计算圈的配对等价类标识（普通圈按颜色区分，特殊圈按种类区分） */
export function getRingSpeciesKey(spec: RingSpec): string {
    if (spec.kind === 'normal') {
        return `normal:${spec.color ?? ''}`;
    }
    return spec.kind;
}

/** 解析关卡充能开关（缺省默认为 true） */
export function resolvePillarEnergyEnabled(
    level: Pick<LevelData, 'pillarEnergy'> | null | undefined,
): { left: boolean; right: boolean } {
    return {
        left: level?.pillarEnergy?.left !== false,
        right: level?.pillarEnergy?.right !== false,
    };
}

/** 从 URL 查询字符串（如 `?level=X02`）安全解析关卡编号，非法或缺失时回退默认关 */
export function parseLevelIdFromSearch(
    search: string | null | undefined,
    fallback: string = GameConst.defaultLevelId,
): string {
    if (!search || typeof search !== 'string') {
        return fallback;
    }
    const trimmed = search.startsWith('?') ? search.slice(1) : search;
    if (!trimmed) {
        return fallback;
    }
    const pairs = trimmed.split('&');
    for (let i = 0; i < pairs.length; i++) {
        const part = pairs[i];
        if (!part) {
            continue;
        }
        const eqIdx = part.indexOf('=');
        const rawKey = eqIdx >= 0 ? part.slice(0, eqIdx) : part;
        let key: string;
        try {
            key = decodeURIComponent(rawKey).trim();
        } catch {
            continue;
        }
        if (key !== 'level') {
            continue;
        }
        const rawVal = eqIdx >= 0 ? part.slice(eqIdx + 1) : '';
        let val: string;
        try {
            val = decodeURIComponent(rawVal.replace(/\+/g, ' ')).trim();
        } catch {
            return fallback;
        }
        if (SAFE_LEVEL_ID_RE.test(val)) {
            return val;
        }
        return fallback;
    }
    return fallback;
}
