import { describe, expect, it } from 'vitest';
import { calcMachineScale, LayoutConfig, LayoutRect } from '../../assets/scripts/config/LayoutConfig';

function isInsideMachine(rect: LayoutRect): boolean {
    return (
        rect.x >= 0 &&
        rect.y >= 0 &&
        rect.x + rect.width <= LayoutConfig.designWidth &&
        rect.y + rect.height <= LayoutConfig.designHeight
    );
}

function overlaps(a: LayoutRect, b: LayoutRect): boolean {
    return !(
        a.x + a.width <= b.x ||
        b.x + b.width <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y
    );
}

describe('LayoutConfig', () => {
    it('内屏与下巴铭牌区尺寸与位置符合设计要求（内屏扩容至 1060×606）', () => {
        const { innerScreen, chin, designWidth } = LayoutConfig;
        expect(innerScreen.width).toBe(1060);
        expect(innerScreen.height).toBe(606);
        expect(innerScreen.x).toBe((designWidth - innerScreen.width) / 2);

        expect(chin.width).toBe(1060);
        expect(chin.height).toBe(66);
        expect(chin.x).toBe(innerScreen.x);
        expect(chin.y + chin.height).toBe(innerScreen.y);
    });

    it('所有按键与分区尺寸正确且全部位于整机范围内', () => {
        const rects: LayoutRect[] = [
            LayoutConfig.innerScreen,
            LayoutConfig.chin,
            LayoutConfig.leftGrip,
            LayoutConfig.rightGrip,
            LayoutConfig.leftJetBtn,
            LayoutConfig.rightJetBtn,
            LayoutConfig.itemBtns.waterHourglass,
            LayoutConfig.itemBtns.traction,
            LayoutConfig.itemBtns.enlighten,
            LayoutConfig.itemBtns.resonance,
            LayoutConfig.countdown,
            LayoutConfig.miasmaBar,
            LayoutConfig.pauseBtn,
            LayoutConfig.levelLabel,
            LayoutConfig.capsuleSafeArea,
        ];

        for (const rect of rects) {
            expect(isInsideMachine(rect)).toBe(true);
        }

        expect(LayoutConfig.leftJetBtn.width).toBe(220);
        expect(LayoutConfig.leftJetBtn.height).toBe(220);
        expect(LayoutConfig.rightJetBtn.width).toBe(220);
        expect(LayoutConfig.rightJetBtn.height).toBe(220);

        for (const item of Object.values(LayoutConfig.itemBtns)) {
            expect(item.width).toBe(100);
            expect(item.height).toBe(100);
        }
    });

    it('各个功能分区互不重叠且道具键在喷射键上方', () => {
        const zones: LayoutRect[] = [
            LayoutConfig.innerScreen,
            LayoutConfig.chin,
            LayoutConfig.leftJetBtn,
            LayoutConfig.rightJetBtn,
            LayoutConfig.itemBtns.waterHourglass,
            LayoutConfig.itemBtns.traction,
            LayoutConfig.itemBtns.enlighten,
            LayoutConfig.itemBtns.resonance,
            LayoutConfig.countdown,
            LayoutConfig.miasmaBar,
            LayoutConfig.pauseBtn,
            LayoutConfig.levelLabel,
            LayoutConfig.capsuleSafeArea,
        ];

        for (let i = 0; i < zones.length; i++) {
            for (let j = i + 1; j < zones.length; j++) {
                expect(overlaps(zones[i], zones[j])).toBe(false);
            }
        }

        expect(LayoutConfig.itemBtns.waterHourglass.y).toBeGreaterThan(
            LayoutConfig.leftJetBtn.y + LayoutConfig.leftJetBtn.height,
        );
        expect(LayoutConfig.itemBtns.enlighten.y).toBeGreaterThan(
            LayoutConfig.rightJetBtn.y + LayoutConfig.rightJetBtn.height,
        );
        expect(LayoutConfig.miasmaBar.x).toBeGreaterThan(
            LayoutConfig.countdown.x + LayoutConfig.countdown.width,
        );
    });

    it('整机缩放按 min(宽/1624, 高/750) 计算，宽屏不放大、窄屏完整缩入', () => {
        expect(calcMachineScale(1624, 750)).toBe(1);
        expect(calcMachineScale(2000, 750)).toBe(1);
        expect(calcMachineScale(1334, 750)).toBeCloseTo(1334 / 1624, 6);
        expect(calcMachineScale(812, 375)).toBeCloseTo(0.5, 6);
    });

    it('HUD 结算弹窗卡片与按钮均严格位于内屏内部，且与调参按钮不重叠', () => {
        const { innerScreen, hudCard, hudActionBtn, pauseBtn, levelLabel, countdown } = LayoutConfig;
        expect(hudCard.x).toBeGreaterThanOrEqual(innerScreen.x);
        expect(hudCard.y).toBeGreaterThanOrEqual(innerScreen.y);
        expect(hudCard.x + hudCard.width).toBeLessThanOrEqual(innerScreen.x + innerScreen.width);
        expect(hudCard.y + hudCard.height).toBeLessThanOrEqual(innerScreen.y + innerScreen.height);

        expect(hudActionBtn.x).toBeGreaterThanOrEqual(hudCard.x);
        expect(hudActionBtn.y).toBeGreaterThanOrEqual(hudCard.y);
        expect(hudActionBtn.x + hudActionBtn.width).toBeLessThanOrEqual(hudCard.x + hudCard.width);
        expect(hudActionBtn.y + hudActionBtn.height).toBeLessThanOrEqual(hudCard.y + hudCard.height);

        // 左上角调参按钮（x:24..136, y:596..644）位于暂停键（y>=662）与关卡号（y>=670）下方，留有间隙
        expect(pauseBtn.y).toBeGreaterThan(644);
        expect(levelLabel.y).toBeGreaterThan(644);
        // 倒计时位于内屏上沿正中
        expect(countdown.y).toBeGreaterThan(innerScreen.y + innerScreen.height);
    });
});
