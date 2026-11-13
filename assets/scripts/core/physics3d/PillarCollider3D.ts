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

    tipRadius = 5.5;
    rootRadius = 11;
    /** 十字卡托碰撞半宽（明显短于视觉半宽 visualCrossHalfWidth，防止未入柱圆环卡在卡托翼尖） */
    crossHalfWidth = 34;
    /** 十字卡托碰撞半深（明显短于视觉半深 visualCrossHalfDepth） */
    crossHalfDepth = 30;
    visualCrossHalfWidth = 47;
    visualCrossHalfDepth = 42;

    friction = 0.05;
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
        this.visualCrossHalfWidth = geom.pillarBaseWidth * 0.5;
        this.visualCrossHalfDepth = geom.pillarCrossDepth * 0.5;
        this.crossHalfWidth = geom.pillarColliderBaseWidth * 0.5;
        this.crossHalfDepth = geom.pillarColliderCrossDepth * 0.5;

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

        // 2. 下段悬空收尖尾椎（仅保留竖向圆滑鼓肚轴心，不伸出任何横向胶囊尖刺，彻底杜绝竖立圆环像挂钩一样挂在卡托翅膀上）
        const tailTipR = 2.5;
        const hubRadius = Math.min(this.crossHalfWidth * 0.65, this.rootRadius * 1.25);
        this.segments.push({
            ax: x,
            ay: tailBottomY + tailTipR,
            az: 0,
            bx: x,
            by: this.crossCenterY,
            bz: 0,
            radiusA: tailTipR,
            radiusB: hubRadius,
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
