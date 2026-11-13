import {
    _decorator, BlockInputEvents, Color, Component, EventTouch, Graphics, Label, Node, toRadian, UITransform, Vec3,
} from 'cc';
import { FeelConfig } from '../config/FeelConfig';
import { GameConst } from '../config/GameConst';
import { LayoutConfig } from '../config/LayoutConfig';
import { Palette } from '../config/Palette';
import { TankSpace } from '../config/TankSpace';
import { LevelData } from '../core/level/LevelData';
import {
    DraggableItem,
    EditableRingEntry,
    getEditorRingRadii,
    LevelEditorModel,
    LiveEditorRingInput,
} from '../core/level/LevelEditorModel';
import { DEBUG_RING_SLOTS, RingSpec, ringSpecLabel, sameKind } from '../core/rings/RingKinds';
import { LevelLoader } from '../game/LevelLoader';
import { Ring } from '../game/Ring';
import { RingLayer } from '../game/RingLayer';
import { ScoreJudge } from '../game/ScoreJudge';
import { RenderLayers } from '../render/Stage3DRig';

const { ccclass } = _decorator;

const LEFT_PANEL = { x: 14, y: 28, width: 254, height: 554 } as const;
const RIGHT_PANEL = { x: 1356, y: 28, width: 254, height: 614 } as const;
const EXPORT_MODAL = { x: 332, y: 116, width: 960, height: 526 } as const;

const tempVec3 = new Vec3();
const scratchColor = new Color();

export interface LevelEditorExitInfo {
    readonly edited: boolean;
    readonly durationSec: number;
    readonly freeRingCount: number;
    readonly editedRings?: LevelData['rings'];
}

export interface LevelEditorHost {
    onEditorEnter(): void;
    onEditorExit(info: LevelEditorExitInfo): void;
    onEditorDurationChanged?(durationSec: number): void;
}

export interface LevelEditorAttachDeps {
    ringLayer: RingLayer;
    scoreJudge: ScoreJudge;
    levelLoader: LevelLoader;
    host: LevelEditorHost;
}

interface EditorButton {
    node: Node;
    x: number;
    y: number;
    width: number;
    height: number;
    radius: number;
    getStyle: () => { fill: Color; border: Color };
    swatchColor?: Color;
}

function resolveSpecSwatchColor(spec: RingSpec): Color {
    if (spec.kind === 'normal') {
        return Palette.ring[spec.color ?? 'red'];
    }
    return Palette.ring[spec.kind];
}

/**
 * 灰盒拖拽摆关器与关卡导出组件（GDD §3.4，T022，受 GameConst.DEBUG 控制）：
 * - 入口在 TuningPanel「摆关」按钮，开启时自动收起调参大面板并暂停物理/喷射/敲玻璃，不弹全屏暂停遮罩；
 * - 工具条精巧布置在左右握把区，100% 避开内屏（1060×606），内屏全区域无遮挡拖拽；
 * - 点击选中圈并实时拖动更新 `ring.body3D`（z=0、清零线/角速度、重置水平姿态并实时同步 3D 网格）；
 * - 支持增删圈（上限 12）、切换 7 种圈种与颜色（普通 4 色 + 金/铁/木）、调整倒计时与导出校验合格的 LevelData JSON；
 * - 整个组件共用唯一 1 个 Graphics 组件；对外提供 `registerDraggable` 接口供后续机关与角色复用。
 */
@ccclass('LevelEditor')
export class LevelEditor extends Component {
    readonly model = new LevelEditorModel();

    private gfx!: Graphics;
    private ringLayer: RingLayer | null = null;
    private scoreJudge: ScoreJudge | null = null;
    private levelLoader: LevelLoader | null = null;
    private host: LevelEditorHost | null = null;

    private dragAreaNode!: Node;
    private dragAreaTransform!: UITransform;
    private exportBoxNode!: Node;

    private selectedInfoLabel!: Label;
    private statsLabel!: Label;
    private durationLabel!: Label;
    private validationLabel!: Label;
    private statusLabel!: Label;
    private exportJsonLabel!: Label;

    private readonly buttons: EditorButton[] = [];
    private readonly exportButtons: EditorButton[] = [];
    private readonly speciesBtnSpecs: Array<{ btn: EditorButton; spec: RingSpec }> = [];
    private readonly ringByModelId = new Map<string, Ring>();

    private lastExportJson = '';
    private _isOpen = false;

    static create(machine: Node, deps: LevelEditorAttachDeps): LevelEditor {
        const node = new Node('LevelEditor');
        node.layer = RenderLayers.FG_UI_2D;

        const tf = node.addComponent(UITransform);
        tf.setContentSize(LayoutConfig.designWidth, LayoutConfig.designHeight);
        tf.setAnchorPoint(0, 0);
        node.setPosition(-LayoutConfig.designWidth / 2, -LayoutConfig.designHeight / 2, 0);

        const editor = node.addComponent(LevelEditor);
        editor.ringLayer = deps.ringLayer;
        editor.scoreJudge = deps.scoreJudge;
        editor.levelLoader = deps.levelLoader;
        editor.host = deps.host;

        node.active = false;
        machine.addChild(node);
        return editor;
    }

