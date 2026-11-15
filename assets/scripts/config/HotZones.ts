import { Point2D, TankSpace } from './TankSpace';

/** 内屏左右拇指热区默认宽度占比（%，T025 真机握持测量前暂定 22%） */
export const DEFAULT_HOT_ZONE_WIDTH_PCT = 22;
export const MIN_HOT_ZONE_WIDTH_PCT = 10;
export const MAX_HOT_ZONE_WIDTH_PCT = 45;

export type HotZoneSide = 'left' | 'right';
export type HotZoneCoordSpace = 'px' | 'pct';

export interface HotZoneRect {
    readonly side: HotZoneSide;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface HotZoneQueryOptions {
    space?: HotZoneCoordSpace;
    widthPct?: number;
    tankWidth?: number;
    tankHeight?: number;
}

export interface HotZoneClampOptions extends HotZoneQueryOptions {
    /** 强制夹入指定一侧热区；未传时自动选择离点更近的一侧 */
    side?: HotZoneSide;
    /** 与热区/内屏边界的内缩边距（默认 0） */
    padding?: number;
}

export type HotZoneChangeListener = (widthPct: number) => void;

let currentWidthPct = DEFAULT_HOT_ZONE_WIDTH_PCT;
const changeListeners: HotZoneChangeListener[] = [];

/** 夹紧热区宽度百分比到合法范围 [10, 45] */
export function clampHotZoneWidthPct(widthPct: number): number {
    if (!Number.isFinite(widthPct)) {
        return DEFAULT_HOT_ZONE_WIDTH_PCT;
    }
    return Math.min(MAX_HOT_ZONE_WIDTH_PCT, Math.max(MIN_HOT_ZONE_WIDTH_PCT, widthPct));
}

export function getHotZoneWidthPct(): number {
    return currentWidthPct;
}

export function setHotZoneWidthPct(widthPct: number): number {
    const next = clampHotZoneWidthPct(widthPct);
    if (next !== currentWidthPct) {
        currentWidthPct = next;
        const snapshot = changeListeners.slice();
        for (let i = 0; i < snapshot.length; i++) {
            snapshot[i](currentWidthPct);
        }
    }
    return currentWidthPct;
}

export function resetHotZoneWidthPct(): number {
    return setHotZoneWidthPct(DEFAULT_HOT_ZONE_WIDTH_PCT);
}

export function onHotZoneChanged(cb: HotZoneChangeListener): () => void {
    if (!changeListeners.includes(cb)) {
        changeListeners.push(cb);
    }
    return () => {
        offHotZoneChanged(cb);
    };
}

export function offHotZoneChanged(cb: HotZoneChangeListener): void {
    const idx = changeListeners.indexOf(cb);
    if (idx >= 0) {
        changeListeners.splice(idx, 1);
    }
}

/** 计算单侧热区在缸像素坐标下的宽度 */
export function getHotZoneWidthPx(
    widthPct: number = currentWidthPct,
    tankWidth: number = TankSpace.width,
): number {
    const safeWidth = Number.isFinite(tankWidth) && tankWidth > 0 ? tankWidth : TankSpace.width;
    return (clampHotZoneWidthPct(widthPct) / 100) * safeWidth;
}

/** 获取左右两块热区矩形（缸像素坐标，原点在内屏左下角） */
export function getHotZoneRects(
    widthPct: number = currentWidthPct,
    tankWidth: number = TankSpace.width,
    tankHeight: number = TankSpace.height,
): [HotZoneRect, HotZoneRect] {
    const safeWidth = Number.isFinite(tankWidth) && tankWidth > 0 ? tankWidth : TankSpace.width;
    const safeHeight = Number.isFinite(tankHeight) && tankHeight > 0 ? tankHeight : TankSpace.height;
    const zoneW = getHotZoneWidthPx(widthPct, safeWidth);
    return [
        { side: 'left', x: 0, y: 0, width: zoneW, height: safeHeight },
        { side: 'right', x: safeWidth - zoneW, y: 0, width: zoneW, height: safeHeight },
    ];
}

/** 获取左右两块热区矩形（百分比坐标 0–100） */
export function getHotZonePctRects(widthPct: number = currentWidthPct): [HotZoneRect, HotZoneRect] {
    const clampedPct = clampHotZoneWidthPct(widthPct);
    return [
        { side: 'left', x: 0, y: 0, width: clampedPct, height: 100 },
        { side: 'right', x: 100 - clampedPct, y: 0, width: clampedPct, height: 100 },
    ];
}

function resolveBounds(spaceOrOptions?: HotZoneCoordSpace | HotZoneQueryOptions): {
    maxW: number;
    maxH: number;
    zoneW: number;
} {
    const opts: HotZoneQueryOptions =
        typeof spaceOrOptions === 'string' ? { space: spaceOrOptions } : (spaceOrOptions ?? {});
    const space = opts.space ?? 'px';
    const widthPct = clampHotZoneWidthPct(opts.widthPct ?? currentWidthPct);

    if (space === 'pct') {
        return {
            maxW: 100,
            maxH: 100,
            zoneW: widthPct,
        };
    }

    const maxW = Number.isFinite(opts.tankWidth) && opts.tankWidth! > 0 ? opts.tankWidth! : TankSpace.width;
    const maxH = Number.isFinite(opts.tankHeight) && opts.tankHeight! > 0 ? opts.tankHeight! : TankSpace.height;
    return {
        maxW,
        maxH,
        zoneW: (widthPct / 100) * maxW,
    };
}

/** 判断坐标点落在哪一侧热区（'left' | 'right' | null），默认按缸像素坐标判断 */
export function whichHotZone(
    pt: Point2D,
    spaceOrOptions?: HotZoneCoordSpace | HotZoneQueryOptions,
): HotZoneSide | null {
    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
        return null;
    }
    const { maxW, maxH, zoneW } = resolveBounds(spaceOrOptions);
    if (pt.y < 0 || pt.y > maxH) {
        return null;
    }
    if (pt.x >= 0 && pt.x <= zoneW) {
        return 'left';
    }
    if (pt.x >= maxW - zoneW && pt.x <= maxW) {
        return 'right';
    }
    return null;
}

