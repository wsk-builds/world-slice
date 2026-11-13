import { describe, expect, it } from 'vitest';
import { GameConst } from '../../assets/scripts/config/GameConst';
import { TankSpace } from '../../assets/scripts/config/TankSpace';
import { FlowField } from '../../assets/scripts/core/flow/FlowField';
import {
    BubblePool,
    MAX_BUBBLES,
    mapFlowVelocityToBubble,
} from '../../assets/scripts/render/BubblePool';

describe('BubblePool', () => {
    it('数量上限恒等于常量且双侧满压连续喷水永不超限', () => {
        expect(MAX_BUBBLES).toBe(GameConst.bubblePoolMaxCount);

        const flow = new FlowField({ seed: 42 });
        const pool = new BubblePool(flow);

        flow.setJetInputs(1, 1);
        for (let i = 0; i < 300; i++) {
            flow.step(1 / 60);
            pool.step(1 / 60);
            expect(pool.activeCount).toBeLessThanOrEqual(MAX_BUBBLES);
        }
        expect(pool.activeCount).toBe(MAX_BUBBLES);
    });

    it('平时保持少量环境气泡，喷水时从对应海眼冒出大量气泡', () => {
        const flow = new FlowField({ seed: 7 });
        const pool = new BubblePool(flow);

        // 平时静止流场 2 秒，仅少量环境气泡
        for (let i = 0; i < 120; i++) {
            flow.step(1 / 60);
            pool.step(1 / 60);
        }
        const ambientOnly = pool.activeCount;
        expect(ambientOnly).toBeGreaterThan(5);
        expect(ambientOnly).toBeLessThanOrEqual(16);

        // 左海眼喷水 0.65 秒（一口满气），气泡数明显增多且集中出现在左海眼上方
        flow.setJetInputs(1, 0);
        for (let i = 0; i < 39; i++) {
            flow.step(1 / 60);
            pool.step(1 / 60);
        }
        expect(pool.activeCount).toBeGreaterThan(ambientOnly + 6);

        const leftNozzleX = flow.jet.getNozzlePose('left').x;
        let nearLeftNozzle = 0;
        let nearRightNozzle = 0;
        const rightNozzleX = flow.jet.getNozzlePose('right').x;
        for (const item of pool.items) {
            if (!item.active || item.kind !== 'jet') {
                continue;
            }
            if (Math.abs(item.x - leftNozzleX) < 120) {
                nearLeftNozzle++;
            }
            if (Math.abs(item.x - rightNozzleX) < 80) {
                nearRightNozzle++;
            }
        }
        expect(nearLeftNozzle).toBeGreaterThanOrEqual(8);
        expect(nearRightNozzle).toBe(0);
    });

    it('新增环境气泡从缸内下 1/5 区域开始生成', () => {
        const flow = new FlowField({ seed: 11, turbulenceScale: 0 });
        const pool = new BubblePool(flow, { seedInitialAmbient: false });

        for (let i = 0; i < 60; i++) {
            pool.step(1 / 60);
            for (const b of pool.items) {
                if (b.active && b.kind === 'ambient' && b.age <= 1 / 60 + 1e-6) {
                    expect(b.y).toBeLessThanOrEqual(TankSpace.height * 0.2 + 5);
                }
            }
        }
        expect(pool.ambientCount).toBeGreaterThan(0);
    });

    it('气泡按同一 FlowField.velocityAt 漂移：左侧喷水后上方气泡向右顺时针转，右侧喷水向左逆时针转', () => {
        const runTurnProbe = (left: number, right: number): number => {
            const flow = new FlowField({ seed: 99, turbulenceScale: 0 });
            const pool = new BubblePool(flow, { seedInitialAmbient: false });
            // 先喷水建立全缸环流，再放入一颗处于顶部中线的探测气泡
            flow.setJetInputs(left, right);
            for (let i = 0; i < 40; i++) {
                flow.step(1 / 60);
            }
            flow.setJetInputs(0, 0);

            const probe = pool.items[0];
            probe.active = true;
            probe.kind = 'jet';
            probe.x = TankSpace.width * 0.5;
            probe.y = TankSpace.height * 0.8;
            probe.radius = 4;
            probe.buoyancy = 30;
            probe.age = 0;
            probe.life = 3;

            const startX = probe.x;
            for (let i = 0; i < 30; i++) {
                flow.step(1 / 60);
                pool.step(1 / 60);
            }
            return probe.x - startX;
        };

        // 左键顺时针：顶部向右（dx > 0）
        expect(runTurnProbe(1, 0)).toBeGreaterThan(40);
        // 右键逆时针：顶部向左（dx < 0）
        expect(runTurnProbe(0, 1)).toBeLessThan(-40);
    });

    it('速度映射在环流低速区 1:1 保留，在高压喷流区保持方向并平滑封顶', () => {
        const out = { x: 0, y: 0 };
        mapFlowVelocityToBubble(180, -120, out);
        expect(out.x).toBeCloseTo(180, 5);
        expect(out.y).toBeCloseTo(-120, 5);

        mapFlowVelocityToBubble(1320, 7480, out);
        const mappedSpeed = Math.hypot(out.x, out.y);
        expect(mappedSpeed).toBeLessThan(950);
        expect(mappedSpeed).toBeGreaterThan(600);
        // 方向严格保持一致
        expect(out.x / mappedSpeed).toBeCloseTo(1320 / Math.hypot(1320, 7480), 5);
        expect(out.y / mappedSpeed).toBeCloseTo(7480 / Math.hypot(1320, 7480), 5);
    });

    it('所有活跃气泡始终严格落在内屏水缸边界与底角圆弧内侧', () => {
        const flow = new FlowField({ seed: 123 });
        const pool = new BubblePool(flow);
        const r = GameConst.tankCornerRadius;

        flow.setJetInputs(1, 0);
        for (let i = 0; i < 240; i++) {
            if (i === 120) {
                flow.setJetInputs(0, 1);
            }
            flow.step(1 / 60);
            pool.step(1 / 60);

            for (const b of pool.items) {
                if (!b.active) {
                    continue;
                }
                expect(b.x).toBeGreaterThanOrEqual(b.radius);
                expect(b.x).toBeLessThanOrEqual(TankSpace.width - b.radius);
                expect(b.y).toBeGreaterThanOrEqual(b.radius);
                expect(b.y).toBeLessThan(TankSpace.height);

                if (b.y < r && b.x < r) {
                    expect(Math.hypot(r - b.x, r - b.y)).toBeLessThanOrEqual(r - b.radius + 0.01);
                } else if (b.y < r && b.x > TankSpace.width - r) {
                    expect(Math.hypot(b.x - (TankSpace.width - r), r - b.y)).toBeLessThanOrEqual(
                        r - b.radius + 0.01,
                    );
                }
            }
        }
    });
});
