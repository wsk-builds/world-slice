import { calcRingPillarGeometry, GameConst } from '../../config/GameConst';
import { TankSpace } from '../../config/TankSpace';
import { mat3MulVec, quatIntegrate, vec3Cross, Vec3Like } from './Math3D';
import { PillarCollider3D } from './PillarCollider3D';
import { TorusBody3D } from './TorusBody3D';
import {
    Contact3D,
    ContactKind3D,
    detectTorusPillarContacts,
    detectTorusTankContacts,
    detectTorusTorusContacts,
    TankBounds3D,
} from './TorusContactDetect';

export type CollisionKind3D = ContactKind3D;

export interface CollisionEvent3D {
    kind: CollisionKind3D;
    bodyA: TorusBody3D;
    bodyB: TorusBody3D | null;
    pillarIndex: number;
    normalImpulse: number;
    approachSpeed: number;
    px: number;
    py: number;
    pz: number;
}

export type CollisionListener3D = (event: CollisionEvent3D) => void;

interface FrameCollisionSlot {
    kind: CollisionKind3D;
    idA: number;
    idB: number;
    event: CollisionEvent3D;
}

const SUB_STEPS = 2;
const VELOCITY_ITERATIONS = 10;
const POSITION_SLOP_PX = 0.25;
const POSITION_BAUMGARTE = 0.22;
const MAX_POSITION_CORRECTION_PX = 2.0;
const RESTITUTION_SPEED_THRESHOLD = 36;
const MAX_LINEAR_SPEED_PX = 1800;
const MAX_ANGULAR_SPEED_RAD = 28;

const tempCrossA: Vec3Like = { x: 0, y: 0, z: 0 };
const tempCrossB: Vec3Like = { x: 0, y: 0, z: 0 };
const tempInvIA: Vec3Like = { x: 0, y: 0, z: 0 };
const tempInvIB: Vec3Like = { x: 0, y: 0, z: 0 };
const tempVelA: Vec3Like = { x: 0, y: 0, z: 0 };
const tempVelB: Vec3Like = { x: 0, y: 0, z: 0 };

/**
 * 薄层 3D 水缸顺序冲量（Sequential Impulse）刚体物理世界（纯 TS，零外部引擎依赖）。
 * - 每次 step(dt) 自动拆分为 2 个 120Hz 子步，彻底杜绝猛喷高速穿透柱尖与缸壁；
 * - 支持真 3D 圆环三轴自由翻滚、锥形十字柱入环挂边晃动与缸底前后斜靠真实堆叠。
 */
export class TorusWorld3D {
    readonly tank: TankBounds3D;
    readonly bodies: TorusBody3D[] = [];
    readonly pillars: PillarCollider3D[] = [];

    /** 触发碰撞事件回调所需的最小法向冲量阈值与最小碰撞接近速度（排除静止支撑微颤） */
    collisionImpulseThreshold: number = GameConst.sfxCollisionMinImpulse;
    collisionApproachSpeedThreshold: number = GameConst.sfxCollisionMinApproachSpeed;

    private readonly contacts: Contact3D[] = [];
    private readonly collisionListeners: CollisionListener3D[] = [];
    private collisionListenersSnapshot: CollisionListener3D[] = [];
    private listenersDirty = false;
    private readonly frameCollisions: FrameCollisionSlot[] = [];
    private frameCollisionCount = 0;

    constructor(width = TankSpace.width, height = TankSpace.height) {
        const geom = calcRingPillarGeometry(width);
        this.tank = {
            width,
            height,
            halfDepth: geom.tankDepth * 0.5,
            cornerRadius: GameConst.tankCornerRadius,
            wallFriction: 0.08,
            wallRestitution: 0.1,
        };
    }

    onCollision(cb: CollisionListener3D): () => void {
        if (!this.collisionListeners.includes(cb)) {
            this.collisionListeners.push(cb);
            this.listenersDirty = true;
        }
        return () => {
            this.offCollision(cb);
        };
    }

    offCollision(cb: CollisionListener3D): void {
        const idx = this.collisionListeners.indexOf(cb);
        if (idx >= 0) {
            this.collisionListeners.splice(idx, 1);
            this.listenersDirty = true;
        }
    }

    updateTankBounds(width = TankSpace.width, height = TankSpace.height): void {
        const geom = calcRingPillarGeometry(width);
        this.tank.width = width;
        this.tank.height = height;
        this.tank.halfDepth = geom.tankDepth * 0.5;
        this.tank.cornerRadius = GameConst.tankCornerRadius;
    }