    get isOpen(): boolean {
        return this._isOpen;
    }

    onLoad(): void {
        if (!GameConst.DEBUG) {
            this.node.active = false;
            return;
        }
        this.gfx = this.getComponent(Graphics) ?? this.addComponent(Graphics);
        this.buildDragArea();
        this.buildLeftToolbar();
        this.buildRightToolbar();
        this.buildExportModal();
    }

    /** 注册通用可拖拽对象（机关、角色点位等），返回注销函数 */
    registerDraggable(item: DraggableItem): () => void {
        const unreg = this.model.registerDraggable(item);
        if (this._isOpen) {
            this.redraw();
        }
        return () => {
            unreg();
            if (this._isOpen) {
                this.redraw();
            }
        };
    }

    unregisterDraggable(id: string): boolean {
        const removed = this.model.unregisterDraggable(id);
        if (removed && this._isOpen) {
            this.redraw();
        }
        return removed;
    }

    toggle(): boolean {
        if (this._isOpen) {
            this.close();
        } else {
            this.open();
        }
        return this._isOpen;
    }

    open(): void {
        if (!GameConst.DEBUG || this._isOpen) {
            return;
        }
        this._isOpen = true;
        this.host?.onEditorEnter();

        this.model.updateTankConfig({
            tankWidth: TankSpace.width,
            tankHeight: TankSpace.height,
            pillarPosPct: FeelConfig.pillarPosPct,
            pillarBottomPct: FeelConfig.pillarBottomPct,
            cornerRadius: GameConst.tankCornerRadius,
        });

        this.syncModelFromLiveStage();
        this.node.active = true;
        if (this.exportBoxNode) {
            this.exportBoxNode.active = false;
        }
        this.setStatus('点击内屏圈选中并拖动；右侧可调时间与导出');
        this.refreshLabels();
        this.redraw();
    }

    close(): void {
        if (!this._isOpen) {
            return;
        }
        this._isOpen = false;
        this.model.endDrag();
        if (this.exportBoxNode) {
            this.exportBoxNode.active = false;
        }
        this.node.active = false;

        let freeCount = 0;
        if (this.ringLayer) {
            const rings = this.ringLayer.getRings();
            for (let i = 0; i < rings.length; i++) {
                const r = rings[i];
                if (r.isValid && !r.locked && !r.clearing) {
                    freeCount++;
                }
            }
        }

        const edited = this.model.dirty;
        this.host?.onEditorExit({
            edited,
            durationSec: this.model.durationSec,
            freeRingCount: freeCount,
            ...(edited ? { editedRings: this.model.toLevelData().rings } : {}),
        });
    }

    private syncModelFromLiveStage(): void {
        this.ringByModelId.clear();
        const baseLevel: LevelData | null = this.levelLoader?.currentLevel ?? null;
        const liveRings = this.ringLayer?.getRings() ?? [];
        const activeRings: Ring[] = [];
        const inputs: LiveEditorRingInput[] = [];

        for (let i = 0; i < liveRings.length; i++) {
            const r = liveRings[i];
            if (!r.isValid || r.clearing) {
                continue;
            }
            const x = r.isBodyReady ? r.body3D.x : r.node.position.x;
            const y = r.isBodyReady ? r.body3D.y : r.node.position.y;
            activeRings.push(r);
            inputs.push({
                spec: { kind: r.spec.kind, color: r.spec.color },
                x,
                y,
            });
        }

        this.model.loadFromLevel(baseLevel, inputs);
        const entries = this.model.getRings();
        for (let i = 0; i < entries.length && i < activeRings.length; i++) {
            this.ringByModelId.set(entries[i].id, activeRings[i]);
        }
    }

    private buildDragArea(): void {
        const inner = LayoutConfig.innerScreen;
        const area = new Node('EditorDragArea');
        area.layer = RenderLayers.FG_UI_2D;

        const tr = area.addComponent(UITransform);
        tr.setAnchorPoint(0, 0);
        tr.setContentSize(inner.width, inner.height);
        area.setPosition(inner.x, inner.y, 0);
        area.addComponent(BlockInputEvents);

        area.on(Node.EventType.TOUCH_START, this.onInnerTouchStart, this);
        area.on(Node.EventType.TOUCH_MOVE, this.onInnerTouchMove, this);
        area.on(Node.EventType.TOUCH_END, this.onInnerTouchEnd, this);
        area.on(Node.EventType.TOUCH_CANCEL, this.onInnerTouchEnd, this);

        this.node.addChild(area);
        this.dragAreaNode = area;
        this.dragAreaTransform = tr;
    }

