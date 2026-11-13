import { Color, EffectAsset, Material, Mesh, primitives, resources, utils, Vec4 } from 'cc';
import { GameConst, RingPillarGeometry } from '../config/GameConst';
import { Palette } from '../config/Palette';
import { RingSpec } from '../core/rings/RingKinds';
import { Stage3DRig } from './Stage3DRig';

interface RingMaterialSpec {
    albedo: Color;
    specStrength: number;
    shininess: number;
    rimStrength: number;
    ambientFloor: number;
}

const torusMeshCache = new Map<string, Mesh>();
const pillarOrbMeshCache = new Map<string, Mesh>();
const pillarTickMeshCache = new Map<string, Mesh>();
const ringMaterialCache = new Map<string, Material>();
let ringFlashMat: Material | null = null;
let pillarShaftMat: Material | null = null;
let pillarCrossMat: Material | null = null;
let tickDisabledMat: Material | null = null;
let tickOffMat: Material | null = null;
let tickLitMat: Material | null = null;
let tickSkillMat: Material | null = null;
let loadedMatcapEffect: EffectAsset | null = null;
let loadingMatcapEffect = false;
let currentObliqueShear = Math.tan((14 * Math.PI) / 180);
let currentObliqueZRef = -0.29;

const scratchMatcapVec4 = new Vec4();
const scratchObliqueVec4 = new Vec4();

const loadedEffectKey = '../resources/effects/matcap';

export interface DynamicShadedMaterialHandle {
    readonly material: Material;
    setVisual(
        color: Color,
        specStrength: number,
        shininess: number,
        rimStrength: number,
        ambientFloor: number,
    ): void;
    dispose(): void;
}

interface InternalDynamicMatEntry {
    material: Material;
    hasMatcapEffect: boolean;
    color: Color;
    specStrength: number;
    shininess: number;
    rimStrength: number;
    ambientFloor: number;
    handle: DynamicShadedMaterialHandle;
}

const dynamicShadedEntries: InternalDynamicMatEntry[] = [];

/** 同步斜轴俯视剪切系数与前缘接地基准到全部 3D 圈柱材质（竖杆 100% 笔直 + 缸底圈贴底零浮空） */
export function ensureObliqueShearSynced(shearY: number, zRef = currentObliqueZRef): void {
    if (Math.abs(currentObliqueShear - shearY) < 1e-5 && Math.abs(currentObliqueZRef - zRef) < 1e-5) {
        return;
    }
    currentObliqueShear = shearY;
    currentObliqueZRef = zRef;
    const v = scratchObliqueVec4.set(shearY, zRef, 0, 0);
    for (const mat of ringMaterialCache.values()) {
        try {
            mat.setProperty('obliqueParams', v);
        } catch {
            // builtin-unlit 兜底阶段无此属性，升级后自动写入
        }
    }
    for (const mat of [
        pillarShaftMat,
        pillarCrossMat,
        ringFlashMat,
        tickDisabledMat,
        tickOffMat,
        tickLitMat,
        tickSkillMat,
    ]) {
        if (mat) {
            try {
                mat.setProperty('obliqueParams', v);
            } catch {
                // ignore
            }
        }
    }
    for (let i = 0; i < dynamicShadedEntries.length; i++) {
        const entry = dynamicShadedEntries[i];
        if (entry.hasMatcapEffect) {
            try {
                entry.material.setProperty('obliqueParams', v);
            } catch {
                // ignore
            }
        }
    }
}

/**
 * 异步预加载并热切换 `resources/effects/matcap` 球面高光着色器（场景零灯光零阴影）。
 * 尚未完成加载的首帧先以内置 `builtin-unlit` 兜底，绝不抛错中断初始化，加载完成后自动替换全部已创建材质！
 */
export function ensureMatcapEffectLoaded(): void {
    const pre =
        EffectAsset.get(loadedEffectKey) ?? EffectAsset.get('effects/matcap') ?? EffectAsset.get('matcap');
    if (pre) {
        loadedMatcapEffect = pre;
        return;
    }
    if (loadingMatcapEffect) {
        return;
    }
    loadingMatcapEffect = true;
    resources.load('effects/matcap', EffectAsset, (err, asset) => {
        loadingMatcapEffect = false;
        if (err || !asset) {
            return;
        }
        loadedMatcapEffect = asset;
        upgradeAllCachedMaterials(asset);
    });
}