    addBody(body: TorusBody3D): TorusBody3D {
        if (!this.bodies.includes(body)) {
            this.bodies.push(body);
        }
        return body;
    }

    removeBody(body: TorusBody3D): boolean {
        const idx = this.bodies.indexOf(body);
        if (idx < 0) {
            return false;
        }
        this.bodies.splice(idx, 1);
        return true;
    }

    clearBodies(): void {
        this.bodies.length = 0;
        this.frameCollisions.length = 0;
        this.frameCollisionCount = 0;
    }

    addPillar(pillar: PillarCollider3D): PillarCollider3D {
        if (!this.pillars.includes(pillar)) {
            this.pillars.push(pillar);
        }
        return pillar;
    }

    clearPillars(): void {
        this.pillars.length = 0;
    }

    /** 推进 dt 秒三维物理步（施力在步前已挂到各刚体，步末自动清空累积力并派发去重后的有效碰撞事件） */
    step(dt: number): void {
        if (!(dt > 0) || this.bodies.length === 0) {
            return;
        }

        this.frameCollisionCount = 0;

        const subDt = dt / SUB_STEPS;
        for (let sub = 0; sub < SUB_STEPS; sub++) {
            this.stepSub(subDt);
        }

        for (let i = 0; i < this.bodies.length; i++) {
            this.bodies[i].clearForces();
        }

        if (this.collisionListeners.length > 0 && this.frameCollisionCount > 0) {
            this.dispatchFrameCollisions();
        }
    }

    private stepSub(dt: number): void {
        const nBodies = this.bodies.length;

        // 1. 推进外力、力矩与指数粘滞阻尼
        for (let i = 0; i < nBodies; i++) {
            const b = this.bodies[i];
            b.syncDerivedState();
            if (b.type !== 'dynamic') {
                continue;
            }

            const linDecay = Math.exp(-b.linearDamping * dt);
            const angDecay = Math.exp(-b.angularDamping * dt);

            b.vx = (b.vx + b.fx * b.invMass * dt) * linDecay;
            b.vy = (b.vy + b.fy * b.invMass * dt) * linDecay;
            b.vz = (b.vz + b.fz * b.invMass * dt) * linDecay;

            mat3MulVec(b.worldInvInertia, b.tx, b.ty, b.tz, tempInvIA);
            b.wx = (b.wx + tempInvIA.x * dt) * angDecay;
            b.wy = (b.wy + tempInvIA.y * dt) * angDecay;
            b.wz = (b.wz + tempInvIA.z * dt) * angDecay;

            clampBodySpeeds(b);
        }

        // 2. 窄相碰撞检测
        this.contacts.length = 0;
        for (let i = 0; i < nBodies; i++) {
            const a = this.bodies[i];
            if (a.type === 'dynamic') {
                detectTorusTankContacts(a, this.tank, this.contacts);
                for (let p = 0; p < this.pillars.length; p++) {
                    detectTorusPillarContacts(a, this.pillars[p], this.contacts, p);
                }
            }
            for (let j = i + 1; j < nBodies; j++) {
                detectTorusTorusContacts(a, this.bodies[j], this.contacts);
            }
        }

        // 3. 预计算接触约束有效质量并顺序冲量迭代求解速度
        if (this.contacts.length > 0) {
            this.prepareContacts();
            for (let iter = 0; iter < VELOCITY_ITERATIONS; iter++) {
                this.solveVelocityConstraints();
            }
            if (this.collisionListeners.length > 0) {
                this.recordSubstepCollisions();
            }
        }

        // 4. 积分位置与旋转四元数
        for (let i = 0; i < nBodies; i++) {
            const b = this.bodies[i];
            if (b.type !== 'dynamic') {
                continue;
            }
            // 水底堆叠静止微阻尼抑抖：极低速接触下快速平息微颤
            const linSpd = Math.hypot(b.vx, b.vy, b.vz);
            const angSpd = Math.hypot(b.wx, b.wy, b.wz);
            if (linSpd < 2.2 && angSpd < 0.08 && Math.hypot(b.fx, b.fy + 500 * b.mass, b.fz) < 900) {
                b.vx *= 0.82;
                b.vy *= 0.82;
                b.vz *= 0.82;
                b.wx *= 0.78;
                b.wy *= 0.78;
                b.wz *= 0.78;
            }

            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.z += b.vz * dt;
            quatIntegrate(b.quat, b.wx, b.wy, b.wz, dt);
            b.syncDerivedState();
        }

        // 5. 纯位置无能量穿透修正（基于位置积分后的最新坐标重新检测真实残余穿透，彻底消除旧接触点过推跳动）
        if (this.contacts.length > 0) {
            this.contacts.length = 0;
            for (let i = 0; i < nBodies; i++) {
                const a = this.bodies[i];
                if (a.type === 'dynamic') {
                    detectTorusTankContacts(a, this.tank, this.contacts);
                    for (let p = 0; p < this.pillars.length; p++) {
                        detectTorusPillarContacts(a, this.pillars[p], this.contacts, p);
                    }
                }
                for (let j = i + 1; j < nBodies; j++) {
                    detectTorusTorusContacts(a, this.bodies[j], this.contacts);
                }
            }
            if (this.contacts.length > 0) {
                this.solvePositionConstraints();
                for (let i = 0; i < nBodies; i++) {
                    if (this.bodies[i].type === 'dynamic') {
                        this.bodies[i].syncDerivedState();
                    }
                }
            }
        }
    }

