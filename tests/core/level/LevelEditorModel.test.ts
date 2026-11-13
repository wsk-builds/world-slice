import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FeelConfig } from '../../../assets/scripts/config/FeelConfig';
import { GameConst } from '../../../assets/scripts/config/GameConst';
import { TankSpace } from '../../../assets/scripts/config/TankSpace';
import { LevelData, LevelPercentPos } from '../../../assets/scripts/core/level/LevelData';
import {
    clampEditorRingTankPos,
    getEditorRingRadii,
    LevelEditorModel,
} from '../../../assets/scripts/core/level/LevelEditorModel';
import {
    isCircleInsideTank,
    overlapsPillar2D,
    resolveLevelRingLayout,
} from '../../../assets/scripts/core/level/LevelRingLayout';
import { validateLevel } from '../../../assets/scripts/core/level/validateLevel';
import { PillarCollider3D } from '../../../assets/scripts/core/physics3d/PillarCollider3D';
import { calcRingPillarGeometry } from '../../../assets/scripts/config/GameConst';

function loadBuiltInLevel(id: string): LevelData {
    const raw = readFileSync(join(process.cwd(), 'assets', 'resources', 'levels', `${id}.json`), 'utf8');
    const parsed = validateLevel(JSON.parse(raw));
    expect(parsed.valid).toBe(true);
    return parsed.level!;
}

