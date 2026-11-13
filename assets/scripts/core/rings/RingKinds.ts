/**
 * 圈（锁脉环）的种类、物理倍率与配对规则（纯逻辑，不依赖引擎）。
 * 规则依据 GDD §3.2、§3.4、§4.1。
 */

export type RingColor = 'red' | 'green' | 'blue' | 'orange';

export type RingKind = 'normal' | 'gold' | 'iron' | 'wood';

export interface RingSpec {
    kind: RingKind;
    /** 仅 normal 普通圈使用；特殊圈不区分颜色 */
    color?: RingColor;
}

export interface RingKindConfig {
    kind: RingKind;
    /** 尺寸倍率（相对于中号圈外径 = 缸宽 / 7.5） */
    sizeScale: number;
    /** 下沉加速度倍率（相对于普通圈基准下沉加速度） */
    sinkScale: number;
    /** 水流跟随度（越大越容易被水流推动，越小越沉稳） */
    flowFollow: number;
}

export const RING_COLORS: readonly RingColor[] = ['red', 'green', 'blue', 'orange'];

export const RING_KIND_CONFIGS: Readonly<Record<RingKind, RingKindConfig>> = {
    normal: {
        kind: 'normal',
        sizeScale: 1.0,
        sinkScale: 1.0,
        flowFollow: 1.0,
    },
    gold: {
        kind: 'gold',
        sizeScale: 0.8,
        sinkScale: 1.0,
        flowFollow: 1.0,
    },
    iron: {
        kind: 'iron',
        sizeScale: 1.0,
        sinkScale: 2.2,
        flowFollow: 0.65,
    },
    wood: {
        kind: 'wood',
        sizeScale: 1.0,
        sinkScale: 0.45,
        flowFollow: 1.35,
    },
};

/** 调试数字键 1–7 对应的圈预设 */
export const DEBUG_RING_SLOTS: readonly RingSpec[] = [
    { kind: 'normal', color: 'red' },
    { kind: 'normal', color: 'green' },
    { kind: 'normal', color: 'blue' },
    { kind: 'normal', color: 'orange' },
    { kind: 'gold' },
    { kind: 'iron' },
    { kind: 'wood' },
];

/** 获取圈种对应的尺寸、下沉与跟随配置 */
export function getRingKindConfig(specOrKind: RingSpec | RingKind): RingKindConfig {
    const kind = typeof specOrKind === 'string' ? specOrKind : specOrKind.kind;
    return RING_KIND_CONFIGS[kind];
}

/**
 * 判断两个圈是否属于同一款（用于柱上消除判定与漏斗匹配）：
 * - 普通圈：比较颜色
 * - 特殊圈（小金环、铁圈、木圈）：只比较种类，不看颜色
 */
export function sameKind(a: RingSpec, b: RingSpec): boolean {
    if (a.kind !== b.kind) {
        return false;
    }
    if (a.kind === 'normal') {
        return a.color !== undefined && a.color === b.color;
    }
    return true;
}

const COLOR_LABEL: Record<RingColor, string> = {
    red: '红圈',
    green: '绿圈',
    blue: '蓝圈',
    orange: '橙圈',
};

const KIND_LABEL: Record<Exclude<RingKind, 'normal'>, string> = {
    gold: '小金环',
    iron: '铁圈',
    wood: '木圈',
};

/** 返回圈种的简短中文名（用于调试输出） */
export function ringSpecLabel(spec: RingSpec): string {
    if (spec.kind === 'normal') {
        return spec.color ? COLOR_LABEL[spec.color] : '普通圈';
    }
    return KIND_LABEL[spec.kind];
}
