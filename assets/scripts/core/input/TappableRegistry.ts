import { GameConst } from '../../config/GameConst';

export interface TappablePoint {
    x: number;
    y: number;
}

export type TappableHitShape =
    | { kind: 'circle'; radius: number }
    | { kind: 'rect'; width: number; height: number };

export interface TappableTapEvent {
    id: string;
    tapX: number;
    tapY: number;
    targetX: number;
    targetY: number;
    distance: number;
}

export interface TappableHitMatch {
    readonly id: string;
    readonly targetX: number;
    readonly targetY: number;
    readonly distance: number;
}

export interface TappableTargetSpec {
    /** 可选固定 ID，未提供时自动生成 */
    id?: string;
    /** 图形中心坐标（缸坐标） */
    position?: TappablePoint;
    /** 动态位置读取函数（对象会移动时传入） */
    getPosition?: () => TappablePoint | null | undefined;
    /** 圆形图形半径（与 size / shape 三选一） */
    radius?: number;
    /** 矩形图形尺寸（与 radius / shape 三选一） */
    size?: { width: number; height: number };
    /** 显式图形形状 */
    shape?: TappableHitShape;
    /** 命中范围相对图形尺寸的放大倍率，默认使用 GameConst.tappableHitScale */
    hitScale?: number;
    /** 启用开关（静态布尔或动态判定函数，默认 true） */
    enabled?: boolean | (() => boolean);
    /** 命中回调 */
    onTap: (event: TappableTapEvent) => void;
}

interface TappableEntry {
    readonly id: string;
    readonly spec: TappableTargetSpec;
    enabledOverride: boolean | null;
}

function resolveShape(spec: TappableTargetSpec): TappableHitShape | null {
    if (spec.shape) {
        if (spec.shape.kind === 'circle') {
            return spec.shape.radius > 0 ? spec.shape : null;
        }
        return spec.shape.width > 0 && spec.shape.height > 0 ? spec.shape : null;
    }
    if (typeof spec.radius === 'number' && Number.isFinite(spec.radius) && spec.radius > 0) {
        return { kind: 'circle', radius: spec.radius };
    }
    if (
        spec.size &&
        Number.isFinite(spec.size.width) &&
        Number.isFinite(spec.size.height) &&
        spec.size.width > 0 &&
        spec.size.height > 0
    ) {
        return { kind: 'rect', width: spec.size.width, height: spec.size.height };
    }
    return null;
}

function resolveHitScale(spec: TappableTargetSpec): number {
    const raw = spec.hitScale ?? GameConst.tappableHitScale;
    return Number.isFinite(raw) && raw > 0 ? raw : GameConst.tappableHitScale;
}

function resolvePosition(spec: TappableTargetSpec): TappablePoint | null {
    const pt = spec.getPosition ? spec.getPosition() : spec.position;
    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
        return null;
    }
    return pt;
}

function isEntryEnabled(entry: TappableEntry): boolean {
    if (entry.enabledOverride === false) {
        return false;
    }
    const specEnabled = entry.spec.enabled;
    if (typeof specEnabled === 'function') {
        return Boolean(specEnabled());
    }
    if (typeof specEnabled === 'boolean' && entry.enabledOverride === null) {
        return specEnabled;
    }
    return true;
}

/**
 * 敲玻璃可点对象登记表（纯逻辑，无引擎依赖，T021）：
 * - 命中范围按常量倍率（默认 GameConst.tappableHitScale = 1.4）相对图形本身放大；
 * - 一次点击命中多个对象时，只触发离点击位置最近的那个对象；
 * - 支持静态/动态坐标、圆形/矩形尺寸、启用/禁用与注销。
 */
export class TappableRegistry {
    private readonly entries: TappableEntry[] = [];
    private nextAutoId = 1;

    get count(): number {
        return this.entries.length;
    }

    register(spec: TappableTargetSpec): string {
        const id = spec.id && spec.id.length > 0 ? spec.id : `tappable_${this.nextAutoId++}`;
        const existingIdx = this.entries.findIndex((item) => item.id === id);
        const entry: TappableEntry = {
            id,
            spec,
            enabledOverride: null,
        };
        if (existingIdx >= 0) {
            this.entries[existingIdx] = entry;
        } else {
            this.entries.push(entry);
        }
        return id;
    }

    unregister(id: string): boolean {
        const idx = this.entries.findIndex((item) => item.id === id);
        if (idx < 0) {
            return false;
        }
        this.entries.splice(idx, 1);
        return true;
    }

    has(id: string): boolean {
        return this.entries.some((item) => item.id === id);
    }

    setEnabled(id: string, enabled: boolean): boolean {
        const entry = this.entries.find((item) => item.id === id);
        if (!entry) {
            return false;
        }
        entry.enabledOverride = enabled;
        return true;
    }

    isEnabled(id: string): boolean {
        const entry = this.entries.find((item) => item.id === id);
        return entry ? isEntryEnabled(entry) : false;
    }

    clear(): void {
        this.entries.length = 0;
    }

    /** 查询放大后命中范围内离点击点最近的对象，不触发回调 */
    findNearestHit(tapPt: TappablePoint): TappableHitMatch | null {
        const resolved = this.resolveNearestEntry(tapPt);
        if (!resolved) {
            return null;
        }
        return {
            id: resolved.entry.id,
            targetX: resolved.targetX,
            targetY: resolved.targetY,
            distance: resolved.distance,
        };
    }

    /** 分发一次敲玻璃点击：仅触发放大命中范围内离点击点最近的那个对象 */
    dispatchTap(tapPt: TappablePoint): TappableHitMatch | null {
        const resolved = this.resolveNearestEntry(tapPt);
        if (!resolved) {
            return null;
        }
        const match: TappableHitMatch = {
            id: resolved.entry.id,
            targetX: resolved.targetX,
            targetY: resolved.targetY,
            distance: resolved.distance,
        };
        resolved.entry.spec.onTap({
            id: match.id,
            tapX: tapPt.x,
            tapY: tapPt.y,
            targetX: match.targetX,
            targetY: match.targetY,
            distance: match.distance,
        });
        return match;
    }

    private resolveNearestEntry(tapPt: TappablePoint): {
        entry: TappableEntry;
        targetX: number;
        targetY: number;
        distance: number;
    } | null {
        if (!tapPt || !Number.isFinite(tapPt.x) || !Number.isFinite(tapPt.y)) {
            return null;
        }

        let best: {
            entry: TappableEntry;
            targetX: number;
            targetY: number;
            distance: number;
        } | null = null;

        for (let i = 0; i < this.entries.length; i++) {
            const entry = this.entries[i];
            if (!isEntryEnabled(entry)) {
                continue;
            }
            const shape = resolveShape(entry.spec);
            const pos = resolvePosition(entry.spec);
            if (!shape || !pos) {
                continue;
            }
            const scale = resolveHitScale(entry.spec);
            const dx = tapPt.x - pos.x;
            const dy = tapPt.y - pos.y;
            const dist = Math.hypot(dx, dy);

            let inside = false;
            if (shape.kind === 'circle') {
                inside = dist <= shape.radius * scale;
            } else {
                const halfW = shape.width * scale * 0.5;
                const halfH = shape.height * scale * 0.5;
                inside = Math.abs(dx) <= halfW && Math.abs(dy) <= halfH;
            }
            if (!inside) {
                continue;
            }

            if (!best || dist < best.distance) {
                best = {
                    entry,
                    targetX: pos.x,
                    targetY: pos.y,
                    distance: dist,
                };
            }
        }

        return best;
    }
}