    private prepareContacts(): void {
        for (let i = 0; i < this.contacts.length; i++) {
            const c = this.contacts[i];
            const a = c.bodyA;
            const b = c.bodyB;

            buildOrthonormalBasis(c);

            c.normalMass = computeEffectiveMass(a, b, c.px, c.py, c.pz, c.nx, c.ny, c.nz);
            c.tangentMass1 = computeEffectiveMass(a, b, c.px, c.py, c.pz, c.t1x, c.t1y, c.t1z);
            c.tangentMass2 = computeEffectiveMass(a, b, c.px, c.py, c.pz, c.t2x, c.t2y, c.t2z);

            a.getPointVelocity(c.px, c.py, c.pz, tempVelA);
            if (b) {
                b.getPointVelocity(c.px, c.py, c.pz, tempVelB);
            } else {
                tempVelB.x = 0;
                tempVelB.y = 0;
                tempVelB.z = 0;
            }

            const rvx = tempVelA.x - tempVelB.x;
            const rvy = tempVelA.y - tempVelB.y;
            const rvz = tempVelA.z - tempVelB.z;
            const vn = rvx * c.nx + rvy * c.ny + rvz * c.nz;

            c.preImpactApproachSpeed = vn < 0 ? -vn : 0;
            c.velocityBias = vn < -RESTITUTION_SPEED_THRESHOLD ? -c.restitution * vn : 0;
        }
    }

    private recordSubstepCollisions(): void {
        for (let i = 0; i < this.contacts.length; i++) {
            const c = this.contacts[i];
            if (c.jnAcc <= 0) {
                continue;
            }

            let idA = c.bodyA.id;
            let idB = -1;
            if (c.kind === 'ring' && c.bodyB) {
                const otherId = c.bodyB.id;
                if (otherId < idA) {
                    idB = idA;
                    idA = otherId;
                } else {
                    idB = otherId;
                }
            } else if (c.kind === 'pillar') {
                idB = c.pillarIndex;
            }

            let slot: FrameCollisionSlot | null = null;
            for (let k = 0; k < this.frameCollisionCount; k++) {
                const candidate = this.frameCollisions[k];
                if (candidate.kind === c.kind && candidate.idA === idA && candidate.idB === idB) {
                    slot = candidate;
                    break;
                }
            }

            if (slot) {
                slot.event.normalImpulse += c.jnAcc;
                if (c.preImpactApproachSpeed > slot.event.approachSpeed) {
                    slot.event.approachSpeed = c.preImpactApproachSpeed;
                    slot.event.px = c.px;
                    slot.event.py = c.py;
                    slot.event.pz = c.pz;
                }
                continue;
            }

            if (this.frameCollisionCount < this.frameCollisions.length) {
                slot = this.frameCollisions[this.frameCollisionCount];
                slot.kind = c.kind;
                slot.idA = idA;
                slot.idB = idB;
                const ev = slot.event;
                ev.kind = c.kind;
                ev.bodyA = c.bodyA;
                ev.bodyB = c.bodyB;
                ev.pillarIndex = c.pillarIndex;
                ev.normalImpulse = c.jnAcc;
                ev.approachSpeed = c.preImpactApproachSpeed;
                ev.px = c.px;
                ev.py = c.py;
                ev.pz = c.pz;
            } else {
                slot = {
                    kind: c.kind,
                    idA,
                    idB,
                    event: {
                        kind: c.kind,
                        bodyA: c.bodyA,
                        bodyB: c.bodyB,
                        pillarIndex: c.pillarIndex,
                        normalImpulse: c.jnAcc,
                        approachSpeed: c.preImpactApproachSpeed,
                        px: c.px,
                        py: c.py,
                        pz: c.pz,
                    },
                };
                this.frameCollisions.push(slot);
            }
            this.frameCollisionCount++;
        }
    }

