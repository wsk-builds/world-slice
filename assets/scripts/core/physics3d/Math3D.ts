/**
 * 纯 TypeScript 三维向量、四元数、3x3 对称惯性矩阵及几何最近点基础运算（禁止引入引擎）。
 */
export interface Vec3Like {
    x: number;
    y: number;
    z: number;
}

export interface QuatLike {
    x: number;
    y: number;
    z: number;
    w: number;
}

/** 3x3 矩阵（行主序 9 元数组） */
export type Mat3Array = [number, number, number, number, number, number, number, number, number];

export function vec3Set(out: Vec3Like, x: number, y: number, z: number): Vec3Like {
    out.x = x;
    out.y = y;
    out.z = z;
    return out;
}

export function vec3Dot(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    return ax * bx + ay * by + az * bz;
}

export function vec3Cross(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    out: Vec3Like,
): Vec3Like {
    out.x = ay * bz - az * by;
    out.y = az * bx - ax * bz;
    out.z = ax * by - ay * bx;
    return out;
}

/** 将四元数归一化（退化时回退为单位四元数） */
export function quatNormalize(q: QuatLike): QuatLike {
    const len = Math.hypot(q.x, q.y, q.z, q.w);
    if (len > 1e-8) {
        const inv = 1 / len;
        q.x *= inv;
        q.y *= inv;
        q.z *= inv;
        q.w *= inv;
    } else {
        q.x = 0;
        q.y = 0;
        q.z = 0;
        q.w = 1;
    }
    return q;
}

/** 由欧拉角（度，YXZ 常用姿态组合）构造四元数 */
export function quatFromEulerDeg(pitchXDeg: number, yawYDeg: number, rollZDeg: number, out: QuatLike): QuatLike {
    const hx = (pitchXDeg * Math.PI) / 360;
    const hy = (yawYDeg * Math.PI) / 360;
    const hz = (rollZDeg * Math.PI) / 360;

    const sx = Math.sin(hx);
    const cx = Math.cos(hx);
    const sy = Math.sin(hy);
    const cy = Math.cos(hy);
    const sz = Math.sin(hz);
    const cz = Math.cos(hz);

    out.x = sx * cy * cz + cx * sy * sz;
    out.y = cx * sy * cz - sx * cy * sz;
    out.z = cx * cy * sz - sx * sy * cz;
    out.w = cx * cy * cz + sx * sy * sz;
    return quatNormalize(out);
}

/** 用单位四元数旋转三维向量 */
export function quatRotateVec(q: Readonly<QuatLike>, vx: number, vy: number, vz: number, out: Vec3Like): Vec3Like {
    const qx = q.x;
    const qy = q.y;
    const qz = q.z;
    const qw = q.w;

    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);

    out.x = vx + qw * tx + (qy * tz - qz * ty);
    out.y = vy + qw * ty + (qz * tx - qx * tz);
    out.z = vz + qw * tz + (qx * ty - qy * tx);
    return out;
}

/** 按世界空间角速度 (wx, wy, wz) 推进单位四元数 dt 秒并归一化 */
export function quatIntegrate(q: QuatLike, wx: number, wy: number, wz: number, dt: number): void {
    const speed = Math.hypot(wx, wy, wz);
    if (speed < 1e-8) {
        return;
    }
    const halfTheta = 0.5 * speed * dt;
    const s = Math.sin(halfTheta) / speed;
    const dqX = wx * s;
    const dqY = wy * s;
    const dqZ = wz * s;
    const dqW = Math.cos(halfTheta);

    const ox = q.x;
    const oy = q.y;
    const oz = q.z;
    const ow = q.w;

    q.x = dqW * ox + dqX * ow + dqY * oz - dqZ * oy;
    q.y = dqW * oy - dqX * oz + dqY * ow + dqZ * ox;
    q.z = dqW * oz + dqX * oy - dqY * ox + dqZ * ow;
    q.w = dqW * ow - dqX * ox - dqY * oy - dqZ * oz;
    quatNormalize(q);
}

