import { closestParamOnSegment3D, closestPointOnCircle3D, Vec3Like } from './Math3D';
import { PillarCollider3D, TaperedCapsule3D } from './PillarCollider3D';
import { TorusBody3D } from './TorusBody3D';

export type ContactKind3D = 'tank' | 'pillar' | 'ring';

/**
 * 碰撞接触点（法线 n 始终由 bodyB / 静物指向 bodyA，推动 bodyA 沿 +n 分离）。
 */
export interface Contact3D {
    kind: ContactKind3D;
    pillarIndex: number;
    bodyA: TorusBody3D;
    bodyB: TorusBody3D | null;
    px: number;
    py: number;
    pz: number;
    nx: number;
    ny: number;
    nz: number;
    depth: number;
    friction: number;
    restitution: number;
    /** 求解器预计算的法向与两切向等效质量及累积冲量 */
    normalMass: number;
    tangentMass1: number;
    tangentMass2: number;
    t1x: number;
    t1y: number;
    t1z: number;
    t2x: number;
    t2y: number;
    t2z: number;
    velocityBias: number;
    preImpactApproachSpeed: number;
    jnAcc: number;
    jt1Acc: number;
    jt2Acc: number;
}

export interface TankBounds3D {
    width: number;
    height: number;
    halfDepth: number;
    cornerRadius: number;
    wallFriction: number;
    wallRestitution: number;
}

const WALL_RING_SAMPLES = 12;
const PILLAR_RING_SAMPLES = 16;
const RING_RING_SAMPLES = 16;
const MIN_DEDUP_DIST_SQ = 12 * 12;

const RING_ANGLES_12 = buildUnitCircleTable(WALL_RING_SAMPLES);
const RING_ANGLES_16 = buildUnitCircleTable(PILLAR_RING_SAMPLES);

const scratchP1: Vec3Like = { x: 0, y: 0, z: 0 };
const scratchP2: Vec3Like = { x: 0, y: 0, z: 0 };

function buildUnitCircleTable(count: number): { cos: number[]; sin: number[] } {
    const cos: number[] = [];
    const sin: number[] = [];
    for (let i = 0; i < count; i++) {
        const theta = (i / count) * Math.PI * 2;
        cos.push(Math.cos(theta));
        sin.push(Math.sin(theta));
    }
    return { cos, sin };
}

function pushContactDedup(
    out: Contact3D[],
    startIdx: number,
    maxPerPair: number,
    kind: ContactKind3D,
    pillarIndex: number,
    bodyA: TorusBody3D,
    bodyB: TorusBody3D | null,
    px: number,
    py: number,
    pz: number,
    nx: number,
    ny: number,
    nz: number,
    depth: number,
    friction: number,
    restitution: number,
): void {
    for (let i = startIdx; i < out.length; i++) {
        const c = out[i];
        const dx = c.px - px;
        const dy = c.py - py;
        const dz = c.pz - pz;
        const sameNormal = c.nx * nx + c.ny * ny + c.nz * nz > 0.85;
        if (sameNormal && dx * dx + dy * dy + dz * dz < MIN_DEDUP_DIST_SQ) {
            if (depth > c.depth) {
                c.px = px;
                c.py = py;
                c.pz = pz;
                c.nx = nx;
                c.ny = ny;
                c.nz = nz;
                c.depth = depth;
            }
            return;
        }
    }

    if (out.length - startIdx >= maxPerPair) {
        let minIdx = startIdx;
        for (let i = startIdx + 1; i < out.length; i++) {
            if (out[i].depth < out[minIdx].depth) {
                minIdx = i;
            }
        }
        if (depth <= out[minIdx].depth) {
            return;
        }
        out.splice(minIdx, 1);
    }

    out.push({
        kind,
        pillarIndex,
        bodyA,
        bodyB,
        px,
        py,
        pz,
        nx,
        ny,
        nz,
        depth,
        friction,
        restitution,
        normalMass: 0,
        tangentMass1: 0,
        tangentMass2: 0,
        t1x: 0,
        t1y: 0,
        t1z: 0,
        t2x: 0,
        t2y: 0,
        t2z: 0,
        velocityBias: 0,
        preImpactApproachSpeed: 0,
        jnAcc: 0,
        jt1Acc: 0,
        jt2Acc: 0,
    });
}

/**
 * 1. 检测正圆环与六面水缸内壁 + 左右圆弧底角柱面的接触点（支持平躺多点稳态支撑与斜靠前后玻璃）。
 */
