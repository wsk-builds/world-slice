import { GameConst } from '../config/GameConst';
import { LayoutRect } from '../config/LayoutConfig';
import { Point2D, TankSpace } from '../config/TankSpace';

/**
 * 计算水缸四面外墙矩形与左右向内圆弧底角折线（纯 TS，不依赖 cc）。
 * 坐标系：缸坐标（原点在缸内壁左下角，x 向右，y 向上）。
 */
export interface TankGeometryData {
    /** 缸内净宽、净高 */
    width: number;
    height: number;
    /** 四面直墙矩形（位于内壁外侧） */
    wallRects: LayoutRect[];
    /** 左下角圆弧折线点（从左壁 (0, r) 沿圆弧到缸底 (r, 0)） */
    leftCornerArc: Point2D[];
    /** 右下角圆弧折线点（从缸底 (width - r, 0) 沿圆弧到右壁 (width, r)） */
    rightCornerArc: Point2D[];
    /** 近似圆弧的多段凸四边形列表（逆时针 CCW 顶点序，供 PolygonCollider2D 使用） */
    cornerStrips: Point2D[][];
}

/** 计算二维叉积 (b - a) × (c - a) */
export function cross2D(a: Point2D, b: Point2D, c: Point2D): number {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** 判断简单多边形是否为逆时针且严格凸 */
export function isConvexCCW(pts: readonly Point2D[]): boolean {
    if (pts.length < 3) {
        return false;
    }
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const c = pts[(i + 2) % pts.length];
        if (cross2D(a, b, c) <= 1e-6) {
            return false;
        }
    }
    return true;
}

/** 生成单侧圆弧点列及对应的外推凸四边形条带 */
function buildCornerStrips(
    cx: number,
    cy: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    segments: number,
    stripThickness: number,
): { arc: Point2D[]; strips: Point2D[][] } {
    const arc: Point2D[] = [];
    const outer: Point2D[] = [];

    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const theta = startAngle + (endAngle - startAngle) * t;
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        arc.push({
            x: cx + radius * cos,
            y: cy + radius * sin,
        });
        outer.push({
            x: cx + (radius + stripThickness) * cos,
            y: cy + (radius + stripThickness) * sin,
        });
    }

    const strips: Point2D[][] = [];
    for (let i = 0; i < segments; i++) {
        // 逆时针顺序：内弧起点 -> 外推起点 -> 外推终点 -> 内弧终点
        strips.push([arc[i], outer[i], outer[i + 1], arc[i + 1]]);
    }

    return { arc, strips };
}

/** 生成水缸边界与底角几何数据 */
export function buildTankGeometry(
    width = TankSpace.width,
    height = TankSpace.height,
    wallThickness = GameConst.tankWallThickness,
    cornerRadius = GameConst.tankCornerRadius,
    segments = GameConst.tankCornerSegments,
    stripThickness = GameConst.tankCornerStripThickness,
): TankGeometryData {
    const r = Math.min(cornerRadius, width / 2, height / 2);

    // 四面直墙：上下贯穿包角，防止极端高速穿透角缝
    const wallRects: LayoutRect[] = [
        // 底墙
        { x: -wallThickness, y: -wallThickness, width: width + wallThickness * 2, height: wallThickness },
        // 顶墙
        { x: -wallThickness, y: height, width: width + wallThickness * 2, height: wallThickness },
        // 左墙
        { x: -wallThickness, y: 0, width: wallThickness, height },
        // 右墙
        { x: width, y: 0, width: wallThickness, height },
    ];

    // 左下角：圆心 (r, r)，角度 π (180°) -> 1.5π (270°)
    const left = buildCornerStrips(r, r, r, Math.PI, Math.PI * 1.5, segments, stripThickness);
    // 右下角：圆心 (width - r, r)，角度 1.5π (270°) -> 2π (360°)
    const right = buildCornerStrips(width - r, r, r, Math.PI * 1.5, Math.PI * 2, segments, stripThickness);

    return {
        width,
        height,
        wallRects,
        leftCornerArc: left.arc,
        rightCornerArc: right.arc,
        cornerStrips: [...left.strips, ...right.strips],
    };
}
