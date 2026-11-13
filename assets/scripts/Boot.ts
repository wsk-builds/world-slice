import { _decorator, Component, Node, screen, UITransform, view } from 'cc';
import { GameConst } from './config/GameConst';
import { calcMachineScale, LayoutConfig } from './config/LayoutConfig';
import { applyFeel, onFeelApplied } from './core/flow/FeelSolver';
import { FlowField } from './core/flow/FlowField';
import { Bladder } from './core/input/Bladder';
import { LevelState } from './core/level/LevelState';
import { PhysicsDebugDraw } from './debug/PhysicsDebugDraw';
import { HotZoneDebugDraw } from './debug/HotZoneDebugDraw';
import { LevelEditor, LevelEditorExitInfo } from './debug/LevelEditor';
import { RingDebugSpawner } from './debug/RingDebugSpawner';
import { TuningPanel } from './debug/TuningPanel';
import { Funnel } from './game/Funnel';
import { LevelLoader, LevelSessionHost } from './game/LevelLoader';
import { PhysicsStepper } from './game/PhysicsStepper';
import { Pillar } from './game/Pillar';
import { PillarEnergyController } from './game/PillarEnergyController';
import { RingLayer } from './game/RingLayer';
import { ScoreJudge } from './game/ScoreJudge';
import { Sfx } from './game/Sfx';
import { Tank } from './game/Tank';
import { Tappable } from './game/Tappable';
import { TidePullSkill } from './game/TidePullSkill';
import { CalmSeaSkill } from './game/CalmSeaSkill';
import { WaterForce } from './game/WaterForce';
import { Bubbles } from './render/Bubbles';
import { RenderLayers, Stage3DRig } from './render/Stage3DRig';
import { GlassTap } from './ui/GlassTap';
import { Hud } from './ui/Hud';
import { JetButton } from './ui/JetButton';
import { ShellView } from './ui/ShellView';

const { ccclass } = _decorator;

export interface LevelBootSessionOptions {
    levelId?: string;
    durationSec?: number;
    seed?: number;
    title?: string;
    pillarEnergy?: { left: boolean; right: boolean };
    spawnRings?: (ringLayer: RingLayer) => void;
    autoStart?: boolean;
}

/** 场景唯一入口，挂在 Canvas 上，运行时用代码搭建三相机夹心架构、3D 圈柱舞台与掌机界面。 */
@ccclass('Boot')
export class Boot extends Component implements LevelSessionHost {
    readonly levelState = new LevelState({ durationSec: GameConst.defaultLevelDurationSec });

    private machineNode: Node | null = null;
    private stageRig: Stage3DRig | null = null;
    private stepper: PhysicsStepper | null = null;
    private bubbles: Bubbles | null = null;
    private ringLayer: RingLayer | null = null;
    private waterForce: WaterForce | null = null;
    private scoreJudge: ScoreJudge | null = null;
    private pillarEnergy: PillarEnergyController | null = null;
    private funnel: Funnel | null = null;
    private tidePullSkill: TidePullSkill | null = null;
    private calmSeaSkill: CalmSeaSkill | null = null;
    private tappable: Tappable | null = null;
    private glassTap: GlassTap | null = null;
    private levelLoader: LevelLoader | null = null;
    private leftJetBtn: JetButton | null = null;
    private rightJetBtn: JetButton | null = null;
    private hud: Hud | null = null;
    private sfx: Sfx | null = null;
    private leftBladder: Bladder | null = null;
    private rightBladder: Bladder | null = null;
    private ringSpawner: RingDebugSpawner | null = null;
    private tuningPanel: TuningPanel | null = null;
    private levelEditor: LevelEditor | null = null;
    private editorActive = false;
    private lastCountdownTickSec = -1;

    private currentLevelOptions: LevelBootSessionOptions = {
        levelId: GameConst.defaultLevelId,
        durationSec: GameConst.defaultLevelDurationSec,
        seed: GameConst.defaultLevelSeed,
        title: GameConst.defaultLevelId,
        pillarEnergy: { left: true, right: true },
        autoStart: true,
    };

