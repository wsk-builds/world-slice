import { GameConst } from '../../config/GameConst';
import { RING_COLORS, RingColor, RingKind } from '../rings/RingKinds';
import {
    getRingSpeciesKey,
    LEVEL_ACTOR_TYPES,
    LEVEL_MECHANISM_TYPES,
    LEVEL_TYPES,
    LevelActorType,
    LevelData,
    LevelMechanismType,
    LevelType,
} from './LevelData';

export interface LevelValidationResult {
    valid: boolean;
    errors: string[];
    level: LevelData | null;
}

const VALID_RING_KINDS: readonly RingKind[] = ['normal', 'gold', 'iron', 'wood'];
const SAFE_LEVEL_ID_RE = /^[A-Za-z0-9_-]+$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRingColor(value: unknown): value is RingColor {
    return typeof value === 'string' && (RING_COLORS as readonly string[]).includes(value);
}

function isRingKind(value: unknown): value is RingKind {
    return typeof value === 'string' && (VALID_RING_KINDS as readonly string[]).includes(value);
}

function validatePercentPos(
    pos: unknown,
    label: string,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    errors: string[],
): boolean {
    if (!isPlainObject(pos)) {
        errors.push(`${label} 必须是 { xPct, yPct } 对象`);
        return false;
    }
    const { xPct, yPct } = pos;
    let ok = true;
    if (typeof xPct !== 'number' || !Number.isFinite(xPct) || xPct < minX || xPct > maxX) {
        errors.push(`${label}.xPct 必须在 [${minX}, ${maxX}] 范围内`);
        ok = false;
    }
    if (typeof yPct !== 'number' || !Number.isFinite(yPct) || yPct < minY || yPct > maxY) {
        errors.push(`${label}.yPct 必须在 [${minY}, ${maxY}] 范围内`);
        ok = false;
    }
    return ok;
}

/**
 * 校验关卡数据合法性（纯逻辑，不依赖引擎，规则依据 GDD §2.1 / §5）：
 * - 圈总数在 [1, 两柱容量之和 (12)]；
 * - 同时出现的圈种（等价类）不超过 GameConst.maxLevelRingSpecies (5)；
 * - 普通圈必须带合法颜色，特殊圈不带颜色；
 * - 圈百分比位置为 'random' 或在缸内合理范围；
 * - 时间、类型、种子、机关列表与角色出场表格式正确。
 */
