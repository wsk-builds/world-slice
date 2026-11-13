import {
    _decorator, BlockInputEvents, Color, Component, EventTouch, Graphics, Label, Layers, Node, sys, UITransform, Vec3,
} from 'cc';
import { DEFAULT_FEEL_CONFIG, FeelConfig } from '../config/FeelConfig';
import { GameConst } from '../config/GameConst';
import { LayoutConfig } from '../config/LayoutConfig';
import { Palette } from '../config/Palette';
import { applyFeel, offFeelApplied, onFeelApplied, SolvedFeel, SolvedFeelConfig } from '../core/flow/FeelSolver';
import {
    FEEL_SLIDER_SPECS, formatFeelCompactJson, formatFeelExportJson, hasFeelPreset, loadFeelPreset, PRESET_SLOTS,
    PresetSlot, resolveDefaultStorage, saveFeelPreset, StorageLike,
} from './TuningPresets';
import { TuningSlider } from './TuningSlider';

const { ccclass } = _decorator;

const TOGGLE_RECT = { x: 24, y: 596, width: 112, height: 48 } as const;
const PANEL_WIDTH = 920;
const PANEL_HEIGHT = 488;
const PANEL_X = LayoutConfig.innerScreen.x + (LayoutConfig.innerScreen.width - PANEL_WIDTH) / 2;
const PANEL_TOP_Y = LayoutConfig.innerScreen.y + LayoutConfig.innerScreen.height - 16;
const PANEL_PADDING_X = 18;
const COL_GAP = 24;
const COL_WIDTH = (PANEL_WIDTH - PANEL_PADDING_X * 2 - COL_GAP) / 2; // 430

const EXPORT_BOX = {
    x: 18,
    y: -234,
    width: PANEL_WIDTH - 36,
    height: 214,
} as const;

const tempPos = new Vec3();

interface PanelButton {
    node: Node;
    width: number;
    height: number;
    radius: number;
    getTone: () => 'normal' | 'active' | 'muted';
}

/**
 * 灰盒实时调参面板（GDD §3.4，T011），受 GameConst.DEBUG 控制：
 * - 左上角「调参」按钮开关面板，面板置于内屏区域不遮挡左右喷射键；
 * - 12 个中文体感滑块拖动立刻调用 applyFeel() 生效；
 * - 支持 3 个本地预设槽位存取、恢复默认及导出 JSON 到控制台与面板显示；
 * - 整个面板（含开关按钮、全部滑块、按钮与导出框）共用同一个 Graphics 组件，省显存。
 */
@ccclass('TuningPanel')
export class TuningPanel extends Component {
    private gfx!: Graphics;
    private toggleBtn!: PanelButton;
    private bodyNode!: Node;
    private exportBoxNode!: Node;

    private metricsLabel!: Label;
    private statusLabel!: Label;
    private exportJsonLabel!: Label;

    private readonly sliders: TuningSlider[] = [];
    private readonly panelButtons: PanelButton[] = [];
    private readonly exportButtons: PanelButton[] = [];
    private storage: StorageLike | null = null;
    private syncingFromExternal = false;
    private lastExportJson = '';

    static create(machine: Node): TuningPanel {
        const node = new Node('TuningPanel');
        node.layer = Layers.Enum.UI_2D;

        const transform = node.addComponent(UITransform);
        transform.setContentSize(LayoutConfig.designWidth, LayoutConfig.designHeight);
        transform.setAnchorPoint(0, 0);
        node.setPosition(-LayoutConfig.designWidth / 2, -LayoutConfig.designHeight / 2, 0);

        const panel = node.addComponent(TuningPanel);
        machine.addChild(node);
        return panel;
    }

    onLoad(): void {
        if (!GameConst.DEBUG) {
            this.node.active = false;
            return;
        }

        this.storage = this.resolveStorage();
        this.gfx = this.getComponent(Graphics) ?? this.addComponent(Graphics);

        this.buildToggleButton();
        this.buildPanelBody();
        this.syncMetricsLabel(SolvedFeelConfig);
        this.redraw();
    }

    onEnable(): void {
        if (!GameConst.DEBUG) {
            return;
        }
        onFeelApplied(this.handleExternalFeelApplied);
    }

    onDisable(): void {
        offFeelApplied(this.handleExternalFeelApplied);
    }

    private resolveStorage(): StorageLike | null {
        try {
            const ccStorage = sys?.localStorage as StorageLike | undefined;
            if (ccStorage && typeof ccStorage.getItem === 'function' && typeof ccStorage.setItem === 'function') {
                return ccStorage;
            }
        } catch {
            // 忽略访问受限环境
        }
        return resolveDefaultStorage();
    }

