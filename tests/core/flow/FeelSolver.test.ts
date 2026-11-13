import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FEEL_CONFIG, FEEL_BASE_CONST, FeelConfig } from '../../../assets/scripts/config/FeelConfig';
import {
    applyFeel,
    onFeelApplied,
    simulateLift1D,
    simulateSink1D,
    SolvedFeelConfig,
    solveFeel,
} from '../../../assets/scripts/core/flow/FeelSolver';
import { FlowField } from '../../../assets/scripts/core/flow/FlowField';

describe('FeelSolver 体感参数换算（T010）', () => {
    afterEach(() => {
        applyFeel(DEFAULT_FEEL_CONFIG);
    });

    it('FeelConfig 暴露完整 12 个体感参数且起始值符合 GDD §3.4 / T010', () => {
        expect(Object.keys(DEFAULT_FEEL_CONFIG).length).toBe(12);
        expect(DEFAULT_FEEL_CONFIG).toEqual({
            sinkSec: 3,
            tapLiftPct: 40,
            holdLiftPct: 85,
            bladderMaxBreathSec: 0.65,
            bladderRefillSec: 0.22,
            pillarPosPct: 32,
            pillarBottomPct: 26,
            nozzlePosPct: 17,
            nozzleTiltDeg: 10,
            circulationDecaySec: 1.75,
            tumbleSensitivity: 0.5,
            funnelTolerance: 0.5,
        });
    });

    it('起始值下，1D 小模拟量出的沉底时间、轻点推升与按满推升与目标相差均不超过 10%', () => {
        const solved = solveFeel(DEFAULT_FEEL_CONFIG);

        const sinkTime = simulateSink1D(
            solved.baseSinkAccel,
            solved.flowFollowRate,
            solved.ringLinearDamping,
        );
        const tapLift = simulateLift1D(
            FEEL_BASE_CONST.tapDurationSec,
            DEFAULT_FEEL_CONFIG,
            solved.baseSinkAccel,
            solved.flowFollowRate,
            solved.jetMaxSpeed,
            solved.ringLinearDamping,
        );
        const holdLift = simulateLift1D(
            DEFAULT_FEEL_CONFIG.bladderMaxBreathSec,
            DEFAULT_FEEL_CONFIG,
            solved.baseSinkAccel,
            solved.flowFollowRate,
            solved.jetMaxSpeed,
            solved.ringLinearDamping,
        );

        expect(Math.abs(sinkTime - 3) / 3).toBeLessThanOrEqual(0.1);
        expect(Math.abs(tapLift - 40) / 40).toBeLessThanOrEqual(0.1);
        expect(Math.abs(holdLift - 85) / 85).toBeLessThanOrEqual(0.1);

        expect(solved.measured.sinkSec).toBeCloseTo(sinkTime, 6);
        expect(solved.measured.tapLiftPct).toBeCloseTo(tapLift, 6);
        expect(solved.measured.holdLiftPct).toBeCloseTo(holdLift, 6);
    });

    it('把沉底秒数改成 2 秒，小模拟量出的沉底时间跟着变成约 2 秒（±10%）且下沉加速度增大', () => {
        const defaultSolved = solveFeel(DEFAULT_FEEL_CONFIG);
        const fastParams = { ...DEFAULT_FEEL_CONFIG, sinkSec: 2 };
        const fastSolved = solveFeel(fastParams);

        const measuredSink = simulateSink1D(
            fastSolved.baseSinkAccel,
            fastSolved.flowFollowRate,
            fastSolved.ringLinearDamping,
        );
        expect(Math.abs(measuredSink - 2) / 2).toBeLessThanOrEqual(0.1);
        expect(measuredSink).toBeLessThan(defaultSolved.measured.sinkSec - 0.7);
        expect(fastSolved.baseSinkAccel).toBeGreaterThan(defaultSolved.baseSinkAccel);
    });

    it('修改轻点推升与按满推升目标时，小模拟量出的升高同步落入新目标 ±10% 内', () => {
        const custom = { ...DEFAULT_FEEL_CONFIG, tapLiftPct: 30, holdLiftPct: 92 };
        const solved = solveFeel(custom);

        expect(Math.abs(solved.measured.tapLiftPct - 30) / 30).toBeLessThanOrEqual(0.1);
        expect(Math.abs(solved.measured.holdLiftPct - 92) / 92).toBeLessThanOrEqual(0.1);
    });

    it('翻滚灵敏度与入柱宽容旋钮在 0–1 区间单调换算', () => {
        const lowTumble = solveFeel({ ...DEFAULT_FEEL_CONFIG, tumbleSensitivity: 0 });
        const midTumble = solveFeel({ ...DEFAULT_FEEL_CONFIG, tumbleSensitivity: 0.5 });
        const highTumble = solveFeel({ ...DEFAULT_FEEL_CONFIG, tumbleSensitivity: 1 });

        expect(lowTumble.ringAngularDamping).toBeGreaterThan(midTumble.ringAngularDamping);
        expect(midTumble.ringAngularDamping).toBeGreaterThan(highTumble.ringAngularDamping);
        expect(lowTumble.tumbleTorqueScale).toBeLessThan(midTumble.tumbleTorqueScale);
        expect(midTumble.tumbleTorqueScale).toBeCloseTo(1, 6);
        expect(highTumble.tumbleTorqueScale).toBeGreaterThan(midTumble.tumbleTorqueScale);

        const zeroFunnel = solveFeel({ ...DEFAULT_FEEL_CONFIG, funnelTolerance: 0 });
        const midFunnel = solveFeel({ ...DEFAULT_FEEL_CONFIG, funnelTolerance: 0.5 });
        const maxFunnel = solveFeel({ ...DEFAULT_FEEL_CONFIG, funnelTolerance: 1 });

        expect(zeroFunnel.funnel.radiusPx).toBe(0);
        expect(zeroFunnel.funnel.pullAccel).toBe(0);
        expect(midFunnel.funnel.maxAngleDeg).toBeCloseTo(35, 6);
        expect(maxFunnel.funnel.radiusPx).toBeGreaterThan(midFunnel.funnel.radiusPx);
        expect(maxFunnel.funnel.pullAccel).toBeGreaterThan(midFunnel.funnel.pullAccel);
        expect(maxFunnel.funnel.alignRate).toBeGreaterThan(midFunnel.funnel.alignRate);
    });

    it('applyFeel() 立刻更新 SolvedFeelConfig 并触发回调，驱动 FlowField 生效', () => {
        const listener = vi.fn();
        const unsub = onFeelApplied(listener);

        const field = new FlowField({ seed: 1024, turbulenceScale: 0 });
        field.setJetInput('left', 1);
        const poseBefore = field.jet.getNozzlePose('left');
        const speedBefore = Math.hypot(
            field.velocityAt(poseBefore.x, 40).x,
            field.velocityAt(poseBefore.x, 40).y,
        );

        FeelConfig.sinkSec = 2;
        FeelConfig.nozzlePosPct = 20;
        const updated = applyFeel();
        field.applyConfig();

        expect(updated).toBe(SolvedFeelConfig);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(Math.abs(SolvedFeelConfig.measured.sinkSec - 2) / 2).toBeLessThanOrEqual(0.1);

        const poseAfter = field.jet.getNozzlePose('left');
        const speedAfter = Math.hypot(
            field.velocityAt(poseAfter.x, 40).x,
            field.velocityAt(poseAfter.x, 40).y,
        );
        expect(poseAfter.x).not.toBeCloseTo(poseBefore.x, 3);
        expect(speedAfter).toBeGreaterThan(speedBefore);

        unsub();
    });
});