function initShadedMaterial(
    mat: Material,
    color: Color,
    specStrength: number,
    shininess: number,
    rimStrength: number,
    ambientFloor: number,
): boolean {
    const eff =
        loadedMatcapEffect ??
        EffectAsset.get(loadedEffectKey) ??
        EffectAsset.get('effects/matcap') ??
        EffectAsset.get('matcap');
    if (eff) {
        mat.initialize({ effectAsset: eff });
        mat.setProperty('mainColor', color);
        mat.setProperty('matcapParams', new Vec4(specStrength, shininess, rimStrength, ambientFloor));
        mat.setProperty('obliqueParams', new Vec4(currentObliqueShear, currentObliqueZRef, 0, 0));
        return true;
    } else {
        mat.initialize({ effectName: 'builtin-unlit' });
        mat.setProperty('mainColor', color);
        ensureMatcapEffectLoaded();
        return false;
    }
}

/** 创建支持零 GC 实时调色与 matcap 热升级的独立材质句柄（供柱尖灵珠呼吸闪烁使用） */
export function createDynamicShadedMaterial(
    initialColor: Color,
    specStrength: number,
    shininess: number,
    rimStrength: number,
    ambientFloor: number,
): DynamicShadedMaterialHandle {
    const mat = new Material();
    const hasMatcapEffect = initShadedMaterial(
        mat,
        initialColor,
        specStrength,
        shininess,
        rimStrength,
        ambientFloor,
    );

    const entry: InternalDynamicMatEntry = {
        material: mat,
        hasMatcapEffect,
        color: initialColor.clone(),
        specStrength,
        shininess,
        rimStrength,
        ambientFloor,
        handle: null as unknown as DynamicShadedMaterialHandle,
    };

    const handle: DynamicShadedMaterialHandle = {
        get material(): Material {
            return entry.material;
        },
        setVisual(
            color: Color,
            nextSpec: number,
            nextShininess: number,
            nextRim: number,
            nextAmbient: number,
        ): void {
            entry.color.set(color);
            entry.specStrength = nextSpec;
            entry.shininess = nextShininess;
            entry.rimStrength = nextRim;
            entry.ambientFloor = nextAmbient;
            entry.material.setProperty('mainColor', entry.color);
            if (entry.hasMatcapEffect) {
                scratchMatcapVec4.set(nextSpec, nextShininess, nextRim, nextAmbient);
                entry.material.setProperty('matcapParams', scratchMatcapVec4);
            }
        },
        dispose(): void {
            const idx = dynamicShadedEntries.indexOf(entry);
            if (idx >= 0) {
                dynamicShadedEntries.splice(idx, 1);
            }
        },
    };

    entry.handle = handle;
    dynamicShadedEntries.push(entry);
    return handle;
}

const boundRenderers: Array<{ getMat: () => Material; setMat: (m: Material) => void }> = [];

export function bindRendererMaterial(
    getMat: () => Material,
    setMat: (m: Material) => void,
): void {
    setMat(getMat());
    boundRenderers.push({ getMat, setMat });
}