export function validateLevel(raw: unknown): LevelValidationResult {
    const errors: string[] = [];
    if (!isPlainObject(raw)) {
        return { valid: false, errors: ['关卡根节点必须是 JSON 对象'], level: null };
    }

    // 1. id / title / type / durationSec / seed
    if (typeof raw.id !== 'string' || raw.id.trim().length === 0 || !SAFE_LEVEL_ID_RE.test(raw.id.trim())) {
        errors.push('id 必须为非空字母/数字/_/- 编号');
    }
    if (typeof raw.title !== 'string' || raw.title.trim().length === 0) {
        errors.push('title 必须为非空字符串');
    }
    if (typeof raw.durationSec !== 'number' || !Number.isFinite(raw.durationSec) || raw.durationSec <= 0) {
        errors.push('durationSec 必须为大于 0 的有限数字');
    }
    if (typeof raw.type !== 'string' || !(LEVEL_TYPES as readonly string[]).includes(raw.type)) {
        errors.push(`type 必须是 ${LEVEL_TYPES.join(' / ')} 之一`);
    }
    if (typeof raw.seed !== 'number' || !Number.isFinite(raw.seed) || !Number.isInteger(raw.seed)) {
        errors.push('seed 必须为有限整数');
    }

    if (raw.note !== undefined && typeof raw.note !== 'string') {
        errors.push('note 若填写则必须为字符串');
    }

    // 2. pillarEnergy（可选，供 T017 读取）
    if (raw.pillarEnergy !== undefined) {
        if (!isPlainObject(raw.pillarEnergy)) {
            errors.push('pillarEnergy 必须是对象');
        } else {
            if (raw.pillarEnergy.left !== undefined && typeof raw.pillarEnergy.left !== 'boolean') {
                errors.push('pillarEnergy.left 必须是布尔值');
            }
            if (raw.pillarEnergy.right !== undefined && typeof raw.pillarEnergy.right !== 'boolean') {
                errors.push('pillarEnergy.right 必须是布尔值');
            }
        }
    }

    // 3. narrative（可选）
    if (raw.narrative !== undefined) {
        if (!isPlainObject(raw.narrative)) {
            errors.push('narrative 必须是对象');
        } else {
            for (const field of ['slateTitle', 'slateSubtitle', 'chinCue', 'chinClearCue'] as const) {
                const v = raw.narrative[field];
                if (v !== undefined && typeof v !== 'string') {
                    errors.push(`narrative.${field} 必须是字符串`);
                }
            }
        }
    }

    // 4. classifyColors（可选）
    if (raw.classifyColors !== undefined) {
        if (!isPlainObject(raw.classifyColors)) {
            errors.push('classifyColors 必须是对象');
        } else {
            for (const side of ['left', 'right'] as const) {
                const pair = raw.classifyColors[side];
                if (!Array.isArray(pair) || pair.length !== 2 || !isRingColor(pair[0]) || !isRingColor(pair[1])) {
                    errors.push(`classifyColors.${side} 必须是包含 2 个合法颜色的数组`);
                }
            }
        }
    }

    // 5. rings
    const maxRings = GameConst.pillarCapacity * 2;
    if (!Array.isArray(raw.rings)) {
        errors.push('rings 必须是数组');
    } else {
        if (raw.rings.length < 1) {
            errors.push('rings 至少包含 1 个圈');
        }
        if (raw.rings.length > maxRings) {
            errors.push(`rings 数量 (${raw.rings.length}) 不能超过两柱容量之和 (${maxRings})`);
        }

        const speciesCounts = new Map<string, number>();

        for (let i = 0; i < raw.rings.length; i++) {
            const item = raw.rings[i];
            const prefix = `rings[${i}]`;
            if (!isPlainObject(item)) {
                errors.push(`${prefix} 必须是对象`);
                continue;
            }
            if (!isRingKind(item.kind)) {
                errors.push(`${prefix}.kind 非法（允许 ${VALID_RING_KINDS.join(' / ')}）`);
                continue;
            }
            if (item.kind === 'normal') {
                if (!isRingColor(item.color)) {
                    errors.push(`${prefix}.color 对普通圈必填且必须是 ${RING_COLORS.join(' / ')}`);
                }
            } else if (item.color !== undefined) {
                errors.push(`${prefix}.color 仅普通圈可用，特殊圈不应指定 color`);
            }

            if (item.pos !== 'random') {
                validatePercentPos(
                    item.pos,
                    `${prefix}.pos`,
                    GameConst.levelPosMinXPct,
                    GameConst.levelPosMaxXPct,
                    GameConst.levelPosMinYPct,
                    GameConst.levelPosMaxYPct,
                    errors,
                );
            }

            if (item.angleDeg !== undefined && (typeof item.angleDeg !== 'number' || !Number.isFinite(item.angleDeg))) {
                errors.push(`${prefix}.angleDeg 必须是有限数字`);
            }

            if (item.trappedBy !== undefined && item.trappedBy !== 'ice' && item.trappedBy !== 'octopus') {
                errors.push(`${prefix}.trappedBy 必须是 'ice' 或 'octopus'`);
            }

            const key = getRingSpeciesKey({
                kind: item.kind,
                color: isRingColor(item.color) ? item.color : undefined,
            });
            speciesCounts.set(key, (speciesCounts.get(key) ?? 0) + 1);
        }

        if (speciesCounts.size > GameConst.maxLevelRingSpecies) {
            errors.push(
                `同时出现的圈种数量 (${speciesCounts.size}) 不能超过 ${GameConst.maxLevelRingSpecies}`,
            );
        }

        // 统计两两同款消除后剩余单圈数：不得超过总柱容量（正常按 <=5 种圈必 <=5，这里仍做硬兜底）
        let leftoverSingletons = 0;
        for (const count of speciesCounts.values()) {
            leftoverSingletons += count % 2;
        }
        if (leftoverSingletons > maxRings) {
            errors.push(`消除同款后剩余单圈数 (${leftoverSingletons}) 超过总柱容量 (${maxRings})`);
        }
    }

    // 6. mechanisms
    if (!Array.isArray(raw.mechanisms)) {
        errors.push('mechanisms 必须是数组');
    } else {
        for (let i = 0; i < raw.mechanisms.length; i++) {
            const m = raw.mechanisms[i];
            const prefix = `mechanisms[${i}]`;
            if (!isPlainObject(m)) {
                errors.push(`${prefix} 必须是对象`);
                continue;
            }
            if (typeof m.type !== 'string' || !(LEVEL_MECHANISM_TYPES as readonly string[]).includes(m.type)) {
                errors.push(`${prefix}.type 必须是 ${LEVEL_MECHANISM_TYPES.join(' / ')} 之一`);
            }
            if (m.pos !== undefined) {
                validatePercentPos(m.pos, `${prefix}.pos`, 0, 100, 0, 100, errors);
            }
            if (m.params !== undefined && !isPlainObject(m.params)) {
                errors.push(`${prefix}.params 必须是对象`);
            }
        }
    }

    // 7. actors
    if (!Array.isArray(raw.actors)) {
        errors.push('actors 必须是数组');
    } else {
        for (let i = 0; i < raw.actors.length; i++) {
            const a = raw.actors[i];
            const prefix = `actors[${i}]`;
            if (!isPlainObject(a)) {
                errors.push(`${prefix} 必须是对象`);
                continue;
            }
            if (typeof a.type !== 'string' || !(LEVEL_ACTOR_TYPES as readonly string[]).includes(a.type)) {
                errors.push(`${prefix}.type 必须是 ${LEVEL_ACTOR_TYPES.join(' / ')} 之一`);
            }
            if (typeof a.spawnSec !== 'number' || !Number.isFinite(a.spawnSec) || a.spawnSec < 0) {
                errors.push(`${prefix}.spawnSec 必须是大于等于 0 的有限数字`);
            }
            if (a.side !== undefined && a.side !== 'left' && a.side !== 'right') {
                errors.push(`${prefix}.side 必须是 'left' 或 'right'`);
            }
            if (a.pos !== undefined) {
                validatePercentPos(a.pos, `${prefix}.pos`, 0, 100, 0, 100, errors);
            }
            if (a.repeatSec !== undefined && (typeof a.repeatSec !== 'number' || !Number.isFinite(a.repeatSec) || a.repeatSec <= 0)) {
                errors.push(`${prefix}.repeatSec 必须是大于 0 的有限数字`);
            }
            if (a.params !== undefined && !isPlainObject(a.params)) {
                errors.push(`${prefix}.params 必须是对象`);
            }
        }
    }

    if (errors.length > 0) {
        return { valid: false, errors, level: null };
    }

    // 校验通过后返回结构稳定的 LevelData
    const typed = raw as unknown as LevelData;
    const normalized: LevelData = {
        id: typed.id.trim(),
        title: typed.title.trim(),
        durationSec: typed.durationSec,
        type: typed.type as LevelType,
        rings: typed.rings.map((r) => ({
            kind: r.kind,
            ...(r.kind === 'normal' ? { color: r.color } : {}),
            pos: r.pos === 'random' ? 'random' : { xPct: r.pos.xPct, yPct: r.pos.yPct },
            ...(r.angleDeg !== undefined ? { angleDeg: r.angleDeg } : {}),
            ...(r.trappedBy !== undefined ? { trappedBy: r.trappedBy } : {}),
        })),
        mechanisms: typed.mechanisms.map((m) => ({
            type: m.type as LevelMechanismType,
            ...(m.pos ? { pos: { xPct: m.pos.xPct, yPct: m.pos.yPct } } : {}),
            ...(m.params ? { params: { ...m.params } } : {}),
        })),
        actors: typed.actors.map((a) => ({
            type: a.type as LevelActorType,
            spawnSec: a.spawnSec,
            ...(a.side ? { side: a.side } : {}),
            ...(a.pos ? { pos: { xPct: a.pos.xPct, yPct: a.pos.yPct } } : {}),
            ...(a.repeatSec !== undefined ? { repeatSec: a.repeatSec } : {}),
            ...(a.params ? { params: { ...a.params } } : {}),
        })),
        seed: typed.seed,
        ...(typed.narrative ? { narrative: { ...typed.narrative } } : {}),
        ...(typed.note !== undefined ? { note: typed.note } : {}),
        ...(typed.pillarEnergy ? { pillarEnergy: { ...typed.pillarEnergy } } : {}),
        ...(typed.classifyColors
            ? {
                  classifyColors: {
                      left: [typed.classifyColors.left[0], typed.classifyColors.left[1]],
                      right: [typed.classifyColors.right[0], typed.classifyColors.right[1]],
                  },
              }
            : {}),
    };

    return { valid: true, errors: [], level: normalized };
}
