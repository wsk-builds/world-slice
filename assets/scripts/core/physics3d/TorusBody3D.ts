import {
    computeWorldInvInertia,
    Mat3Array,
    QuatLike,
    quatNormalize,
    quatRotateVec,
    Vec3Like,
} from './Math3D';

export type Body3DType = 'dynamic' | 'static';

export interface TorusBody3DOptions {
    id?: number;
    x: number;
    y: number;
    z?: number;
    qx?: number;
    qy?: number;
    qz?: number;
    qw?: number;
    /** 圆环中心圆主半径 R = (外径 - 管粗) / 2 */
    majorRadius: number;
    /** 圆环截面管半径 r = 管粗 / 2 */
    tubeRadius: number;
    mass?: number;
    linearDamping?: number;
    angularDamping?: number;
    friction?: number;
    restitution?: number;
    type?: Body3DType;
}

let nextBodyId = 1;

/**
 * 真 3D 标准正圆环（Torus）刚体（纯逻辑，坐标单位为缸内像素）。
 * 本地空间约定（对齐 Cocos primitives.torus）：
 * - 圆环平放在本地 X-Z 平面，圆心在 (0,0,0)，中心孔法线方向为本地 +Y (0, 1, 0)。
 * - 当绕 X 轴旋转 90° 时，正圆环正面朝向镜头 (+Z)，呈现 100% 标准正圆。
 */
export class TorusBody3D {
    readonly id: number;

    x: number;
    y: number;
    z: number;

    readonly quat: QuatLike = { x: 0, y: 0, z: 0, w: 1 };

    vx = 0;
    vy = 0;
    vz = 0;

    wx = 0;
    wy = 0;
    wz = 0;

    fx = 0;
    fy = 0;
    fz = 0;

    tx = 0;
    ty = 0;
    tz = 0;

    majorRadius: number;
    tubeRadius: number;

    linearDamping: number;
    angularDamping: number;
    friction: number;
    restitution: number;

    /** 世界空间 3x3 逆惯量张量（每子步更新） */
    readonly worldInvInertia: Mat3Array = [0, 0, 0, 0, 0, 0, 0, 0, 0];

    /** 当前子步缓存的圆环世界基向量：U(本地+X), N(本地+Y孔轴), V(本地+Z) */
    readonly basisU: Vec3Like = { x: 1, y: 0, z: 0 };
    readonly basisN: Vec3Like = { x: 0, y: 1, z: 0 };
    readonly basisV: Vec3Like = { x: 0, y: 0, z: 1 };

    private _type: Body3DType = 'dynamic';
    private _mass = 1;
    private _invMass = 1;
    private _invIx = 0;
    private _invIy = 0;
    private _invIz = 0;

    constructor(opts: TorusBody3DOptions) {
        this.id = opts.id ?? nextBodyId++;
        this.x = opts.x;
        this.y = opts.y;
        this.z = opts.z ?? 0;
        this.quat.x = opts.qx ?? 0;
        this.quat.y = opts.qy ?? 0;
        this.quat.z = opts.qz ?? 0;
        this.quat.w = opts.qw ?? 1;
        quatNormalize(this.quat);

        this.majorRadius = Math.max(4, opts.majorRadius);
        this.tubeRadius = Math.max(2, opts.tubeRadius);
        this._mass = Math.max(0.05, opts.mass ?? 1);
        this._type = opts.type ?? 'dynamic';

        this.linearDamping = Math.max(0, opts.linearDamping ?? 0.5);
        this.angularDamping = Math.max(0, opts.angularDamping ?? 4.0);
        this.friction = Math.max(0, opts.friction ?? 0.14);
        this.restitution = Math.max(0, opts.restitution ?? 0.12);

        this.recomputeMassProperties();
        this.syncDerivedState();
    }

    get type(): Body3DType {
        return this._type;
    }

    set type(v: Body3DType) {
        if (this._type === v) {
            return;
        }
        this._type = v;
        if (v === 'static') {
            this.clearVelocity();
            this.clearForces();
        }
        this.recomputeMassProperties();
        this.syncDerivedState();
    }

    get mass(): number {
        return this._mass;
    }

    set mass(v: number) {
        this._mass = Math.max(0.05, v);
        this.recomputeMassProperties();
        this.syncDerivedState();
    }

    get invMass(): number {
        return this._invMass;
    }

