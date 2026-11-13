/**
 * 基于种子的伪随机数生成器（mulberry32 算法）。
 * 同一关使用相同种子，保证角色出场、扰动和摆关结果可复现；玩法中禁止使用 Math.random()。
 */
export class SeededRandom {
    private state: number;

    constructor(seed: number) {
        this.state = seed >>> 0;
    }

    /** 返回 [0, 1) 之间的随机小数。 */
    next(): number {
        this.state = (this.state + 0x6D2B79F5) >>> 0;
        let t = this.state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** 返回 [min, max) 之间的随机小数。 */
    range(min: number, max: number): number {
        return min + (max - min) * this.next();
    }

    /** 返回 [0, max) 之间的随机整数；max <= 0 时返回 0。 */
    int(max: number): number {
        if (max <= 0) {
            return 0;
        }
        return Math.floor(this.next() * max);
    }
}