function upgradeAllCachedMaterials(eff: EffectAsset): void {
    const obliqueVec = new Vec4(currentObliqueShear, currentObliqueZRef, 0, 0);
    for (const [key] of ringMaterialCache.entries()) {
        const spec = parseRingSpecFromKey(key);
        const cfg = resolveRingMatSpec(spec);
        const fresh = new Material();
        fresh.initialize({ effectAsset: eff });
        fresh.setProperty('mainColor', cfg.albedo);
        fresh.setProperty(
            'matcapParams',
            new Vec4(cfg.specStrength, cfg.shininess, cfg.rimStrength, cfg.ambientFloor),
        );
        fresh.setProperty('obliqueParams', obliqueVec);
        ringMaterialCache.set(key, fresh);
    }
    if (pillarShaftMat) {
        const freshShaft = new Material();
        freshShaft.initialize({ effectAsset: eff });
        freshShaft.setProperty('mainColor', Palette.pillarRodFill);
        freshShaft.setProperty('matcapParams', new Vec4(0.45, 28.0, 0.28, 0.36));
        freshShaft.setProperty('obliqueParams', obliqueVec);
        pillarShaftMat = freshShaft;
    }
    if (pillarCrossMat) {
        const freshCross = new Material();
        freshCross.initialize({ effectAsset: eff });
        freshCross.setProperty('mainColor', Palette.pillarBaseFill);
        freshCross.setProperty('matcapParams', new Vec4(0.4, 22.0, 0.24, 0.32));
        freshCross.setProperty('obliqueParams', obliqueVec);
        pillarCrossMat = freshCross;
    }
    if (ringFlashMat) {
        const freshFlash = new Material();
        freshFlash.initialize({ effectAsset: eff });
        freshFlash.setProperty('mainColor', Palette.ring.goldAccent);
        freshFlash.setProperty('matcapParams', new Vec4(0.9, 16.0, 0.45, 0.92));
        freshFlash.setProperty('obliqueParams', obliqueVec);
        ringFlashMat = freshFlash;
    }
    if (tickDisabledMat) {
        const fresh = new Material();
        fresh.initialize({ effectAsset: eff });
        fresh.setProperty('mainColor', Palette.pillarEnergy.tickDisabled);
        fresh.setProperty('matcapParams', new Vec4(0.12, 12.0, 0.08, 0.22));
        fresh.setProperty('obliqueParams', obliqueVec);
        tickDisabledMat = fresh;
    }
    if (tickOffMat) {
        const fresh = new Material();
        fresh.initialize({ effectAsset: eff });
        fresh.setProperty('mainColor', Palette.pillarEnergy.tickOff);
        fresh.setProperty('matcapParams', new Vec4(0.22, 16.0, 0.14, 0.30));
        fresh.setProperty('obliqueParams', obliqueVec);
        tickOffMat = fresh;
    }
    if (tickLitMat) {
        const fresh = new Material();
        fresh.initialize({ effectAsset: eff });
        fresh.setProperty('mainColor', Palette.pillarEnergy.tickLit);
        fresh.setProperty('matcapParams', new Vec4(0.68, 22.0, 0.44, 0.92));
        fresh.setProperty('obliqueParams', obliqueVec);
        tickLitMat = fresh;
    }
    if (tickSkillMat) {
        const fresh = new Material();
        fresh.initialize({ effectAsset: eff });
        fresh.setProperty('mainColor', Palette.pillarEnergy.tickSkill);
        fresh.setProperty('matcapParams', new Vec4(0.84, 20.0, 0.52, 0.98));
        fresh.setProperty('obliqueParams', obliqueVec);
        tickSkillMat = fresh;
    }
    for (let i = 0; i < dynamicShadedEntries.length; i++) {
        const entry = dynamicShadedEntries[i];
        const fresh = new Material();
        fresh.initialize({ effectAsset: eff });
        fresh.setProperty('mainColor', entry.color);
        fresh.setProperty(
            'matcapParams',
            new Vec4(entry.specStrength, entry.shininess, entry.rimStrength, entry.ambientFloor),
        );
        fresh.setProperty('obliqueParams', obliqueVec);
        entry.material = fresh;
        entry.hasMatcapEffect = true;
    }
    for (let i = boundRenderers.length - 1; i >= 0; i--) {
        try {
            boundRenderers[i].setMat(boundRenderers[i].getMat());
        } catch {
            boundRenderers.splice(i, 1);
        }
    }
}

function parseRingSpecFromKey(key: string): RingSpec {
    if (key.startsWith('normal:')) {
        const c = key.slice('normal:'.length) as RingSpec['color'];
        return { kind: 'normal', color: c };
    }
    return { kind: key as RingSpec['kind'] };
}

/**
 * 构建或复用标准正圆环 3D 网格（Cocos 内置 primitives.torus，中心在原点，孔轴沿本地 +Y）。
 */
