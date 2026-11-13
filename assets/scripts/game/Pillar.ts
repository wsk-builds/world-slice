import { _decorator, Color, Component, MeshRenderer, Node, UITransform } from 'cc';
import { FeelConfig } from '../config/FeelConfig';
import { calcRingPillarGeometry, GameConst, RingPillarGeometry } from '../config/GameConst';
import { Palette } from '../config/Palette';
import { TankSpace } from '../config/TankSpace';
import { PillarCollider3D } from '../core/physics3d/PillarCollider3D';
import {
    bindRendererMaterial,
    createDynamicShadedMaterial,
    createPillarCrossGuardMesh,
    createPillarSpindleMesh,
    DynamicShadedMaterialHandle,
    getOrCreatePillarEnergyTickMaterials,
    getOrCreatePillarMaterials,
    getOrCreatePillarOrbMesh,
    getOrCreatePillarTickMesh,
} from '../render/MeshFactory3D';
import { RenderLayers, Stage3DRig } from '../render/Stage3DRig';
import { PhysicsStepper } from './PhysicsStepper';

const { ccclass } = _decorator;

export type PillarSide = 'left' | 'right';

const TICK_STATE_DISABLED = 0;
const TICK_STATE_OFF = 1;
const TICK_STATE_LIT = 2;
const TICK_STATE_SKILL = 3;

/**
 * 三段式锥形十字玉柱（复刻参考视频造型：上尖下粗圆锥杆 + 十字四翼卡托 + 下端悬空收尖尾椎）。
 * 2D 节点保留在 TankRoot 下提供缸坐标引用，3D 网格挂在 Stage3DRig.tank3DRoot 下参与深度缓冲与光照渲染，
 * 物理碰撞由 PillarCollider3D 注册进 TorusWorld3D。
 * 十字四翼卡托上的发光能量刻度与柱尖灵珠均挂在柱子 3D 节点上，调参拖动柱位时同步移动且不被叠圈遮挡。
 */
@ccclass('Pillar')
export class Pillar extends Component {
    side: PillarSide = 'left';
    collider3D!: PillarCollider3D;

    private geom: RingPillarGeometry = calcRingPillarGeometry(TankSpace.width);
    private stepper: PhysicsStepper | null = null;
    private view3DRoot: Node | null = null;
    private spindleRenderer: MeshRenderer | null = null;
    private crossRenderer: MeshRenderer | null = null;
    private tickRenderers: MeshRenderer[] = [];
    private tickStates: number[] = [];
    private orbNode: Node | null = null;
    private orbMatHandle: DynamicShadedMaterialHandle | null = null;
    private readonly unbindMats: Array<() => void> = [];

    private energyEnabled = true;
    private energyRatio = 0;
    private energyLitTicks = 0;
    private energySkillActive = false;
    private orbFlashRemaining = 0;
    private orbAnimTime = 0;
    private readonly orbColorScratch = new Color();

    static createPair(tankRoot: Node, tank3DRoot: Node): [Pillar, Pillar] {
        const layerNode = new Node('Pillars');
        layerNode.layer = RenderLayers.BG_2D;
        const layerTransform = layerNode.addComponent(UITransform);
        layerTransform.setContentSize(TankSpace.width, TankSpace.height);
        layerTransform.setAnchorPoint(0, 0);
        layerNode.setPosition(0, 0, 0);
        tankRoot.addChild(layerNode);

        const stepper = tankRoot.getComponent(PhysicsStepper);

        const left = Pillar.createOne('left', tank3DRoot, stepper);
        const right = Pillar.createOne('right', tank3DRoot, stepper);

        layerNode.addChild(left.node);
        layerNode.addChild(right.node);

        left.applyLayout();
        right.applyLayout();

        return [left, right];
    }

    private static createOne(side: PillarSide, tank3DRoot: Node, stepper: PhysicsStepper | null): Pillar {
        const name = side === 'left' ? 'Pillar_Left' : 'Pillar_Right';
        const node = new Node(name);
        node.layer = RenderLayers.BG_2D;

        const transform = node.addComponent(UITransform);
        transform.setAnchorPoint(0.5, 0);

        const pillar = node.addComponent(Pillar);
        pillar.side = side;
        pillar.stepper = stepper;

        const geom = calcRingPillarGeometry(TankSpace.width);
        const xPct = side === 'left' ? FeelConfig.pillarPosPct : 100 - FeelConfig.pillarPosPct;
        const x = TankSpace.pctToPxX(xPct);
        const y = TankSpace.pctToPxY(FeelConfig.pillarBottomPct);

        pillar.collider3D = new PillarCollider3D(x, y, geom);
        stepper?.world.addPillar(pillar.collider3D);

        pillar.setup3DView(name, tank3DRoot, geom);
        return pillar;
    }