/** 判断坐标点是否位于左右任一拇指热区内，默认按缸像素坐标判断 */
export function inHotZone(
    pt: Point2D,
    spaceOrOptions?: HotZoneCoordSpace | HotZoneQueryOptions,
): boolean {
    return whichHotZone(pt, spaceOrOptions) !== null;
}

/**
 * 将点夹紧到左右拇指热区及内屏高度内（默认按缸像素坐标）。
 * 靠近左侧夹到左热区内，靠近右侧夹到右热区内。
 */
export function clampToHotZone(
    pt: Point2D,
    spaceOrOptions?: HotZoneCoordSpace | HotZoneClampOptions,
): Point2D {
    const opts: HotZoneClampOptions =
        typeof spaceOrOptions === 'string' ? { space: spaceOrOptions } : (spaceOrOptions ?? {});
    const { maxW, maxH, zoneW } = resolveBounds(opts);

    const rawPad = opts.padding;
    const safePad = Number.isFinite(rawPad) && rawPad! > 0 ? rawPad! : 0;
    const padX = Math.min(safePad, zoneW * 0.5);
    const padY = Math.min(safePad, maxH * 0.5);

    const safeX = Number.isFinite(pt?.x) ? pt.x : 0;
    const safeY = Number.isFinite(pt?.y) ? pt.y : 0;

    const side: HotZoneSide = opts.side ?? (safeX <= maxW * 0.5 ? 'left' : 'right');
    const minX = side === 'left' ? padX : maxW - zoneW + padX;
    const maxX = side === 'left' ? zoneW - padX : maxW - padX;
    const clampedX = Math.min(maxX, Math.max(minX, safeX));
    const clampedY = Math.min(maxH - padY, Math.max(padY, safeY));

    return { x: clampedX, y: clampedY };
}

/** 拇指热区统一读写与几何查询入口（纯逻辑，无引擎依赖） */
export const HotZones = {
    defaultWidthPct: DEFAULT_HOT_ZONE_WIDTH_PCT,
    minWidthPct: MIN_HOT_ZONE_WIDTH_PCT,
    maxWidthPct: MAX_HOT_ZONE_WIDTH_PCT,
    get widthPct(): number {
        return currentWidthPct;
    },
    setWidthPct: setHotZoneWidthPct,
    reset: resetHotZoneWidthPct,
    getWidthPx: getHotZoneWidthPx,
    getRects: getHotZoneRects,
    getPctRects: getHotZonePctRects,
    whichHotZone,
    inHotZone,
    clampToHotZone,
    onChange: onHotZoneChanged,
    offChange: offHotZoneChanged,
};