    private buildToggleButton(): void {
        const cx = TOGGLE_RECT.x + TOGGLE_RECT.width / 2;
        const cy = TOGGLE_RECT.y + TOGGLE_RECT.height / 2;
        this.toggleBtn = this.createButton(
            this.node,
            'TuningToggle',
            '调参',
            cx,
            cy,
            TOGGLE_RECT.width,
            TOGGLE_RECT.height,
            20,
            10,
            () => (this.bodyNode?.active ? 'active' : 'normal'),
            () => this.togglePanel(),
        );
    }

    private buildPanelBody(): void {
        const body = new Node('TuningBody');
        body.layer = Layers.Enum.UI_2D;
        const bodyTr = body.addComponent(UITransform);
        bodyTr.setAnchorPoint(0, 1);
        bodyTr.setContentSize(PANEL_WIDTH, PANEL_HEIGHT);
        body.setPosition(PANEL_X, PANEL_TOP_Y, 0);
        body.addComponent(BlockInputEvents);
        body.active = false;
        this.node.addChild(body);
        this.bodyNode = body;

        this.buildHeader(body);
        this.buildSliders(body);
        this.buildPresetAndExportBar(body);
        this.buildStatusRow(body);
        this.buildExportBox(body);
    }

    private buildHeader(body: Node): void {
        this.addLabel(
            body,
            'HeaderTitle',
            '手感调参（拖动立即生效）',
            PANEL_PADDING_X,
            -28,
            260,
            28,
            20,
            Palette.labelPrimary,
            Label.HorizontalAlign.LEFT,
            0,
        );

        this.metricsLabel = this.addLabel(
            body,
            'MetricsLabel',
            '',
            420,
            -28,
            300,
            24,
            15,
            Palette.tuning.accentText,
            Label.HorizontalAlign.LEFT,
            0,
        );

        const resetBtn = this.createButton(
            body,
            'ResetDefaultBtn',
            '恢复默认',
            786,
            -28,
            104,
            32,
            16,
            8,
            () => 'normal',
            () => this.resetToDefault(),
        );
        const closeBtn = this.createButton(
            body,
            'CloseBtn',
            '×',
            882,
            -28,
            40,
            32,
            22,
            8,
            () => 'normal',
            () => this.setPanelOpen(false),
        );
        this.panelButtons.push(resetBtn, closeBtn);
    }

    private buildSliders(body: Node): void {
        const startY = -52;
        for (let i = 0; i < FEEL_SLIDER_SPECS.length; i++) {
            const spec = FEEL_SLIDER_SPECS[i];
            const col = Math.floor(i / 6);
            const row = i % 6;
            const x = PANEL_PADDING_X + col * (COL_WIDTH + COL_GAP);
            const y = startY - row * TuningSlider.ROW_HEIGHT;

            const slider = TuningSlider.create(
                body,
                COL_WIDTH,
                spec,
                FeelConfig[spec.key],
                DEFAULT_FEEL_CONFIG[spec.key],
                (value) => this.onSliderChanged(spec.key, value),
            );
            slider.node.setPosition(x, y, 0);
            this.sliders.push(slider);
        }
    }

    private buildPresetAndExportBar(body: Node): void {
        const rowY = -430;
        this.addLabel(
            body,
            'PresetHint',
            '预设:',
            PANEL_PADDING_X,
            rowY,
            52,
            28,
            17,
            Palette.labelMuted,
            Label.HorizontalAlign.LEFT,
            0,
        );

        let cursorX = PANEL_PADDING_X + 54;
        for (const slot of PRESET_SLOTS) {
            const saveBtn = this.createButton(
                body,
                `SavePreset_${slot}`,
                `存${slot}`,
                cursorX + 32,
                rowY,
                64,
                34,
                16,
                8,
                () => 'normal',
                () => this.onSavePreset(slot),
            );
            cursorX += 64 + 8;

            const loadBtn = this.createButton(
                body,
                `LoadPreset_${slot}`,
                `读${slot}`,
                cursorX + 32,
                rowY,
                64,
                34,
                16,
                8,
                () => (hasFeelPreset(slot, this.storage) ? 'active' : 'muted'),
                () => this.onLoadPreset(slot),
            );
            cursorX += 64 + 18;
            this.panelButtons.push(saveBtn, loadBtn);
        }

        const exportBtn = this.createButton(
            body,
            'ExportJsonBtn',
            '导出 JSON',
            PANEL_WIDTH - PANEL_PADDING_X - 68,
            rowY,
            136,
            34,
            16,
            8,
            () => (this.exportBoxNode?.active ? 'active' : 'normal'),
            () => this.onExportJson(),
        );
        this.panelButtons.push(exportBtn);
    }