    private setup3DView(name: string, tank3DRoot: Node, geom: RingPillarGeometry): void {
        const root3D = new Node(`${name}_3D`);
        root3D.layer = RenderLayers.RING_PILLAR_3D;
        tank3DRoot.addChild(root3D);
        this.view3DRoot = root3D;

        const spindleNode = new Node('Spindle');
        spindleNode.layer = RenderLayers.RING_PILLAR_3D;
        root3D.addChild(spindleNode);
        const spindleMr = spindleNode.addComponent(MeshRenderer);
        spindleMr.mesh = createPillarSpindleMesh(geom);
        this.unbindMats.push(
            bindRendererMaterial(
                () => getOrCreatePillarMaterials().shaftMat,
                (m) => {
                    if (spindleMr.isValid) spindleMr.material = m;
                },
            ),
        );
        this.spindleRenderer = spindleMr;

        const crossNode = new Node('CrossGuard');
        crossNode.layer = RenderLayers.RING_PILLAR_3D;
        crossNode.setPosition(0, Stage3DRig.pxTo3D(geom.pillarTailHeight + geom.pillarBaseHeight * 0.5), 0);
        root3D.addChild(crossNode);
        const crossMr = crossNode.addComponent(MeshRenderer);
        crossMr.mesh = createPillarCrossGuardMesh(geom);
        this.unbindMats.push(
            bindRendererMaterial(
                () => getOrCreatePillarMaterials().crossMat,
                (m) => {
                    if (crossMr.isValid) crossMr.material = m;
                },
            ),
        );
        this.crossRenderer = crossMr;

        // 十字四翼卡托发光刻度（10 格，每格 10%）：挂在 CrossGuard 下与四翼严格共面跟随
        const ticksRoot = new Node('EnergyTicks');
        ticksRoot.layer = RenderLayers.RING_PILLAR_3D;
        crossNode.addChild(ticksRoot);
        this.tickRenderers = [];
        this.tickStates = [];
        for (let i = 0; i < GameConst.energyTickCount; i++) {
            const tickNode = new Node(`Tick_${i}`);
            tickNode.layer = RenderLayers.RING_PILLAR_3D;
            ticksRoot.addChild(tickNode);
            const tickMr = tickNode.addComponent(MeshRenderer);
            tickMr.mesh = getOrCreatePillarTickMesh(geom, i, GameConst.energyTickCount);
            const idx = i;
            this.tickRenderers.push(tickMr);
            this.tickStates.push(-1);
            this.unbindMats.push(
                bindRendererMaterial(
                    () => this.resolveTickMaterialByIndex(idx),
                    (m) => {
                        if (tickMr.isValid) tickMr.material = m;
                    },
                ),
            );
        }

        // 柱尖 3D 灵珠小球：悬立于柱尖正上方，叠满 6 圈也不被遮挡
        const orbNode = new Node('TipOrb');
        orbNode.layer = RenderLayers.RING_PILLAR_3D;
        orbNode.setPosition(0, this.calcTipOrbLocalY(geom), 0);
        root3D.addChild(orbNode);
        this.orbNode = orbNode;
        const orbMr = orbNode.addComponent(MeshRenderer);
        orbMr.mesh = getOrCreatePillarOrbMesh(GameConst.pillarOrbRadiusPx);
        const orbMatHandle = createDynamicShadedMaterial(Palette.pillarEnergy.orbIdle, 0.72, 26.0, 0.45, 0.72);
        this.orbMatHandle = orbMatHandle;
        this.unbindMats.push(
            bindRendererMaterial(
                () => orbMatHandle.material,
                (m) => {
                    if (orbMr.isValid) orbMr.material = m;
                },
            ),
        );

        this.refreshTickMaterials(true);
        this.refreshOrbVisual();
    }

    private calcTipOrbLocalY(geom: RingPillarGeometry): number {
        return Stage3DRig.pxTo3D(
            geom.pillarTotalHeight + GameConst.pillarOrbTipGapPx + GameConst.pillarOrbRadiusPx,
        );
    }