export function detectTorusTankContacts(ring: TorusBody3D, tank: TankBounds3D, out: Contact3D[]): void {
    const outerR = ring.outerRadius;
    const nearLeft = ring.x - outerR < tank.cornerRadius;
    const nearRight = ring.x + outerR > tank.width - tank.cornerRadius;
    const nearFloor = ring.y - outerR < tank.cornerRadius;
    const nearCeil = ring.y + outerR > tank.height;
    const nearBack = ring.z - outerR < -tank.halfDepth;
    const nearFront = ring.z + outerR > tank.halfDepth;

    if (!nearLeft && !nearRight && !nearFloor && !nearCeil && !nearBack && !nearFront) {
        return;
    }

    const startIdx = out.length;
    const R = ring.majorRadius;
    const rTube = ring.tubeRadius;
    const ux = ring.basisU.x;
    const uy = ring.basisU.y;
    const uz = ring.basisU.z;
    const vx = ring.basisV.x;
    const vy = ring.basisV.y;
    const vz = ring.basisV.z;

    const mu = Math.sqrt(ring.friction * tank.wallFriction);
    const rest = Math.min(ring.restitution, tank.wallRestitution);
    const cr = tank.cornerRadius;

    for (let i = 0; i < WALL_RING_SAMPLES; i++) {
        const c = RING_ANGLES_12.cos[i];
        const s = RING_ANGLES_12.sin[i];
        const qx = ring.x + R * (c * ux + s * vx);
        const qy = ring.y + R * (c * uy + s * vy);
        const qz = ring.z + R * (c * uz + s * vz);

        // 底墙 y = 0（避开左右圆弧底角内侧区，圆弧区由圆柱面统一处理）
        if (qy < rTube && qx >= cr && qx <= tank.width - cr) {
            pushContactDedup(out, startIdx, 8, 'tank', -1, ring, null, qx, 0, qz, 0, 1, 0, rTube - qy, mu, rest);
        }
        // 顶墙 y = height
        if (qy > tank.height - rTube) {
            pushContactDedup(
                out,
                startIdx,
                8,
                'tank',
                -1,
                ring,
                null,
                qx,
                tank.height,
                qz,
                0,
                -1,
                0,
                qy + rTube - tank.height,
                mu,
                rest,
            );
        }
        // 左墙 x = 0（y >= cr，底部近角段零摩擦防贴墙滞留）
        if (qx < rTube && qy >= cr) {
            const sideMu = qy < cr * 1.6 ? 0 : mu;
            pushContactDedup(out, startIdx, 8, 'tank', -1, ring, null, 0, qy, qz, 1, 0, 0, rTube - qx, sideMu, rest);
        }
        // 右墙 x = width（y >= cr，底部近角段零摩擦防贴墙滞留）
        if (qx > tank.width - rTube && qy >= cr) {
            const sideMu = qy < cr * 1.6 ? 0 : mu;
            pushContactDedup(
                out,
                startIdx,
                8,
                'tank',
                -1,
                ring,
                null,
                tank.width,
                qy,
                qz,
                -1,
                0,
                0,
                qx + rTube - tank.width,
                sideMu,
                rest,
            );
        }
        // 后玻璃内壁 z = -halfDepth
        if (qz < -tank.halfDepth + rTube) {
            pushContactDedup(
                out,
                startIdx,
                8,
                'tank',
                -1,
                ring,
                null,
                qx,
                qy,
                -tank.halfDepth,
                0,
                0,
                1,
                -tank.halfDepth + rTube - qz,
                0,
                rest,
            );
        }
        // 前玻璃内壁 z = +halfDepth
        if (qz > tank.halfDepth - rTube) {
            pushContactDedup(
                out,
                startIdx,
                8,
                'tank',
                -1,
                ring,
                null,
                qx,
                qy,
                tank.halfDepth,
                0,
                0,
                -1,
                qz + rTube - tank.halfDepth,
                0,
                rest,
            );
        }

        // 左下圆弧底角（圆心 (cr, cr)，光滑零摩擦内凹圆弧滑道，让边角圈自动滑回海眼）
        if (cr > 0 && qx < cr && qy < cr) {
            const dx = qx - cr;
            const dy = qy - cr;
            const dist = Math.hypot(dx, dy);
            if (dist > cr - rTube && dist > 1e-5) {
                const nx = -dx / dist;
                const ny = -dy / dist;
                const depth = dist - (cr - rTube);
                pushContactDedup(
                    out,
                    startIdx,
                    8,
                    'tank',
                    -1,
                    ring,
                    null,
                    cr - nx * cr,
                    cr - ny * cr,
                    qz,
                    nx,
                    ny,
                    0,
                    depth,
                    0,
                    rest,
                );
            }
        }

        // 右下圆弧底角（圆心 (width - cr, cr)，光滑零摩擦内凹圆弧滑道）
        const rcx = tank.width - cr;
        if (cr > 0 && qx > rcx && qy < cr) {
            const dx = qx - rcx;
            const dy = qy - cr;
            const dist = Math.hypot(dx, dy);
            if (dist > cr - rTube && dist > 1e-5) {
                const nx = -dx / dist;
                const ny = -dy / dist;
                const depth = dist - (cr - rTube);
                pushContactDedup(
                    out,
                    startIdx,
                    8,
                    'tank',
                    -1,
                    ring,
                    null,
                    rcx - nx * cr,
                    cr - ny * cr,
                    qz,
                    nx,
                    ny,
                    0,
                    depth,
                    0,
                    rest,
                );
            }
        }
    }
}

