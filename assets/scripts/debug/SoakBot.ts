import { _decorator, Color, Component, Graphics, Label, Node, UITransform } from 'cc';
import { GameConst } from '../config/GameConst';
import { LayoutConfig, LayoutRect, rectCenter } from '../config/LayoutConfig';
import { Palette } from '../config/Palette';
import { TankSpace } from '../config/TankSpace';
import { Bladder } from '../core/input/Bladder';
import { LevelState } from '../core/level/LevelState';
import {
    buildSoakBotTankHint,
    formatSoakElapsed,
    parseSoakBotOptions,
    SoakBotInputGenerator,
    SoakBotOptions,
    SoakInvariantChecker,
    SoakPillarHintTarget,
    SoakRingSnapshot,
    SoakViolation,
} from '../core/rules/SoakBotCore';
import { PhysicsStepper } from '../game/PhysicsStepper';
import { Pillar } from '../game/Pillar';
import { Ring } from '../game/Ring';
import { RingLayer } from '../game/RingLayer';
import { MatchClearedEvent, ScoreJudge } from '../game/ScoreJudge';
import { Sfx } from '../game/Sfx';
import { RenderLayers } from '../render/Stage3DRig';

const { ccclass } = _decorator;

const FRAME_BUDGET_MS = 12;

const BADGE_RECT: LayoutRect = {
    x: 1358,
    y: 20,
    width: 242,
    height: 62,
};

function getSafeSearchQuery(): string {
    try {
        if (typeof window !== 'undefined' && window.location && typeof window.location.search === 'string') {
            return window.location.search;
        }
    } catch {
        // 小游戏等无 DOM 环境静默降级
    }
    return '';
}