    /** 按 FeelConfig 与 GameConst 刷新位置、3D 物理碰撞与 3D 模型 */
    applyLayout(forceRebuildMesh = false): void {
        const prev = this.geom;
        const geom = calcRingPillarGeometry(TankSpace.width);
        this.geom = geom;

        const xPct = this.side === 'left' ? FeelConfig.pillarPosPct : 100 - FeelConfig.pillarPosPct;
        const x = TankSpace.pctToPxX(xPct);
        const y = TankSpace.pctToPxY(FeelConfig.pillarBottomPct);
        this.node.setPosition(x, y, 0);

        this.node.getComponent(UITransform)?.setContentSize(geom.pillarBaseWidth, geom.pillarTotalHeight);
        this.collider3D?.updateLayout(x, y, geom);

        if (this.view3DRoot) {
            this.view3DRoot.setPosition(Stage3DRig.pxTo3D(x), Stage3DRig.pxTo3D(y), 0);
            const meshChanged =
                forceRebuildMesh ||
                Math.abs(prev.pillarTotalHeight - geom.pillarTotalHeight) > 0.01 ||
                Math.abs(prev.pillarBaseWidth - geom.pillarBaseWidth) > 0.01 ||
                Math.abs(prev.pillarRootWidth - geom.pillarRootWidth) > 0.01;
            if (meshChanged) {
                if (this.spindleRenderer) {
                    this.spindleRenderer.mesh = createPillarSpindleMesh(geom);
                }
                if (this.crossRenderer) {
                    this.crossRenderer.mesh = createPillarCrossGuardMesh(geom);
                    this.crossRenderer.node.setPosition(
                        0,
                        Stage3DRig.pxTo3D(geom.pillarTailHeight + geom.pillarBaseHeight * 0.5),
                        0,
                    );
                }
                for (let i = 0; i < this.tickRenderers.length; i++) {
                    const mr = this.tickRenderers[i];
                    if (mr && mr.isValid) {
                        mr.mesh = getOrCreatePillarTickMesh(geom, i, GameConst.energyTickCount);
                    }
                }
                if (this.orbNode && this.orbNode.isValid) {
                    this.orbNode.setPosition(0, this.calcTipOrbLocalY(geom), 0);
                }
            }
        }
    }

    /** 同步本柱当前充能状态到十字刻度与柱尖灵珠（T017） */
    setEnergyState(state: {
        enabled: boolean;
        ratio: number;
        litTicks: number;
        skillActive: boolean;
    }): void {
        this.energyEnabled = state.enabled;
        this.energyRatio = Math.min(1, Math.max(0, state.ratio));
        this.energyLitTicks = Math.min(GameConst.energyTickCount, Math.max(0, state.litTicks));
        this.energySkillActive = state.skillActive;
        this.refreshTickMaterials(false);
        this.refreshOrbVisual();
    }

    /** 充满触发技能瞬间的柱尖灵珠闪光表现 */
    triggerSkillFlash(): void {
        this.orbFlashRemaining = GameConst.pillarOrbFlashDurationSec;
        this.refreshOrbVisual();
    }

    /** 重置能量显示状态（切关 / 重开 / R 清空时调用） */
    resetEnergyVisual(enabled = true): void {
        this.orbFlashRemaining = 0;
        this.orbAnimTime = 0;
        this.setEnergyState({
            enabled,
            ratio: 0,
            litTicks: 0,
            skillActive: false,
        });
    }

    update(dt: number): void {
        if (!this.orbNode || !this.orbNode.isValid || !this.energyEnabled) {
            return;
        }
        if (this.stepper && !this.stepper.running) {
            return;
        }
        const safeDt = Math.min(Math.max(0, dt), 0.1);
        this.orbAnimTime += safeDt;
        if (this.orbFlashRemaining > 0) {
            this.orbFlashRemaining = Math.max(0, this.orbFlashRemaining - safeDt);
        }
        this.refreshOrbVisual();
    }

    private resolveTickState(index: number): number {
        if (!this.energyEnabled) {
            return TICK_STATE_DISABLED;
        }
        if (this.energySkillActive) {
            return TICK_STATE_SKILL;
        }
        return index < this.energyLitTicks ? TICK_STATE_LIT : TICK_STATE_OFF;
    }

    private resolveTickMaterialByIndex(index: number) {
        const mats = getOrCreatePillarEnergyTickMaterials();
        const st = this.resolveTickState(index);
        switch (st) {
            case TICK_STATE_DISABLED:
                return mats.disabledMat;
            case TICK_STATE_SKILL:
                return mats.skillMat;
            case TICK_STATE_LIT:
                return mats.litMat;
            case TICK_STATE_OFF:
            default:
                return mats.offMat;
        }
    }

