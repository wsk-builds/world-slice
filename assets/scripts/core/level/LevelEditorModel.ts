import { FeelConfig } from '../../config/FeelConfig';
import { calcRingPillarGeometry, GameConst } from '../../config/GameConst';
import { TankSpace } from '../../config/TankSpace';
import { PillarCollider3D } from '../physics3d/PillarCollider3D';
import { getRingKindConfig, RingColor, RingSpec } from '../rings/RingKinds';
import {
    getRingSpeciesKey,
    LevelData,
    LevelPercentPos,
    LevelRingEntry,
} from './LevelData';
import {
    isCircleInsideTank,
    overlapsPillar2D,
    resolveLevelRingLayout,
} from './LevelRingLayout';
import { LevelValidationResult, validateLevel } from './validateLevel';

export interface EditableRingEntry {
    readonly id: string;
    spec: RingSpec;
    xPct: number;
    yPct: number;
    angleDeg?: number;
    trappedBy?: 'ice' | 'octopus';
}

export interface LiveEditorRingInput {
    spec: RingSpec;
    x: number;
    y: number;
    angleDeg?: number;
    trappedBy?: 'ice' | 'octopus';
}

export interface DraggablePoint {
    x: number;
    y: number;
}

/**
 * 通用可拖拽对象描述（供未来机关、角色点位登记进摆关器共用同一套命中与坐标夹紧，T022）。
 */
export interface DraggableItem {
    id?: string;
    kind?: string;
    /** 命中半径（缸内像素），默认 GameConst.editorDefaultHitRadiusPx */
    hitRadiusPx?: number;
    /** 命中优先级，越大越优先（外部登记项默认 10，内置圈为 0） */
    priority?: number;
    /** 获取当前缸内像素坐标 */
    getPosition: () => DraggablePoint | null | undefined;
    /** 拖动更新时写回位置（传入已夹紧的缸坐标与百分比坐标） */
    setPosition: (tankX: number, tankY: number, pct: LevelPercentPos) => void;
    /** 可选自定义夹紧函数；不传时按 hitRadiusPx 夹紧到水缸内 */
    clampPosition?: (tankX: number, tankY: number) => DraggablePoint;
    onSelect?: () => void;
    onDragStart?: (tankX: number, tankY: number) => void;
    onDragEnd?: (tankX: number, tankY: number, pct: LevelPercentPos) => void;
    enabled?: boolean | (() => boolean);
}

export interface DraggableHitResult {
    readonly id: string;
    readonly source: 'ring' | 'draggable';
    readonly kind: string;
    readonly x: number;
    readonly y: number;
    readonly hitRadiusPx: number;
    readonly distance: number;
    readonly priority: number;
}

export interface LevelEditorTankConfig {
    tankWidth?: number;
    tankHeight?: number;
    pillarPosPct?: number;
    pillarBottomPct?: number;
    cornerRadius?: number;
}

export interface EditorOperationResult {
    readonly ok: boolean;
    readonly reason?: string;
    readonly ring?: EditableRingEntry;
    readonly validation: LevelValidationResult;
}

export interface EditorDeleteResult {
    readonly ok: boolean;
    readonly removed?: EditableRingEntry;
    readonly nextSelectedId: string | null;
    readonly reason?: string;
    readonly validation: LevelValidationResult;
}

export interface EditorExportResult {
    readonly ok: boolean;
    readonly json: string;
    readonly validation: LevelValidationResult;
}

export interface EditorHitTestOptions {
    ringHitPadPx?: number;
    resolveRingScreenPos?: (ring: EditableRingEntry) => DraggablePoint;
}

export interface ActiveDragStepResult {
    readonly id: string;
    readonly source: 'ring' | 'draggable';
    readonly x: number;
    readonly y: number;
    readonly pct: LevelPercentPos;
}

interface RegisteredDraggableEntry {
    readonly id: string;
    readonly item: DraggableItem;
    readonly order: number;
}

const DEFAULT_RING_SPEC: RingSpec = { kind: 'normal', color: 'red' };

function clamp(val: number, min: number, max: number): number {
    return val < min ? min : val > max ? max : val;
}

/** 百分比四舍五入保留两位小数 */
export function roundLevelPct(pct: number, decimals = 2): number {
    const scale = Math.pow(10, decimals);
    return Math.round(pct * scale) / scale;
}

export function normalizeRingSpec(spec: RingSpec): RingSpec {
    if (spec.kind === 'normal') {
        const color: RingColor = spec.color ?? 'red';
        return { kind: 'normal', color };
    }
    return { kind: spec.kind };
}

export function getEditorRingRadii(
    spec: RingSpec,
    tankWidth: number = TankSpace.width,
): { outerRadius: number; tubeRadius: number } {
    const geom = calcRingPillarGeometry(tankWidth);
    const cfg = getRingKindConfig(spec);
    return {
        outerRadius: geom.ringOuterDiameter * cfg.sizeScale * 0.5,
        tubeRadius: geom.ringThickness * cfg.sizeScale * 0.5,
    };
}

/**
 * 将圈的缸像素坐标夹紧在合法安全区内：
 * 1. 同时满足 validateLevel 的显式百分比范围 [levelPosMinXPct..MaxXPct, levelPosMinYPct..MaxYPct]；
 * 2. 避开四面内壁与左右底角圆弧死角（与 LevelRingLayout 保持一致并多留 1px 余量，保证往返精度）；
 * 3. 四舍五入保留 2 位小数后确保仍严格在安全边界之内。
 */