    private unsubFeel: (() => void) | null = null;
    private unsubLevelStatus: (() => void) | null = null;
    private unsubCollision: (() => void) | null = null;
    private unsubLockSfx: (() => void) | null = null;
    private unsubMatchSfx: (() => void) | null = null;
    private unsubSkillSfx: (() => void) | null = null;

    onLoad(): void {
        applyFeel();

        // 1. 初始化三相机夹心架构（Camera1 2D背景 -> Camera2 3D圈柱 -> Camera3 2D外壳与UI）
        const stageRig = Stage3DRig.setup(this.node);
        this.stageRig = stageRig;

        const machine = new Node('Machine');
        machine.layer = RenderLayers.FG_UI_2D;
        const machineTransform = machine.addComponent(UITransform);
        machineTransform.setContentSize(LayoutConfig.designWidth, LayoutConfig.designHeight);
        machineTransform.setAnchorPoint(0.5, 0.5);
        this.node.addChild(machine);
        this.machineNode = machine;
        this.fitMachine();

        const leftBladder = new Bladder();
        const rightBladder = new Bladder();
        this.leftBladder = leftBladder;
        this.rightBladder = rightBladder;
        const flowField = new FlowField({ seed: GameConst.defaultLevelSeed });
        const sfx = Sfx.attach(this.node);
        this.sfx = sfx;

        // 2. 内屏节点（原点在机身内屏左下角），背景与气泡由 Camera 1 拍摄，圈柱在 3D 舞台由 Camera 2 拍摄
        const tankRoot = this.createTankRoot(machine);
        const stepper = tankRoot.addComponent(PhysicsStepper);
        const tank = Tank.create(tankRoot);
        const bubbles = Bubbles.create(tankRoot, flowField);
        const [leftPillar, rightPillar] = Pillar.createPair(tankRoot, stageRig.tank3DRoot);
        const ringLayer = RingLayer.create(tankRoot, stageRig.tank3DRoot);
        const waterForce = WaterForce.attach(tankRoot, flowField, leftBladder, rightBladder, ringLayer);
        const scoreJudge = ScoreJudge.attach(tankRoot, leftPillar, rightPillar, ringLayer);
        const pillarEnergy = PillarEnergyController.attach(tankRoot, leftPillar, rightPillar, scoreJudge);
        const funnel = Funnel.attach(tankRoot, leftPillar, rightPillar, ringLayer, scoreJudge);
        const tidePullSkill = TidePullSkill.attach(tankRoot, {
            flowField,
            funnel,
            energyController: pillarEnergy,
            scoreJudge,
            leftPillar,
        });
        const calmSeaSkill = CalmSeaSkill.attach(tankRoot, {
            flowField,
            energyController: pillarEnergy,
            ringLayer,
            leftPillar,
            rightPillar,
            scoreJudge,
        });
        const tappable = Tappable.attach(tankRoot);
        const glassTap = GlassTap.attach(tankRoot, { tappable, stepper });
        const ringSpawner = tankRoot.addComponent(RingDebugSpawner);
        ringSpawner.ringLayer = ringLayer;
        ringSpawner.scoreJudge = scoreJudge;
        ringSpawner.onClearAll = () => {
            this.tidePullSkill?.reset();
            this.calmSeaSkill?.reset();
            this.funnel?.reset();
            this.pillarEnergy?.reset(this.currentLevelOptions.pillarEnergy);
            this.glassTap?.clearRipples();
            this.lastCountdownTickSec = -1;
            this.sfx?.reset();
            this.levelState.reset({
                durationSec: this.currentLevelOptions.durationSec,
                initialFreeRings: 0,
            });
            if (this.currentLevelOptions.autoStart !== false) {
                this.levelState.start();
            }
            this.syncRuntimeWithLevelState();
        };
        tankRoot.addComponent(PhysicsDebugDraw);
        tankRoot.addComponent(HotZoneDebugDraw);

        this.stepper = stepper;
        this.bubbles = bubbles;
        this.ringLayer = ringLayer;
        this.waterForce = waterForce;
        this.scoreJudge = scoreJudge;
        this.pillarEnergy = pillarEnergy;
        this.funnel = funnel;
        this.tidePullSkill = tidePullSkill;
        this.calmSeaSkill = calmSeaSkill;
        this.tappable = tappable;
        this.glassTap = glassTap;
        this.ringSpawner = ringSpawner;

        stepper.onAfterStep(this.onAfterPhysicsStep);
        this.unsubCollision = stepper.world.onCollision((event) => {
            if (!this.levelState.isPlaying) {
                return;
            }
            if (event.kind === 'pillar') {
                sfx.playCollision('pillar_rim', event.normalImpulse);
            } else {
                sfx.playCollision('ring_hit', event.normalImpulse);
            }
        });
        this.unsubLockSfx = scoreJudge.onRingLocked(() => {
            sfx.play('ring_lock');
        });
        this.unsubMatchSfx = scoreJudge.onMatchCleared((event) => {
            sfx.play('match_clear', event.matchCount >= 3 ? 1 : 0.88);
        });
        this.unsubSkillSfx = pillarEnergy.onSkillTrigger((event) => {
            sfx.play('energy_full');
            sfx.play(event.side === 'left' ? 'skill_tide' : 'skill_calm');
        });
        this.unsubLevelStatus = this.levelState.onStatusChange((next) => {
            this.syncRuntimeWithLevelState();
            if (next === 'won') {
                this.sfx?.stopJetLoop();
                this.sfx?.play('level_win');
            } else if (next === 'lost') {
                this.sfx?.stopJetLoop();
                this.sfx?.play('level_lose');
            } else if (next === 'ready') {
                this.lastCountdownTickSec = -1;
                this.sfx?.stopJetLoop();
            }
        });

        // 体感参数修改后（T010 / T011）实时同步水流、气囊、3D 圈物理属性、双柱、已锁圈与海眼位置
        this.unsubFeel = onFeelApplied(() => {
            waterForce.applyConfig();
            ringLayer.applyConfigToAll();
            leftPillar.applyLayout(false);
            rightPillar.applyLayout(true);
            scoreJudge.syncLockedRings();
            tank.redraw();
        });

        // 3. 外壳绘制在最上层（Camera 3），内屏位置挖空；左右喷射键、HUD 与调参面板挂在外壳之上
        ShellView.create(machine);
        const [leftJetBtn, rightJetBtn] = JetButton.createPair(machine, leftBladder, rightBladder, {
            onPress: (_side, bladder) => {
                if (!this.levelState.isPlaying || !bladder || bladder.output <= 0) {
                    return;
                }
                sfx.play('jet_tap', 0.65 + 0.35 * bladder.output);
            },
            onRelease: (_side, bladder, fromSystem) => {
                if (fromSystem || !this.levelState.isPlaying || !bladder) {
                    return;
                }
                const depletion = 1 - bladder.reserve;
                if (depletion >= GameConst.sfxReboundMinDepletion) {
                    sfx.play('bladder_rebound', 0.45 + 0.55 * Math.min(1, depletion));
                }
            },
        });
        this.leftJetBtn = leftJetBtn;
        this.rightJetBtn = rightJetBtn;

        this.hud = Hud.create(machine, {
            levelState: this.levelState,
            levelTitle: this.currentLevelOptions.title,
            onPauseToggle: () => {
                this.levelState.togglePause();
            },
            onResume: () => {
                this.levelState.resume();
            },
            onRestart: () => {
                this.restartCurrentLevel();
            },
        });

        // 通过 LevelLoader 读取关卡 JSON（默认 X01，支持 ?level=X02），加载前暂停物理步与输入
        const levelLoader = LevelLoader.attach(this.node, this);
        this.levelLoader = levelLoader;

        if (GameConst.DEBUG) {
            const tuningPanel = TuningPanel.create(machine);
            this.tuningPanel = tuningPanel;
            const levelEditor = LevelEditor.create(machine, {
                ringLayer,
                scoreJudge,
                levelLoader,
                host: {
                    onEditorEnter: () => this.enterLevelEditorMode(),
                    onEditorExit: (info) => this.exitLevelEditorMode(info),
                    onEditorDurationChanged: (sec) => this.onEditorDurationChanged(sec),
                },
            });
            this.levelEditor = levelEditor;
            tuningPanel.bindEditorToggle(
                () => levelEditor.toggle(),
                () => levelEditor.isOpen,
            );
        }

        this.syncRuntimeWithLevelState();
        levelLoader.loadFromQueryOrDefault();

        this.fitMachine();
        view.on('canvas-resize', this.fitMachine, this);
        screen.on('window-resize', this.fitMachine, this);
        this.node.on(Node.EventType.SIZE_CHANGED, this.fitMachine, this);
    }