    private buildStatusRow(body: Node): void {
        this.statusLabel = this.addLabel(
            body,
            'StatusLabel',
            '拖动滑块立即生效；黄色竖线为默认值，不挡左右喷射键',
            PANEL_PADDING_X,
            -468,
            PANEL_WIDTH - PANEL_PADDING_X * 2,
            24,
            15,
            Palette.tuning.mutedText,
            Label.HorizontalAlign.LEFT,
            0,
        );
    }

    private buildExportBox(body: Node): void {
        const box = new Node('ExportJsonBox');
        box.layer = Layers.Enum.UI_2D;
        const tr = box.addComponent(UITransform);
        tr.setAnchorPoint(0, 1);
        tr.setContentSize(EXPORT_BOX.width, EXPORT_BOX.height);
        box.setPosition(EXPORT_BOX.x, EXPORT_BOX.y, 0);
        box.addComponent(BlockInputEvents);
        box.active = false;
        body.addChild(box);
        this.exportBoxNode = box;

        this.addLabel(
            box,
            'ExportTitle',
            '当前参数 JSON（已打印控制台，点击复制即可粘贴）',
            16,
            -22,
            560,
            26,
            17,
            Palette.tuning.accentText,
            Label.HorizontalAlign.LEFT,
            0,
        );

        const copyBtn = this.createButton(
            box,
            'CopyJsonBtn',
            '复制',
            EXPORT_BOX.width - 134,
            -22,
            78,
            30,
            15,
            6,
            () => 'active',
            () => this.copyLastExportToClipboard(),
        );
        const hideBtn = this.createButton(
            box,
            'HideJsonBtn',
            '收起',
            EXPORT_BOX.width - 48,
            -22,
            78,
            30,
            15,
            6,
            () => 'normal',
            () => this.setExportBoxVisible(false),
        );
        this.exportButtons.push(copyBtn, hideBtn);

        this.exportJsonLabel = this.addLabel(
            box,
            'ExportJsonContent',
            '',
            16,
            -120,
            EXPORT_BOX.width - 32,
            150,
            16,
            Palette.labelPrimary,
            Label.HorizontalAlign.LEFT,
            0,
        );
        this.exportJsonLabel.lineHeight = 24;
    }

    private togglePanel(): void {
        this.setPanelOpen(!this.bodyNode.active);
    }

    private setPanelOpen(open: boolean): void {
        this.bodyNode.active = open;
        if (!open && this.exportBoxNode) {
            this.exportBoxNode.active = false;
        }
        this.redraw();
    }

    private setExportBoxVisible(visible: boolean): void {
        this.exportBoxNode.active = visible;
        this.redraw();
    }

    private onSliderChanged(key: keyof typeof FeelConfig, value: number): void {
        if (this.syncingFromExternal) {
            return;
        }
        this.syncingFromExternal = true;
        try {
            const solved = applyFeel({ [key]: value });
            this.syncMetricsLabel(solved);
            if (this.exportBoxNode.active) {
                this.refreshExportDisplay(false);
            }
        } finally {
            this.syncingFromExternal = false;
        }
        this.redraw();
    }

    private onSavePreset(slot: PresetSlot): void {
        const ok = saveFeelPreset(slot, FeelConfig, this.storage);
        this.setStatus(ok ? `已保存到本地预设 ${slot}（刷新后点「读${slot}」恢复）` : `保存预设 ${slot} 失败：本地存储不可用`);
        this.redraw();
    }

    private onLoadPreset(slot: PresetSlot): void {
        const loaded = loadFeelPreset(slot, this.storage);
        if (!loaded) {
            this.setStatus(`预设 ${slot} 为空，请先点击「存${slot}」`);
            return;
        }
        this.applyFeelAndSync(loaded);
        this.setStatus(`已读取预设 ${slot} 并立即生效`);
    }

    private resetToDefault(): void {
        this.applyFeelAndSync(DEFAULT_FEEL_CONFIG);
        this.setStatus('已恢复 GDD 默认体感参数');
    }

    private applyFeelAndSync(nextFeel: Readonly<typeof DEFAULT_FEEL_CONFIG>): void {
        this.syncingFromExternal = true;
        try {
            const solved = applyFeel({ ...nextFeel });
            this.syncAllSliders();
            this.syncMetricsLabel(solved);
            if (this.exportBoxNode.active) {
                this.refreshExportDisplay(false);
            }
        } finally {
            this.syncingFromExternal = false;
        }
        this.redraw();
    }

    private handleExternalFeelApplied = (solved: Readonly<SolvedFeel>): void => {
        if (this.syncingFromExternal) {
            return;
        }
        this.syncAllSliders();
        this.syncMetricsLabel(solved);
        if (this.exportBoxNode?.active) {
            this.refreshExportDisplay(false);
        }
        this.redraw();
    };

    private syncAllSliders(): void {
        for (const slider of this.sliders) {
            slider.setValue(FeelConfig[slider.key]);
        }
    }

