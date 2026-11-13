import { GameConst } from '../../config/GameConst';
import { RingSpec, sameKind } from '../rings/RingKinds';
import { calcSlotCenterY } from './PillarStack';

export interface MatchSlotInput<T = unknown> {
    item: T;
    spec: RingSpec;
    thickness: number;
}

export interface MatchedGroup<T = unknown> {
    entries: readonly MatchSlotInput<T>[];
    indices: readonly number[];
    count: number;
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
    group: MatchedGroup<T> | null;
    /** 消除后柱上剩余各圈的新槽位与目标高度（按从底到顶 0..k-1 排列） */
    remaining: RemainingSlotLayout<T>[];
}

export interface PillarRingCandidate {
    spec: RingSpec;
    thickness: number;
    y: number;
    /** 若为已锁定圈，对应它在 stack 中的下标；未锁定的柱上圈传 -1 */
    lockedIndex: number;
}

export interface ResolvePillarMatchOptions {
    baseTopY: number;
    pitchScale?: number;
    /** 优先消除包含该槽位下标的相邻同款组（如刚落锁的顶圈下标） */
    preferredIndex?: number;
}

export function isSameColorAndSize<T>(
    a: Pick<MatchSlotInput<T>, 'spec' | 'thickness'>,
    b: Pick<MatchSlotInput<T>, 'spec' | 'thickness'>,
): boolean {
    return sameKind(a.spec, b.spec) && Math.abs(a.thickness - b.thickness) <= 0.01;
}

/**
 * 在同一根柱子的已锁槽位列表（从底到顶）中查找是否存在相邻的同款圈（同色且同大小）：
 * - 不相邻（中间隔着其它圈）不消除；
 * - 2 个相邻消除 2 个，3 个同时相邻消除 3 个，4 个同时相邻消除 4 个（及以上连续同款一并消除）。
 */
export function findMatchGroup<T>(
    entries: readonly MatchSlotInput<T>[],
    preferredIndex?: number,
): MatchedGroup<T> | null {
    const runs: Array<{ start: number; end: number }> = [];
    let i = 0;
    while (i < entries.length) {
        let j = i + 1;
        while (j < entries.length && isSameColorAndSize(entries[i], entries[j])) {
            j++;
        }
        const len = j - i;
        if (len >= 2) {
            runs.push({ start: i, end: j - 1 });
        }
        i = j;
    }

    if (runs.length === 0) {
        return null;
    }

    let chosen = runs[0];
    if (preferredIndex !== undefined) {
        for (let r = 0; r < runs.length; r++) {
            if (preferredIndex >= runs[r].start && preferredIndex <= runs[r].end) {
                chosen = runs[r];
                break;
            }
        }
    }

    const matchedEntries: MatchSlotInput<T>[] = [];
    const indices: number[] = [];
    for (let idx = chosen.start; idx <= chosen.end; idx++) {
        matchedEntries.push(entries[idx]);
        indices.push(idx);
    }

    return {
        entries: matchedEntries,
        indices,
        count: matchedEntries.length,
    };
}

/**
 * 检查柱上是否存在相邻同款消除组，并重算剩余各圈的新槽位下标与目标中心 Y（纯逻辑，不依赖引擎）。
 */
export function resolvePillarMatch<T>(
    entries: readonly MatchSlotInput<T>[],
    options: ResolvePillarMatchOptions,
): PillarMatchResult<T> {
    const pitchScale = options.pitchScale ?? GameConst.pillarSlotPitchScale;
    const group = findMatchGroup(entries, options.preferredIndex);

    const removedIndices = new Set<number>(group ? group.indices : []);
    const kept: Array<{ entry: MatchSlotInput<T>; oldIndex: number }> = [];
    for (let i = 0; i < entries.length; i++) {
        if (removedIndices.has(i)) {
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
            moved: group !== null && oldIndex > newIndex,
            targetCenterY: calcSlotCenterY(options.baseTopY, thicknesses, entry.thickness, newIndex, pitchScale),
        };
    }

    return {
        matched: group !== null,
        group,
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

/**
 * 判断候选消除组（lockedIndices）周围是否还有“正在柱上稳定中的相邻同款圈”或“夹在组内尚未锁定的异款圈”：
 * - 若有同色同大小的未锁定圈正紧挨在消除组上方、下方或组内且中间无异款阻隔，返回 true，
 *   让消除暂缓一拍，等相邻同色圈一起锁妥后全部同时消除（避免 3/4/5 个同时相邻却被两两拆消）。
 * - 若有异款未锁定圈物理位置夹在消除组上下两圈之间，也暂缓，避免跨圈误消。
 */
export function shouldDeferPillarMatch(
    lockedRings: readonly PillarRingCandidate[],
    pendingRingsOnPillar: readonly PillarRingCandidate[],
    matchLockedIndices: readonly number[],
): boolean {
    if (matchLockedIndices.length === 0 || pendingRingsOnPillar.length === 0) {
        return false;
    }

    const matchSet = new Set<number>(matchLockedIndices);
    const refCandidate = lockedRings[matchLockedIndices[0]];
    if (!refCandidate) {
        return false;
    }

    const merged: Array<PillarRingCandidate & { inMatchGroup: boolean; isPending: boolean }> = [];
    for (let i = 0; i < lockedRings.length; i++) {
        merged.push({
            ...lockedRings[i],
            inMatchGroup: matchSet.has(i),
            isPending: false,
        });
    }
    for (let i = 0; i < pendingRingsOnPillar.length; i++) {
        merged.push({
            ...pendingRingsOnPillar[i],
            inMatchGroup: false,
            isPending: true,
        });
    }
    merged.sort((a, b) => a.y - b.y);

    let gMin = -1;
    let gMax = -1;
    for (let i = 0; i < merged.length; i++) {
        if (merged[i].inMatchGroup) {
            if (gMin < 0) {
                gMin = i;
            }
            gMax = i;
        }
    }
    if (gMin < 0) {
        return false;
    }

    // 1. 若有任意未锁定圈物理夹在候选消除组内部（无论同款还是异款），都先等待其落定再判定
    for (let i = gMin + 1; i < gMax; i++) {
        if (merged[i].isPending) {
            return true;
        }
    }

    // 2. 向下检查紧邻的未锁定圈（遇到非同款圈立即停止）
    for (let i = gMin - 1; i >= 0; i--) {
        const cur = merged[i];
        if (!isSameColorAndSize(cur, refCandidate)) {
            break;
        }
        if (cur.isPending) {
            return true;
        }
    }

    // 3. 向上检查紧邻的未锁定圈（遇到非同款圈立即停止）
    for (let i = gMax + 1; i < merged.length; i++) {
        const cur = merged[i];
        if (!isSameColorAndSize(cur, refCandidate)) {
            break;
        }
        if (cur.isPending) {
            return true;
        }
    }

    return false;
}