    start(): void {
        this.fitMachine();
    }

    update(): void {
        if (!this.sfx) {
            return;
        }
        if (this.levelState.isPlaying && !this.editorActive) {
            const leftOut = this.leftBladder?.output ?? 0;
            const rightOut = this.rightBladder?.output ?? 0;
            const maxOut = leftOut > rightOut ? leftOut : rightOut;
            this.sfx.setJetLoopState(maxOut > GameConst.sfxJetLoopOutflowThreshold, maxOut);
        } else {
            this.sfx.stopJetLoop();
        }
    }

    onDestroy(): void {
        this.stepper?.offAfterStep(this.onAfterPhysicsStep);
        this.unsubCollision?.();
        this.unsubCollision = null;
        this.unsubLockSfx?.();
        this.unsubLockSfx = null;
        this.unsubMatchSfx?.();
        this.unsubMatchSfx = null;
        this.unsubSkillSfx?.();
        this.unsubSkillSfx = null;
        this.unsubLevelStatus?.();
        this.unsubLevelStatus = null;
        this.unsubFeel?.();
        this.unsubFeel = null;
        view.off('canvas-resize', this.fitMachine, this);
        screen.off('window-resize', this.fitMachine, this);
        this.node.off(Node.EventType.SIZE_CHANGED, this.fitMachine, this);
    }

