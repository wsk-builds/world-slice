import { describe, expect, it } from 'vitest';
import { GameConst } from '../../assets/scripts/config/GameConst';
import { TankSpace } from '../../assets/scripts/config/TankSpace';
import { buildTankGeometry, isConvexCCW } from '../../assets/scripts/game/TankGeometry';

describe('TankGeometry', () => {
    it('四面墙位于缸内壁外侧且紧贴内壁', () => {
        const geom = buildTankGeometry();
        expect(geom.wallRects).toHaveLength(4);

        const [bottom, top, left, right] = geom.wallRects;
        expect(bottom.y + bottom.height).toBe(0);
        expect(top.y).toBe(TankSpace.height);
        expect(left.x + left.width).toBe(0);
        expect(right.x).toBe(TankSpace.width);
    });

    it('左右底角圆弧折线对称、精确落在圆弧上，且条带多边形全部严格凸 CCW', () => {
        const geom = buildTankGeometry();
        const segs = GameConst.tankCornerSegments;
        const r = GameConst.tankCornerRadius;

        expect(geom.leftCornerArc).toHaveLength(segs + 1);
        expect(geom.rightCornerArc).toHaveLength(segs + 1);
        expect(geom.cornerStrips).toHaveLength(segs * 2);

        // 左下角从 (0, r) 到 (r, 0)，圆心在 (r, r)
        expect(geom.leftCornerArc[0].x).toBeCloseTo(0, 5);
        expect(geom.leftCornerArc[0].y).toBeCloseTo(r, 5);
        expect(geom.leftCornerArc[segs].x).toBeCloseTo(r, 5);
        expect(geom.leftCornerArc[segs].y).toBeCloseTo(0, 5);

        for (let i = 0; i <= segs; i++) {
            const lp = geom.leftCornerArc[i];
            const rp = geom.rightCornerArc[segs - i];
            expect(Math.hypot(lp.x - r, lp.y - r)).toBeCloseTo(r, 5);
            // 左右对称
            expect(lp.x + rp.x).toBeCloseTo(TankSpace.width, 5);
            expect(lp.y).toBeCloseTo(rp.y, 5);
        }

        for (const strip of geom.cornerStrips) {
            expect(strip).toHaveLength(4);
            expect(isConvexCCW(strip)).toBe(true);
        }
    });
});
