import { describe, expect, it, vi } from 'vitest';
import { FeelConfig } from '../../../assets/scripts/config/FeelConfig';
import { calcRingPillarGeometry, GameConst } from '../../../assets/scripts/config/GameConst';
import { TankSpace } from '../../../assets/scripts/config/TankSpace';
import { FlowField, FlowTermObject, FlowVec2 } from '../../../assets/scripts/core/flow/FlowField';

function speedOf(v: FlowVec2): number {
    return Math.hypot(v.x, v.y);
}

describe('FlowField 水流速度场（T006）', () => {
    it('海眼位于缸宽 14% 与 86%，向内倾 10°，左右严格镜像对称', () => {
        const field = new FlowField({ seed: 42, turbulenceScale: 0 });
        const leftPose = field.jet.getNozzlePose('left');
        const rightPose = field.jet.getNozzlePose('right');

        expect(leftPose.x).toBeCloseTo(TankSpace.pctToPxX(FeelConfig.nozzlePosPct), 5);
        expect(rightPose.x).toBeCloseTo(TankSpace.pctToPxX(100 - FeelConfig.nozzlePosPct), 5);
        expect(leftPose.y).toBe(0);
        expect(rightPose.y).toBe(0);

        const rad10 = (10 * Math.PI) / 180;
        expect(leftPose.axisX).toBeCloseTo(Math.sin(rad10), 6);
        expect(leftPose.axisY).toBeCloseTo(Math.cos(rad10), 6);
        expect(rightPose.axisX).toBeCloseTo(-Math.sin(rad10), 6);
        expect(rightPose.axisY).toBeCloseTo(Math.cos(rad10), 6);

        field.setJetInputs(0.8, 0.8);
        const vLeft = field.velocityAt(200, 180);
        const vRight = field.velocityAt(TankSpace.width - 200, 180);
        expect(vRight.x).toBeCloseTo(-vLeft.x, 6);
        expect(vRight.y).toBeCloseTo(vLeft.y, 6);
    });

    it('主喷流中心线上越高越弱，底部冲力强、到柱尖高度明显变柔', () => {
        const field = new FlowField({ seed: 7, turbulenceScale: 0 });
        field.setJetInput('left', 1);

        const pose = field.jet.getNozzlePose('left');
        const heights = [10, 80, 160, 240, 320, 420, 520];
        const speeds = heights.map((y) => {
            const along = y / pose.axisY;
            const x = pose.x + along * pose.axisX;
            const v = field.velocityAt(x, y);
            // 中心线上流向与内倾轴一致（向右上方）
            expect(v.x).toBeGreaterThan(0);
            expect(v.y).toBeGreaterThan(0);
            return speedOf(v);
        });

        for (let i = 1; i < speeds.length; i++) {
            expect(speeds[i]).toBeLessThan(speeds[i - 1]);
        }

        // 柱尖高度处水速已明显发散变柔（小于海眼口水速的一半）
        const geom = calcRingPillarGeometry(TankSpace.width);
        const pillarTipY = TankSpace.pctToPxY(FeelConfig.pillarBottomPct) + geom.pillarBaseHeight + geom.pillarHeight;
        const tipAlong = pillarTipY / pose.axisY;
        const tipSpeed = speedOf(field.velocityAt(pose.x + tipAlong * pose.axisX, pillarTipY));
        const mouthSpeed = speedOf(field.velocityAt(pose.x, 0));
        expect(tipSpeed).toBeLessThan(mouthSpeed * 0.5);
        expect(tipSpeed).toBeGreaterThan(mouthSpeed * 0.2);

        // 即使开启默认扰动，主喷流中心线上从底到高同样单调递减
        const fullField = new FlowField({ seed: 7 });
        fullField.setJetInput('left', 1);
        const fullSpeeds = heights.map((y) => {
            const along = y / pose.axisY;
            return speedOf(fullField.velocityAt(pose.x + along * pose.axisX, y));
        });
        for (let i = 1; i < fullSpeeds.length; i++) {
            expect(fullSpeeds[i]).toBeLessThan(fullSpeeds[i - 1]);
        }
    });

    it('主喷流为下窄上宽的锥形，锥形之外严格为 0', () => {
        const field = new FlowField({ seed: 100, turbulenceScale: 0 });
        field.setJetInput('left', 1);

        const pose = field.jet.getNozzlePose('left');
        const tanHalf = Math.tan((GameConst.jetHalfAngleDeg * Math.PI) / 180);
        const perpX = -pose.axisY;
        const perpY = pose.axisX;

        // 下窄上宽：在 along = 40 处恰好在锥外的位置 perp = 40，到了 along = 300 处已在锥内
        const nearAlong = 40;
        const nearHalfWidth = GameConst.jetMouthHalfWidth + nearAlong * tanHalf;
        const testPerp = nearHalfWidth + 5; // 在底部锥外

        const nearPtX = pose.x + nearAlong * pose.axisX + testPerp * perpX;
        const nearPtY = pose.y + nearAlong * pose.axisY + testPerp * perpY;
        expect(field.velocityAt(nearPtX, nearPtY)).toEqual({ x: 0, y: 0 });

        const highAlong = 300;
        const highHalfWidth = GameConst.jetMouthHalfWidth + highAlong * tanHalf;
        expect(testPerp).toBeLessThan(highHalfWidth);
        const highPtX = pose.x + highAlong * pose.axisX + testPerp * perpX;
        const highPtY = pose.y + highAlong * pose.axisY + testPerp * perpY;
        expect(speedOf(field.velocityAt(highPtX, highPtY))).toBeGreaterThan(0);

        // 各处锥形之外采样点严格为 0
        const outsideSamples: FlowVec2[] = [
            // 海眼正下方（along < 0）
            { x: pose.x, y: -10 },
            // 高处锥形左右边界外侧
            {
                x: pose.x + highAlong * pose.axisX + (highHalfWidth + 1) * perpX,
                y: pose.y + highAlong * pose.axisY + (highHalfWidth + 1) * perpY,
            },
            {
                x: pose.x + highAlong * pose.axisX - (highHalfWidth + 1) * perpX,
                y: pose.y + highAlong * pose.axisY - (highHalfWidth + 1) * perpY,
            },
            // 水缸中央与右侧远端
            { x: TankSpace.width * 0.6, y: 120 },
            { x: TankSpace.width * 0.85, y: 260 },
            // 超过水面（along >= jetRange）
            { x: pose.x + 620 * pose.axisX, y: 620 * pose.axisY },
        ];

        for (const pt of outsideSamples) {
            const v = field.velocityAt(pt.x, pt.y);
            expect(v.x).toBe(0);
            expect(v.y).toBe(0);
        }
    });

    it('按下立刻出水，松手后保留 0.25–0.3 秒余韵衰减', () => {
        const field = new FlowField({ seed: 12, turbulenceScale: 0 });
        const pose = field.jet.getNozzlePose('left');

        field.setJetInput('left', 1);
        const peakSpeed = speedOf(field.jet.sample ? (() => {
            const out = { x: 0, y: 0 };
            field.jet.sample(pose.x, 20, out);
            return out;
        })() : { x: 0, y: 0 });
        expect(field.getJetLevel('left')).toBe(1);
        expect(peakSpeed).toBeGreaterThan(0);

        // 松手瞬间仍有余韵，不会突变为 0
        field.setJetInput('left', 0);
        expect(field.getJetLevel('left')).toBe(1);

        // 0.12 秒时余韵仍在（约 25%~40%）
        field.step(0.12);
        expect(field.getJetLevel('left')).toBeGreaterThan(0.2);
        expect(field.getJetLevel('left')).toBeLessThan(0.5);

        // 累计到 0.28 秒（0.25–0.3 秒区间内）衰减至约 5%，到 0.30 秒低于 5%
        field.step(0.18);
        expect(field.getJetLevel('left')).toBeLessThan(0.05);
        expect(field.getJetLevel('left')).toBeGreaterThan(0);
    });

    it('只按左键只产生顺时针环流，松手约 2 秒后衰减到 5% 以下；右键只产生逆时针环流', () => {
        const field = new FlowField({ seed: 99, turbulenceScale: 0 });

        // 按住左键 0.5 秒建立环流
        field.setJetInput('left', 1);
        for (let i = 0; i < 30; i++) {
            field.step(1 / 60);
        }
        field.setJetInput('left', 0);

        const initialMomentum = field.getCirculation();
        expect(initialMomentum).toBeGreaterThan(0);

        const cx = TankSpace.width / 2;
        const cy = TankSpace.height / 2;
        const sampleCirc = (x: number, y: number): FlowVec2 => {
            const out = { x: 0, y: 0 };
            field.circulation.sample(x, y, out);
            return out;
        };

        // 四象限方向校验：顺时针 = 左上(+y)、顶右(+x)、右下(-y)、底左(-x)
        expect(sampleCirc(120, cy).y).toBeGreaterThan(0);
        expect(sampleCirc(cx, TankSpace.height - 60).x).toBeGreaterThan(0);
        expect(sampleCirc(TankSpace.width - 120, cy).y).toBeLessThan(0);
        expect(sampleCirc(cx, 50).x).toBeLessThan(0);

        // 全缸网格任意非中心点角动量叉积 (x - cx)*vy - (y - cy)*vx < 0（严格顺时针）
        for (let gx = 80; gx <= TankSpace.width - 80; gx += 160) {
            for (let gy = 60; gy <= TankSpace.height - 60; gy += 110) {
                if (Math.abs(gx - cx) < 1 && Math.abs(gy - cy) < 1) {
                    continue;
                }
                const v = sampleCirc(gx, gy);
                const cross = (gx - cx) * v.y - (gy - cy) * v.x;
                expect(cross).toBeLessThan(0);
            }
        }

        const initialBottomSpeed = Math.abs(sampleCirc(cx, 40).x);
        expect(initialBottomSpeed).toBeGreaterThan(50);

        // 推进 1.0 秒：仍有明显余韵（> 15%）
        for (let i = 0; i < 60; i++) {
            field.step(1 / 60);
        }
        expect(field.getCirculation()).toBeGreaterThan(initialMomentum * 0.15);

        // 再推进 1.0 秒（累计 2.0 秒）：动量与总水速（此时喷流余韵也早已归零）均衰减到 5% 以下
        for (let i = 0; i < 60; i++) {
            field.step(1 / 60);
        }
        expect(field.getCirculation()).toBeGreaterThanOrEqual(0);
        expect(field.getCirculation()).toBeLessThan(initialMomentum * 0.05);
        expect(Math.abs(field.velocityAt(cx, 40).x)).toBeLessThan(initialBottomSpeed * 0.05);

        // 右键只产生逆时针环流
        const rightField = new FlowField({ seed: 99, turbulenceScale: 0 });
        rightField.setJetInput('right', 1);
        rightField.step(0.5);
        expect(rightField.getCirculation()).toBeLessThan(0);
        const rvTop = { x: 0, y: 0 };
        const rvBottom = { x: 0, y: 0 };
        rightField.circulation.sample(cx, TankSpace.height - 60, rvTop);
        rightField.circulation.sample(cx, 50, rvBottom);
        expect(rvTop.x).toBeLessThan(0);
        expect(rvBottom.x).toBeGreaterThan(0);
    });

    it('同种子、同输入结果完全相同，不同种子不同，且全程不调用 Math.random', () => {
        const randomSpy = vi.spyOn(Math, 'random');

        const runSequence = (seed: number, extraBubbleReads: boolean): FlowVec2[] => {
            const f = new FlowField({ seed });
            for (let frame = 0; frame < 90; frame++) {
                const left = frame >= 5 && frame < 35 ? 1 : 0;
                const right = frame >= 45 && frame < 65 ? 0.6 : 0;
                f.setJetInputs(left, right);
                f.step(1 / 60);

                if (extraBubbleReads) {
                    // 模拟气泡系统高频读取水速，不得污染随机数或改变后续物理水速
                    for (let b = 0; b < 20; b++) {
                        f.velocityAt(b * 40, b * 25);
                    }
                }
            }
            return [
                f.velocityAt(180, 120),
                f.velocityAt(470, 280),
                f.velocityAt(760, 360),
                f.velocityAt(310, 90),
            ];
        };

        const runA = runSequence(20261113, false);
        const runB = runSequence(20261113, true);
        const runDifferentSeed = runSequence(98765432, false);

        expect(runA).toEqual(runB);
        expect(runA).not.toEqual(runDifferentSeed);
        expect(randomSpy).not.toHaveBeenCalled();

        randomSpy.mockRestore();
    });

    it('velocityAt 等于各项之和，且支持 addTerm / removeTerm 动态增删额外项', () => {
        const field = new FlowField({ seed: 777 });
        field.setJetInputs(0.7, 0.3);
        field.step(0.2);

        let elapsedInTerm = 0;
        const customObjTerm: FlowTermObject = {
            id: 'test:vortex',
            step(dt: number) {
                elapsedInTerm += dt;
            },
            sample(x: number, y: number, out: FlowVec2) {
                out.x = x * 0.05;
                out.y = -y * 0.02 + elapsedInTerm * 10;
            },
        };
        const removeFnTerm = field.addTerm((_x, _y, out) => {
            out.x += 15;
            out.y += -8;
        });
        field.addTerm(customObjTerm);
        // 重复挂载同一项不会叠加两次
        field.addTerm(customObjTerm);

        field.step(0.5);
        expect(elapsedInTerm).toBeCloseTo(0.5, 6);

        const x = 230;
        const y = 190;
        const jetV = { x: 0, y: 0 };
        const circV = { x: 0, y: 0 };
        const turbV = { x: 0, y: 0 };
        const objV = { x: 0, y: 0 };
        field.jet.sample(x, y, jetV);
        field.circulation.sample(x, y, circV);
        field.turbulence.sample(x, y, turbV);
        customObjTerm.sample(x, y, objV);

        const total = field.velocityAt(x, y);
        expect(total.x).toBeCloseTo(jetV.x + circV.x + turbV.x + objV.x + 15, 6);
        expect(total.y).toBeCloseTo(jetV.y + circV.y + turbV.y + objV.y - 8, 6);

        // 移除两个额外项后回到三项基础水流之和
        removeFnTerm();
        expect(field.removeTerm(customObjTerm)).toBe(true);
        expect(field.removeTerm(customObjTerm)).toBe(false);

        const baseOnly = field.velocityAt(x, y);
        expect(baseOnly.x).toBeCloseTo(jetV.x + circV.x + turbV.x, 6);
        expect(baseOnly.y).toBeCloseTo(jetV.y + circV.y + turbV.y, 6);
    });
});