    /** 装载或重置一关（统一重置物理步、双柱槽位、水缸圈、漏斗、流场、气泡与关卡倒计时，供 T016 LevelLoader 复用） */
    loadLevelSession(options?: LevelBootSessionOptions): void {
        const merged: LevelBootSessionOptions = {
            ...this.currentLevelOptions,
            ...options,
        };
        this.currentLevelOptions = merged;

        const seed = merged.seed ?? GameConst.defaultLevelSeed;
        const durationSec = merged.durationSec ?? GameConst.defaultLevelDurationSec;

        if (this.stepper) {
            this.stepper.running = false;
            this.stepper.resetElapsed();
        }
        this.lastCountdownTickSec = -1;
        this.sfx?.reset();
        this.glassTap?.clearRipples();
        this.scoreJudge?.reset();
        this.tidePullSkill?.reset();
        this.calmSeaSkill?.reset();
        this.pillarEnergy?.reset(merged.pillarEnergy);
        this.funnel?.reset();
        this.ringLayer?.clearAll();
        this.ringLayer?.resetSpawnRng(seed);
        this.waterForce?.reset(seed);
        this.bubbles?.reset(seed);

        if (this.ringLayer && merged.spawnRings) {
            merged.spawnRings(this.ringLayer);
        }

        const initialFreeRings = this.ringLayer ? this.countFreeRings() : 0;
        this.levelState.reset({ durationSec, initialFreeRings });
        if (merged.title !== undefined) {
            this.hud?.setLevelTitle(merged.title);
        }
        if (merged.autoStart !== false) {
            this.levelState.start();
        }
        this.syncRuntimeWithLevelState();
    }

    /** 重开当前关卡 */
    restartCurrentLevel(): void {
        this.loadLevelSession(this.currentLevelOptions);
    }

    private countFreeRings(): number {
        if (!this.ringLayer) {
            return 0;
        }
        const rings = this.ringLayer.getRings();
        let count = 0;
        for (let i = 0; i < rings.length; i++) {
            const r = rings[i];
            if (r.isValid && !r.locked && !r.clearing) {
                count++;
            }
        }
        return count;
    }