    private syncMetricsLabel(solved: Readonly<SolvedFeel>): void {
        if (!this.metricsLabel) {
            return;
        }
        const m = solved.measured;
        this.metricsLabel.string = `1D预估: 沉${m.sinkSec.toFixed(2)}s 轻${Math.round(m.tapLiftPct)}% 满${Math.round(m.holdLiftPct)}%`;
    }

    private onExportJson(): void {
        this.refreshExportDisplay(true);
        this.setExportBoxVisible(true);
    }

    private refreshExportDisplay(logAndCopy: boolean): void {
        const prettyJson = formatFeelExportJson(FeelConfig);
        this.lastExportJson = prettyJson;
        this.exportJsonLabel.string = formatFeelCompactJson(FeelConfig);

        if (logAndCopy) {
            console.log(`[调参面板] 当前体感参数 JSON：\n${prettyJson}`);
            this.copyLastExportToClipboard(true);
        }
    }

    private copyLastExportToClipboard(fromExport = false): void {
        const text = this.lastExportJson || formatFeelExportJson(FeelConfig);
        const copied = tryCopyClipboard(text);
        if (copied) {
            this.setStatus(fromExport ? '已打印到控制台、显示在面板并尝试复制 JSON' : '已复制 JSON 到剪贴板');
        } else {
            this.setStatus('已打印到控制台并显示在面板中，可从控制台复制');
        }
    }

    private setStatus(msg: string): void {
        if (this.statusLabel) {
            this.statusLabel.string = msg;
        }
    }

    private redraw(): void {
        const g = this.gfx;
        if (!g) {
            return;
        }
        const gTransform = g.node.getComponent(UITransform);
        if (!gTransform) {
            return;
        }

        g.clear();
        this.drawButton(g, gTransform, this.toggleBtn);

        if (!this.bodyNode.active) {
            return;
        }

        // 面板半透明底板（位于内屏范围内，不挡喷射键）
        g.fillColor = Palette.tuning.panelBg;
        g.strokeColor = Palette.tuning.panelBorder;
        g.lineWidth = 2;
        g.roundRect(PANEL_X, PANEL_TOP_Y - PANEL_HEIGHT, PANEL_WIDTH, PANEL_HEIGHT, 14);
        g.fill();
        g.stroke();

        for (const btn of this.panelButtons) {
            this.drawButton(g, gTransform, btn);
        }
        for (const slider of this.sliders) {
            slider.draw(g);
        }

        if (this.exportBoxNode.active) {
            const bx = PANEL_X + EXPORT_BOX.x;
            const by = PANEL_TOP_Y + EXPORT_BOX.y - EXPORT_BOX.height;
            g.fillColor = Palette.tuning.exportBg;
            g.strokeColor = Palette.tuning.panelBorder;
            g.lineWidth = 2;
            g.roundRect(bx, by, EXPORT_BOX.width, EXPORT_BOX.height, 10);
            g.fill();
            g.stroke();

            for (const btn of this.exportButtons) {
                this.drawButton(g, gTransform, btn);
            }
        }
    }

    private drawButton(g: Graphics, gTransform: UITransform, btn: PanelButton): void {
        gTransform.convertToNodeSpaceAR(btn.node.worldPosition, tempPos);
        const x = tempPos.x - btn.width / 2;
        const y = tempPos.y - btn.height / 2;
        const tone = btn.getTone();

        g.fillColor =
            tone === 'active'
                ? Palette.tuning.btnActiveFill
                : tone === 'muted'
                    ? Palette.tuning.btnMutedFill
                    : Palette.tuning.btnFill;
        g.strokeColor = Palette.tuning.btnBorder;
        g.lineWidth = 1.5;
        g.roundRect(x, y, btn.width, btn.height, btn.radius);
        g.fill();
        g.stroke();
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
        getTone: () => 'normal' | 'active' | 'muted',
        onTap: () => void,
    ): PanelButton {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        const tr = node.addComponent(UITransform);
        tr.setAnchorPoint(0.5, 0.5);
        tr.setContentSize(width, height);
        node.setPosition(x, y, 0);

        const lbl = node.addComponent(Label);
        lbl.string = text;
        lbl.fontSize = fontSize;
        lbl.lineHeight = Math.round(fontSize * 1.25);
        lbl.horizontalAlign = Label.HorizontalAlign.CENTER;
        lbl.verticalAlign = Label.VerticalAlign.CENTER;
        lbl.color = Palette.labelPrimary;

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
        return { node, width, height, radius, getTone };
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
        anchorX: number,
    ): Label {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        const tr = node.addComponent(UITransform);
        tr.setAnchorPoint(anchorX, 0.5);
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
        // 忽略剪贴板权限或非浏览器环境错误
    }
    return false;
}
