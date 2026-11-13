import { LayoutConfig } from './LayoutConfig';

export interface Point2D {
    x: number;
    y: number;
}

/**
 * 缸坐标工具。
 * 原点在内屏左下角，x 向右（0 ~ innerScreen.width），y 向上（0 ~ innerScreen.height）。
 * 百分比按 0 ~ 100 计，例如 (32, 26) 表示宽 32%、高 26%。
 */
export const TankSpace = {
    width: LayoutConfig.innerScreen.width,
    height: LayoutConfig.innerScreen.height,

    /** 百分比 X（0 ~ 100）转缸内像素 X */
    pctToPxX(pctX: number): number {
        return (pctX / 100) * LayoutConfig.innerScreen.width;
    },

    /** 百分比 Y（0 ~ 100）转缸内像素 Y */
    pctToPxY(pctY: number): number {
        return (pctY / 100) * LayoutConfig.innerScreen.height;
    },

    /** 缸内百分比（0 ~ 100）转缸内像素坐标 */
    pctToPx(pctX: number, pctY: number): Point2D {
        return {
            x: (pctX / 100) * LayoutConfig.innerScreen.width,
            y: (pctY / 100) * LayoutConfig.innerScreen.height,
        };
    },

    /** 缸内像素 X 转百分比 X（0 ~ 100） */
    pxToPctX(pxX: number): number {
        return (pxX / LayoutConfig.innerScreen.width) * 100;
    },

    /** 缸内像素 Y 转百分比 Y（0 ~ 100） */
    pxToPctY(pxY: number): number {
        return (pxY / LayoutConfig.innerScreen.height) * 100;
    },

    /** 缸内像素坐标转百分比（0 ~ 100） */
    pxToPct(pxX: number, pxY: number): Point2D {
        return {
            x: (pxX / LayoutConfig.innerScreen.width) * 100,
            y: (pxY / LayoutConfig.innerScreen.height) * 100,
        };
    },

    /** 缸内像素坐标转机器左下角坐标 */
    tankToMachine(tankX: number, tankY: number): Point2D {
        return {
            x: LayoutConfig.innerScreen.x + tankX,
            y: LayoutConfig.innerScreen.y + tankY,
        };
    },

    /** 机器左下角坐标转缸内像素坐标 */
    machineToTank(machineX: number, machineY: number): Point2D {
        return {
            x: machineX - LayoutConfig.innerScreen.x,
            y: machineY - LayoutConfig.innerScreen.y,
        };
    },
} as const;