    private syncRuntimeWithLevelState(): void {
        const running = this.levelState.shouldRunPhysics && !this.editorActive;
        if (this.stepper) {
            this.stepper.running = running;
        }
        if (!running) {
            this.sfx?.stopJetLoop();
        }
        this.leftJetBtn?.setInputEnabled(running);
        this.rightJetBtn?.setInputEnabled(running);
        this.glassTap?.setInputEnabled(running);
        this.hud?.syncFromState(true);
    }

    private enterLevelEditorMode(): void {
        this.editorActive = true;
        this.tuningPanel?.setPanelOpen(false);
        this.scoreJudge?.finishClearingImmediately();
        this.hud?.setSuppressedByEditor(true);
        this.ringSpawner?.setInputEnabled(false);
        this.syncRuntimeWithLevelState();
        this.tuningPanel?.syncEditorToggleVisual();
    }

    private onEditorDurationChanged(durationSec: number): void {
        this.currentLevelOptions.durationSec = durationSec;
        const freeRings = this.countFreeRings();
        this.levelState.reset({ durationSec, initialFreeRings: freeRings });
        this.hud?.syncFromState(true);
    }

    private exitLevelEditorMode(info: LevelEditorExitInfo): void {
        this.editorActive = false;
        this.hud?.setSuppressedByEditor(false);
        this.ringSpawner?.setInputEnabled(true);
        this.tuningPanel?.syncEditorToggleVisual();

        if (info.edited) {
            this.currentLevelOptions.durationSec = info.durationSec;
            this.tidePullSkill?.reset();
            this.calmSeaSkill?.reset();
            this.funnel?.reset();
            this.pillarEnergy?.reset(this.currentLevelOptions.pillarEnergy);
            this.lastCountdownTickSec = -1;
            const totalRings = this.ringLayer ? this.ringLayer.getRings().length : info.freeRingCount;
            this.levelState.reset({ durationSec: info.durationSec, initialFreeRings: info.freeRingCount });
            if (totalRings > 0) {
                this.levelState.start();
            }
        }

        this.syncRuntimeWithLevelState();
    }

    private onAfterPhysicsStep = (dt: number): void => {
        if (!this.ringLayer) {
            return;
        }
        const rings = this.ringLayer.getRings();
        let freeRings = 0;
        let clearingRings = 0;
        let totalRings = 0;
        for (let i = 0; i < rings.length; i++) {
            const r = rings[i];
            if (!r.isValid) {
                continue;
            }
            totalRings++;
            if (r.clearing) {
                clearingRings++;
            } else if (!r.locked) {
                freeRings++;
            }
        }
        this.levelState.step(dt, { freeRings, clearingRings, totalRings });

        if (this.levelState.isPlaying && this.sfx) {
            const rem = this.levelState.remainingSec;
            const sec = rem > 0 ? Math.ceil(rem) : 0;
            if (sec >= 1 && sec <= GameConst.countdownUrgentSec) {
                if (sec !== this.lastCountdownTickSec) {
                    this.lastCountdownTickSec = sec;
                    this.sfx.play('countdown_tick');
                }
            } else if (sec > GameConst.countdownUrgentSec) {
                this.lastCountdownTickSec = -1;
            }
        }
    };

    /** 创建内屏水缸根节点，原点位于内屏左下角。 */
    private createTankRoot(machine: Node): Node {
        const inner = LayoutConfig.innerScreen;
        const tankRoot = new Node('TankRoot');
        tankRoot.layer = RenderLayers.BG_2D;

        const transform = tankRoot.addComponent(UITransform);
        transform.setContentSize(inner.width, inner.height);
        transform.setAnchorPoint(0, 0);
        tankRoot.setPosition(
            inner.x - LayoutConfig.designWidth / 2,
            inner.y - LayoutConfig.designHeight / 2,
            0,
        );

        machine.addChild(tankRoot);
        return tankRoot;
    }

    /** 按可视区域等比缩放整机并居中，同时同步 3D 圈柱相机对齐。 */
    private fitMachine = (): void => {
        if (!this.machineNode) {
            return;
        }
        const visible = view.getVisibleSize();
        const scale = calcMachineScale(visible.width, visible.height);
        this.machineNode.setScale(scale, scale, 1);
        this.machineNode.setPosition(0, 0, 0);
        this.stageRig?.syncCameras();
    };
}