/**
 * 2. 检测正圆环与三段式锥形十字柱各光滑圆台线段的接触点。
 */
export function detectTorusPillarContacts(
    ring: TorusBody3D,
    pillar: PillarCollider3D,
    out: Contact3D[],
    pillarIndex = 0,
): void {
    const outerR = ring.outerRadius;
    const maxHalfW = Math.max(pillar.crossHalfWidth, pillar.visualCrossHalfWidth);
    if (
        ring.x + outerR < pillar.x - maxHalfW ||
        ring.x - outerR > pillar.x + maxHalfW ||
        ring.y + outerR < pillar.tailBottomY ||
        ring.y - outerR > pillar.tipY
    ) {
        return;
    }

    const mu = Math.sqrt(ring.friction * pillar.friction);
    const rest = Math.min(ring.restitution, pillar.restitution);

    for (let s = 0; s < pillar.segments.length; s++) {
        detectTorusTaperedSegment(ring, pillar.segments[s], pillarIndex, mu, rest, out);
    }

    // 精确三维穿孔判定：仅当竖直柱轴真正穿过圆环三维内孔平面时，才启用卡托承接/防倒穿，外侧擦过或竖立贴靠的圈绝不挂卡
    const absNy = Math.abs(ring.basisN.y);
    if (absNy > 0.35) {
        const dxAxis = pillar.x - ring.x;
        const dzAxis = pillar.z - ring.z;
        const dyPierce = -(dxAxis * ring.basisN.x + dzAxis * ring.basisN.z) / ring.basisN.y;
        const yPierce = ring.y + dyPierce;
        const inPlaneDist = Math.hypot(dxAxis, dyPierce, dzAxis);
        const innerR = Math.max(0, ring.majorRadius - ring.tubeRadius);

        if (inPlaneDist < innerR) {
            const R = ring.majorRadius;
            const rTube = ring.tubeRadius;

            if (
                ring.y >= pillar.crossCenterY &&
                ring.y - outerR < pillar.baseTopY + 2 &&
                yPierce >= pillar.crossCenterY - 2 &&
                yPierce <= pillar.tipY + 4
            ) {
                // 已从柱尖套入上段锥杆：卡托顶面 baseTopY 平稳向上托住圆环
                const seatStart = out.length;
                const seatTopY = pillar.baseTopY;
                for (let i = 0; i < WALL_RING_SAMPLES; i++) {
                    const c = RING_ANGLES_12.cos[i];
                    const s = RING_ANGLES_12.sin[i];
                    const qx = ring.x + R * (c * ring.basisU.x + s * ring.basisV.x);
                    const qy = ring.y + R * (c * ring.basisU.y + s * ring.basisV.y);
                    const qz = ring.z + R * (c * ring.basisU.z + s * ring.basisV.z);
                    if (qy < seatTopY + rTube && qy > pillar.crossBottomY - rTube) {
                        pushContactDedup(
                            out,
                            seatStart,
                            4,
                            'pillar',
                            pillarIndex,
                            ring,
                            null,
                            qx,
                            seatTopY,
                            qz,
                            0,
                            1,
                            0,
                            seatTopY + rTube - qy,
                            mu,
                            rest,
                        );
                    }
                }
            } else if (
                ring.y < pillar.crossCenterY &&
                ring.y + outerR > pillar.crossBottomY - 2 &&
                yPierce >= pillar.tailBottomY - 4 &&
                yPierce <= pillar.crossCenterY + 2
            ) {
                // 从下方误穿尾椎上冲：卡托底面 crossBottomY 纯向下挡回（法线 -Y 永不托挂圆环）
                const blockStart = out.length;
                const bottomY = pillar.crossBottomY;
                for (let i = 0; i < WALL_RING_SAMPLES; i++) {
                    const c = RING_ANGLES_12.cos[i];
                    const s = RING_ANGLES_12.sin[i];
                    const qx = ring.x + R * (c * ring.basisU.x + s * ring.basisV.x);
                    const qy = ring.y + R * (c * ring.basisU.y + s * ring.basisV.y);
                    const qz = ring.z + R * (c * ring.basisU.z + s * ring.basisV.z);
                    if (qy > bottomY - rTube && qy < pillar.baseTopY + rTube) {
                        pushContactDedup(
                            out,
                            blockStart,
                            4,
                            'pillar',
                            pillarIndex,
                            ring,
                            null,
                            qx,
                            bottomY,
                            qz,
                            0,
                            -1,
                            0,
                            qy + rTube - bottomY,
                            0,
                            rest,
                        );
                    }
                }
            }
        }
    }
}