export function getOrCreateTorusMesh(majorRadiusPx: number, tubeRadiusPx: number): Mesh {
    const key = `${majorRadiusPx.toFixed(2)}_${tubeRadiusPx.toFixed(2)}`;
    const cached = torusMeshCache.get(key);
    if (cached) {
        return cached;
    }
    const R = Stage3DRig.pxTo3D(majorRadiusPx);
    const r = Stage3DRig.pxTo3D(tubeRadiusPx);
    const geom = primitives.torus(R, r, {
        radialSegments: 22,
        tubularSegments: 40,
    });
    const mesh = utils.MeshUtils.createMesh(geom);
    torusMeshCache.set(key, mesh);
    return mesh;
}

/**
 * 程序生成三段式「上尖下粗圆锥杆（带圆润球顶）+ 下段收尖尾椎」的一体回转体 3D 网格，
 * 原点位于尾尖底部 (0, 0, 0)。
 */
export function createPillarSpindleMesh(geom: RingPillarGeometry): Mesh {
    const ptm = Stage3DRig.pxTo3D(1);
    const tailH = geom.pillarTailHeight * ptm;
    const baseH = geom.pillarBaseHeight * ptm;
    const rodH = geom.pillarHeight * ptm;
    const tipR = geom.pillarTipWidth * 0.5 * ptm;
    const rootR = geom.pillarRootWidth * 0.5 * ptm;

    const crossMidY = tailH + baseH * 0.5;
    const domeBaseY = tailH + baseH + rodH - tipR;

    // 回转轮廓点 (y, radius)：从尾尖平滑过渡到卡托腰部，再往上收细并以半球封顶
    const profile: Array<[number, number]> = [
        [0, 0.015],
        [tailH * 0.25, rootR * 0.34],
        [tailH * 0.7, rootR * 0.68],
        [crossMidY, rootR * 1.04],
        [tailH + baseH, rootR],
        [tailH + baseH + rodH * 0.5, (rootR + tipR) * 0.5],
        [domeBaseY, tipR],
    ];

    const domeSteps = 5;
    for (let s = 1; s <= domeSteps; s++) {
        const phi = (s / domeSteps) * (Math.PI * 0.5);
        const y = domeBaseY + Math.sin(phi) * tipR;
        const r = Math.max(0.002, Math.cos(phi) * tipR);
        profile.push([y, r]);
    }

    return buildLatheMesh(profile, 24);
}

/**
 * 程序生成十字四翼卡托（`+` 字形菱形机翼横挡，中心厚、四端尖，完美复刻参考视频柱托造型）。
 * 中心在局部原点 (0, 0, 0)。
 */
export function createPillarCrossGuardMesh(geom: RingPillarGeometry): Mesh {
    const ptm = Stage3DRig.pxTo3D(1);
    const halfW = geom.pillarBaseWidth * 0.5 * ptm;
    const halfD = geom.pillarCrossDepth * 0.5 * ptm;
    const halfH = geom.pillarBaseHeight * 0.5 * ptm;
    const armHalfThick = geom.pillarRootWidth * 0.58 * ptm;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    appendDiamondWing(positions, normals, uvs, indices, halfW, halfH, armHalfThick, true);
    appendDiamondWing(positions, normals, uvs, indices, halfD, halfH * 0.92, armHalfThick, false);

    return utils.MeshUtils.createMesh({
        positions,
        normals,
        uvs,
        indices,
    });
}

/** 获取对应圈种的零灯光 MatCap 球面高光材质 */
export function getOrCreateRingMaterial(spec: RingSpec): Material {
    const key = spec.kind === 'normal' ? `normal:${spec.color ?? 'red'}` : spec.kind;
    const cached = ringMaterialCache.get(key);
    if (cached) {
        return cached;
    }

    const cfg = resolveRingMatSpec(spec);
    const mat = new Material();
    initShadedMaterial(mat, cfg.albedo, cfg.specStrength, cfg.shininess, cfg.rimStrength, cfg.ambientFloor);
    ringMaterialCache.set(key, mat);
    return mat;
}

/** 获取消除闪烁时共用的高亮材质 */
export function getOrCreateRingFlashMaterial(): Material {
    if (!ringFlashMat) {
        ringFlashMat = new Material();
        initShadedMaterial(ringFlashMat, Palette.ring.goldAccent, 0.9, 16.0, 0.45, 0.92);
    }
    return ringFlashMat;
}