function nowMs(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

export interface SoakBotDeps {
    stepper: PhysicsStepper;
    ringLayer: RingLayer;
    scoreJudge: ScoreJudge;
    leftBladder: Bladder;
    rightBladder: Bladder;
    leftPillar: Pillar;
    rightPillar: Pillar;
    levelState: LevelState;
    sfx: Sfx | null;
    getCurrentLevelId: () => string;
    onRestartLevel: () => void;
}

/**
 * 挂机自测稳定性组件（GDD §3.5 第 3 条，T023）：
 * - 当网址带 `?bot=1`（且 `GameConst.DEBUG` 开启）时自动挂载运行；
 * - 使用 `SeededRandom` 拟真驱动左右气囊，每帧调用 `PhysicsStepper.stepOnce()` 加速推进；
 * - 每步检查 `body3D` 数值有限性、三维水缸边界、已锁定圈零漂移（兼容消除下落）及圈总数守恒；
 * - 任一不变量失败立即停机并在内屏醒目红框写明规则、模拟时间与目标圈；
 * - 屏幕右下角显示累计模拟时间与局数，过关或超时后自动重开。
 */
@ccclass('SoakBot')
export class SoakBot extends Component {
    private deps: SoakBotDeps | null = null;
    private options: SoakBotOptions = {
        enabled: false,
        stepsPerFrame: 8,
        seed: 2026001,
        muteSfx: true,
    };

    private inputGen = new SoakBotInputGenerator();
    private checker = new SoakInvariantChecker();

    private gfx: Graphics | null = null;
    private badgeLabel: Label | null = null;
    private errorTitleLabel: Label | null = null;
    private errorBodyLabel: Label | null = null;

    private totalSimTimeSec = 0;
    private roundIndex = 0;
    private roundInitialized = false;
    private restarting = false;
    private failedViolation: SoakViolation | null = null;
    private lastDisplayedSec = -1;
    private lastDisplayedRound = -1;

    private readonly snapshotsScratch: SoakRingSnapshot[] = [];
    private readonly clearedIdsScratch: number[] = [];
    private readonly pillarHintsScratch: [SoakPillarHintTarget, SoakPillarHintTarget] = [
        { x: 0, baseTopY: 0, tipY: 0, isFull: false },
        { x: 0, baseTopY: 0, tipY: 0, isFull: false },
    ];

    private unsubMatch: (() => void) | null = null;

    static createIfEnabled(machine: Node, deps: SoakBotDeps): SoakBot | null {
        if (!GameConst.DEBUG) {
            return null;
        }
        const options = parseSoakBotOptions(getSafeSearchQuery());
        if (!options.enabled) {
            return null;
        }

        const node = new Node('SoakBot');
        node.layer = RenderLayers.FG_UI_2D;

        const transform = node.addComponent(UITransform);
        transform.setContentSize(LayoutConfig.designWidth, LayoutConfig.designHeight);
        transform.setAnchorPoint(0, 0);
        node.setPosition(-LayoutConfig.designWidth / 2, -LayoutConfig.designHeight / 2, 0);

        const bot = node.addComponent(SoakBot);
        bot.init(deps, options);
        machine.addChild(node);
        return bot;
    }

    get hasFailure(): boolean {
        return this.failedViolation !== null;
    }

    get simulatedSec(): number {
        return this.totalSimTimeSec;
    }

    private init(deps: SoakBotDeps, options: SoakBotOptions): void {
        this.deps = deps;
        this.options = options;
        this.inputGen = new SoakBotInputGenerator(options.seed);
        this.checker = new SoakInvariantChecker();

        if (options.muteSfx && deps.sfx) {
            deps.sfx.setMuted(true);
        }

        this.bindStepperAndJudge();
    }

    onLoad(): void {
        this.ensureUi();
        this.bindStepperAndJudge();
        this.redraw();
        this.syncBadgeLabel(true);
    }

    onEnable(): void {
        this.bindStepperAndJudge();
    }

    onDisable(): void {
        this.unbindStepperAndJudge();
    }

    onDestroy(): void {
        this.unbindStepperAndJudge();
    }

    /** 每次关卡装载或重开完成时调用，登记本局初始总圈数与账本 */
    onRoundLoaded(levelId: string): void {
        if (!this.deps || this.failedViolation) {
            return;
        }
        this.roundIndex++;
        this.roundInitialized = true;
        this.restarting = false;
        this.inputGen.clearPending();
        this.deps.leftBladder.setPressed(false);
        this.deps.rightBladder.setPressed(false);

        const snaps = this.collectSnapshots();
        this.checker.beginRound(this.roundIndex, levelId, snaps);
        this.syncBadgeLabel(true);
    }

    update(_dt: number): void {
        if (!this.deps || !this.roundInitialized || this.failedViolation) {
            return;
        }

        const { stepper, levelState, onRestartLevel } = this.deps;

        if (levelState.isFinished) {
            if (!this.restarting) {
                this.restarting = true;
                onRestartLevel();
            }
            this.syncBadgeLabel(false);
            return;
        }

        if (levelState.shouldRunPhysics && this.options.stepsPerFrame > 1) {
            const extraSteps = this.options.stepsPerFrame - 1;
            const startMs = nowMs();
            for (let i = 0; i < extraSteps; i++) {
                if (this.failedViolation || levelState.isFinished || !stepper.running) {
                    break;
                }
                stepper.stepOnce();
                if (i > 0 && nowMs() - startMs >= FRAME_BUDGET_MS) {
                    break;
                }
            }

            if (levelState.isFinished && !this.failedViolation && !this.restarting) {
                this.restarting = true;
                onRestartLevel();
            }
        }

        this.syncBadgeLabel(false);
    }

    private bindStepperAndJudge(): void {
        if (!this.deps) {
            return;
        }
        this.deps.stepper.onBeforeStep(this.onBeforePhysicsStep);
        this.deps.stepper.onAfterStep(this.onAfterPhysicsStep);
        if (!this.unsubMatch) {
            this.unsubMatch = this.deps.scoreJudge.onMatchCleared(this.onMatchCleared);
        }
    }

    private unbindStepperAndJudge(): void {
        if (!this.deps) {
            return;
        }
        this.deps.stepper.offBeforeStep(this.onBeforePhysicsStep);
        this.deps.stepper.offAfterStep(this.onAfterPhysicsStep);
        this.unsubMatch?.();
        this.unsubMatch = null;
    }

    private onMatchCleared = (event: MatchClearedEvent): void => {
        if (this.failedViolation) {
            return;
        }
        const ids = this.clearedIdsScratch;
        ids.length = 0;
        for (let i = 0; i < event.clearedRings.length; i++) {
            const ring = event.clearedRings[i];
            if (ring.isBodyReady) {
                ids.push(ring.body3D.id);
            }
        }
        this.checker.markMatchCleared(ids);
    };

    private onBeforePhysicsStep = (dt: number): void => {
        if (!this.deps || !this.roundInitialized || this.failedViolation) {
            return;
        }
        if (!this.deps.levelState.shouldRunPhysics) {
            return;
        }

        const { leftPillar, rightPillar, scoreJudge, leftBladder, rightBladder } = this.deps;
        this.pillarHintsScratch[0].x = leftPillar.node.position.x;
        this.pillarHintsScratch[0].baseTopY = leftPillar.baseTopY;
        this.pillarHintsScratch[0].tipY = leftPillar.tipY;
        this.pillarHintsScratch[0].isFull = scoreJudge.isPillarFull('left');

        this.pillarHintsScratch[1].x = rightPillar.node.position.x;
        this.pillarHintsScratch[1].baseTopY = rightPillar.baseTopY;
        this.pillarHintsScratch[1].tipY = rightPillar.tipY;
        this.pillarHintsScratch[1].isFull = scoreJudge.isPillarFull('right');

        const snaps = this.collectSnapshots();
        const hint = buildSoakBotTankHint(snaps, TankSpace.width, this.pillarHintsScratch);
        const inp = this.inputGen.step(dt, hint);
        leftBladder.setPressed(inp.leftPressed);
        rightBladder.setPressed(inp.rightPressed);
    };

    private onAfterPhysicsStep = (dt: number): void => {
        if (!this.deps || !this.roundInitialized || this.failedViolation) {
            return;
        }

        this.totalSimTimeSec += dt;
        const snaps = this.collectSnapshots();
        const violation = this.checker.checkStep(
            this.totalSimTimeSec,
            this.deps.stepper.world.tank,
            snaps,
            this.deps.stepper.world.bodies.length,
        );
        if (violation) {
            this.triggerFailure(violation);
        }
    };

    private collectSnapshots(): readonly SoakRingSnapshot[] {
        const list = this.snapshotsScratch;
        if (!this.deps) {
            list.length = 0;
            return list;
        }

        const rings = this.deps.ringLayer.getRings();
        const scoreJudge = this.deps.scoreJudge;
        let outIdx = 0;

        for (let i = 0; i < rings.length; i++) {
            const ring: Ring = rings[i];
            if (!ring.isValid || !ring.isBodyReady) {
                continue;
            }
            const isDropping = scoreJudge.isRingDropping(ring);
            const dropTargetY = isDropping ? scoreJudge.getRingDropTargetY(ring) : undefined;
            let slot = list[outIdx];
            if (!slot) {
                slot = {
                    id: ring.body3D.id,
                    kind: ring.spec.kind,
                    color: ring.spec.color,
                    locked: ring.locked,
                    clearing: ring.clearing,
                    isDropping,
                    dropTargetY,
                    body: ring.body3D,
                };
                list.push(slot);
            } else {
                slot.id = ring.body3D.id;
                slot.kind = ring.spec.kind;
                slot.color = ring.spec.color;
                slot.locked = ring.locked;
                slot.clearing = ring.clearing;
                slot.isDropping = isDropping;
                slot.dropTargetY = dropTargetY;
                slot.body = ring.body3D;
            }
            outIdx++;
        }

        list.length = outIdx;
        return list;
    }

    private triggerFailure(violation: SoakViolation): void {
        this.failedViolation = violation;
        if (this.deps) {
            this.deps.stepper.running = false;
            this.deps.leftBladder.setPressed(false);
            this.deps.rightBladder.setPressed(false);
            this.deps.levelState.pause();
            this.deps.sfx?.stopJetLoop();
        }

        console.error(
            `[SoakBot] ${violation.ruleLabel} | time=${formatSoakElapsed(violation.simTimeSec)} (${violation.simTimeSec.toFixed(2)}s) | ${violation.levelId} 第 ${violation.roundIndex} 局 | ${violation.ringDesc} | ${violation.detail}`,
        );

        this.redraw();
        this.syncBadgeLabel(true);
        this.showErrorOverlay(violation);
    }

    private ensureUi(): void {
        if (!this.gfx || !this.gfx.isValid) {
            this.gfx = this.getComponent(Graphics) ?? this.addComponent(Graphics);
        }

        if (!this.badgeLabel) {
            const c = rectCenter(BADGE_RECT);
            this.badgeLabel = this.createLabel(
                'SoakBadgeLabel',
                'BOT 00:00 · 第0局',
                c.x,
                c.y,
                BADGE_RECT.width - 14,
                BADGE_RECT.height - 8,
                19,
                Palette.soakBot.badgeText,
                Label.HorizontalAlign.CENTER,
            );
        }

        if (!this.errorTitleLabel || !this.errorBodyLabel) {
            const inner = LayoutConfig.innerScreen;
            const ic = rectCenter(inner);
            const cardW = Math.min(760, inner.width - 80);

            this.errorTitleLabel = this.createLabel(
                'SoakErrorTitle',
                '',
                ic.x,
                ic.y + 84,
                cardW - 40,
                46,
                28,
                Palette.soakBot.errorTitle,
                Label.HorizontalAlign.CENTER,
            );
            this.errorTitleLabel.node.active = false;

            this.errorBodyLabel = this.createLabel(
                'SoakErrorBody',
                '',
                ic.x,
                ic.y - 26,
                cardW - 44,
                168,
                20,
                Palette.soakBot.errorText,
                Label.HorizontalAlign.LEFT,
            );
            this.errorBodyLabel.node.active = false;
        }
    }

    private syncBadgeLabel(force: boolean): void {
        if (!this.badgeLabel) {
            return;
        }
        const wholeSec = Math.floor(this.totalSimTimeSec);
        if (!force && wholeSec === this.lastDisplayedSec && this.roundIndex === this.lastDisplayedRound) {
            return;
        }
        this.lastDisplayedSec = wholeSec;
        this.lastDisplayedRound = this.roundIndex;

        const timeStr = formatSoakElapsed(this.totalSimTimeSec);
        if (this.failedViolation) {
            this.badgeLabel.color = Palette.soakBot.errorTitle;
            this.badgeLabel.string = `BOT ERR ${timeStr}\n第${this.roundIndex}局`;
        } else {
            this.badgeLabel.color = Palette.soakBot.badgeText;
            this.badgeLabel.string = `BOT ${timeStr}\n第${this.roundIndex}局 · ${this.options.stepsPerFrame}x`;
        }
    }

    private showErrorOverlay(v: SoakViolation): void {
        if (!this.errorTitleLabel || !this.errorBodyLabel) {
            return;
        }
        this.errorTitleLabel.node.active = true;
        this.errorBodyLabel.node.active = true;
        this.errorTitleLabel.string = `挂机自测异常停止：${v.ruleLabel}`;
        this.errorBodyLabel.string = [
            `规则编号：${v.rule}`,
            `模拟时间：${formatSoakElapsed(v.simTimeSec)}（第 ${v.simTimeSec.toFixed(2)} 秒）`,
            `关卡局次：${v.levelId} 第 ${v.roundIndex} 局`,
            `涉事圆环：${v.ringDesc}`,
            `异常详情：${v.detail}`,
        ].join('\n');
    }

    private redraw(): void {
        const g = this.gfx;
        if (!g || !g.isValid) {
            return;
        }
        g.clear();

        // 1. 右下角挂机模拟时间角标底板
        g.fillColor = this.failedViolation ? Palette.soakBot.errorBg : Palette.soakBot.badgeBg;
        g.strokeColor = this.failedViolation ? Palette.soakBot.errorBorder : Palette.soakBot.badgeBorder;
        g.lineWidth = 2;
        g.roundRect(BADGE_RECT.x, BADGE_RECT.y, BADGE_RECT.width, BADGE_RECT.height, 10);
        g.fill();
        g.stroke();

        // 2. 仅在失败时于内屏正中绘制醒目红色告警框
        if (this.failedViolation) {
            const inner = LayoutConfig.innerScreen;
            const ic = rectCenter(inner);
            const cardW = Math.min(760, inner.width - 80);
            const cardH = 264;
            const cardX = ic.x - cardW / 2;
            const cardY = ic.y - cardH / 2;

            g.fillColor = Palette.soakBot.errorBg;
            g.strokeColor = Palette.soakBot.errorBorder;
            g.lineWidth = 4;
            g.roundRect(cardX, cardY, cardW, cardH, 16);
            g.fill();
            g.stroke();
        }
    }

    private createLabel(
        name: string,
        text: string,
        x: number,
        y: number,
        width: number,
        height: number,
        fontSize: number,
        color: Color,
        align: number,
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
        label.lineHeight = Math.round(fontSize * 1.3);
        label.horizontalAlign = align;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.color = color;
        label.overflow = Label.Overflow.SHRINK;

        this.node.addChild(node);
        return label;
    }
}