function detectTorusTaperedSegment(
    ring: TorusBody3D,
    seg: TaperedCapsule3D,
    pillarIndex: number,
    mu: number,
    rest: number,
    out: Contact3D[],
): void {
    const startIdx = out.length;
    const R = ring.majorRadius;
    const rTube = ring.tubeRadius;
    const ux = ring.basisU.x;
    const uy = ring.basisU.y;
    const uz = ring.basisU.z;
    const vx = ring.basisV.x;
    const vy = ring.basisV.y;
    const vz = ring.basisV.z;

    for (let i = 0; i < PILLAR_RING_SAMPLES; i++) {
        let qx = ring.x + R * (RING_ANGLES_16.cos[i] * ux + RING_ANGLES_16.sin[i] * vx);
        let qy = ring.y + R * (RING_ANGLES_16.cos[i] * uy + RING_ANGLES_16.sin[i] * vy);
        let qz = ring.z + R * (RING_ANGLES_16.cos[i] * uz + RING_ANGLES_16.sin[i] * vz);

        let t = closestParamOnSegment3D(qx, qy, qz, seg.ax, seg.ay, seg.az, seg.bx, seg.by, seg.bz);
        let sx = seg.ax + (seg.bx - seg.ax) * t;
        let sy = seg.ay + (seg.by - seg.ay) * t;
        let sz = seg.az + (seg.bz - seg.az) * t;

        const maxSegR = Math.max(seg.radiusA, seg.radiusB);
        const roughDx = qx - sx;
        const roughDy = qy - sy;
        const roughDz = qz - sz;
        const roughLimit = rTube + maxSegR + 12;
        if (roughDx * roughDx + roughDy * roughDy + roughDz * roughDz > roughLimit * roughLimit) {
            continue;
        }

        // 一次交替投影精细收敛到连续圆环与连续锥线段上的精确最近点对
        closestPointOnCircle3D(
            sx,
            sy,
            sz,
            ring.x,
            ring.y,
            ring.z,
            ring.basisN.x,
            ring.basisN.y,
            ring.basisN.z,
            ux,
            uy,
            uz,
            R,
            scratchP1,
        );
        qx = scratchP1.x;
        qy = scratchP1.y;
        qz = scratchP1.z;
        t = closestParamOnSegment3D(qx, qy, qz, seg.ax, seg.ay, seg.az, seg.bx, seg.by, seg.bz);
        sx = seg.ax + (seg.bx - seg.ax) * t;
        sy = seg.ay + (seg.by - seg.ay) * t;
        sz = seg.az + (seg.bz - seg.az) * t;

        const segR = seg.radiusA + (seg.radiusB - seg.radiusA) * t;
        const sumR = rTube + segR;

        const dx = qx - sx;
        const dy = qy - sy;
        const dz = qz - sz;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq >= sumR * sumR) {
            continue;
        }

        const dist = Math.sqrt(distSq);
        let nx = 0;
        let ny = 1;
        let nz = 0;
        if (dist > 1e-5) {
            nx = dx / dist;
            ny = dy / dist;
            nz = dz / dist;
        }
        const depth = sumR - dist;
        const px = sx + nx * segR;
        const py = sy + ny * segR;
        const pz = sz + nz * segR;

        pushContactDedup(out, startIdx, 4, 'pillar', pillarIndex, ring, null, px, py, pz, nx, ny, nz, depth, mu, rest);
    }
}

