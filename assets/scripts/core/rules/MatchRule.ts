import { GameConst } from '../../config/GameConst';
import { RingSpec, sameKind } from '../rings/RingKinds';
import { calcSlotCenterY } from './PillarStack';

export interface MatchSlotInput<T = unknown> {
    item: T;
    spec: RingSpec;
    thickness: number;
}

export interface MatchedPair<T = unknown> {
    first: MatchSlotInput<T>;
    second: MatchSlotInput<T>;
    firstIndex: number;
    secondIndex: number;
}

export interface RemainingSlotLayout<T = unknown> {
    item: T;
    spec: RingSpec;
    thickness: number;
    oldIndex: number;
    newIndex: number;
    /** 是否位于被消圈上方（旧槽位下移到新槽位） */
    moved: boolean;
    /** 按 calcSlotCenterY(..., pitchScale) 计算的新槽位中心 Y（缸坐标） */
    targetCenterY: number;
}

export interface PillarMatchResult<T = unknown> {
    matched: boolean;
    pair: MatchedPair<T> | null;
    /** 消除后柱上剩余各圈的新槽位与目标高度（按从底到顶 0..k-1 排列） */
    remaining: RemainingSlotLayout<T>[];
}

export interface ResolvePillarMatchOptions {
    baseTopY: number;
    pitchScale?: number;
}

/**
 * 在同一根柱子的已锁槽位列表（从底到顶）中查找是否存在一对同款圈（不要求相邻）：
 * - 普通圈按颜色配对；
 * - 特殊圈（小金环、铁圈、木圈）按种类配对。
 */
export function findMatchPair<T>(entries: readonly MatchSlotInput<T>[]): MatchedPair<T> | null {
    for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
            if (sameKind(entries[i].spec, entries[j].spec)) {
                return {
                    first: entries[i],
                    second: entries[j],
                    firstIndex: i,
                    secondIndex: j,
                };
            }
        }
    }
    return null;
}

/**
 * 检查柱上是否存在同款消除对，并重算剩余各圈的新槽位下标与目标中心 Y（纯逻辑，不依赖引擎）。
 */
export function resolvePillarMatch<T>(
    entries: readonly MatchSlotInput<T>[],
    options: ResolvePillarMatchOptions,
): PillarMatchResult<T> {
    const pitchScale = options.pitchScale ?? GameConst.pillarSlotPitchScale;
    const pair = findMatchPair(entries);

    const kept: Array<{ entry: MatchSlotInput<T>; oldIndex: number }> = [];
    for (let i = 0; i < entries.length; i++) {
        if (pair && (i === pair.firstIndex || i === pair.secondIndex)) {
            continue;
        }
        kept.push({ entry: entries[i], oldIndex: i });
    }

    const thicknesses = kept.map((k) => k.entry.thickness);
    const remaining: RemainingSlotLayout<T>[] = new Array(kept.length);
    for (let newIndex = 0; newIndex < kept.length; newIndex++) {
        const { entry, oldIndex } = kept[newIndex];
        remaining[newIndex] = {
            item: entry.item,
            spec: entry.spec,
            thickness: entry.thickness,
            oldIndex,
            newIndex,
            moved: pair !== null && oldIndex > newIndex,
            targetCenterY: calcSlotCenterY(options.baseTopY, thicknesses, entry.thickness, newIndex, pitchScale),
        };
    }

    return {
        matched: pair !== null,
        pair,
        remaining,
    };
}

/** 根据垂直下落距离计算平滑下落耗时（秒） */
export function calcMatchDropDuration(distancePx: number): number {
    const dist = Math.abs(distancePx);
    if (dist <= 0.01) {
        return 0;
    }
    const raw = dist / GameConst.matchDropSpeedPxPerSec;
    return Math.min(GameConst.matchDropMaxDurationSec, Math.max(GameConst.matchDropMinDurationSec, raw));
}

/** 计算沿 Y 轴平滑下落的插值位置（smoothstep 缓动，起点柔起、落点无过冲） */
export function calcMatchDropY(startY: number, targetY: number, progress01: number): number {
    const t = Math.min(1, Math.max(0, progress01));
    const eased = t * t * (3 - 2 * t);
    return startY + (targetY - startY) * eased;
}
