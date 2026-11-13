import { SeededRandom } from '../util/SeededRandom';

const DERIVATIVE_EPS = 1e-3;

/**
 * 基于种子随机数的二维旋度噪声（纯逻辑，不依赖引擎）。
 * 用 SeededRandom 打乱三维 Perlin 排列表，采样标量场 ψ(x, y, t) 的旋度 (∂ψ/∂y, -∂ψ/∂x)：
 * 1. 天然散度为 0，形成平滑涡流而不会把物体挤向同一点；
 * 2. 采样过程为纯函数，不消耗随机数次数，气泡采样多少次都不影响物理复现。
 */
export class CurlNoise {
    private readonly perm = new Uint8Array(512);

    constructor(seed: number) {
        this.reseed(seed);
    }

    /** 用指定种子重建排列表 */
    reseed(seed: number): void {
        const rng = new SeededRandom(seed);
        const table = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
            table[i] = i;
        }
        for (let i = 255; i > 0; i--) {
            const j = rng.int(i + 1);
            const tmp = table[i];
            table[i] = table[j];
            table[j] = tmp;
        }
        for (let i = 0; i < 512; i++) {
            this.perm[i] = table[i & 255];
        }
    }

    /** 计算归一化噪声坐标 (x, y) 在时刻 t 的无散涡流向量，写入 out */
    sample(x: number, y: number, t: number, out: { x: number; y: number }): void {
        const dPsiDy = (this.noise3d(x, y + DERIVATIVE_EPS, t) - this.noise3d(x, y - DERIVATIVE_EPS, t)) / (2 * DERIVATIVE_EPS);
        const dPsiDx = (this.noise3d(x + DERIVATIVE_EPS, y, t) - this.noise3d(x - DERIVATIVE_EPS, y, t)) / (2 * DERIVATIVE_EPS);
        out.x = dPsiDy;
        out.y = -dPsiDx;
    }

    private noise3d(x: number, y: number, z: number): number {
        const p = this.perm;
        const fx = Math.floor(x);
        const fy = Math.floor(y);
        const fz = Math.floor(z);
        const X = fx & 255;
        const Y = fy & 255;
        const Z = fz & 255;

        const rx = x - fx;
        const ry = y - fy;
        const rz = z - fz;

        const u = fade(rx);
        const v = fade(ry);
        const w = fade(rz);

        const A = p[X] + Y;
        const AA = p[A] + Z;
        const AB = p[A + 1] + Z;
        const B = p[X + 1] + Y;
        const BA = p[B] + Z;
        const BB = p[B + 1] + Z;

        return lerp(
            w,
            lerp(
                v,
                lerp(u, grad(p[AA], rx, ry, rz), grad(p[BA], rx - 1, ry, rz)),
                lerp(u, grad(p[AB], rx, ry - 1, rz), grad(p[BB], rx - 1, ry - 1, rz)),
            ),
            lerp(
                v,
                lerp(u, grad(p[AA + 1], rx, ry, rz - 1), grad(p[BA + 1], rx - 1, ry, rz - 1)),
                lerp(u, grad(p[AB + 1], rx, ry - 1, rz - 1), grad(p[BB + 1], rx - 1, ry - 1, rz - 1)),
            ),
        );
    }
}

function fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(t: number, a: number, b: number): number {
    return a + t * (b - a);
}

function grad(hash: number, x: number, y: number, z: number): number {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}