/**
 * 3. 检测两个真 3D 正圆环之间的多接触点（支持边缘碰撞翻滚、平叠及 3D 斜靠交错堆叠）。
 */
export function detectTorusTorusContacts(a: TorusBody3D, b: TorusBody3D, out: Contact3D[]): void {
    if (a.type === 'static' && b.type === 'static') {
        return;
    }

    // 保证 bodyA 始终为 dynamic 刚体
    if (a.type !== 'dynamic') {
        detectTorusTorusContacts(b, a, out);
        return;
    }

    const sumOuter = a.outerRadius + b.outerRadius;
    const cdx = a.x - b.x;
    const cdy = a.y - b.y;
    const cdz = a.z - b.z;
    if (cdx * cdx + cdy * cdy + cdz * cdz >= sumOuter * sumOuter) {
        return;
    }

    const startIdx = out.length;
    const Ra = a.majorRadius;
    const Rb = b.majorRadius;
    const sumTube = a.tubeRadius + b.tubeRadius;
    const coarseLimit = sumTube + 14;
    const coarseLimitSq = coarseLimit * coarseLimit;

    const mu = Math.sqrt(a.friction * b.friction);
    const rest = Math.min(a.restitution, b.restitution);

    for (let i = 0; i < RING_RING_SAMPLES; i++) {
        const c = RING_ANGLES_16.cos[i];
        const s = RING_ANGLES_16.sin[i];
        let pax = a.x + Ra * (c * a.basisU.x + s * a.basisV.x);
        let pay = a.y + Ra * (c * a.basisU.y + s * a.basisV.y);
        let paz = a.z + Ra * (c * a.basisU.z + s * a.basisV.z);

        closestPointOnCircle3D(
            pax,
            pay,
            paz,
            b.x,
            b.y,
            b.z,
            b.basisN.x,
            b.basisN.y,
            b.basisN.z,
            b.basisU.x,
            b.basisU.y,
            b.basisU.z,
            Rb,
            scratchP2,
        );

        const rdx = pax - scratchP2.x;
        const rdy = pay - scratchP2.y;
        const rdz = paz - scratchP2.z;
        if (rdx * rdx + rdy * rdy + rdz * rdz > coarseLimitSq) {
            continue;
        }

        // 两次交替圆投影收敛到双圆环上的局部精确最近点对
        for (let iter = 0; iter < 2; iter++) {
            closestPointOnCircle3D(
                scratchP2.x,
                scratchP2.y,
                scratchP2.z,
                a.x,
                a.y,
                a.z,
                a.basisN.x,
                a.basisN.y,
                a.basisN.z,
                a.basisU.x,
                a.basisU.y,
                a.basisU.z,
                Ra,
                scratchP1,
            );
            pax = scratchP1.x;
            pay = scratchP1.y;
            paz = scratchP1.z;

            closestPointOnCircle3D(
                pax,
                pay,
                paz,
                b.x,
                b.y,
                b.z,
                b.basisN.x,
                b.basisN.y,
                b.basisN.z,
                b.basisU.x,
                b.basisU.y,
                b.basisU.z,
                Rb,
                scratchP2,
            );
        }

        const dx = pax - scratchP2.x;
        const dy = pay - scratchP2.y;
        const dz = paz - scratchP2.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq >= sumTube * sumTube) {
            continue;
        }

        const dist = Math.sqrt(distSq);
        let nx: number;
        let ny: number;
        let nz: number;
        if (dist > 1e-5) {
            nx = dx / dist;
            ny = dy / dist;
            nz = dz / dist;
        } else {
            const fLen = Math.hypot(cdx, cdy, cdz);
            if (fLen > 1e-5) {
                nx = cdx / fLen;
                ny = cdy / fLen;
                nz = cdz / fLen;
            } else {
                nx = 0;
                ny = 1;
                nz = 0;
            }
        }

        const depth = sumTube - dist;
        const px = scratchP2.x + nx * (b.tubeRadius - 0.5 * depth);
        const py = scratchP2.y + ny * (b.tubeRadius - 0.5 * depth);
        const pz = scratchP2.z + nz * (b.tubeRadius - 0.5 * depth);

        pushContactDedup(out, startIdx, 4, 'ring', -1, a, b, px, py, pz, nx, ny, nz, depth, mu, rest);
    }
}