    private buildLeftToolbar(): void {
        const panel = new Node('LeftEditorToolbar');
        panel.layer = RenderLayers.FG_UI_2D;
        const tr = panel.addComponent(UITransform);
        tr.setAnchorPoint(0, 0);
        tr.setContentSize(LEFT_PANEL.width, LEFT_PANEL.height);
        panel.setPosition(LEFT_PANEL.x, LEFT_PANEL.y, 0);
        panel.addComponent(BlockInputEvents);
        this.node.addChild(panel);

        const cx = LEFT_PANEL.x + LEFT_PANEL.width * 0.5;
        this.addLabel(
            this.node,
            'LeftTitle',
            '摆关编辑器',
            cx,
            LEFT_PANEL.y + LEFT_PANEL.height - 26,
            LEFT_PANEL.width - 24,
            28,
            20,
            Palette.tuning.accentText,
            Label.HorizontalAlign.CENTER,
        );

        this.selectedInfoLabel = this.addLabel(
            this.node,
            'SelectedInfo',
            '未选中圈',
            cx,
            LEFT_PANEL.y + LEFT_PANEL.height - 62,
            LEFT_PANEL.width - 24,
            28,
            15,
            Palette.labelPrimary,
            Label.HorizontalAlign.CENTER,
        );

        this.addLabel(
            this.node,
            'SpeciesHeader',
            '圈种与颜色（改选中 / 新增默认）',
            cx,
            LEFT_PANEL.y + LEFT_PANEL.height - 96,
            LEFT_PANEL.width - 20,
            24,
            14,
            Palette.labelMuted,
            Label.HorizontalAlign.CENTER,
        );

        // 7 种圈按钮（2 列 × 4 行）
        const btnW = 108;
        const btnH = 42;
        const gapX = 12;
        const gapY = 10;
        const startX = LEFT_PANEL.x + (LEFT_PANEL.width - (btnW * 2 + gapX)) * 0.5 + btnW * 0.5;
        const startY = LEFT_PANEL.y + LEFT_PANEL.height - 138;

        for (let i = 0; i < DEBUG_RING_SLOTS.length; i++) {
            const spec = DEBUG_RING_SLOTS[i];
            const col = i % 2;
            const row = Math.floor(i / 2);
            const bx = startX + col * (btnW + gapX);
            const by = startY - row * (btnH + gapY);

            const btn = this.createButton(
                this.node,
                `SpeciesBtn_${i}`,
                ringSpecLabel(spec),
                bx,
                by,
                btnW,
                btnH,
                16,
                8,
                () => this.resolveSpeciesBtnStyle(spec),
                () => this.onSelectSpecies(spec),
                resolveSpecSwatchColor(spec),
                14,
            );
            this.buttons.push(btn);
            this.speciesBtnSpecs.push({ btn, spec });
        }

        const addBtn = this.createButton(
            this.node,
            'AddRingBtn',
            '+ 新增圈',
            cx,
            LEFT_PANEL.y + 132,
            224,
            46,
            18,
            10,
            () => ({
                fill:
                    this.model.ringCount >= this.model.maxRings
                        ? Palette.editor.btnMutedFill
                        : Palette.editor.btnPrimaryFill,
                border: Palette.editor.btnBorder,
            }),
            () => this.onAddRing(),
        );

        const delBtn = this.createButton(
            this.node,
            'DeleteRingBtn',
            '删除选中圈',
            cx,
            LEFT_PANEL.y + 74,
            224,
            46,
            18,
            10,
            () => ({
                fill: this.model.selectedRingId ? Palette.editor.btnDangerFill : Palette.editor.btnMutedFill,
                border: Palette.editor.btnBorder,
            }),
            () => this.onDeleteSelectedRing(),
        );
        this.buttons.push(addBtn, delBtn);

        this.addLabel(
            this.node,
            'LeftLimitTip',
            `上限 ${this.model.maxRings} 圈 · 同时出现 ≤ ${GameConst.maxLevelRingSpecies} 种`,
            cx,
            LEFT_PANEL.y + 26,
            LEFT_PANEL.width - 20,
            24,
            13,
            Palette.labelMuted,
            Label.HorizontalAlign.CENTER,
        );
    }

