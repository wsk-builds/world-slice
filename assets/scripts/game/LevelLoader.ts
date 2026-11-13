import { _decorator, Component, JsonAsset, Node, resources } from 'cc';
import { FeelConfig } from '../config/FeelConfig';
import { GameConst } from '../config/GameConst';
import { LevelData, parseLevelIdFromSearch, resolvePillarEnergyEnabled } from '../core/level/LevelData';
import { resolveLevelRingLayout } from '../core/level/LevelRingLayout';
import { validateLevel } from '../core/level/validateLevel';
import { RingLayer } from './RingLayer';

const { ccclass } = _decorator;

export interface LevelSessionBootOptions {
    levelId?: string;
    durationSec?: number;
    seed?: number;
    title?: string;
    pillarEnergy?: { left: boolean; right: boolean };
    spawnRings?: (ringLayer: RingLayer) => void;
    autoStart?: boolean;
}

export interface LevelSessionHost {
    loadLevelSession(options?: LevelSessionBootOptions): void;
}

/** 安全读取浏览器地址栏查询串（兼容微信/抖音小游戏无 window.location 环境） */
function getSafeLocationSearch(): string {
    try {
        if (typeof window !== 'undefined' && window.location && typeof window.location.search === 'string') {
            return window.location.search;
        }
    } catch {
        // 小游戏或受限环境中无 window.location 时静默降级
    }
    return '';
}

/**
 * 关卡加载与校验组件（T016）：
 * - 从 `assets/resources/levels/` 读取关卡 JSON；
 * - 调用 `validateLevel` 做规则与坐标校验；
 * - 通过 `resolveLevelRingLayout` 按关卡 `seed` 确定性摆出全部初始 3D 圈并转交 `Boot.loadLevelSession`；
 * - 支持 URL 参数 `?level=X02` 指定关卡，缺省或异常时安全回退默认关 `X01`。
 */
@ccclass('LevelLoader')
export class LevelLoader extends Component {
    private host: LevelSessionHost | null = null;
    private readonly cache = new Map<string, LevelData>();
    private activeLevel: LevelData | null = null;
    private loadToken = 0;

    static attach(node: Node, host: LevelSessionHost): LevelLoader {
        const loader = node.getComponent(LevelLoader) ?? node.addComponent(LevelLoader);
        loader.host = host;
        return loader;
    }

    get currentLevel(): LevelData | null {
        return this.activeLevel;
    }

    /** 根据当前 URL `?level=...` 解析目标关号（无参数或无 DOM 环境返回默认关 `X01`） */
    resolveTargetLevelId(): string {
        return parseLevelIdFromSearch(getSafeLocationSearch(), GameConst.defaultLevelId);
    }

    /** 按地址栏参数或默认关加载并启动 */
    loadFromQueryOrDefault(onDone?: (level: LevelData | null) => void): void {
        const targetId = this.resolveTargetLevelId();
        this.loadLevel(targetId, onDone);
    }

    /** 从 `resources/levels/<levelId>` 加载、校验并搭出关卡 */
    loadLevel(levelId: string, onDone?: (level: LevelData | null) => void): void {
        const safeId = levelId.trim() || GameConst.defaultLevelId;
        const token = ++this.loadToken;

        const cached = this.cache.get(safeId);
        if (cached) {
            this.applyLevelData(cached);
            onDone?.(cached);
            return;
        }

        resources.load(`levels/${safeId}`, JsonAsset, (err, asset) => {
            if (!this.isValid || token !== this.loadToken) {
                return;
            }
            if (err || !asset || !asset.json) {
                console.warn(`[LevelLoader] 加载关卡 ${safeId} 失败:`, err);
                if (safeId !== GameConst.defaultLevelId) {
                    this.loadLevel(GameConst.defaultLevelId, onDone);
                    return;
                }
                onDone?.(null);
                return;
            }

            const result = validateLevel(asset.json);
            if (!result.valid || !result.level) {
                console.error(`[LevelLoader] 关卡 ${safeId} 校验失败:`, result.errors);
                if (safeId !== GameConst.defaultLevelId) {
                    this.loadLevel(GameConst.defaultLevelId, onDone);
                    return;
                }
                onDone?.(null);
                return;
            }

            this.cache.set(result.level.id, result.level);
            this.cache.set(safeId, result.level);
            this.applyLevelData(result.level);
            onDone?.(result.level);
        });
    }

    /** 使用已校验的 LevelData 立即重建该关（切关与重开共用，按 seed 确定性复现） */
    applyLevelData(level: LevelData): void {
        this.activeLevel = level;
        this.host?.loadLevelSession({
            levelId: level.id,
            durationSec: level.durationSec,
            seed: level.seed,
            title: level.title,
            pillarEnergy: resolvePillarEnergyEnabled(level),
            autoStart: true,
            spawnRings: (ringLayer: RingLayer) => {
                const spawns = resolveLevelRingLayout(level.rings, {
                    seed: level.seed,
                    pillarPosPct: FeelConfig.pillarPosPct,
                    pillarBottomPct: FeelConfig.pillarBottomPct,
                    startPillarDropChance: GameConst.startPillarDropChance,
                    startPillarDropRoll: Math.random(),
                    startPillarSideRoll: Math.random(),
                    startPillarRingRoll: Math.random(),
                });
                for (let i = 0; i < spawns.length; i++) {
                    const item = spawns[i];
                    ringLayer.spawn(item.x, item.y, item.spec, item.rollZDeg, {
                        z: item.z,
                        pitchXDeg: item.pitchXDeg,
                        yawYDeg: item.yawYDeg,
                        rollZDeg: item.rollZDeg,
                    });
                }
            },
        });
    }
}