    private dispatchFrameCollisions(): void {
        if (this.listenersDirty) {
            this.collisionListenersSnapshot = this.collisionListeners.slice();
            this.listenersDirty = false;
        }
        const listeners = this.collisionListenersSnapshot;
        const minImp = this.collisionImpulseThreshold;
        const minSpeed = this.collisionApproachSpeedThreshold;

        for (let i = 0; i < this.frameCollisionCount; i++) {
            const ev = this.frameCollisions[i].event;
            if (ev.normalImpulse < minImp || ev.approachSpeed < minSpeed) {
                continue;
            }
            for (let j = 0; j < listeners.length; j++) {
                listeners[j](ev);
            }
        }
    }

    private solveVelocityConstraints(): void {
        for (let i = 0; i < this.contacts.length; i++) {
            const c = this.contacts[i];
            const a = c.bodyA;
            const b = c.bodyB;

            // 法向冲量
            a.getPointVelocity(c.px, c.py, c.pz, tempVelA);
            if (b) {
                b.getPointVelocity(c.px, c.py, c.pz, tempVelB);
            } else {
                tempVelB.x = 0;
                tempVelB.y = 0;
                tempVelB.z = 0;
            }

            let rvx = tempVelA.x - tempVelB.x;
            let rvy = tempVelA.y - tempVelB.y;
            let rvz = tempVelA.z - tempVelB.z;

            const vn = rvx * c.nx + rvy * c.ny + rvz * c.nz;
            let dJn = -(vn - c.velocityBias) * c.normalMass;
            const prevJn = c.jnAcc;
            c.jnAcc = Math.max(0, prevJn + dJn);
            dJn = c.jnAcc - prevJn;

            if (dJn !== 0) {
                applyImpulsePair(a, b, c.px, c.py, c.pz, c.nx * dJn, c.ny * dJn, c.nz * dJn);
            }

            // 库仑摩擦冲量（两个正交切向）
            if (c.friction > 0 && c.jnAcc > 0) {
                a.getPointVelocity(c.px, c.py, c.pz, tempVelA);
                if (b) {
                    b.getPointVelocity(c.px, c.py, c.pz, tempVelB);
                }
                rvx = tempVelA.x - tempVelB.x;
                rvy = tempVelA.y - tempVelB.y;
                rvz = tempVelA.z - tempVelB.z;

                const maxJt = c.friction * c.jnAcc;

                const vt1 = rvx * c.t1x + rvy * c.t1y + rvz * c.t1z;
                let dJt1 = -vt1 * c.tangentMass1;
                const prevJt1 = c.jt1Acc;
                c.jt1Acc = Math.max(-maxJt, Math.min(maxJt, prevJt1 + dJt1));
                dJt1 = c.jt1Acc - prevJt1;

                const vt2 = rvx * c.t2x + rvy * c.t2y + rvz * c.t2z;
                let dJt2 = -vt2 * c.tangentMass2;
                const prevJt2 = c.jt2Acc;
                c.jt2Acc = Math.max(-maxJt, Math.min(maxJt, prevJt2 + dJt2));
                dJt2 = c.jt2Acc - prevJt2;

                const jx = c.t1x * dJt1 + c.t2x * dJt2;
                const jy = c.t1y * dJt1 + c.t2y * dJt2;
                const jz = c.t1z * dJt1 + c.t2z * dJt2;
                if (jx !== 0 || jy !== 0 || jz !== 0) {
                    applyImpulsePair(a, b, c.px, c.py, c.pz, jx, jy, jz);
                }
            }
        }
    }