    private buildRightToolbar(): void {
        const panel = new Node('RightEditorToolbar');
        panel.layer = RenderLayers.FG_UI_2D;
        const tr = panel.addComponent(UITransform);
        tr.setAnchorPoint(0, 0);
        tr.setContentSize(RIGHT_PANEL.width, RIGHT_PANEL.height);
        panel.setPosition(RIGHT_PANEL.x, RIGHT_PANEL.y, 0);
        panel.addComponent(BlockInputEvents);
        this.node.addChild(panel);

        const cx = RIGHT_PANEL.x + RIGHT_PANEL.width * 0.5;
        this.addLabel(
            this.node,
            'RightTitle',
            '关卡参数与导出',
            cx,
            RIGHT_PANEL.y + RIGHT_PANEL.height - 28,
            RIGHT_PANEL.width - 24,
            28,
            20,
            Palette.tuning.accentText,
            Label.HorizontalAlign.CENTER,
        );

        this.statsLabel = this.addLabel(
            this.node,
            'StatsLabel',
            '',
            cx,
            RIGHT_PANEL.y + RIGHT_PANEL.height - 70,
            RIGHT_PANEL.width - 20,
            34,
            16,
            Palette.labelPrimary,
            Label.HorizontalAlign.CENTER,
        );

        this.durationLabel = this.addLabel(
            this.node,
            'DurationLabel',
            '',
            cx,
            RIGHT_PANEL.y + RIGHT_PANEL.height - 118,
            RIGHT_PANEL.width - 20,
            28,
            18,
            Palette.labelPrimary,
            Label.HorizontalAlign.CENTER,
        );

        // 时间调节按钮行：-10s / -5s / +5s / +10s
        const deltas = [-10, -5, 5, 10];
        const tW = 52;
        const tGap = 6;
        const tStartX = RIGHT_PANEL.x + (RIGHT_PANEL.width - (tW * 4 + tGap * 3)) * 0.5 + tW * 0.5;
        const tY = RIGHT_PANEL.y + RIGHT_PANEL.height - 162;

        for (let i = 0; i < deltas.length; i++) {
            const delta = deltas[i];
            const label = delta > 0 ? `+${delta}s` : `${delta}s`;
            const btn = this.createButton(
                this.node,
                `TimeBtn_${delta}`,
                label,
                tStartX + i * (tW + tGap),
                tY,
                tW,
                40,
                15,
                8,
                () => ({ fill: Palette.editor.btnFill, border: Palette.editor.btnBorder }),
                () => this.onAdjustDuration(delta),
            );
            this.buttons.push(btn);
        }

        this.validationLabel = this.addLabel(
            this.node,
            'ValidationLabel',
            '',
            cx,
            RIGHT_PANEL.y + RIGHT_PANEL.height - 238,
            RIGHT_PANEL.width - 24,
            72,
            14,
            Palette.editor.validText,
            Label.HorizontalAlign.CENTER,
        );

        const exportBtn = this.createButton(
            this.node,
            'ExportLevelJsonBtn',
            '导出关卡 JSON',
            cx,
            RIGHT_PANEL.y + 206,
            224,
            52,
            18,
            10,
            () => ({
                fill: this.model.validate().valid ? Palette.editor.btnActiveFill : Palette.editor.btnMutedFill,
                border: Palette.editor.btnActiveBorder,
            }),
            () => this.onExportJson(),
        );

        const exitBtn = this.createButton(
            this.node,
            'ExitEditorBtn',
            '退出摆关',
            cx,
            RIGHT_PANEL.y + 138,
            224,
            48,
            18,
            10,
            () => ({ fill: Palette.editor.btnPrimaryFill, border: Palette.editor.btnBorder }),
            () => this.close(),
        );
        this.buttons.push(exportBtn, exitBtn);

        this.statusLabel = this.addLabel(
            this.node,
            'EditorStatusLabel',
            '',
            cx,
            RIGHT_PANEL.y + 62,
            RIGHT_PANEL.width - 24,
            76,
            14,
            Palette.labelMuted,
            Label.HorizontalAlign.CENTER,
        );
    }

    private buildExportModal(): void {
        const box = new Node('EditorExportModal');
        box.layer = RenderLayers.FG_UI_2D;
        const tr = box.addComponent(UITransform);
        tr.setAnchorPoint(0, 0);
        tr.setContentSize(EXPORT_MODAL.width, EXPORT_MODAL.height);
        box.setPosition(EXPORT_MODAL.x, EXPORT_MODAL.y, 0);
        box.addComponent(BlockInputEvents);
        box.active = false;
        this.node.addChild(box);
        this.exportBoxNode = box;

        this.addLabel(
            box,
            'ExportModalTitle',
            '导出关卡 JSON（已打印控制台，复制后可发给 AI 存成 X04.json）',
            20 + (EXPORT_MODAL.width - 240) * 0.5,
            EXPORT_MODAL.height - 30,
            EXPORT_MODAL.width - 240,
            30,
            17,
            Palette.tuning.accentText,
            Label.HorizontalAlign.LEFT,
        );

        const copyBtn = this.createButton(
            box,
            'EditorCopyJsonBtn',
            '复制 JSON',
            EXPORT_MODAL.width - 148,
            EXPORT_MODAL.height - 30,
            106,
            34,
            15,
            8,
            () => ({ fill: Palette.editor.btnActiveFill, border: Palette.editor.btnActiveBorder }),
            () => this.copyExportJson(false),
        );
        const closeBtn = this.createButton(
            box,
            'EditorCloseJsonBtn',
            '关闭',
            EXPORT_MODAL.width - 50,
            EXPORT_MODAL.height - 30,
            72,
            34,
            15,
            8,
            () => ({ fill: Palette.editor.btnFill, border: Palette.editor.btnBorder }),
            () => this.setExportModalVisible(false),
        );
        this.exportButtons.push(copyBtn, closeBtn);

        this.exportJsonLabel = this.addLabel(
            box,
            'EditorExportJsonText',
            '',
            EXPORT_MODAL.width * 0.5,
            (EXPORT_MODAL.height - 58) * 0.5 + 12,
            EXPORT_MODAL.width - 40,
            EXPORT_MODAL.height - 76,
            14,
            Palette.labelPrimary,
            Label.HorizontalAlign.LEFT,
        );
        this.exportJsonLabel.lineHeight = 19;
    }

