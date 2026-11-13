import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameConst } from '../../../assets/scripts/config/GameConst';
import {
    getRingSpeciesKey,
    LevelData,
    parseLevelIdFromSearch,
    resolvePillarEnergyEnabled,
} from '../../../assets/scripts/core/level/LevelData';
import { validateLevel } from '../../../assets/scripts/core/level/validateLevel';

function makeBaseLevel(overrides?: Partial<LevelData>): LevelData {
    return {
        id: 'T01',
        title: '测试关',
        durationSec: 60,
        type: 'normal',
        seed: 1234,
        rings: [
            { kind: 'normal', color: 'red', pos: { xPct: 20, yPct: 30 } },
            { kind: 'normal', color: 'red', pos: 'random' },
            { kind: 'normal', color: 'green', pos: 'random' },
            { kind: 'normal', color: 'green', pos: 'random' },
            { kind: 'normal', color: 'blue', pos: 'random' },
            { kind: 'normal', color: 'blue', pos: 'random' },
        ],
        mechanisms: [],
        actors: [],
        ...overrides,
    };
}

describe('validateLevel 关卡数据校验', () => {
    it('合法的普通关数据应通过校验并保留充能与叙事字段', () => {
        const input = makeBaseLevel({
            pillarEnergy: { left: true, right: false },
            narrative: {
                slateTitle: '第一幕',
                slateSubtitle: '浅礁试水',
                chinCue: '锁脉环散落了。',
            },
            note: '基础测试',
        });

        const res = validateLevel(input);
        expect(res.valid).toBe(true);
        expect(res.errors).toEqual([]);
        expect(res.level?.id).toBe('T01');
        expect(resolvePillarEnergyEnabled(res.level)).toEqual({ left: true, right: false });
        expect(resolvePillarEnergyEnabled(makeBaseLevel())).toEqual({ left: true, right: true });
    });

    it('圈总数超过两柱容量之和（12）或为 0 时拒绝', () => {
        const emptyRes = validateLevel(makeBaseLevel({ rings: [] }));
        expect(emptyRes.valid).toBe(false);

        const maxAllowed = GameConst.pillarCapacity * 2;
        const exact12 = Array.from({ length: maxAllowed }, (_, i) => ({
            kind: 'normal' as const,
            color: (['red', 'green', 'blue'] as const)[i % 3],
            pos: 'random' as const,
        }));
        expect(validateLevel(makeBaseLevel({ rings: exact12 })).valid).toBe(true);

        const over12 = [...exact12, { kind: 'normal' as const, color: 'red' as const, pos: 'random' as const }];
        const overRes = validateLevel(makeBaseLevel({ rings: over12 }));
        expect(overRes.valid).toBe(false);
        expect(overRes.errors.some((e) => e.includes('12'))).toBe(true);
    });

    it('同时出现的圈种超过 5 种时拒绝，正好 5 种允许通过', () => {
        const fiveSpecies = makeBaseLevel({
            rings: [
                { kind: 'normal', color: 'red', pos: 'random' },
                { kind: 'normal', color: 'green', pos: 'random' },
                { kind: 'normal', color: 'blue', pos: 'random' },
                { kind: 'gold', pos: 'random' },
                { kind: 'iron', pos: 'random' },
                { kind: 'iron', pos: 'random' },
            ],
        });
        expect(validateLevel(fiveSpecies).valid).toBe(true);

        const sixSpecies = makeBaseLevel({
            rings: [
                { kind: 'normal', color: 'red', pos: 'random' },
                { kind: 'normal', color: 'green', pos: 'random' },
                { kind: 'normal', color: 'blue', pos: 'random' },
                { kind: 'normal', color: 'orange', pos: 'random' },
                { kind: 'gold', pos: 'random' },
                { kind: 'iron', pos: 'random' },
            ],
        });
        const sixRes = validateLevel(sixSpecies);
        expect(sixRes.valid).toBe(false);
        expect(sixRes.errors.some((e) => e.includes('5'))).toBe(true);
    });

    it('校验圈颜色、百分比范围、时间、类型与种子合法性', () => {
        const badRings = makeBaseLevel({
            rings: [
                { kind: 'normal', pos: { xPct: 0, yPct: 50 } },
                { kind: 'gold', color: 'red', pos: { xPct: 50, yPct: 101 } },
            ],
            durationSec: 0,
            seed: 1.5,
            type: 'unknown' as LevelData['type'],
        });
        const res = validateLevel(badRings);
        expect(res.valid).toBe(false);
        expect(res.errors.length).toBeGreaterThanOrEqual(5);
    });

    it('校验机关与角色出场表的字段与范围', () => {
        const validComplex = makeBaseLevel({
            type: 'rescue',
            mechanisms: [
                { type: 'gate', pos: { xPct: 50, yPct: 50 } },
                { type: 'vortex', pos: { xPct: 25, yPct: 60 }, params: { power: 1.2 } },
            ],
            actors: [
                { type: 'turtle', spawnSec: 5, side: 'left', pos: { xPct: 16, yPct: 18 } },
                { type: 'crab', spawnSec: 12, side: 'right', repeatSec: 20 },
            ],
        });
        expect(validateLevel(validComplex).valid).toBe(true);

        const badActor = makeBaseLevel({
            actors: [{ type: 'crab', spawnSec: -1, side: 'center' as 'left', pos: { xPct: 120, yPct: 50 } }],
            mechanisms: [{ type: 'laser' as 'gate', pos: { xPct: 50, yPct: -5 } }],
        });
        const res = validateLevel(badActor);
        expect(res.valid).toBe(false);
        expect(res.errors.length).toBeGreaterThanOrEqual(4);
    });

    it('parseLevelIdFromSearch 安全解析 ?level= 参数并过滤非法输入', () => {
        expect(parseLevelIdFromSearch('')).toBe(GameConst.defaultLevelId);
        expect(parseLevelIdFromSearch(undefined)).toBe(GameConst.defaultLevelId);
        expect(parseLevelIdFromSearch('?level=X02')).toBe('X02');
        expect(parseLevelIdFromSearch('?foo=1&level=X03&bot=1')).toBe('X03');
        expect(parseLevelIdFromSearch('?level=../../etc/passwd')).toBe(GameConst.defaultLevelId);
        expect(parseLevelIdFromSearch('?level=')).toBe(GameConst.defaultLevelId);
    });

    it('仓库内置灰盒试验关 X01 / X02 / X03 均通过校验且圈数与配对合理可过关', () => {
        const expected = [
            { id: 'X01', count: 6, leftEnergy: true, rightEnergy: true },
            { id: 'X02', count: 9, leftEnergy: false, rightEnergy: false },
            { id: 'X03', count: 12, leftEnergy: true, rightEnergy: false },
        ];

        for (const item of expected) {
            const rawText = readFileSync(
                join(process.cwd(), 'assets', 'resources', 'levels', `${item.id}.json`),
                'utf8',
            );
            const parsed = JSON.parse(rawText);
            const res = validateLevel(parsed);
            expect(res.valid, `${item.id} 校验失败: ${res.errors.join('; ')}`).toBe(true);
            expect(res.level?.id).toBe(item.id);
            expect(res.level?.rings.length).toBe(item.count);
            expect(resolvePillarEnergyEnabled(res.level)).toEqual({
                left: item.leftEnergy,
                right: item.rightEnergy,
            });

            // 确认消除同款后剩余单圈数 <= 单柱容量 (6)，且同时出现圈种 <= 5，绝不锁死
            const counts = new Map<string, number>();
            for (const ring of res.level!.rings) {
                const key = getRingSpeciesKey(ring);
                counts.set(key, (counts.get(key) ?? 0) + 1);
            }
            expect(counts.size).toBeLessThanOrEqual(GameConst.maxLevelRingSpecies);
            let leftoverSingletons = 0;
            for (const c of counts.values()) {
                leftoverSingletons += c % 2;
            }
            expect(leftoverSingletons).toBeLessThanOrEqual(GameConst.pillarCapacity);
        }
    });
});