    private solvePositionConstraints(): void {
        for (let i = 0; i < this.contacts.length; i++) {
            const c = this.contacts[i];
            const pen = c.depth - POSITION_SLOP_PX;
            if (pen <= 0) {
                continue;
            }
            const corr = Math.min(MAX_POSITION_CORRECTION_PX, pen * POSITION_BAUMGARTE);
            const a = c.bodyA;
            const b = c.bodyB;
            const invA = a.invMass;
            const invB = b ? b.invMass : 0;
            const invSum = invA + invB;
            if (invSum <= 0) {
                continue;
            }

            const pushA = corr * (invA / invSum);
            a.x += c.nx * pushA;
            a.y += c.ny * pushA;
            a.z += c.nz * pushA;

            if (b && invB > 0) {
                const pushB = corr * (invB / invSum);
                b.x -= c.nx * pushB;
                b.y -= c.ny * pushB;
                b.z -= c.nz * pushB;
            }
        }
    }
}

function buildOrthonormalBasis(c: Contact3D): void {
    const nx = c.nx;
    const ny = c.ny;
    const nz = c.nz;
    if (Math.abs(nx) < 0.57735) {
        const inv = 1 / Math.hypot(nz, ny);
        c.t1x = 0;
        c.t1y = nz * inv;
        c.t1z = -ny * inv;
    } else {
        const inv = 1 / Math.hypot(ny, nx);
        c.t1x = -ny * inv;
        c.t1y = nx * inv;
        c.t1z = 0;
    }
    c.t2x = ny * c.t1z - nz * c.t1y;
    c.t2y = nz * c.t1x - nx * c.t1z;
    c.t2z = nx * c.t1y - ny * c.t1x;
}

function computeEffectiveMass(
    a: TorusBody3D,
    b: TorusBody3D | null,
    px: number,
    py: number,
    pz: number,
    dx: number,
    dy: number,
    dz: number,
): number {
    let k = a.invMass;
    vec3Cross(px - a.x, py - a.y, pz - a.z, dx, dy, dz, tempCrossA);
    mat3MulVec(a.worldInvInertia, tempCrossA.x, tempCrossA.y, tempCrossA.z, tempInvIA);
    k += tempCrossA.x * tempInvIA.x + tempCrossA.y * tempInvIA.y + tempCrossA.z * tempInvIA.z;

    if (b && b.invMass > 0) {
        k += b.invMass;
        vec3Cross(px - b.x, py - b.y, pz - b.z, dx, dy, dz, tempCrossB);
        mat3MulVec(b.worldInvInertia, tempCrossB.x, tempCrossB.y, tempCrossB.z, tempInvIB);
        k += tempCrossB.x * tempInvIB.x + tempCrossB.y * tempInvIB.y + tempCrossB.z * tempInvIB.z;
    }

    return k > 1e-8 ? 1 / k : 0;
}

function applyImpulsePair(
    a: TorusBody3D,
    b: TorusBody3D | null,
    px: number,
    py: number,
    pz: number,
    jx: number,
    jy: number,
    jz: number,
): void {
    if (a.invMass > 0) {
        a.vx += jx * a.invMass;
        a.vy += jy * a.invMass;
        a.vz += jz * a.invMass;
        vec3Cross(px - a.x, py - a.y, pz - a.z, jx, jy, jz, tempCrossA);
        mat3MulVec(a.worldInvInertia, tempCrossA.x, tempCrossA.y, tempCrossA.z, tempInvIA);
        a.wx += tempInvIA.x;
        a.wy += tempInvIA.y;
        a.wz += tempInvIA.z;
    }

    if (b && b.invMass > 0) {
        b.vx -= jx * b.invMass;
        b.vy -= jy * b.invMass;
        b.vz -= jz * b.invMass;
        vec3Cross(px - b.x, py - b.y, pz - b.z, jx, jy, jz, tempCrossB);
        mat3MulVec(b.worldInvInertia, tempCrossB.x, tempCrossB.y, tempCrossB.z, tempInvIB);
        b.wx -= tempInvIB.x;
        b.wy -= tempInvIB.y;
        b.wz -= tempInvIB.z;
    }
}

function clampBodySpeeds(b: TorusBody3D): void {
    const lsSq = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz;
    if (lsSq > MAX_LINEAR_SPEED_PX * MAX_LINEAR_SPEED_PX) {
        const s = MAX_LINEAR_SPEED_PX / Math.sqrt(lsSq);
        b.vx *= s;
        b.vy *= s;
        b.vz *= s;
    }
    const asSq = b.wx * b.wx + b.wy * b.wy + b.wz * b.wz;
    if (asSq > MAX_ANGULAR_SPEED_RAD * MAX_ANGULAR_SPEED_RAD) {
        const s = MAX_ANGULAR_SPEED_RAD / Math.sqrt(asSq);
        b.wx *= s;
        b.wy *= s;
        b.wz *= s;
    }
}
