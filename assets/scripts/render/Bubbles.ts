import { _decorator, Color, Component, Graphics, Layers, Node, UITransform } from 'cc';
import { Palette } from '../config/Palette';
import { TankSpace } from '../config/TankSpace';
import { FlowField } from '../core/flow/FlowField';
import { PhysicsStepper } from '../game/PhysicsStepper';
import { BubbleItem, BubblePool, MAX_BUBBLES } from './BubblePool';

const { ccclass } = _decorator;

/** 将气泡按透明度分 3 档合批填充，控制 draw/fill 调用数，保证 60 FPS */
const ALPHA_BANDS = [0.28, 0.58, 0.88] as const;

const tempFillColor = new Color();
const tempHighlightColor = new Color();

/**
 * 水流气泡表现组件（T009），挂在 TankRoot 下，原点位于缸坐标 (0, 0)。
 * 整个气泡池共用节点上唯一一个 Graphics 组件；每帧直接从同一个 FlowField 采样漂移。
 */
@ccclass('Bubbles')
export class Bubbles extends Component {
    flowField!: FlowField;

    private gfx!: Graphics;
    private stepper: PhysicsStepper | null = null;
    private pool!: BubblePool;
    private readonly bandBuckets: BubbleItem[][] = [[], [], []];
    private readonly highlightBucket: BubbleItem[] = [];

    static create(tankRoot: Node, flowField: FlowField): Bubbles {
        const node = new Node('Bubbles');
        node.layer = Layers.Enum.UI_2D;

        const transform = node.addComponent(UITransform);
        transform.setContentSize(TankSpace.width, TankSpace.height);
        transform.setAnchorPoint(0, 0);
        node.setPosition(0, 0, 0);

        const bubbles = node.addComponent(Bubbles);
        bubbles.flowField = flowField;
        tankRoot.addChild(node);
        return bubbles;
    }

    onLoad(): void {
        if (!this.flowField) {
            this.flowField = new FlowField();
        }
        this.gfx = this.getComponent(Graphics) ?? this.addComponent(Graphics);
        this.stepper = this.node.parent?.getComponent(PhysicsStepper) ?? null;
        this.pool = new BubblePool(this.flowField, { maxCount: MAX_BUBBLES });
    }

    onEnable(): void {
        if (!this.stepper) {
            this.stepper = this.node.parent?.getComponent(PhysicsStepper) ?? null;
        }
    }

    /** 当前活跃气泡数量（供调试或验收观察） */
    get activeCount(): number {
        return this.pool ? this.pool.activeCount : 0;
    }

    /** 重置气泡池（切关或重开时使用） */
    reset(seed?: number): void {
        this.pool?.reset(seed);
    }

    update(dt: number): void {
        if (!this.pool || (this.stepper && !this.stepper.running)) {
            return;
        }
        this.pool.step(Math.min(dt, 0.05));
    }

    lateUpdate(): void {
        if (!this.gfx || !this.pool) {
            return;
        }
        this.drawAll();
    }

    private drawAll(): void {
        const gfx = this.gfx;
        gfx.clear();

        if (this.pool.activeCount === 0) {
            return;
        }

        const buckets = this.bandBuckets;
        buckets[0].length = 0;
        buckets[1].length = 0;
        buckets[2].length = 0;
        this.highlightBucket.length = 0;

        const items = this.pool.items;
        for (let i = 0; i < items.length; i++) {
            const b = items[i];
            if (!b.active || b.alpha <= 0.02) {
                continue;
            }
            const bandIdx = b.alpha < 0.36 ? 0 : b.alpha < 0.68 ? 1 : 2;
            buckets[bandIdx].push(b);

            if (b.radius >= 3.2 && b.alpha >= 0.32) {
                this.highlightBucket.push(b);
            }
        }

        const baseFill = Palette.bubbleFill;
        for (let band = 0; band < ALPHA_BANDS.length; band++) {
            const list = buckets[band];
            if (list.length === 0) {
                continue;
            }
            tempFillColor.set(baseFill);
            tempFillColor.a = Math.round(baseFill.a * ALPHA_BANDS[band]);
            gfx.fillColor = tempFillColor;

            for (let i = 0; i < list.length; i++) {
                const b = list[i];
                gfx.circle(b.x, b.y, b.radius);
            }
            gfx.fill();
        }

        if (this.highlightBucket.length > 0) {
            tempHighlightColor.set(Palette.bubbleHighlight);
            gfx.fillColor = tempHighlightColor;
            for (let i = 0; i < this.highlightBucket.length; i++) {
                const b = this.highlightBucket[i];
                const offset = b.radius * 0.34;
                gfx.circle(b.x - offset, b.y + offset, Math.max(0.8, b.radius * 0.24));
            }
            gfx.fill();
        }
    }
}
