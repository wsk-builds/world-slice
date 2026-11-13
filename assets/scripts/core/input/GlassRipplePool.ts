import { GameConst } from '../../config/GameConst';

export interface GlassRippleItem {
    active: boolean;
    x: number;
    y: number;
    ageSec: number;
    durationSec: number;
    startRadius: number;
    endRadius: number;
    hitMatched: boolean;
}

export interface ClippedSegmentOut {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

/**
 * Liang-Barsky 矩形线段裁剪（零对象分配）：
 * 将线段 (x0, y0)-(x1, y1) 严格裁剪到 [minX, maxX] × [minY, maxY] 内，
 * 若完全位于矩形外则返回 false。
 */
export function clipSegmentToRect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    out: ClippedSegmentOut,
): boolean {
    const dx = x1 - x0;
    const dy = y1 - y0;
    let t0 = 0;
    let t1 = 1;

    // 左边界: -dx * t <= x0 - minX
    if (dx === 0) {
        if (x0 < minX || x0 > maxX) {
            return false;
        }
    } else {
        const invDx = 1 / dx;
        const tLeft = (minX - x0) * invDx;
        const tRight = (maxX - x0) * invDx;
        const enterX = dx > 0 ? tLeft : tRight;
        const exitX = dx > 0 ? tRight : tLeft;
        if (enterX > t0) {
            t0 = enterX;
        }
        if (exitX < t1) {
            t1 = exitX;
        }
        if (t0 > t1) {
            return false;
        }
    }

    if (dy === 0) {
        if (y0 < minY || y0 > maxY) {
            return false;
        }
    } else {
        const invDy = 1 / dy;
        const tBottom = (minY - y0) * invDy;
        const tTop = (maxY - y0) * invDy;
        const enterY = dy > 0 ? tBottom : tTop;
        const exitY = dy > 0 ? tTop : tBottom;
        if (enterY > t0) {
            t0 = enterY;
        }
        if (exitY < t1) {
            t1 = exitY;
        }
        if (t0 > t1) {
            return false;
        }
    }

    out.x0 = x0 + t0 * dx;
    out.y0 = y0 + t0 * dy;
    out.x1 = x0 + t1 * dx;
    out.y1 = y0 + t1 * dy;
    return true;
}

/**
 * 敲玻璃扩散震纹固定容量对象池（零 GC，支持快速连点同时存在多圈震纹）。
 */
export class GlassRipplePool {
    readonly items: GlassRippleItem[];

    constructor(maxCount: number = GameConst.glassTapRipplePoolSize) {
        const size = Math.max(1, Math.floor(maxCount));
        this.items = new Array<GlassRippleItem>(size);
        for (let i = 0; i < size; i++) {
            this.items[i] = {
                active: false,
                x: 0,
                y: 0,
                ageSec: 0,
                durationSec: GameConst.glassTapRippleDurationSec,
                startRadius: GameConst.glassTapRippleStartRadiusPx,
                endRadius: GameConst.glassTapRippleEndRadiusPx,
                hitMatched: false,
            };
        }
    }

    get activeCount(): number {
        let count = 0;
        for (let i = 0; i < this.items.length; i++) {
            if (this.items[i].active) {
                count++;
            }
        }
        return count;
    }

    spawn(x: number, y: number, hitMatched = false): void {
        let slot: GlassRippleItem | null = null;
        let oldest: GlassRippleItem = this.items[0];

        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            if (!item.active) {
                slot = item;
                break;
            }
            if (item.ageSec > oldest.ageSec) {
                oldest = item;
            }
        }

        const target = slot ?? oldest;
        target.active = true;
        target.x = x;
        target.y = y;
        target.ageSec = 0;
        target.durationSec = GameConst.glassTapRippleDurationSec;
        target.startRadius = GameConst.glassTapRippleStartRadiusPx;
        target.endRadius = hitMatched
            ? GameConst.glassTapRippleEndRadiusPx * 1.12
            : GameConst.glassTapRippleEndRadiusPx;
        target.hitMatched = hitMatched;
    }

    step(dt: number): void {
        if (!Number.isFinite(dt) || dt <= 0) {
            return;
        }
        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            if (!item.active) {
                continue;
            }
            item.ageSec += dt;
            if (item.ageSec >= item.durationSec) {
                item.active = false;
            }
        }
    }

    clear(): void {
        for (let i = 0; i < this.items.length; i++) {
            this.items[i].active = false;
            this.items[i].ageSec = 0;
        }
    }
}