export function getOrCreatePillarMaterials(): { shaftMat: Material; crossMat: Material } {
    if (!pillarShaftMat) {
        pillarShaftMat = new Material();
        initShadedMaterial(pillarShaftMat, Palette.pillarRodFill, 0.38, 24.0, 0.24, 0.38);
    }
    if (!pillarCrossMat) {
        pillarCrossMat = new Material();
        initShadedMaterial(pillarCrossMat, Palette.pillarBaseFill, 0.34, 20.0, 0.22, 0.34);
    }
    return { shaftMat: pillarShaftMat, crossMat: pillarCrossMat };
}

/** 获取十字卡托充能刻度的四档共用材质（暗态 / 未亮 / 已点亮 / 技能金光） */
export function getOrCreatePillarEnergyTickMaterials(): {
    disabledMat: Material;
    offMat: Material;
    litMat: Material;
    skillMat: Material;
} {
    if (!tickDisabledMat) {
        tickDisabledMat = new Material();
        initShadedMaterial(tickDisabledMat, Palette.pillarEnergy.tickDisabled, 0.12, 12.0, 0.08, 0.22);
    }
    if (!tickOffMat) {
        tickOffMat = new Material();
        initShadedMaterial(tickOffMat, Palette.pillarEnergy.tickOff, 0.22, 16.0, 0.14, 0.30);
    }
    if (!tickLitMat) {
        tickLitMat = new Material();
        initShadedMaterial(tickLitMat, Palette.pillarEnergy.tickLit, 0.68, 22.0, 0.44, 0.92);
    }
    if (!tickSkillMat) {
        tickSkillMat = new Material();
        initShadedMaterial(tickSkillMat, Palette.pillarEnergy.tickSkill, 0.84, 20.0, 0.52, 0.98);
    }
    return {
        disabledMat: tickDisabledMat,
        offMat: tickOffMat,
        litMat: tickLitMat,
        skillMat: tickSkillMat,
    };
}

/** 获取或创建柱尖 3D 灵珠球体网格 */
export function getOrCreatePillarOrbMesh(radiusPx: number): Mesh {
    const key = radiusPx.toFixed(2);
    const cached = pillarOrbMeshCache.get(key);
    if (cached) {
        return cached;
    }
    const r = Stage3DRig.pxTo3D(radiusPx);
    const geom = primitives.sphere(r, { segments: 16 });
    const mesh = utils.MeshUtils.createMesh(geom);
    pillarOrbMeshCache.set(key, mesh);
    return mesh;
}

/** 获取或创建十字四翼卡托第 tickIndex 格发光刻度网格（四翼同步嵌环，中心在 CrossGuard 原点） */
export function getOrCreatePillarTickMesh(
    geom: RingPillarGeometry,
    tickIndex: number,
    tickCount: number = GameConst.energyTickCount,
): Mesh {
    const key = `${geom.pillarBaseWidth.toFixed(2)}_${geom.pillarCrossDepth.toFixed(2)}_${geom.pillarBaseHeight.toFixed(2)}_${geom.pillarRootWidth.toFixed(2)}_${tickIndex}_${tickCount}`;
    const cached = pillarTickMeshCache.get(key);
    if (cached) {
        return cached;
    }

    const ptm = Stage3DRig.pxTo3D(1);
    const halfW = geom.pillarBaseWidth * 0.5 * ptm;
    const halfD = geom.pillarCrossDepth * 0.5 * ptm;
    const halfH = geom.pillarBaseHeight * 0.5 * ptm;
    const armHalfThick = geom.pillarRootWidth * 0.58 * ptm;

    const uStart = 0.35;
    const uEnd = 0.91;
    const stepSpan = (uEnd - uStart) / Math.max(1, tickCount);
    const u0 = uStart + tickIndex * stepSpan;
    const u1 = u0 + stepSpan * 0.72;
    const pad = 0.008;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    appendWingTickBand(positions, normals, uvs, indices, halfW, halfH, armHalfThick, u0, u1, pad, 1, 0);
    appendWingTickBand(positions, normals, uvs, indices, halfW, halfH, armHalfThick, u0, u1, pad, -1, 0);
    appendWingTickBand(positions, normals, uvs, indices, halfD, halfH * 0.92, armHalfThick, u0, u1, pad, 0, 1);
    appendWingTickBand(positions, normals, uvs, indices, halfD, halfH * 0.92, armHalfThick, u0, u1, pad, 0, -1);

    const mesh = utils.MeshUtils.createMesh({
        positions,
        normals,
        uvs,
        indices,
    });
    pillarTickMeshCache.set(key, mesh);
    return mesh;
}