export function clampEditorRingTankPos(
    rawX: number,
    rawY: number,
    spec: RingSpec,
    tankWidth: number = TankSpace.width,
    tankHeight: number = TankSpace.height,
    cornerRadius: number = GameConst.tankCornerRadius,
): { x: number; y: number; xPct: number; yPct: number } {
    const { outerRadius, tubeRadius } = getEditorRingRadii(spec, tankWidth);
    const pad = GameConst.editorWallPadPx;

    const minPctX = (GameConst.levelPosMinXPct / 100) * tankWidth;
    const maxPctX = (GameConst.levelPosMaxXPct / 100) * tankWidth;
    const minPctY = (GameConst.levelPosMinYPct / 100) * tankHeight;
    const maxPctY = (GameConst.levelPosMaxYPct / 100) * tankHeight;

    const minX = Math.max(outerRadius + pad, minPctX);
    const maxX = Math.max(minX, Math.min(tankWidth - outerRadius - pad, maxPctX));
    const minY = Math.max(tubeRadius + pad, minPctY);
    const maxY = Math.max(minY, Math.min(tankHeight - outerRadius - pad, maxPctY));

    let x = clamp(Number.isFinite(rawX) ? rawX : tankWidth * 0.5, minX, maxX);
    let y = clamp(Number.isFinite(rawY) ? rawY : tankHeight * 0.5, minY, maxY);

    const cr = Math.min(cornerRadius, tankWidth * 0.5, tankHeight * 0.5);
    const minArcDist = cr - outerRadius - pad;
    if (cr > outerRadius + pad && minArcDist > 0) {
        if (x < cr && y < cr) {
            const dx = x - cr;
            const dy = y - cr;
            const dist = Math.hypot(dx, dy);
            if (dist > minArcDist && dist > 1e-6) {
                x = clamp(cr + (dx / dist) * minArcDist, minX, maxX);
                y = clamp(cr + (dy / dist) * minArcDist, minY, maxY);
            }
        } else if (x > tankWidth - cr && y < cr) {
            const rcx = tankWidth - cr;
            const dx = x - rcx;
            const dy = y - cr;
            const dist = Math.hypot(dx, dy);
            if (dist > minArcDist && dist > 1e-6) {
                x = clamp(rcx + (dx / dist) * minArcDist, minX, maxX);
                y = clamp(cr + (dy / dist) * minArcDist, minY, maxY);
            }
        }
    }

    let xPct = clamp(roundLevelPct((x / tankWidth) * 100, 2), GameConst.levelPosMinXPct, GameConst.levelPosMaxXPct);
    let yPct = clamp(roundLevelPct((y / tankHeight) * 100, 2), GameConst.levelPosMinYPct, GameConst.levelPosMaxYPct);

    // 二次校验：防止两位小数四舍五入后越出圆弧或壁厚硬界
    for (let step = 0; step < 8; step++) {
        const px = (xPct / 100) * tankWidth;
        const py = (yPct / 100) * tankHeight;
        let adjusted = false;

        if (px < minX - 0.5) {
            xPct = roundLevelPct(xPct + 0.05, 2);
            adjusted = true;
        } else if (px > maxX + 0.5) {
            xPct = roundLevelPct(xPct - 0.05, 2);
            adjusted = true;
        }
        if (py < minY - 0.5) {
            yPct = roundLevelPct(yPct + 0.05, 2);
            adjusted = true;
        } else if (py > maxY + 0.5) {
            yPct = roundLevelPct(yPct - 0.05, 2);
            adjusted = true;
        }

        if (cr > outerRadius + pad && minArcDist > 0) {
            const safeArc = minArcDist + 0.5;
            if (px < cr && py < cr && Math.hypot(px - cr, py - cr) > safeArc) {
                if (cr - px >= cr - py) {
                    xPct = roundLevelPct(xPct + 0.05, 2);
                } else {
                    yPct = roundLevelPct(yPct + 0.05, 2);
                }
                adjusted = true;
            } else if (px > tankWidth - cr && py < cr && Math.hypot(px - (tankWidth - cr), py - cr) > safeArc) {
                const rcx = tankWidth - cr;
                if (px - rcx >= cr - py) {
                    xPct = roundLevelPct(xPct - 0.05, 2);
                } else {
                    yPct = roundLevelPct(yPct + 0.05, 2);
                }
                adjusted = true;
            }
        }

        xPct = clamp(xPct, GameConst.levelPosMinXPct, GameConst.levelPosMaxXPct);
        yPct = clamp(yPct, GameConst.levelPosMinYPct, GameConst.levelPosMaxYPct);
        if (!adjusted) {
            break;
        }
    }

    return {
        x: (xPct / 100) * tankWidth,
        y: (yPct / 100) * tankHeight,
        xPct,
        yPct,
    };
}