/** 由单位四元数与本地主轴逆惯量 (invIx, invIy, invIz) 计算世界空间 3x3 逆惯量矩阵 R * diag * R^T */
export function computeWorldInvInertia(
    q: Readonly<QuatLike>,
    invIx: number,
    invIy: number,
    invIz: number,
    out: Mat3Array,
): void {
    const x = q.x;
    const y = q.y;
    const z = q.z;
    const w = q.w;

    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;
    const xx = x * x2;
    const xy = x * y2;
    const xz = x * z2;
    const yy = y * y2;
    const yz = y * z2;
    const zz = z * z2;
    const wx = w * x2;
    const wy = w * y2;
    const wz = w * z2;

    // 旋转矩阵 R 的三列（即本地 X, Y, Z 轴在世界空间下的方向）
    const r00 = 1 - (yy + zz);
    const r10 = xy + wz;
    const r20 = xz - wy;

    const r01 = xy - wz;
    const r11 = 1 - (xx + zz);
    const r21 = yz + wx;

    const r02 = xz + wy;
    const r12 = yz - wx;
    const r22 = 1 - (xx + yy);

    out[0] = r00 * r00 * invIx + r01 * r01 * invIy + r02 * r02 * invIz;
    out[1] = r00 * r10 * invIx + r01 * r11 * invIy + r02 * r12 * invIz;
    out[2] = r00 * r20 * invIx + r01 * r21 * invIy + r02 * r22 * invIz;

    out[3] = out[1];
    out[4] = r10 * r10 * invIx + r11 * r11 * invIy + r12 * r12 * invIz;
    out[5] = r10 * r20 * invIx + r11 * r21 * invIy + r12 * r22 * invIz;

    out[6] = out[2];
    out[7] = out[5];
    out[8] = r20 * r20 * invIx + r21 * r21 * invIy + r22 * r22 * invIz;
}

export function mat3MulVec(m: Readonly<Mat3Array>, vx: number, vy: number, vz: number, out: Vec3Like): Vec3Like {
    out.x = m[0] * vx + m[1] * vy + m[2] * vz;
    out.y = m[3] * vx + m[4] * vy + m[5] * vz;
    out.z = m[6] * vx + m[7] * vy + m[8] * vz;
    return out;
}

/** 计算空间点 P 到三维圆环中心圆 (C, 法向 N, 半径 R, 正交基 U) 的精确最近点 */
export function closestPointOnCircle3D(
    px: number,
    py: number,
    pz: number,
    cx: number,
    cy: number,
    cz: number,
    nx: number,
    ny: number,
    nz: number,
    ux: number,
    uy: number,
    uz: number,
    radius: number,
    out: Vec3Like,
): Vec3Like {
    const dx = px - cx;
    const dy = py - cy;
    const dz = pz - cz;
    const dotN = dx * nx + dy * ny + dz * nz;
    const projX = dx - dotN * nx;
    const projY = dy - dotN * ny;
    const projZ = dz - dotN * nz;
    const len = Math.hypot(projX, projY, projZ);
    if (len > 1e-6) {
        const k = radius / len;
        out.x = cx + projX * k;
        out.y = cy + projY * k;
        out.z = cz + projZ * k;
    } else {
        out.x = cx + ux * radius;
        out.y = cy + uy * radius;
        out.z = cz + uz * radius;
    }
    return out;
}

/** 计算空间点 P 到三维线段 AB 的参数 t ∈ [0, 1] */
export function closestParamOnSegment3D(
    px: number,
    py: number,
    pz: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
): number {
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const lenSq = abx * abx + aby * aby + abz * abz;
    if (lenSq <= 1e-8) {
        return 0;
    }
    const t = ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / lenSq;
    return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/** 由两个单位方向向量构造从 from 旋转到 to 的最短弧四元数，并左乘原四元数 */
export function rotateQuatFromTo(
    fromX: number,
    fromY: number,
    fromZ: number,
    toX: number,
    toY: number,
    toZ: number,
    q: QuatLike,
): void {
    const dot = fromX * toX + fromY * toY + fromZ * toZ;
    if (dot >= 0.999999) {
        return;
    }
    let rx: number;
    let ry: number;
    let rz: number;
    let rw: number;
    if (dot <= -0.999999) {
        // 180° 翻转：任取正交水平轴
        rx = 1;
        ry = 0;
        rz = 0;
        rw = 0;
    } else {
        rx = fromY * toZ - fromZ * toY;
        ry = fromZ * toX - fromX * toZ;
        rz = fromX * toY - fromY * toX;
        rw = 1 + dot;
        const inv = 1 / Math.hypot(rx, ry, rz, rw);
        rx *= inv;
        ry *= inv;
        rz *= inv;
        rw *= inv;
    }
    const ox = q.x;
    const oy = q.y;
    const oz = q.z;
    const ow = q.w;
    q.x = rw * ox + rx * ow + ry * oz - rz * oy;
    q.y = rw * oy - rx * oz + ry * ow + rz * ox;
    q.z = rw * oz + rx * oy - ry * ox + rz * ow;
    q.w = rw * ow - rx * ox - ry * oy - rz * oz;
    quatNormalize(q);
}