    private setExportModalVisible(visible: boolean): void {
        if (this.exportBoxNode) {
            this.exportBoxNode.active = visible;
        }
        this.redraw();
    }

    private resolveSpeciesBtnStyle(spec: RingSpec): { fill: Color; border: Color } {
        const selected = this.model.getSelectedRing();
        const refSpec = selected ? selected.spec : this.model.defaultNewSpec;
        const active = sameKind(refSpec, spec);
        return {
            fill: active ? Palette.editor.btnActiveFill : Palette.editor.btnFill,
            border: active ? Palette.editor.btnActiveBorder : Palette.editor.btnBorder,
        };
    }

    private resolveRingScreenPos(entry: EditableRingEntry): { x: number; y: number } {
        const ring = this.ringByModelId.get(entry.id);
        if (ring && ring.isValid && ring.isBodyReady) {
            const b = ring.body3D;
            const obliqueK = Math.tan(toRadian(GameConst.camera3dPitchDownDeg));
            const projY = b.y - (b.z - ring.dimensions.majorRadius) * obliqueK;
            return { x: b.x, y: projY };
        }
        return this.model.getRingTankPos(entry);
    }

    private onInnerTouchStart = (event: EventTouch): void => {
        if (!this._isOpen || !this.dragAreaTransform) {
            return;
        }
        const uiLoc = event.getUILocation();
        this.dragAreaTransform.convertToNodeSpaceAR(tempVec3.set(uiLoc.x, uiLoc.y, 0), tempVec3);
        const tx = tempVec3.x;
        const ty = tempVec3.y;
        if (tx < 0 || tx > TankSpace.width || ty < 0 || ty > TankSpace.height) {
            return;
        }
        event.propagationStopped = true;

        const hit = this.model.beginDragAt(tx, ty, {
            ringHitPadPx: GameConst.editorRingHitPadPx,
            resolveRingScreenPos: (entry) => this.resolveRingScreenPos(entry),
        });
        if (hit) {
            if (hit.source === 'ring') {
                const entry = this.model.getRingById(hit.id);
                if (entry) {
                    this.setStatus(`已选中 ${ringSpecLabel(entry.spec)}，按住拖动位置`);
                }
            } else {
                this.setStatus(`已选中可拖拽对象: ${hit.kind}`);
            }
        } else {
            this.model.selectRing(null);
            this.setStatus('未点中圈，点击任意圈可选中拖动');
        }
        this.refreshLabels();
        this.redraw();
    };

    private onInnerTouchMove = (event: EventTouch): void => {
        if (!this._isOpen || !this.model.getActiveDrag() || !this.dragAreaTransform) {
            return;
        }
        const uiLoc = event.getUILocation();
        this.dragAreaTransform.convertToNodeSpaceAR(tempVec3.set(uiLoc.x, uiLoc.y, 0), tempVec3);
        event.propagationStopped = true;

        const step = this.model.moveDragTo(tempVec3.x, tempVec3.y);
        if (!step) {
            return;
        }

        if (step.source === 'ring') {
            const ring = this.ringByModelId.get(step.id);
            if (ring && ring.isValid && ring.isBodyReady) {
                if (ring.locked) {
                    this.scoreJudge?.unlockRing(ring, true);
                }
                ring.locked = false;
                ring.body3D.type = 'dynamic';
                ring.body3D.clearVelocity();
                ring.body3D.clearForces();
                ring.body3D.setPose(step.x, step.y, 0, 0, 0, 0, 1);
                ring.syncVisualFromBody();
            }
        }

        this.refreshLabels();
        this.redraw();
    };

    private onInnerTouchEnd = (event: EventTouch): void => {
        if (!this._isOpen) {
            return;
        }
        if (this.model.getActiveDrag()) {
            event.propagationStopped = true;
            this.model.endDrag();
            this.refreshLabels();
            this.redraw();
        }
    };