/** 通用拖拽项默认缸内坐标夹紧 */
export function clampEditorGenericTankPos(
    rawX: number,
    rawY: number,
    marginPx = 0,
    tankWidth: number = TankSpace.width,
    tankHeight: number = TankSpace.height,
): { x: number; y: number; xPct: number; yPct: number } {
    const safeMarginX = clamp(marginPx, 0, tankWidth * 0.45);
    const safeMarginY = clamp(marginPx, 0, tankHeight * 0.45);
    const x = clamp(Number.isFinite(rawX) ? rawX : tankWidth * 0.5, safeMarginX, tankWidth - safeMarginX);
    const y = clamp(Number.isFinite(rawY) ? rawY : tankHeight * 0.5, safeMarginY, tankHeight - safeMarginY);
    const xPct = clamp(roundLevelPct((x / tankWidth) * 100, 2), 0, 100);
    const yPct = clamp(roundLevelPct((y / tankHeight) * 100, 2), 0, 100);
    return {
        x: (xPct / 100) * tankWidth,
        y: (yPct / 100) * tankHeight,
        xPct,
        yPct,
    };
}

function isDraggableEnabled(item: DraggableItem): boolean {
    if (typeof item.enabled === 'function') {
        return Boolean(item.enabled());
    }
    if (typeof item.enabled === 'boolean') {
        return item.enabled;
    }
    return true;
}

function cloneLevelMetadata(level: LevelData): LevelData {
    return {
        id: level.id,
        title: level.title,
        durationSec: level.durationSec,
        type: level.type,
        rings: [],
        mechanisms: level.mechanisms.map((m) => ({
            type: m.type,
            ...(m.pos ? { pos: { xPct: m.pos.xPct, yPct: m.pos.yPct } } : {}),
            ...(m.params ? { params: { ...m.params } } : {}),
        })),
        actors: level.actors.map((a) => ({
            type: a.type,
            spawnSec: a.spawnSec,
            ...(a.side ? { side: a.side } : {}),
            ...(a.pos ? { pos: { xPct: a.pos.xPct, yPct: a.pos.yPct } } : {}),
            ...(a.repeatSec !== undefined ? { repeatSec: a.repeatSec } : {}),
            ...(a.params ? { params: { ...a.params } } : {}),
        })),
        seed: level.seed,
        ...(level.narrative ? { narrative: { ...level.narrative } } : {}),
        ...(level.note !== undefined ? { note: level.note } : {}),
        ...(level.pillarEnergy ? { pillarEnergy: { ...level.pillarEnergy } } : {}),
        ...(level.classifyColors
            ? {
                  classifyColors: {
                      left: [level.classifyColors.left[0], level.classifyColors.left[1]],
                      right: [level.classifyColors.right[0], level.classifyColors.right[1]],
                  },
              }
            : {}),
    };
}

function makeFallbackLevel(): LevelData {
    return {
        id: GameConst.defaultLevelId,
        title: `${GameConst.defaultLevelId} · 自定义`,
        durationSec: GameConst.defaultLevelDurationSec,
        type: 'normal',
        seed: GameConst.defaultLevelSeed,
        rings: [],
        mechanisms: [],
        actors: [],
    };
}

/**
 * 拖拽摆关器纯逻辑模型（T022，禁止引用 cc）：
 * - 维护当前关卡元数据、倒计时、显式百分比圈列表与选中态；
 * - 负责坐标安全夹紧（同步 validateLevel 范围与底角圆弧防死角）、增删改圈、种数/数量约束检查与 LevelData JSON 导出；
 * - 提供通用的 `registerDraggable` 接口，供未来机关、角色点位复用同一套命中与拖拽回调。
 */
export class LevelEditorModel {
    private baseLevel: LevelData = makeFallbackLevel();
    private _durationSec: number = GameConst.defaultLevelDurationSec;
    private readonly _rings: EditableRingEntry[] = [];
    private _selectedRingId: string | null = null;
    private _selectedDraggableId: string | null = null;
    private _defaultNewSpec: RingSpec = { ...DEFAULT_RING_SPEC };
    private _dirty = false;

    private nextRingSeq = 1;
    private nextDraggableSeq = 1;
    private nextOrderSeq = 1;
    private readonly draggables: RegisteredDraggableEntry[] = [];

    private activeDrag: {
        id: string;
        source: 'ring' | 'draggable';
        grabOffsetX: number;
        grabOffsetY: number;
        moved: boolean;
    } | null = null;

    private readonly tankConfig: Required<LevelEditorTankConfig>;

    constructor(tankConfig?: LevelEditorTankConfig) {
        this.tankConfig = {
            tankWidth: tankConfig?.tankWidth ?? TankSpace.width,
            tankHeight: tankConfig?.tankHeight ?? TankSpace.height,
            pillarPosPct: tankConfig?.pillarPosPct ?? FeelConfig.pillarPosPct,
            pillarBottomPct: tankConfig?.pillarBottomPct ?? FeelConfig.pillarBottomPct,
            cornerRadius: tankConfig?.cornerRadius ?? GameConst.tankCornerRadius,
        };
    }

    get levelId(): string {
        return this.baseLevel.id;
    }

    get levelTitle(): string {
        return this.baseLevel.title;
    }

    get durationSec(): number {
        return this._durationSec;
    }

    get selectedRingId(): string | null {
        return this._selectedRingId;
    }

    get selectedDraggableId(): string | null {
        return this._selectedDraggableId;
    }

    get defaultNewSpec(): Readonly<RingSpec> {
        return this._defaultNewSpec;
    }

