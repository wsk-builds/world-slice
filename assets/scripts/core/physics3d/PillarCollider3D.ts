import { RingPillarGeometry } from '../../config/GameConst';

/** 线性渐变半径的三维圆台/胶囊线段（精确光滑包络，无多面体棱边卡顿） */
export interface TaperedCapsule3D {
    ax: number;
    ay: number;
    az: number;
    bx: number;
    by: number;
    bz: number;
    radiusA: number;
    radiusB: number;
}

/**
 * 三段式锥形十字柱的 3D 静态碰撞几何（纯逻辑，坐标单位为缸内像素）：
 * 1. 上段上尖下粗圆锥杆（圆润半球柱尖 -> 根部变粗）
 * 2. 中下段十字四翼卡托（+X/-X 横翼 + +Z/-Z 纵翼，翼尖收细）
 * 3. 下段悬空收尖尾椎
 */
export class PillarCollider3D {
    x = 0;
    tailBottomY = 0;
    z = 0;

    crossBottomY = 0;
    crossCenterY = 0;
    baseTopY = 0;
    tipY = 0;

    tipRadius = 7;
    rootRadius = 14;
    crossHalfWidth = 66;
    crossHalfDepth = 55;

    friction = 0.16;
    restitution = 0.06;

    readonly segments: TaperedCapsule3D[] = [];

    constructor(x: number, tailBottomY: number, geom: RingPillarGeometry) {
        this.updateLayout(x, tailBottomY, geom);
    }

    updateLayout(x: number, tailBottomY: number, geom: RingPillarGeometry): void {
        this.x = x;
        this.tailBottomY = tailBottomY;
        this.z = 0;

        this.crossBottomY = tailBottomY + geom.pillarTailHeight;
        this.baseTopY = this.crossBottomY + geom.pillarBaseHeight;
        this.crossCenterY = 0.5 * (this.crossBottomY + this.baseTopY);
        this.tipY = this.baseTopY + geom.pillarHeight;

        this.tipRadius = geom.pillarTipWidth * 0.5;
        this.rootRadius = geom.pillarRootWidth * 0.5;
        this.crossHalfWidth = geom.pillarBaseWidth * 0.5;
        this.crossHalfDepth = geom.pillarCrossDepth * 0.5;

        const wingCenterR = geom.pillarBaseHeight * 0.5;
        const wingTipR = Math.max(4, geom.pillarBaseHeight * 0.22);

        this.segments.length = 0;

        // 1. 上段锥形柱杆（柱尖圆球中心位于 tipY - tipRadius，保证视觉柱尖最高点对齐 tipY）
        this.segments.push({
            ax: x,
            ay: this.crossCenterY,
            az: 0,
            bx: x,
            by: Math.max(this.crossCenterY + 4, this.tipY - this.tipRadius),
            bz: 0,
            radiusA: this.rootRadius,
            radiusB: this.tipRadius,
        });

        // 2. 下段悬空收尖尾椎
        const tailTipR = 2.5;
        this.segments.push({
            ax: x,
            ay: tailBottomY + tailTipR,
            az: 0,
            bx: x,
            by: this.crossCenterY,
            bz: 0,
            radiusA: tailTipR,
            radiusB: this.rootRadius * 0.8,
        });

        // 3. 十字横翼（左右各一段从中心向翼尖收细的圆润棱翼，顶面在中心处对齐 baseTopY）
        const xSpan = Math.max(wingTipR + 2, this.crossHalfWidth - wingTipR);
        this.segments.push({
            ax: x,
            ay: this.crossCenterY,
            az: 0,
            bx: x - xSpan,
            by: this.crossCenterY,
            bz: 0,
            radiusA: wingCenterR,
            radiusB: wingTipR,
        });
        this.segments.push({
            ax: x,
            ay: this.crossCenterY,
            az: 0,
            bx: x + xSpan,
            by: this.crossCenterY,
            bz: 0,
            radiusA: wingCenterR,
            radiusB: wingTipR,
        });

        // 4. 十字纵翼（前后各一段，兜住任何 3D 翻滚姿态落下的圆环）
        const zSpan = Math.max(wingTipR + 2, this.crossHalfDepth - wingTipR);
        this.segments.push({
            ax: x,
            ay: this.crossCenterY,
            az: 0,
            bx: x,
            by: this.crossCenterY,
            bz: -zSpan,
            radiusA: wingCenterR,
            radiusB: wingTipR,
        });
        this.segments.push({
            ax: x,
            ay: this.crossCenterY,
            az: 0,
            bx: x,
            by: this.crossCenterY,
            bz: zSpan,
            radiusA: wingCenterR,
            radiusB: wingTipR,
        });
    }

    /** 查询缸坐标高度 y 处锥形柱杆的半径（供入柱判定与锁定微倾限位使用） */
    shaftRadiusAtY(y: number): number {
        if (y <= this.baseTopY) {
            return this.rootRadius;
        }
        if (y >= this.tipY) {
            return this.tipRadius;
        }
        const t = (y - this.baseTopY) / Math.max(1, this.tipY - this.baseTopY);
        return this.rootRadius + (this.tipRadius - this.rootRadius) * t;
    }
}