    private onSelectSpecies(spec: RingSpec): void {
        const selectedId = this.model.selectedRingId;
        if (!selectedId) {
            this.model.setDefaultNewSpec(spec);
            this.setStatus(`默认新增圈已切换为 ${ringSpecLabel(spec)}`);
            this.refreshLabels();
            this.redraw();
            return;
        }

        const res = this.model.setRingSpec(selectedId, spec);
        if (res.ok && res.ring && this.ringLayer) {
            const oldRing = this.ringByModelId.get(selectedId);
            if (oldRing && oldRing.isValid) {
                if (oldRing.locked) {
                    this.scoreJudge?.unlockRing(oldRing, true);
                }
                const nextRing = this.ringLayer.replaceRing(oldRing, res.ring.spec, {
                    z: 0,
                    pitchXDeg: 0,
                    yawYDeg: 0,
                    rollZDeg: 0,
                });
                const pos = this.model.getRingTankPos(res.ring);
                nextRing.body3D.clearVelocity();
                nextRing.body3D.clearForces();
                nextRing.body3D.setPose(pos.x, pos.y, 0, 0, 0, 0, 1);
                nextRing.syncVisualFromBody();
                this.ringByModelId.set(selectedId, nextRing);
            }
            if (!res.validation.valid) {
                this.setStatus(`已切换为 ${ringSpecLabel(spec)}（提示：${res.validation.errors[0]}）`);
            } else {
                this.setStatus(`已切换选中圈为 ${ringSpecLabel(spec)}`);
            }
        }
        this.refreshLabels();
        this.redraw();
    }

    private onAddRing(): void {
        if (!this.ringLayer) {
            return;
        }
        const res = this.model.addRing(undefined, true);
        if (!res.ok || !res.ring) {
            this.setStatus(res.reason ?? '无法新增圈');
            this.refreshLabels();
            this.redraw();
            return;
        }

        const pos = this.model.getRingTankPos(res.ring);
        const newRing = this.ringLayer.spawn(pos.x, pos.y, res.ring.spec, 0, {
            z: 0,
            pitchXDeg: 0,
            yawYDeg: 0,
            rollZDeg: 0,
        });
        newRing.body3D.clearVelocity();
        newRing.body3D.clearForces();
        newRing.body3D.setPose(pos.x, pos.y, 0, 0, 0, 0, 1);
        newRing.syncVisualFromBody();
        this.ringByModelId.set(res.ring.id, newRing);

        if (!res.validation.valid) {
            this.setStatus(`已新增 ${ringSpecLabel(res.ring.spec)}（提示：${res.validation.errors[0]}）`);
        } else {
            this.setStatus(`已新增 ${ringSpecLabel(res.ring.spec)} (${res.ring.xPct}%, ${res.ring.yPct}%)`);
        }
        this.refreshLabels();
        this.redraw();
    }

    private onDeleteSelectedRing(): void {
        const res = this.model.deleteSelectedRing();
        if (!res.ok || !res.removed) {
            this.setStatus(res.reason ?? '请先选中一个圈');
            this.refreshLabels();
            this.redraw();
            return;
        }

        const targetRing = this.ringByModelId.get(res.removed.id);
        this.ringByModelId.delete(res.removed.id);
        if (targetRing && targetRing.isValid) {
            if (targetRing.locked) {
                this.scoreJudge?.unlockRing(targetRing, true);
            }
            this.ringLayer?.destroyRing(targetRing);
        }

        this.setStatus(`已删除 ${ringSpecLabel(res.removed.spec)}（剩余 ${this.model.ringCount} 个圈）`);
        this.refreshLabels();
        this.redraw();
    }

    private onAdjustDuration(deltaSec: number): void {
        const prevSec = this.model.durationSec;
        const nextSec = this.model.adjustDurationSec(deltaSec);
        if (nextSec !== prevSec) {
            this.host?.onEditorDurationChanged?.(nextSec);
        }
        this.setStatus(`本关倒计时已调整为 ${nextSec} 秒`);
        this.refreshLabels();
        this.redraw();
    }

    private onExportJson(): void {
        const res = this.model.exportJson(true);
        if (!res.ok) {
            this.setStatus(`导出阻止：${res.validation.errors[0] ?? '关卡数据不合法'}`);
            console.warn('[摆关器] 关卡校验未通过，无法导出：', res.validation.errors);
            this.refreshLabels();
            this.redraw();
            return;
        }

        this.lastExportJson = res.json;
        console.log(`[摆关器] 导出关卡 JSON（可发给 AI 存成 X04.json）：\n${res.json}`);
        if (this.exportJsonLabel) {
            this.exportJsonLabel.string = res.json;
        }
        this.setExportModalVisible(true);
        this.copyExportJson(true);
    }

    private copyExportJson(fromExport: boolean): void {
        if (!this.lastExportJson) {
            return;
        }
        const copied = tryCopyClipboard(this.lastExportJson);
        if (copied) {
            this.setStatus(fromExport ? '校验通过！已打印控制台、展示并复制 JSON' : '已复制关卡 JSON 到剪贴板');
        } else {
            this.setStatus('校验通过！已打印控制台并在弹窗展示 JSON');
        }
    }

    private setStatus(msg: string): void {
        if (this.statusLabel) {
            this.statusLabel.string = msg;
        }
    }