    get dirty(): boolean {
        return this._dirty;
    }

    get ringCount(): number {
        return this._rings.length;
    }

    get maxRings(): number {
        return GameConst.pillarCapacity * 2;
    }

    get draggableCount(): number {
        return this.draggables.length;
    }

    get tankWidth(): number {
        return this.tankConfig.tankWidth;
    }

    get tankHeight(): number {
        return this.tankConfig.tankHeight;
    }

    updateTankConfig(config: LevelEditorTankConfig): void {
        if (config.tankWidth !== undefined) this.tankConfig.tankWidth = config.tankWidth;
        if (config.tankHeight !== undefined) this.tankConfig.tankHeight = config.tankHeight;
        if (config.pillarPosPct !== undefined) this.tankConfig.pillarPosPct = config.pillarPosPct;
        if (config.pillarBottomPct !== undefined) this.tankConfig.pillarBottomPct = config.pillarBottomPct;
        if (config.cornerRadius !== undefined) this.tankConfig.cornerRadius = config.cornerRadius;
    }

    /** 从关卡数据与（可选）当前场上实机圈位加载编辑态 */
    loadFromLevel(level: LevelData | null | undefined, liveRings?: readonly LiveEditorRingInput[]): void {
        const src = level ?? makeFallbackLevel();
        this.baseLevel = cloneLevelMetadata(src);
        this._durationSec = this.sanitizeDuration(src.durationSec);
        this._rings.length = 0;
        this._selectedRingId = null;
        this._selectedDraggableId = null;
        this.activeDrag = null;
        this._dirty = false;

        if (liveRings) {
            for (let i = 0; i < liveRings.length; i++) {
                const live = liveRings[i];
                const spec = normalizeRingSpec(live.spec);
                const clamped = clampEditorRingTankPos(
                    live.x,
                    live.y,
                    spec,
                    this.tankConfig.tankWidth,
                    this.tankConfig.tankHeight,
                    this.tankConfig.cornerRadius,
                );
                this._rings.push({
                    id: `ring_${this.nextRingSeq++}`,
                    spec,
                    xPct: clamped.xPct,
                    yPct: clamped.yPct,
                    ...(live.angleDeg !== undefined ? { angleDeg: live.angleDeg } : {}),
                    ...(live.trappedBy !== undefined ? { trappedBy: live.trappedBy } : {}),
                });
            }
        } else {
            const spawns = resolveLevelRingLayout(src.rings, {
                seed: src.seed,
                tankWidth: this.tankConfig.tankWidth,
                tankHeight: this.tankConfig.tankHeight,
                pillarPosPct: this.tankConfig.pillarPosPct,
                pillarBottomPct: this.tankConfig.pillarBottomPct,
                cornerRadius: this.tankConfig.cornerRadius,
                startPillarDropChance: 0,
            });
            for (let i = 0; i < spawns.length; i++) {
                const sp = spawns[i];
                const entry = src.rings[sp.index];
                const spec = normalizeRingSpec(sp.spec);
                const clamped = clampEditorRingTankPos(
                    sp.x,
                    sp.y,
                    spec,
                    this.tankConfig.tankWidth,
                    this.tankConfig.tankHeight,
                    this.tankConfig.cornerRadius,
                );
                this._rings.push({
                    id: `ring_${this.nextRingSeq++}`,
                    spec,
                    xPct: clamped.xPct,
                    yPct: clamped.yPct,
                    ...(entry?.angleDeg !== undefined ? { angleDeg: entry.angleDeg } : {}),
                    ...(entry?.trappedBy !== undefined ? { trappedBy: entry.trappedBy } : {}),
                });
            }
        }

        if (this._rings.length > 0) {
            this._selectedRingId = this._rings[0].id;
            this._defaultNewSpec = { ...this._rings[0].spec };
        }
    }

    getRings(): readonly EditableRingEntry[] {
        return this._rings;
    }

    getRingById(id: string): EditableRingEntry | undefined {
        return this._rings.find((r) => r.id === id);
    }

    getSelectedRing(): EditableRingEntry | null {
        if (!this._selectedRingId) {
            return null;
        }
        return this.getRingById(this._selectedRingId) ?? null;
    }