function resolveRingMatSpec(spec: RingSpec): RingMaterialSpec {
    switch (spec.kind) {
        case 'gold':
            return {
                albedo: Palette.ring.gold,
                specStrength: 0.72,
                shininess: 38.0,
                rimStrength: 0.35,
                ambientFloor: 0.4,
            };
        case 'iron':
            return {
                albedo: Palette.ring.iron,
                specStrength: 0.58,
                shininess: 34.0,
                rimStrength: 0.28,
                ambientFloor: 0.32,
            };
        case 'wood':
            return {
                albedo: Palette.ring.wood,
                specStrength: 0.16,
                shininess: 12.0,
                rimStrength: 0.18,
                ambientFloor: 0.44,
            };
        case 'normal':
        default: {
            const c = spec.color ?? 'red';
            return {
                albedo: Palette.ring[c],
                specStrength: 0.52,
                shininess: 30.0,
                rimStrength: 0.28,
                ambientFloor: 0.36,
            };
        }
    }
}

function buildLatheMesh(profile: ReadonlyArray<[number, number]>, radialSegments: number): Mesh {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const ringCount = profile.length;
    const slopeNormals: Array<[number, number]> = [];
    for (let j = 0; j < ringCount; j++) {
        const prev = profile[Math.max(0, j - 1)];
        const next = profile[Math.min(ringCount - 1, j + 1)];
        const dy = next[0] - prev[0];
        const dr = next[1] - prev[1];
        const len = Math.hypot(dy, dr) || 1;
        slopeNormals.push([dy / len, -dr / len]);
    }

    for (let j = 0; j < ringCount; j++) {
        const [y, r] = profile[j];
        const [nr, ny] = slopeNormals[j];
        const v = j / Math.max(1, ringCount - 1);

        for (let i = 0; i <= radialSegments; i++) {
            const u = i / radialSegments;
            const theta = u * Math.PI * 2;
            const cosT = Math.cos(theta);
            const sinT = Math.sin(theta);

            positions.push(r * sinT, y, r * cosT);
            normals.push(nr * sinT, ny, nr * cosT);
            uvs.push(u, v);
        }
    }

    const stride = radialSegments + 1;
    for (let j = 0; j < ringCount - 1; j++) {
        for (let i = 0; i < radialSegments; i++) {
            const a = j * stride + i;
            const b = (j + 1) * stride + i;
            const c = (j + 1) * stride + i + 1;
            const d = j * stride + i + 1;
            indices.push(a, d, b);
            indices.push(b, d, c);
        }
    }

    return utils.MeshUtils.createMesh({
        positions,
        normals,
        uvs,
        indices,
    });
}

function appendDiamondWing(
    positions: number[],
    normals: number[],
    uvs: number[],
    indices: number[],
    spanHalf: number,
    heightHalf: number,
    thickHalf: number,
    alongX: boolean,
): void {
    const pTipNeg: [number, number, number] = alongX ? [-spanHalf, 0, 0] : [0, 0, -spanHalf];
    const pTipPos: [number, number, number] = alongX ? [spanHalf, 0, 0] : [0, 0, spanHalf];
    const pTop: [number, number, number] = [0, heightHalf, 0];
    const pBot: [number, number, number] = [0, -heightHalf * 0.85, 0];
    const pSidePos: [number, number, number] = alongX ? [0, 0, thickHalf] : [thickHalf, 0, 0];
    const pSideNeg: [number, number, number] = alongX ? [0, 0, -thickHalf] : [-thickHalf, 0, 0];

    const faces: Array<[[number, number, number], [number, number, number], [number, number, number]]> = alongX
        ? [
              [pTop, pSidePos, pTipPos],
              [pTop, pTipNeg, pSidePos],
              [pTop, pTipPos, pSideNeg],
              [pTop, pSideNeg, pTipNeg],
              [pBot, pTipPos, pSidePos],
              [pBot, pSidePos, pTipNeg],
              [pBot, pSideNeg, pTipPos],
              [pBot, pSideNeg, pTipNeg],
          ]
        : [
              [pTop, pTipPos, pSidePos],
              [pTop, pSidePos, pTipNeg],
              [pTop, pSideNeg, pTipPos],
              [pTop, pSideNeg, pSideNeg],
              [pBot, pSidePos, pTipPos],
              [pBot, pTipNeg, pSidePos],
              [pBot, pTipPos, pSideNeg],
              [pBot, pSideNeg, pTipNeg],
          ];

    for (const [a, b, c] of faces) {
        const abx = b[0] - a[0];
        const aby = b[1] - a[1];
        const abz = b[2] - a[2];
        const acx = c[0] - a[0];
        const acy = c[1] - a[1];
        const acz = c[2] - a[2];
        let nx = aby * acz - abz * acy;
        let ny = abz * acx - abx * acz;
        let nz = abx * acy - aby * acx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;

        const baseIdx = positions.length / 3;
        for (const v of [a, b, c]) {
            positions.push(v[0], v[1], v[2]);
            normals.push(nx, ny, nz);
            uvs.push(0.5, 0.5);
        }
        indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
    }
}