    /** 外径 D = 2 * (R + r) */
    get outerRadius(): number {
        return this.majorRadius + this.tubeRadius;
    }

    /** 内孔半径 R - r */
    get innerRadius(): number {
        return Math.max(0, this.majorRadius - this.tubeRadius);
    }

    setDimensions(majorRadius: number, tubeRadius: number): void {
        this.majorRadius = Math.max(4, majorRadius);
        this.tubeRadius = Math.max(2, tubeRadius);
        this.recomputeMassProperties();
        this.syncDerivedState();
    }

    setPose(x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number): void {
        this.x = x;
        this.y = y;
        this.z = z;
        this.quat.x = qx;
        this.quat.y = qy;
        this.quat.z = qz;
        this.quat.w = qw;
        quatNormalize(this.quat);
        this.syncDerivedState();
    }

    clearVelocity(): void {
        this.vx = 0;
        this.vy = 0;
        this.vz = 0;
        this.wx = 0;
        this.wy = 0;
        this.wz = 0;
    }

    clearForces(): void {
        this.fx = 0;
        this.fy = 0;
        this.fz = 0;
        this.tx = 0;
        this.ty = 0;
        this.tz = 0;
    }

    /** 在质心处施加三维力 */
    applyCentralForce(fx: number, fy: number, fz: number): void {
        if (this._type !== 'dynamic') {
            return;
        }
        this.fx += fx;
        this.fy += fy;
        this.fz += fz;
    }

    /** 在世界（缸）坐标点 (px, py, pz) 施加三维力，自动产生 r × F 三轴翻转力矩 */
    applyForceAtPoint(fx: number, fy: number, fz: number, px: number, py: number, pz: number): void {
        if (this._type !== 'dynamic') {
            return;
        }
        this.fx += fx;
        this.fy += fy;
        this.fz += fz;

        const rx = px - this.x;
        const ry = py - this.y;
        const rz = pz - this.z;
        this.tx += ry * fz - rz * fy;
        this.ty += rz * fx - rx * fz;
        this.tz += rx * fy - ry * fx;
    }

    /** 在世界空间直接施加纯力矩 */
    applyTorque(tx: number, ty: number, tz: number): void {
        if (this._type !== 'dynamic') {
            return;
        }
        this.tx += tx;
        this.ty += ty;
        this.tz += tz;
    }

    /** 获取刚体上任意空间点 (px, py, pz) 的瞬时线速度 v + ω × r */
    getPointVelocity(px: number, py: number, pz: number, out: Vec3Like): Vec3Like {
        const rx = px - this.x;
        const ry = py - this.y;
        const rz = pz - this.z;
        out.x = this.vx + (this.wy * rz - this.wz * ry);
        out.y = this.vy + (this.wz * rx - this.wx * rz);
        out.z = this.vz + (this.wx * ry - this.wy * rx);
        return out;
    }

    /** 刷新世界基向量 U, N, V 与世界空间逆惯量张量 */
    syncDerivedState(): void {
        quatRotateVec(this.quat, 1, 0, 0, this.basisU);
        quatRotateVec(this.quat, 0, 1, 0, this.basisN);
        quatRotateVec(this.quat, 0, 0, 1, this.basisV);

        if (this._type === 'dynamic') {
            computeWorldInvInertia(this.quat, this._invIx, this._invIy, this._invIz, this.worldInvInertia);
        } else {
            for (let i = 0; i < 9; i++) {
                this.worldInvInertia[i] = 0;
            }
        }
    }

    private recomputeMassProperties(): void {
        if (this._type !== 'dynamic') {
            this._invMass = 0;
            this._invIx = 0;
            this._invIy = 0;
            this._invIz = 0;
            return;
        }
        const m = this._mass;
        const R2 = this.majorRadius * this.majorRadius;
        const r2 = this.tubeRadius * this.tubeRadius;

        // 实心圆环（Torus）精确转动惯量公式（Y 为圆环中心孔对称轴）
        const iy = m * (R2 + 0.75 * r2);
        const ixz = m * (0.5 * R2 + 0.625 * r2);

        this._invMass = 1 / m;
        this._invIx = 1 / Math.max(1e-4, ixz);
        this._invIy = 1 / Math.max(1e-4, iy);
        this._invIz = 1 / Math.max(1e-4, ixz);
    }
}