    private refreshLabels(): void {
        const selected = this.model.getSelectedRing();
        if (this.selectedInfoLabel) {
            this.selectedInfoLabel.string = selected
                ? `已选: ${ringSpecLabel(selected.spec)} (${selected.xPct.toFixed(1)}%, ${selected.yPct.toFixed(1)}%)`
                : `未选中圈 · 默认: ${ringSpecLabel(this.model.defaultNewSpec)}`;
        }
        if (this.statsLabel) {
            this.statsLabel.string = `${this.model.levelId} · 圈 ${this.model.ringCount}/${this.model.maxRings} · 种 ${this.model.getSpeciesCount()}/${GameConst.maxLevelRingSpecies}`;
        }
        if (this.durationLabel) {
            this.durationLabel.string = `倒计时: ${this.model.durationSec} 秒`;
        }
        if (this.validationLabel) {
            const val = this.model.validate();
            if (val.valid) {
                this.validationLabel.color = Palette.editor.validText;
                this.validationLabel.string = '校验通过：符合 GDD 规则，可导出';
            } else {
                this.validationLabel.color = Palette.editor.errorText;
                this.validationLabel.string = `校验未通过：\n${val.errors[0] ?? '存在非法配置'}`;
            }
        }
    }

    private redraw(): void {
        const g = this.gfx;
        if (!g || !this._isOpen) {
            return;
        }
        g.clear();

        // 1. 内屏高亮框（先画在底座下方，确保只落在内屏内，不被工具栏压住）
        this.drawSelectionHighlight(g);

        // 2. 左握把工具面板
        g.fillColor = Palette.editor.panelBg;
        g.strokeColor = Palette.editor.panelBorder;
        g.lineWidth = 2;
        g.roundRect(LEFT_PANEL.x, LEFT_PANEL.y, LEFT_PANEL.width, LEFT_PANEL.height, 14);
        g.fill();
        g.stroke();

        // 3. 右握把工具面板
        g.roundRect(RIGHT_PANEL.x, RIGHT_PANEL.y, RIGHT_PANEL.width, RIGHT_PANEL.height, 14);
        g.fill();
        g.stroke();

        for (let i = 0; i < this.buttons.length; i++) {
            this.drawButton(g, this.buttons[i], 0, 0);
        }

        // 4. 导出弹窗
        if (this.exportBoxNode?.active) {
            g.fillColor = Palette.editor.exportBg;
            g.strokeColor = Palette.editor.panelBorder;
            g.lineWidth = 2.5;
            g.roundRect(EXPORT_MODAL.x, EXPORT_MODAL.y, EXPORT_MODAL.width, EXPORT_MODAL.height, 14);
            g.fill();
            g.stroke();

            for (let i = 0; i < this.exportButtons.length; i++) {
                this.drawButton(g, this.exportButtons[i], EXPORT_MODAL.x, EXPORT_MODAL.y);
            }
        }
    }

    private drawSelectionHighlight(g: Graphics): void {
        const selectedRing = this.model.getSelectedRing();
        const selectedDraggable = selectedRing ? null : this.model.getSelectedDraggableTarget();
        if (!selectedRing && !selectedDraggable) {
            return;
        }

        const inner = LayoutConfig.innerScreen;
        let projX: number;
        let projY: number;
        let boxR: number;
        if (selectedRing) {
            const proj = this.resolveRingScreenPos(selectedRing);
            projX = proj.x;
            projY = proj.y;
            boxR = getEditorRingRadii(selectedRing.spec, TankSpace.width).outerRadius + 9;
        } else {
            projX = selectedDraggable!.x;
            projY = selectedDraggable!.y;
            boxR = selectedDraggable!.hitRadiusPx + 6;
        }

        const cx = Math.min(inner.x + inner.width - 8, Math.max(inner.x + 8, inner.x + projX));
        const cy = Math.min(inner.y + inner.height - 8, Math.max(inner.y + 8, inner.y + projY));

        const minX = Math.max(inner.x + 2, cx - boxR);
        const maxX = Math.min(inner.x + inner.width - 2, cx + boxR);
        const minY = Math.max(inner.y + 2, cy - boxR);
        const maxY = Math.min(inner.y + inner.height - 2, cy + boxR);

        // 选中高亮圆形外框 + 四角定位括号 + 中心十字准星
        scratchColor.set(Palette.editor.selectionRing);
        g.strokeColor = scratchColor;
        g.lineWidth = 2.5;
        const ringHighlightR = Math.min(boxR - 2, cx - inner.x - 2, inner.x + inner.width - cx - 2, cy - inner.y - 2, inner.y + inner.height - cy - 2);
        if (ringHighlightR >= 8) {
            g.circle(cx, cy, ringHighlightR);
            g.stroke();
        }

        const arm = 12;
        g.lineWidth = 3;
        // 左下角
        g.moveTo(minX, minY + arm);
        g.lineTo(minX, minY);
        g.lineTo(minX + arm, minY);
        // 右下角
        g.moveTo(maxX - arm, minY);
        g.lineTo(maxX, minY);
        g.lineTo(maxX, minY + arm);
        // 右上角
        g.moveTo(maxX, maxY - arm);
        g.lineTo(maxX, maxY);
        g.lineTo(maxX - arm, maxY);
        // 左上角
        g.moveTo(minX + arm, maxY);
        g.lineTo(minX, maxY);
        g.lineTo(minX, maxY - arm);
        g.stroke();

        scratchColor.set(Palette.editor.selectionCross);
        g.strokeColor = scratchColor;
        g.lineWidth = 1.6;
        g.moveTo(cx - 8, cy);
        g.lineTo(cx + 8, cy);
        g.moveTo(cx, cy - 8);
        g.lineTo(cx, cy + 8);
        g.stroke();
    }

