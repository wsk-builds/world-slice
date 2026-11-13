import { describe, expect, it, vi } from 'vitest';
import { formatCountdown, LevelState, LevelStatus } from '../../../assets/scripts/core/level/LevelState';

describe('LevelState 关卡状态与倒计时', () => {
    it('五状态流转正确，且只有 playing 允许物理步运行', () => {
        const transitions: Array<[LevelStatus, LevelStatus]> = [];
        const level = new LevelState({ durationSec: 60, initialFreeRings: 3 });
        level.onStatusChange((next, prev) => transitions.push([prev, next]));

        expect(level.status).toBe('ready');
        expect(level.shouldRunPhysics).toBe(false);
        expect(level.pause()).toBe(false);
        expect(level.resume()).toBe(false);

        expect(level.start()).toBe(true);
        expect(level.status).toBe('playing');
        expect(level.shouldRunPhysics).toBe(true);
        expect(level.start()).toBe(false);

        expect(level.pause()).toBe(true);
        expect(level.status).toBe('paused');
        expect(level.isPaused).toBe(true);
        expect(level.shouldRunPhysics).toBe(false);

        expect(level.resume()).toBe(true);
        expect(level.status).toBe('playing');
        expect(level.shouldRunPhysics).toBe(true);

        expect(level.togglePause()).toBe('paused');
        expect(level.togglePause()).toBe('playing');

        // 所有圈锁上柱或消除 -> 过关
        level.step(1 / 60, { freeRings: 0, totalRings: 3 });
        expect(level.status).toBe('won');
        expect(level.isFinished).toBe(true);
        expect(level.shouldRunPhysics).toBe(false);
        expect(level.pause()).toBe(false);
        expect(level.resume()).toBe(false);

        expect(transitions).toEqual([
            ['ready', 'playing'],
            ['playing', 'paused'],
            ['paused', 'playing'],
            ['playing', 'paused'],
            ['paused', 'playing'],
            ['playing', 'won'],
        ]);
    });

    it('倒计时按物理时间扣减，ready/paused/终局状态下不扣减时间', () => {
        const level = new LevelState({ durationSec: 60, initialFreeRings: 4 });

        // ready 阶段不扣时间
        level.step(5, { freeRings: 4, totalRings: 4 });
        expect(level.remainingSec).toBe(60);
        expect(level.elapsedSec).toBe(0);

        level.start();
        for (let i = 0; i < 60; i++) {
            level.step(1 / 60, { freeRings: 4, totalRings: 4 });
        }
        expect(level.remainingSec).toBeCloseTo(59, 6);
        expect(level.elapsedSec).toBeCloseTo(1, 6);

        // 暂停期间不扣时间
        level.pause();
        level.step(10, { freeRings: 4, totalRings: 4 });
        expect(level.remainingSec).toBeCloseTo(59, 6);
        expect(level.elapsedSec).toBeCloseTo(1, 6);

        // 恢复后继续扣时间
        level.resume();
        level.step(9, { freeRings: 2, totalRings: 4 });
        expect(level.remainingSec).toBeCloseTo(50, 6);
        expect(level.elapsedSec).toBeCloseTo(10, 6);

        // 过关后不再扣时间
        level.step(1, { freeRings: 0, totalRings: 4 });
        expect(level.status).toBe('won');
        level.step(20, { freeRings: 0, totalRings: 4 });
        expect(level.remainingSec).toBeCloseTo(50, 6);
    });

    it('全部圈消除（totalRings 归零）同样立即判定过关，且等待最后一瞬闪烁完成时不误判超时', () => {
        const level = new LevelState({ durationSec: 10, initialFreeRings: 2 });
        level.start();

        // 先耗到只剩 0.05 秒
        level.step(9.95, { freeRings: 1, totalRings: 2 });
        expect(level.status).toBe('playing');

        // 最后一圈锁定并触发同款消除，2 个圈正在播放 0.22s 闪烁，水里已无自由圈
        level.step(0.1, { freeRings: 0, clearingRings: 2, totalRings: 2 });
        expect(level.status).toBe('playing');
        expect(level.remainingSec).toBeCloseTo(0.05, 6);

        // 闪烁销毁完成（场上已无任何圈）-> 立即过关
        level.step(0.02, { freeRings: 0, clearingRings: 0, totalRings: 0 });
        expect(level.status).toBe('won');
    });

    it('刚开局 0 圈的空缸边界不会在首帧误判过关，放圈后再全部锁定才会过关', () => {
        const level = new LevelState({ durationSec: 30, initialFreeRings: 0 });
        level.start();

        level.step(1, { freeRings: 0, totalRings: 0 });
        expect(level.status).toBe('playing');
        expect(level.remainingSec).toBeCloseTo(29, 6);

        // 调试放入 1 个圈后锁定它
        level.step(1, { freeRings: 1, totalRings: 1 });
        expect(level.status).toBe('playing');
        level.step(1 / 60, { freeRings: 0, totalRings: 1 });
        expect(level.status).toBe('won');
    });

    it('时间到且水里仍有自由圈时判为失败，且终局后不可被误改回过关', () => {
        const level = new LevelState({ durationSec: 15, initialFreeRings: 5 });
        level.start();

        level.step(14.5, { freeRings: 2, totalRings: 5 });
        expect(level.status).toBe('playing');

        level.step(0.6, { freeRings: 2, totalRings: 5 });
        expect(level.status).toBe('lost');
        expect(level.remainingSec).toBe(0);
        expect(level.shouldRunPhysics).toBe(false);

        // 失败后即使把自由圈清零也不能变成 won
        level.step(1, { freeRings: 0, totalRings: 5 });
        expect(level.status).toBe('lost');
    });

    it('addTime(sec) 仅在非终局状态生效并忽略非法值', () => {
        const level = new LevelState({ durationSec: 30, initialFreeRings: 3 });

        expect(level.addTime(10)).toBe(40);
        level.start();
        level.step(10, 3);
        expect(level.remainingSec).toBeCloseTo(30, 6);

        expect(level.addTime(20)).toBeCloseTo(50, 6);
        expect(level.addTime(-5)).toBeCloseTo(50, 6);
        expect(level.addTime(Number.NaN)).toBeCloseTo(50, 6);

        level.pause();
        expect(level.addTime(4)).toBeCloseTo(54, 6);

        level.resume();
        level.step(60, 1);
        expect(level.status).toBe('lost');
        expect(level.addTime(20)).toBe(0);
    });

    it('reset() 完整重置状态与倒计时并通知监听者', () => {
        const listener = vi.fn();
        const level = new LevelState({ durationSec: 60, initialFreeRings: 6 });
        const unsub = level.onStatusChange(listener);

        level.start();
        level.step(65, 2);
        expect(level.status).toBe('lost');

        level.reset({ durationSec: 75, initialFreeRings: 9 });
        expect(level.status).toBe('ready');
        expect(level.durationSec).toBe(75);
        expect(level.remainingSec).toBe(75);
        expect(level.elapsedSec).toBe(0);
        expect(level.hasHadRings).toBe(true);
        expect(listener).toHaveBeenLastCalledWith('ready', 'lost');

        unsub();
    });

    it('formatCountdown 正确格式化分秒且仅归零时显示 00:00', () => {
        expect(formatCountdown(60)).toBe('01:00');
        expect(formatCountdown(59.1)).toBe('01:00');
        expect(formatCountdown(59)).toBe('00:59');
        expect(formatCountdown(9.2)).toBe('00:10');
        expect(formatCountdown(0.05)).toBe('00:01');
        expect(formatCountdown(0)).toBe('00:00');
        expect(formatCountdown(-3)).toBe('00:00');
    });
});