    getSelectedDraggableTarget(): {
        id: string;
        kind: string;
        x: number;
        y: number;
        hitRadiusPx: number;
    } | null {
        if (!this._selectedDraggableId) {
            return null;
        }
        const entry = this.draggables.find((d) => d.id === this._selectedDraggableId);
        if (!entry || !isDraggableEnabled(entry.item)) {
            return null;
        }
        const pos = entry.item.getPosition();
        if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
            return null;
        }
        const hitRadiusPx =
            entry.item.hitRadiusPx !== undefined && entry.item.hitRadiusPx > 0
                ? entry.item.hitRadiusPx
                : GameConst.editorDefaultHitRadiusPx;
        return {
            id: entry.id,
            kind: entry.item.kind ?? 'custom',
            x: pos.x,
            y: pos.y,
            hitRadiusPx,
        };
    }

    selectRing(id: string | null): EditableRingEntry | null {
        if (id === null) {
            this._selectedRingId = null;
            return null;
        }
        const found = this.getRingById(id);
        if (!found) {
            return null;
        }
        this._selectedRingId = found.id;
        this._selectedDraggableId = null;
        this._defaultNewSpec = { ...found.spec };
        return found;
    }

    getSpeciesCount(): number {
        const set = new Set<string>();
        for (let i = 0; i < this._rings.length; i++) {
            set.add(getRingSpeciesKey(this._rings[i].spec));
        }
        return set.size;
    }

    getRingTankPos(ring: Pick<EditableRingEntry, 'xPct' | 'yPct'>): DraggablePoint {
        return {
            x: (ring.xPct / 100) * this.tankConfig.tankWidth,
            y: (ring.yPct / 100) * this.tankConfig.tankHeight,
        };
    }

    setDefaultNewSpec(spec: RingSpec): void {
        this._defaultNewSpec = normalizeRingSpec(spec);
    }

    setDurationSec(sec: number): number {
        const next = this.sanitizeDuration(sec);
        if (next !== this._durationSec) {
            this._durationSec = next;
            this._dirty = true;
        }
        return this._durationSec;
    }

    adjustDurationSec(deltaSec: number): number {
        if (!Number.isFinite(deltaSec)) {
            return this._durationSec;
        }
        return this.setDurationSec(this._durationSec + deltaSec);
    }

    /** 更新指定圈的缸坐标（自动夹紧在安全百分比与底角圆弧内） */
    setRingPositionByTankPx(id: string, rawX: number, rawY: number): EditableRingEntry | null {
        const ring = this.getRingById(id);
        if (!ring) {
            return null;
        }
        const clamped = clampEditorRingTankPos(
            rawX,
            rawY,
            ring.spec,
            this.tankConfig.tankWidth,
            this.tankConfig.tankHeight,
            this.tankConfig.cornerRadius,
        );
        ring.xPct = clamped.xPct;
        ring.yPct = clamped.yPct;
        this._dirty = true;
        return ring;
    }

    /** 切换指定圈的种类/颜色，并按新尺寸重新夹紧位置 */
    setRingSpec(id: string, nextSpec: RingSpec): EditorOperationResult {
        const ring = this.getRingById(id);
        if (!ring) {
            return { ok: false, reason: '未找到目标圈', validation: this.validate() };
        }
        const normalized = normalizeRingSpec(nextSpec);
        const curPos = this.getRingTankPos(ring);
        const clamped = clampEditorRingTankPos(
            curPos.x,
            curPos.y,
            normalized,
            this.tankConfig.tankWidth,
            this.tankConfig.tankHeight,
            this.tankConfig.cornerRadius,
        );
        ring.spec = normalized;
        ring.xPct = clamped.xPct;
        ring.yPct = clamped.yPct;
        this._defaultNewSpec = { ...normalized };
        this._dirty = true;
        const validation = this.validate();
        return {
            ok: true,
            ring,
            validation,
            ...(validation.valid ? {} : { reason: validation.errors[0] }),
        };
    }

    /** 新增一个圈（满 12 个时拒绝；超 5 种时保留校验错误提示以阻止非法导出） */
    addRing(spec?: RingSpec, nearSelected = true): EditorOperationResult {
        if (this._rings.length >= this.maxRings) {
            return {
                ok: false,
                reason: `圈总数已达上限（${this.maxRings} 个）`,
                validation: this.validate(),
            };
        }

        const chosenSpec = normalizeRingSpec(spec ?? this._defaultNewSpec);
        const pos = this.findSafeSpawnPos(chosenSpec, nearSelected ? this._selectedRingId : null);
        const created: EditableRingEntry = {
            id: `ring_${this.nextRingSeq++}`,
            spec: chosenSpec,
            xPct: pos.xPct,
            yPct: pos.yPct,
        };
        this._rings.push(created);
        this._selectedRingId = created.id;
        this._selectedDraggableId = null;
        this._defaultNewSpec = { ...chosenSpec };
        this._dirty = true;

        const validation = this.validate();
        return {
            ok: true,
            ring: created,
            validation,
            ...(validation.valid ? {} : { reason: validation.errors[0] }),
        };
    }

    deleteRing(id: string): EditorDeleteResult {
        const idx = this._rings.findIndex((r) => r.id === id);
        if (idx < 0) {
            return {
                ok: false,
                nextSelectedId: this._selectedRingId,
                reason: '未找到要删除的圈',
                validation: this.validate(),
            };
        }
        const [removed] = this._rings.splice(idx, 1);
        if (this.activeDrag?.source === 'ring' && this.activeDrag.id === id) {
            this.activeDrag = null;
        }
        if (this._selectedRingId === id) {
            if (this._rings.length === 0) {
                this._selectedRingId = null;
            } else {
                const nextIdx = Math.min(idx, this._rings.length - 1);
                this._selectedRingId = this._rings[nextIdx].id;
            }
        }
        this._dirty = true;
        const validation = this.validate();
        return {
            ok: true,
            removed,
            nextSelectedId: this._selectedRingId,
            validation,
        };
    }

    deleteSelectedRing(): EditorDeleteResult {
        if (!this._selectedRingId) {
            return {
                ok: false,
                nextSelectedId: null,
                reason: '请先点选一个圈再删除',
                validation: this.validate(),
            };
        }
        return this.deleteRing(this._selectedRingId);
    }

    /** 为新增圈寻找安全无重叠空位（避开水缸墙、圆弧底角、双柱及已摆好的圈） */
    findSafeSpawnPos(
        spec: RingSpec,
        nearRingId?: string | null,
    ): { x: number; y: number; xPct: number; yPct: number } {
        const w = this.tankConfig.tankWidth;
        const h = this.tankConfig.tankHeight;
        const cr = this.tankConfig.cornerRadius;
        const geom = calcRingPillarGeometry(w);
        const { outerRadius } = getEditorRingRadii(spec, w);
        const tailBottomY = (this.tankConfig.pillarBottomPct / 100) * h;
        const leftPillar = new PillarCollider3D((this.tankConfig.pillarPosPct / 100) * w, tailBottomY, geom);
        const rightPillar = new PillarCollider3D(((100 - this.tankConfig.pillarPosPct) / 100) * w, tailBottomY, geom);
        const gap = GameConst.levelRingSpawnGapPx;
        const pad = GameConst.editorWallPadPx;

        const existing = this._rings.map((r) => {
            const p = this.getRingTankPos(r);
            return {
                x: p.x,
                y: p.y,
                outerR: getEditorRingRadii(r.spec, w).outerRadius,
            };
        });

        const isSpotFree = (cx: number, cy: number): boolean => {
            const clamped = clampEditorRingTankPos(cx, cy, spec, w, h, cr);
            if (Math.hypot(clamped.x - cx, clamped.y - cy) > 8) {
                return false;
            }
            if (!isCircleInsideTank(clamped.x, clamped.y, outerRadius, w, h, cr, pad)) {
                return false;
            }
            if (overlapsPillar2D(clamped.x, clamped.y, outerRadius, leftPillar, gap)) {
                return false;
            }
            if (overlapsPillar2D(clamped.x, clamped.y, outerRadius, rightPillar, gap)) {
                return false;
            }
            for (let i = 0; i < existing.length; i++) {
                const other = existing[i];
                if (Math.hypot(clamped.x - other.x, clamped.y - other.y) < outerRadius + other.outerR + gap) {
                    return false;
                }
            }
            return true;
        };

        const anchor = nearRingId ? this.getRingById(nearRingId) : undefined;
        if (anchor) {
            const ap = this.getRingTankPos(anchor);
            const step1 = outerRadius * 2.35;
            const step2 = outerRadius * 3.4;
            const offsets: ReadonlyArray<[number, number]> = [
                [step1, 0],
                [-step1, 0],
                [0, step1],
                [0, -step1],
                [step1 * 0.78, step1 * 0.78],
                [-step1 * 0.78, step1 * 0.78],
                [step1 * 0.78, -step1 * 0.78],
                [-step1 * 0.78, -step1 * 0.78],
                [step2, 0],
                [-step2, 0],
                [0, step2],
                [0, -step2],
            ];
            for (let i = 0; i < offsets.length; i++) {
                const cx = ap.x + offsets[i][0];
                const cy = ap.y + offsets[i][1];
                if (isSpotFree(cx, cy)) {
                    return clampEditorRingTankPos(cx, cy, spec, w, h, cr);
                }
            }
        }

        // 从水缸中央偏中下部向四周扫描安全空位
        const minX = outerRadius + pad + 4;
        const maxX = Math.max(minX, w - outerRadius - pad - 4);
        const minY = outerRadius + pad + 6;
        const maxY = Math.max(minY, h - outerRadius - pad - 6);
        const step = 28;
        const candidates: Array<{ x: number; y: number; distCenter: number }> = [];
        const centerX = w * 0.5;
        const centerY = h * 0.42;

        for (let y = minY; y <= maxY; y += step) {
            for (let x = minX; x <= maxX; x += step) {
                candidates.push({
                    x,
                    y,
                    distCenter: Math.hypot(x - centerX, y - centerY),
                });
            }
        }
        candidates.sort((a, b) => a.distCenter - b.distCenter);

        for (let i = 0; i < candidates.length; i++) {
            if (isSpotFree(candidates[i].x, candidates[i].y)) {
                return clampEditorRingTankPos(candidates[i].x, candidates[i].y, spec, w, h, cr);
            }
        }

        return clampEditorRingTankPos(centerX, centerY, spec, w, h, cr);
    }

    /** 注册通用可拖拽对象（机关、角色点位等），返回注销函数 */
    registerDraggable(item: DraggableItem): () => void {
        const id = item.id && item.id.length > 0 ? item.id : `draggable_${this.nextDraggableSeq++}`;
        const existingIdx = this.draggables.findIndex((entry) => entry.id === id);
        const entry: RegisteredDraggableEntry = {
            id,
            item,
            order: this.nextOrderSeq++,
        };
        if (existingIdx >= 0) {
            this.draggables[existingIdx] = entry;
        } else {
            this.draggables.push(entry);
        }
        return () => {
            this.unregisterDraggable(id);
        };
    }

    unregisterDraggable(id: string): boolean {
        const idx = this.draggables.findIndex((entry) => entry.id === id);
        if (idx < 0) {
            return false;
        }
        this.draggables.splice(idx, 1);
        if (this._selectedDraggableId === id) {
            this._selectedDraggableId = null;
        }
        if (this.activeDrag?.source === 'draggable' && this.activeDrag.id === id) {
            this.activeDrag = null;
        }
        return true;
    }

    hasDraggable(id: string): boolean {
        return this.draggables.some((entry) => entry.id === id);
    }

    clearDraggables(): void {
        this.draggables.length = 0;
        this._selectedDraggableId = null;
        if (this.activeDrag?.source === 'draggable') {
            this.activeDrag = null;
        }
    }

    /**
     * 对缸内点击位置进行命中检测：
     * - 同时检测通过 `registerDraggable` 登记的对象（默认优先级 10）与编辑器内的圈（优先级 0）；
     * - 优先级高者胜出；同优先级时离点击中心最近者胜出；距离相同则后登记/后生成的胜出。
     */
    hitTest(tankX: number, tankY: number, options?: EditorHitTestOptions): DraggableHitResult | null {
        if (!Number.isFinite(tankX) || !Number.isFinite(tankY)) {
            return null;
        }

        let best: (DraggableHitResult & { order: number }) | null = null;

        const consider = (candidate: DraggableHitResult & { order: number }) => {
            if (!best) {
                best = candidate;
                return;
            }
            if (candidate.priority !== best.priority) {
                if (candidate.priority > best.priority) {
                    best = candidate;
                }
                return;
            }
            if (Math.abs(candidate.distance - best.distance) > 1e-4) {
                if (candidate.distance < best.distance) {
                    best = candidate;
                }
                return;
            }
            if (candidate.order > best.order) {
                best = candidate;
            }
        };

        // 1. 通用登记拖拽项
        for (let i = 0; i < this.draggables.length; i++) {
            const entry = this.draggables[i];
            if (!isDraggableEnabled(entry.item)) {
                continue;
            }
            const pos = entry.item.getPosition();
            if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
                continue;
            }
            const hitRadiusPx =
                entry.item.hitRadiusPx !== undefined && entry.item.hitRadiusPx > 0
                    ? entry.item.hitRadiusPx
                    : GameConst.editorDefaultHitRadiusPx;
            const dist = Math.hypot(tankX - pos.x, tankY - pos.y);
            if (dist > hitRadiusPx) {
                continue;
            }
            consider({
                id: entry.id,
                source: 'draggable',
                kind: entry.item.kind ?? 'custom',
                x: pos.x,
                y: pos.y,
                hitRadiusPx,
                distance: dist,
                priority: entry.item.priority ?? 10,
                order: entry.order,
            });
        }

        // 2. 编辑器内的圈
        const hitPad = options?.ringHitPadPx ?? GameConst.editorRingHitPadPx;
        for (let i = 0; i < this._rings.length; i++) {
            const ring = this._rings[i];
            const pos = options?.resolveRingScreenPos
                ? options.resolveRingScreenPos(ring)
                : this.getRingTankPos(ring);
            if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
                continue;
            }
            const { outerRadius } = getEditorRingRadii(ring.spec, this.tankConfig.tankWidth);
            const hitRadiusPx = outerRadius + hitPad;
            const dist = Math.hypot(tankX - pos.x, tankY - pos.y);
            if (dist > hitRadiusPx) {
                continue;
            }
            consider({
                id: ring.id,
                source: 'ring',
                kind: 'ring',
                x: pos.x,
                y: pos.y,
                hitRadiusPx,
                distance: dist,
                priority: 0,
                order: i,
            });
        }

        if (!best) {
            return null;
        }
        const winner: DraggableHitResult & { order: number } = best;
        return {
            id: winner.id,
            source: winner.source,
            kind: winner.kind,
            x: winner.x,
            y: winner.y,
            hitRadiusPx: winner.hitRadiusPx,
            distance: winner.distance,
            priority: winner.priority,
        };
    }

    /** 开始点击/拖动：命中则更新选中态并触发对应回调 */
    beginDragAt(tankX: number, tankY: number, options?: EditorHitTestOptions): DraggableHitResult | null {
        const hit = this.hitTest(tankX, tankY, options);
        if (!hit) {
            this.activeDrag = null;
            return null;
        }

        if (hit.source === 'draggable') {
            const entry = this.draggables.find((d) => d.id === hit.id);
            const pos = entry?.item.getPosition();
            if (!entry || !pos) {
                return null;
            }
            this._selectedDraggableId = hit.id;
            this._selectedRingId = null;
            this.activeDrag = {
                id: hit.id,
                source: 'draggable',
                grabOffsetX: pos.x - tankX,
                grabOffsetY: pos.y - tankY,
                moved: false,
            };
            entry.item.onSelect?.();
            entry.item.onDragStart?.(pos.x, pos.y);
            return hit;
        }

        const ring = this.getRingById(hit.id);
        if (!ring) {
            return null;
        }
        const ringPos = this.getRingTankPos(ring);
        this.selectRing(ring.id);
        this.activeDrag = {
            id: ring.id,
            source: 'ring',
            grabOffsetX: ringPos.x - tankX,
            grabOffsetY: ringPos.y - tankY,
            moved: false,
        };
        return hit;
    }

    /** 拖动更新：计算夹紧后的坐标与百分比并写回圈或通用拖拽项 */
    moveDragTo(tankX: number, tankY: number): ActiveDragStepResult | null {
        if (!this.activeDrag || !Number.isFinite(tankX) || !Number.isFinite(tankY)) {
            return null;
        }

        const targetX = tankX + this.activeDrag.grabOffsetX;
        const targetY = tankY + this.activeDrag.grabOffsetY;

        if (this.activeDrag.source === 'draggable') {
            const entry = this.draggables.find((d) => d.id === this.activeDrag!.id);
            if (!entry) {
                this.activeDrag = null;
                return null;
            }
            const margin = entry.item.hitRadiusPx ?? 0;
            let clampedX: number;
            let clampedY: number;
            let pct: LevelPercentPos;

            if (entry.item.clampPosition) {
                const custom = entry.item.clampPosition(targetX, targetY);
                clampedX = clamp(custom.x, 0, this.tankConfig.tankWidth);
                clampedY = clamp(custom.y, 0, this.tankConfig.tankHeight);
                pct = {
                    xPct: clamp(roundLevelPct((clampedX / this.tankConfig.tankWidth) * 100, 2), 0, 100),
                    yPct: clamp(roundLevelPct((clampedY / this.tankConfig.tankHeight) * 100, 2), 0, 100),
                };
            } else {
                const generic = clampEditorGenericTankPos(
                    targetX,
                    targetY,
                    margin,
                    this.tankConfig.tankWidth,
                    this.tankConfig.tankHeight,
                );
                clampedX = generic.x;
                clampedY = generic.y;
                pct = { xPct: generic.xPct, yPct: generic.yPct };
            }

            this.activeDrag.moved = true;
            this._dirty = true;
            entry.item.setPosition(clampedX, clampedY, pct);
            return {
                id: entry.id,
                source: 'draggable',
                x: clampedX,
                y: clampedY,
                pct,
            };
        }

        const ring = this.getRingById(this.activeDrag.id);
        if (!ring) {
            this.activeDrag = null;
            return null;
        }

        const clamped = clampEditorRingTankPos(
            targetX,
            targetY,
            ring.spec,
            this.tankConfig.tankWidth,
            this.tankConfig.tankHeight,
            this.tankConfig.cornerRadius,
        );
        ring.xPct = clamped.xPct;
        ring.yPct = clamped.yPct;
        this.activeDrag.moved = true;
        this._dirty = true;

        return {
            id: ring.id,
            source: 'ring',
            x: clamped.x,
            y: clamped.y,
            pct: { xPct: clamped.xPct, yPct: clamped.yPct },
        };
    }

    endDrag(): ActiveDragStepResult | null {
        const drag = this.activeDrag;
        this.activeDrag = null;
        if (!drag) {
            return null;
        }

        if (drag.source === 'draggable') {
            const entry = this.draggables.find((d) => d.id === drag.id);
            const pos = entry?.item.getPosition();
            if (!entry || !pos) {
                return null;
            }
            const clamped = clampEditorGenericTankPos(
                pos.x,
                pos.y,
                0,
                this.tankConfig.tankWidth,
                this.tankConfig.tankHeight,
            );
            const pct: LevelPercentPos = { xPct: clamped.xPct, yPct: clamped.yPct };
            entry.item.onDragEnd?.(pos.x, pos.y, pct);
            return {
                id: drag.id,
                source: 'draggable',
                x: pos.x,
                y: pos.y,
                pct,
            };
        }

        const ring = this.getRingById(drag.id);
        if (!ring) {
            return null;
        }
        const pos = this.getRingTankPos(ring);
        return {
            id: ring.id,
            source: 'ring',
            x: pos.x,
            y: pos.y,
            pct: { xPct: ring.xPct, yPct: ring.yPct },
        };
    }

    getActiveDrag(): { id: string; source: 'ring' | 'draggable'; moved: boolean } | null {
        if (!this.activeDrag) {
            return null;
        }
        return {
            id: this.activeDrag.id,
            source: this.activeDrag.source,
            moved: this.activeDrag.moved,
        };
    }

    toLevelData(): LevelData {
        const rings: LevelRingEntry[] = this._rings.map((r) => ({
            kind: r.spec.kind,
            ...(r.spec.kind === 'normal' ? { color: r.spec.color ?? 'red' } : {}),
            pos: {
                xPct: r.xPct,
                yPct: r.yPct,
            },
            ...(r.angleDeg !== undefined ? { angleDeg: r.angleDeg } : {}),
            ...(r.trappedBy !== undefined ? { trappedBy: r.trappedBy } : {}),
        }));

        return {
            ...cloneLevelMetadata(this.baseLevel),
            durationSec: this._durationSec,
            rings,
        };
    }

    validate(): LevelValidationResult {
        return validateLevel(this.toLevelData());
    }

    exportJson(pretty = true): EditorExportResult {
        const data = this.toLevelData();
        const validation = validateLevel(data);
        if (!validation.valid || !validation.level) {
            return {
                ok: false,
                json: '',
                validation,
            };
        }
        return {
            ok: true,
            json: JSON.stringify(validation.level, null, pretty ? 2 : 0),
            validation,
        };
    }

    private sanitizeDuration(sec: number): number {
        if (!Number.isFinite(sec)) {
            return GameConst.defaultLevelDurationSec;
        }
        return Math.round(clamp(sec, GameConst.editorMinDurationSec, GameConst.editorMaxDurationSec));
    }
}