    private drawButton(g: Graphics, btn: EditorButton, offsetX: number, offsetY: number): void {
        const style = btn.getStyle();
        const x = offsetX + btn.x - btn.width * 0.5;
        const y = offsetY + btn.y - btn.height * 0.5;

        g.fillColor = style.fill;
        g.strokeColor = style.border;
        g.lineWidth = 1.8;
        g.roundRect(x, y, btn.width, btn.height, btn.radius);
        g.fill();
        g.stroke();

        if (btn.swatchColor) {
            g.fillColor = btn.swatchColor;
            g.circle(x + 18, y + btn.height * 0.5, 7);
            g.fill();
        }
    }

    private createButton(
        parent: Node,
        name: string,
        text: string,
        x: number,
        y: number,
        width: number,
        height: number,
        fontSize: number,
        radius: number,
        getStyle: () => { fill: Color; border: Color },
        onTap: () => void,
        swatchColor?: Color,
        labelOffsetX = 0,
    ): EditorButton {
        const node = new Node(name);
        node.layer = RenderLayers.FG_UI_2D;
        const tr = node.addComponent(UITransform);
        tr.setAnchorPoint(0.5, 0.5);
        tr.setContentSize(width, height);
        node.setPosition(x, y, 0);

        const lblNode = new Node('Label');
        lblNode.layer = RenderLayers.FG_UI_2D;
        const ltr = lblNode.addComponent(UITransform);
        ltr.setAnchorPoint(0.5, 0.5);
        ltr.setContentSize(width - 12 - Math.abs(labelOffsetX), height - 6);
        lblNode.setPosition(labelOffsetX * 0.5, 0, 0);

        const lbl = lblNode.addComponent(Label);
        lbl.string = text;
        lbl.fontSize = fontSize;
        lbl.lineHeight = Math.round(fontSize * 1.25);
        lbl.horizontalAlign = Label.HorizontalAlign.CENTER;
        lbl.verticalAlign = Label.VerticalAlign.CENTER;
        lbl.color = Palette.labelPrimary;
        lbl.overflow = Label.Overflow.SHRINK;
        node.addChild(lblNode);

        node.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
            e.propagationStopped = true;
            onTap();
        });
        node.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            e.propagationStopped = true;
        });
        node.on(Node.EventType.TOUCH_CANCEL, (e: EventTouch) => {
            e.propagationStopped = true;
        });

        parent.addChild(node);
        return { node, x, y, width, height, radius, getStyle, swatchColor };
    }

    private addLabel(
        parent: Node,
        name: string,
        text: string,
        x: number,
        y: number,
        width: number,
        height: number,
        fontSize: number,
        color: Color,
        hAlign: number,
    ): Label {
        const node = new Node(name);
        node.layer = RenderLayers.FG_UI_2D;
        const tr = node.addComponent(UITransform);
        tr.setAnchorPoint(0.5, 0.5);
        tr.setContentSize(width, height);
        node.setPosition(x, y, 0);

        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = Math.round(fontSize * 1.25);
        label.horizontalAlign = hAlign;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.color = color;
        label.overflow = Label.Overflow.SHRINK;

        parent.addChild(node);
        return label;
    }
}

function tryCopyClipboard(text: string): boolean {
    try {
        const nav = (globalThis as { navigator?: { clipboard?: { writeText?: (s: string) => Promise<void> } } })
            .navigator;
        if (nav?.clipboard?.writeText) {
            void nav.clipboard.writeText(text).catch(() => undefined);
            return true;
        }
        const doc = (globalThis as {
            document?: {
                createElement?: (tag: string) => {
                    value: string;
                    style: Record<string, string>;
                    select: () => void;
                    setSelectionRange?: (a: number, b: number) => void;
                };
                body?: { appendChild: (el: unknown) => void; removeChild: (el: unknown) => void };
                execCommand?: (cmd: string) => boolean;
            };
        }).document;
        if (doc?.createElement && doc.body && doc.execCommand) {
            const ta = doc.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            doc.body.appendChild(ta);
            ta.select();
            ta.setSelectionRange?.(0, text.length);
            const ok = doc.execCommand('copy');
            doc.body.removeChild(ta);
            return Boolean(ok);
        }
    } catch {
        // 忽略受限环境剪贴板异常
    }
    return false;
}