function appendWingTickBand(
    positions: number[],
    normals: number[],
    uvs: number[],
    indices: number[],
    spanHalf: number,
    heightHalf: number,
    thickHalf: number,
    u0: number,
    u1: number,
    pad: number,
    dirX: number,
    dirZ: number,
): void {
    const perpX = dirX === 0 ? 1 : 0;
    const perpZ = dirZ === 0 ? 1 : 0;

    const ringAt = (u: number): [[number, number, number], [number, number, number], [number, number, number], [number, number, number]] => {
        const axial = u * spanHalf;
        const cx = axial * dirX;
        const cz = axial * dirZ;
        const t = Math.max(0.02, 1 - u);
        const topY = heightHalf * t + pad;
        const botY = -(heightHalf * 0.85 * t + pad * 0.75);
        const side = thickHalf * t + pad;
        return [
            [cx, topY, cz],
            [cx + perpX * side, 0, cz + perpZ * side],
            [cx, botY, cz],
            [cx - perpX * side, 0, cz - perpZ * side],
        ];
    };

    const r0 = ringAt(u0);
    const r1 = ringAt(u1);
    const midAxial = 0.5 * (u0 + u1) * spanHalf;
    const center: [number, number, number] = [midAxial * dirX, 0, midAxial * dirZ];

    for (let i = 0; i < 4; i++) {
        const next = (i + 1) % 4;
        pushOrientedTri(positions, normals, uvs, indices, r0[i], r1[i], r1[next], center);
        pushOrientedTri(positions, normals, uvs, indices, r0[i], r1[next], r0[next], center);
    }

    pushOrientedTri(positions, normals, uvs, indices, r0[0], r0[1], r0[2], center);
    pushOrientedTri(positions, normals, uvs, indices, r0[0], r0[2], r0[3], center);
    pushOrientedTri(positions, normals, uvs, indices, r1[0], r1[2], r1[1], center);
    pushOrientedTri(positions, normals, uvs, indices, r1[0], r1[3], r1[2], center);
}

function pushOrientedTri(
    positions: number[],
    normals: number[],
    uvs: number[],
    indices: number[],
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    interiorCenter: [number, number, number],
): void {
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const acx = c[0] - a[0];
    const acy = c[1] - a[1];
    const acz = c[2] - a[2];

    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;

    const midX = (a[0] + b[0] + c[0]) / 3 - interiorCenter[0];
    const midY = (a[1] + b[1] + c[1]) / 3 - interiorCenter[1];
    const midZ = (a[2] + b[2] + c[2]) / 3 - interiorCenter[2];

    let v1 = b;
    let v2 = c;
    if (nx * midX + ny * midY + nz * midZ < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
        v1 = c;
        v2 = b;
    }

    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;

    const baseIdx = positions.length / 3;
    for (const v of [a, v1, v2]) {
        positions.push(v[0], v[1], v[2]);
        normals.push(nx, ny, nz);
        uvs.push(0.5, 0.5);
    }
    indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
}
