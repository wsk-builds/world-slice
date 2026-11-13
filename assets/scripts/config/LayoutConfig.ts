/** 布局矩形区域，原点在设计分辨率左下角（x 向右，y 向上）。 */
export interface LayoutRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** 计算矩形中心点坐标。 */
export function rectCenter(rect: LayoutRect): { x: number; y: number } {
    return {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
    };
}

const DESIGN_WIDTH = 1624;
const DESIGN_HEIGHT = 750;

const INNER_WIDTH = 940;
const INNER_HEIGHT = 575;
const INNER_X = (DESIGN_WIDTH - INNER_WIDTH) / 2; // 342
const CHIN_HEIGHT = 85;
const CHIN_Y = 18;
const INNER_Y = CHIN_Y + CHIN_HEIGHT; // 103

const GRIP_WIDTH = INNER_X; // 342
const RIGHT_GRIP_X = INNER_X + INNER_WIDTH; // 1282

const JET_SIZE = 220;
const JET_Y = 100;
const LEFT_JET_X = (GRIP_WIDTH - JET_SIZE) / 2; // 61
const RIGHT_JET_X = RIGHT_GRIP_X + (GRIP_WIDTH - JET_SIZE) / 2; // 1343

const ITEM_SIZE = 100;
const ITEM_GAP = 20;
const ITEM_Y = 370;

const COUNTDOWN_WIDTH = 180;
const COUNTDOWN_HEIGHT = 56;
const COUNTDOWN_X = (DESIGN_WIDTH - COUNTDOWN_WIDTH) / 2; // 722
const COUNTDOWN_Y = 686;

const MIASMA_WIDTH = 300;
const MIASMA_HEIGHT = 24;

/**
 * 整机灰盒与正式版基准布局常量（1624 × 750）。
 * 坐标系原点位于机身左下角，x 向右，y 向上。
 */
export const LayoutConfig = {
    designWidth: DESIGN_WIDTH,
    designHeight: DESIGN_HEIGHT,

    /** 内屏（水缸可视窗口）：940 × 575，水平居中 */
    innerScreen: {
        x: INNER_X,
        y: INNER_Y,
        width: INNER_WIDTH,
        height: INNER_HEIGHT,
    } as LayoutRect,

    /** 下巴铭牌区：940 × 85，紧贴内屏正下方 */
    chin: {
        x: INNER_X,
        y: CHIN_Y,
        width: INNER_WIDTH,
        height: CHIN_HEIGHT,
    } as LayoutRect,

    /** 左握把区域 */
    leftGrip: {
        x: 0,
        y: 0,
        width: GRIP_WIDTH,
        height: DESIGN_HEIGHT,
    } as LayoutRect,

    /** 右握把区域 */
    rightGrip: {
        x: RIGHT_GRIP_X,
        y: 0,
        width: GRIP_WIDTH,
        height: DESIGN_HEIGHT,
    } as LayoutRect,

    /** 左喷射键：220 × 220 */
    leftJetBtn: {
        x: LEFT_JET_X,
        y: JET_Y,
        width: JET_SIZE,
        height: JET_SIZE,
    } as LayoutRect,

    /** 右喷射键：220 × 220 */
    rightJetBtn: {
        x: RIGHT_JET_X,
        y: JET_Y,
        width: JET_SIZE,
        height: JET_SIZE,
    } as LayoutRect,

    /** 四个道具键：各 100 × 100，位于左右喷射键上方 */
    itemBtns: {
        /** 左一：玉水漏 */
        waterHourglass: {
            x: LEFT_JET_X,
            y: ITEM_Y,
            width: ITEM_SIZE,
            height: ITEM_SIZE,
        } as LayoutRect,
        /** 左二：牵引 */
        traction: {
            x: LEFT_JET_X + ITEM_SIZE + ITEM_GAP,
            y: ITEM_Y,
            width: ITEM_SIZE,
            height: ITEM_SIZE,
        } as LayoutRect,
        /** 右一：点化 */
        enlighten: {
            x: RIGHT_JET_X,
            y: ITEM_Y,
            width: ITEM_SIZE,
            height: ITEM_SIZE,
        } as LayoutRect,
        /** 右二：齐鸣 */
        resonance: {
            x: RIGHT_JET_X + ITEM_SIZE + ITEM_GAP,
            y: ITEM_Y,
            width: ITEM_SIZE,
            height: ITEM_SIZE,
        } as LayoutRect,
    },

    /** 倒计时底板：180 × 56，内屏上沿正中 */
    countdown: {
        x: COUNTDOWN_X,
        y: COUNTDOWN_Y,
        width: COUNTDOWN_WIDTH,
        height: COUNTDOWN_HEIGHT,
    } as LayoutRect,

    /** 首领战浊气条：300 × 24，倒计时右侧 */
    miasmaBar: {
        x: COUNTDOWN_X + COUNTDOWN_WIDTH + 30,
        y: COUNTDOWN_Y + (COUNTDOWN_HEIGHT - MIASMA_HEIGHT) / 2,
        width: MIASMA_WIDTH,
        height: MIASMA_HEIGHT,
    } as LayoutRect,

    /** 暂停键：左上角 */
    pauseBtn: {
        x: 32,
        y: 658,
        width: 64,
        height: 64,
    } as LayoutRect,

    /** 关卡号：左上角暂停键右侧 */
    levelLabel: {
        x: 112,
        y: 666,
        width: 196,
        height: 48,
    } as LayoutRect,

    /** 右上角平台胶囊按钮留空区 */
    capsuleSafeArea: {
        x: 1368,
        y: 650,
        width: 228,
        height: 76,
    } as LayoutRect,
} as const;

/** 计算整机根节点在给定可视尺寸下的等比缩放值（不裁剪外壳）。 */
export function calcMachineScale(visibleWidth: number, visibleHeight: number): number {
    if (visibleWidth <= 0 || visibleHeight <= 0) {
        return 1;
    }
    return Math.min(visibleWidth / DESIGN_WIDTH, visibleHeight / DESIGN_HEIGHT);
}