describe('LevelEditorModel 拖拽摆关器纯逻辑', () => {
    it('从现有 LevelData 载入并保留全部元数据与显式位置', () => {
        const x01 = loadBuiltInLevel('X01');
        const complexLevel: LevelData = {
            ...x01,
            type: 'rescue',
            mechanisms: [{ type: 'gate', pos: { xPct: 50, yPct: 48 } }],
            actors: [{ type: 'crab', spawnSec: 8, side: 'left', pos: { xPct: 14, yPct: 8 } }],
            note: '带机关与角色元数据测试',
        };

        const model = new LevelEditorModel();
        model.loadFromLevel(complexLevel);

        expect(model.levelId).toBe('X01');
        expect(model.durationSec).toBe(x01.durationSec);
        expect(model.ringCount).toBe(6);
        expect(model.selectedRingId).not.toBeNull();

        const exported = model.exportJson();
        expect(exported.ok).toBe(true);
        const parsed = JSON.parse(exported.json) as LevelData;
        expect(parsed.id).toBe('X01');
        expect(parsed.type).toBe('rescue');
        expect(parsed.seed).toBe(x01.seed);
        expect(parsed.pillarEnergy).toEqual(x01.pillarEnergy);
        expect(parsed.mechanisms).toEqual(complexLevel.mechanisms);
        expect(parsed.actors).toEqual(complexLevel.actors);
        expect(parsed.narrative).toEqual(x01.narrative);
        expect(parsed.note).toBe(complexLevel.note);
        for (const ring of parsed.rings) {
            expect(ring.pos).not.toBe('random');
        }
    });

    it('拖拽更新百分比坐标并夹紧在 validateLevel 范围与底角圆弧安全区内', () => {
        const x01 = loadBuiltInLevel('X01');
        const model = new LevelEditorModel();
        model.loadFromLevel(x01);

        const target = model.getRings()[0];
        const startPos = model.getRingTankPos(target);
        const hit = model.beginDragAt(startPos.x + 5, startPos.y - 4);
        expect(hit?.source).toBe('ring');
        expect(hit?.id).toBe(target.id);

        // 拖向左下底角死角外 (-40, -20)
        const stepCorner = model.moveDragTo(-40, -20);
        expect(stepCorner).not.toBeNull();
        expect(stepCorner!.pct.xPct).toBeGreaterThanOrEqual(GameConst.levelPosMinXPct);
        expect(stepCorner!.pct.yPct).toBeGreaterThanOrEqual(GameConst.levelPosMinYPct);

        const { outerRadius } = getEditorRingRadii(target.spec, TankSpace.width);
        const cr = GameConst.tankCornerRadius;
        expect(Math.hypot(stepCorner!.x - cr, stepCorner!.y - cr)).toBeLessThanOrEqual(cr - outerRadius - 4);

        // 拖向右上边界外 (2000, 900)
        const stepTopRight = model.moveDragTo(2000, 900);
        expect(stepTopRight).not.toBeNull();
        expect(stepTopRight!.pct.xPct).toBeLessThanOrEqual(GameConst.levelPosMaxXPct);
        expect(stepTopRight!.pct.yPct).toBeLessThanOrEqual(GameConst.levelPosMaxYPct);
        expect(isCircleInsideTank(stepTopRight!.x, stepTopRight!.y, outerRadius, TankSpace.width, TankSpace.height, cr, 4)).toBe(true);

        const ended = model.endDrag();
        expect(ended?.pct).toEqual({ xPct: target.xPct, yPct: target.yPct });
    });

    it('增删圈、改圈种颜色、12 圈上限与超过 5 种圈校验阻断导出', () => {
        const x03 = loadBuiltInLevel('X03'); // 12 圈, 5 种
        const model = new LevelEditorModel();
        model.loadFromLevel(x03);

        // 满 12 个时禁止再新增
        expect(model.ringCount).toBe(12);
        const blockedAdd = model.addRing({ kind: 'normal', color: 'red' });
        expect(blockedAdd.ok).toBe(false);
        expect(blockedAdd.reason).toContain('12');

        // 删掉一个后可新增，且自动避开双柱与已有圈
        const delRes = model.deleteSelectedRing();
        expect(delRes.ok).toBe(true);
        expect(model.ringCount).toBe(11);

        const added = model.addRing({ kind: 'wood' });
        expect(added.ok).toBe(true);
        expect(model.ringCount).toBe(12);
        // X03 原有 red/green/blue/gold/iron 5 种，再加 wood 变为 6 种，应提示校验失败且阻止导出
        expect(added.validation.valid).toBe(false);
        expect(model.exportJson().ok).toBe(false);

        const geom = calcRingPillarGeometry(TankSpace.width);
        const leftPillar = new PillarCollider3D(
            (FeelConfig.pillarPosPct / 100) * TankSpace.width,
            (FeelConfig.pillarBottomPct / 100) * TankSpace.height,
            geom,
        );
        const rightPillar = new PillarCollider3D(
            ((100 - FeelConfig.pillarPosPct) / 100) * TankSpace.width,
            (FeelConfig.pillarBottomPct / 100) * TankSpace.height,
            geom,
        );
        const addedPos = model.getRingTankPos(added.ring!);
        const addedR = getEditorRingRadii(added.ring!.spec, TankSpace.width).outerRadius;
        expect(overlapsPillar2D(addedPos.x, addedPos.y, addedR, leftPillar, 4)).toBe(false);
        expect(overlapsPillar2D(addedPos.x, addedPos.y, addedR, rightPillar, 4)).toBe(false);

        // 改回已有圈种（如 normal red），恢复 5 种并通过校验可导出
        const fixed = model.setRingSpec(added.ring!.id, { kind: 'normal', color: 'red' });
        expect(fixed.ok).toBe(true);
        expect(fixed.validation.valid).toBe(true);
        expect(model.exportJson().ok).toBe(true);

        // 小金环放在最靠边安全位置，切回普通大圈时会自动向内再夹紧
        const edgeGold = clampEditorRingTankPos(35, 300, { kind: 'gold' });
        model.setRingPositionByTankPx(added.ring!.id, edgeGold.x, edgeGold.y);
        model.setRingSpec(added.ring!.id, { kind: 'gold' });
        const goldX = model.getRingTankPos(added.ring!).x;
        model.setRingSpec(added.ring!.id, { kind: 'normal', color: 'orange' });
        const normalX = model.getRingTankPos(added.ring!).x;
        expect(normalX).toBeGreaterThanOrEqual(goldX);
    });

    it('支持调整倒计时秒数并夹紧合法区间', () => {
        const x01 = loadBuiltInLevel('X01');
        const model = new LevelEditorModel();
        model.loadFromLevel(x01);

        expect(model.adjustDurationSec(15)).toBe(75);
        expect(model.adjustDurationSec(-20)).toBe(55);
        expect(model.adjustDurationSec(-999)).toBe(GameConst.editorMinDurationSec);
        expect(model.adjustDurationSec(999)).toBe(GameConst.editorMaxDurationSec);

        const exported = model.exportJson();
        expect(exported.ok).toBe(true);
        const parsed = JSON.parse(exported.json) as LevelData;
        expect(parsed.durationSec).toBe(GameConst.editorMaxDurationSec);
    });

    it('registerDraggable 通用拖拽项命中优先、自定义夹紧与回调完整生效', () => {
        const x01 = loadBuiltInLevel('X01');
        const model = new LevelEditorModel();
        model.loadFromLevel(x01);

        const ring0 = model.getRings()[0];
        const ring0Pos = model.getRingTankPos(ring0);

        let mechPos = { x: ring0Pos.x + 4, y: ring0Pos.y + 4 };
        let lastPct: LevelPercentPos | null = null;
        const onSelect = vi.fn();
        const onDragStart = vi.fn();
        const onDragEnd = vi.fn();

        const unregister = model.registerDraggable({
            id: 'gate_1',
            kind: 'gate',
            hitRadiusPx: 30,
            priority: 10,
            getPosition: () => mechPos,
            clampPosition: (x, y) => ({
                x: Math.min(Math.max(x, 100), 900),
                y: Math.min(Math.max(y, 80), 500),
            }),
            setPosition: (x, y, pct) => {
                mechPos = { x, y };
                lastPct = pct;
            },
            onSelect,
            onDragStart,
            onDragEnd,
        });

        // 同一位置同时命中 gate_1（优先级 10）与 ring0（优先级 0），应优先命中 gate_1
        const hit = model.beginDragAt(mechPos.x, mechPos.y);
        expect(hit?.source).toBe('draggable');
        expect(hit?.id).toBe('gate_1');
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onDragStart).toHaveBeenCalledWith(mechPos.x, mechPos.y);

        // 拖动超出自定义 clampPosition 范围，应被夹紧在 [100..900, 80..500]
        const moveRes = model.moveDragTo(50, 20);
        expect(moveRes?.source).toBe('draggable');
        expect(mechPos.x).toBe(100);
        expect(mechPos.y).toBe(80);
        expect(lastPct).not.toBeNull();

        model.endDrag();
        expect(onDragEnd).toHaveBeenCalledTimes(1);

        // 注销后再点同一位置，应退回命中底层圈 ring0
        unregister();
        expect(model.hasDraggable('gate_1')).toBe(false);
        const hitAfterUnreg = model.beginDragAt(ring0Pos.x, ring0Pos.y);
        expect(hitAfterUnreg?.source).toBe('ring');
        expect(hitAfterUnreg?.id).toBe(ring0.id);
        model.endDrag();
    });

    it('导出的 JSON 通过 validateLevel 且再次用 LevelRingLayout 解析位置完全一致', () => {
        const x02 = loadBuiltInLevel('X02');
        const model = new LevelEditorModel();
        model.loadFromLevel(x02);

        // 移动 2 个圈、删 1 个圈、加 1 个小金环、改时间
        const first = model.getRings()[0];
        const second = model.getRings()[1];
        model.setRingPositionByTankPx(first.id, 380, 260);
        model.setRingPositionByTankPx(second.id, 680, 420);
        model.deleteRing(model.getRings()[8].id);
        model.addRing({ kind: 'gold' });
        model.adjustDurationSec(10);

        const exported = model.exportJson(true);
        expect(exported.ok).toBe(true);
        expect(exported.validation.valid).toBe(true);

        const parsed = JSON.parse(exported.json) as LevelData;
        const revalidated = validateLevel(parsed);
        expect(revalidated.valid).toBe(true);
        expect(revalidated.level).not.toBeNull();

        const editorRings = model.getRings();
        const reloadedSpawns = resolveLevelRingLayout(revalidated.level!.rings, {
            seed: revalidated.level!.seed,
            startPillarDropChance: 0,
        });

        expect(reloadedSpawns.length).toBe(editorRings.length);
        for (let i = 0; i < editorRings.length; i++) {
            const expectedPx = model.getRingTankPos(editorRings[i]);
            const actual = reloadedSpawns[i];
            expect(actual.spec).toEqual(editorRings[i].spec);
            expect(actual.x).toBeCloseTo(expectedPx.x, 4);
            expect(actual.y).toBeCloseTo(expectedPx.y, 4);
        }
    });
});