    private refreshTickMaterials(force: boolean): void {
        if (this.tickRenderers.length === 0) {
            return;
        }
        const mats = getOrCreatePillarEnergyTickMaterials();
        for (let i = 0; i < this.tickRenderers.length; i++) {
            const mr = this.tickRenderers[i];
            if (!mr || !mr.isValid) {
                continue;
            }
            const nextState = this.resolveTickState(i);
            if (!force && this.tickStates[i] === nextState) {
                continue;
            }
            this.tickStates[i] = nextState;
            switch (nextState) {
                case TICK_STATE_DISABLED:
                    mr.material = mats.disabledMat;
                    break;
                case TICK_STATE_SKILL:
                    mr.material = mats.skillMat;
                    break;
                case TICK_STATE_LIT:
                    mr.material = mats.litMat;
                    break;
                case TICK_STATE_OFF:
                default:
                    mr.material = mats.offMat;
                    break;
            }
        }
    }

    private refreshOrbVisual(): void {
        if (!this.orbNode || !this.orbNode.isValid || !this.orbMatHandle) {
            return;
        }

        const c = this.orbColorScratch;
        if (!this.energyEnabled) {
            this.orbNode.setScale(0.72, 0.72, 0.72);
            this.orbMatHandle.setVisual(Palette.pillarEnergy.orbDisabled, 0.14, 14.0, 0.1, 0.24);
            return;
        }

        const flashDur = Math.max(0.001, GameConst.pillarOrbFlashDurationSec);
        const flashT = this.orbFlashRemaining > 0 ? Math.min(1, this.orbFlashRemaining / flashDur) : 0;

        if (this.energySkillActive || flashT > 0) {
            const pulse = 0.5 + 0.5 * Math.sin(this.orbAnimTime * 11.0);
            const scale = (this.energySkillActive ? 1.15 + 0.14 * pulse : 1.0) + 0.42 * flashT;
            this.orbNode.setScale(scale, scale, scale);
            Color.lerp(c, Palette.pillarEnergy.orbSkill, Palette.pillarEnergy.orbFlash, Math.max(pulse * 0.45, flashT));
            this.orbMatHandle.setVisual(
                c,
                0.85 + 0.15 * flashT,
                22.0,
                0.48 + 0.16 * flashT,
                0.92 + 0.08 * flashT,
            );
            return;
        }

        const ratio = this.energyRatio;
        const breathFreq = 2.4 + ratio * 4.6;
        const pulse = 0.5 + 0.5 * Math.sin(this.orbAnimTime * breathFreq);
        const scale = 0.94 + (0.04 + ratio * 0.15) * pulse;
        this.orbNode.setScale(scale, scale, scale);

        Color.lerp(c, Palette.pillarEnergy.orbIdle, Palette.pillarEnergy.orbCharged, ratio);
        const peakBlend = (0.08 + ratio * 0.38) * pulse;
        Color.lerp(c, c, Palette.pillarEnergy.orbFlash, peakBlend);

        this.orbMatHandle.setVisual(
            c,
            0.55 + ratio * 0.3,
            24.0,
            0.3 + ratio * 0.25,
            0.56 + ratio * 0.36 + peakBlend * 0.1,
        );
    }

    onDestroy(): void {
        for (let i = 0; i < this.unbindMats.length; i++) {
            this.unbindMats[i]();
        }
        this.unbindMats.length = 0;
        this.orbMatHandle?.dispose();
        this.orbMatHandle = null;
        if (this.view3DRoot && this.view3DRoot.isValid) {
            this.view3DRoot.destroy();
            this.view3DRoot = null;
        }
    }

    /** 柱尖在缸坐标系下的 Y 坐标 */
    get tipY(): number {
        return this.collider3D ? this.collider3D.tipY : this.node.position.y + this.geom.pillarTotalHeight;
    }

    /** 十字卡托顶面（叠圈起始面）在缸坐标系下的 Y 坐标 */
    get baseTopY(): number {
        return this.collider3D
            ? this.collider3D.baseTopY
            : this.node.position.y + this.geom.pillarTailHeight + this.geom.pillarBaseHeight;
    }

    /** 锥形柱杆在指定缸高 y 处的半径（像素） */
    shaftRadiusAtY(y: number): number {
        return this.collider3D ? this.collider3D.shaftRadiusAtY(y) : this.geom.pillarWidth * 0.5;
    }

    /** 柱杆平均宽度 */
    get rodWidth(): number {
        return this.geom.pillarWidth;
    }

    /** 上段套圈柱杆高度 */
    get rodHeight(): number {
        return this.geom.pillarHeight;
    }

    /** 十字四翼卡托横向总宽 */
    get baseWidth(): number {
        return this.geom.pillarBaseWidth;
    }
}
