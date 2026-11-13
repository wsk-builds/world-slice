import { Color } from 'cc';

function hex(value: string, alpha = 1): Color {
    const color = new Color(value);
    color.a = Math.round(alpha * 255);
    return color;
}

/** 灰盒阶段配色表 */
export const Palette = {
    /** 机身外壳底色（窄屏/宽屏四周露出部分也用此色） */
    shellBody: hex('#434C59'),
    /** 机身外框与分区描边 */
    shellBorder: hex('#8FA3B8'),
    /** 内屏水缸底色（深水感，与外壳拉开反差） */
    innerWaterBg: hex('#162430'),
    /** 内屏边框高亮 */
    innerBorder: hex('#64DFDF'),

    /** 握把区边框线 */
    gripOutline: hex('#6C7A89', 0.65),
    /** 下巴铭牌占位区 */
    chinFill: hex('#343C47'),
    chinBorder: hex('#7F8C99'),

    /** 左右喷射键与凹槽阴影 */
    jetBtnShadow: hex('#262E38'),
    jetBtnFill: hex('#D96B52'),
    jetBtnPressedFill: hex('#BE533B'),
    jetBtnBorder: hex('#F4A28C'),
    jetBtnHighlight: hex('#FFFFFF', 0.2),

    /** 四个道具键占位 */
    itemBtnFill: hex('#4A7C78'),
    itemBtnBorder: hex('#84B5B0'),

    /** 顶部倒计时、暂停、关卡号占位 */
    hudFill: hex('#2C3440'),
    hudBorder: hex('#8FA3B8'),

    /** 首领战浊气条占位 */
    miasmaFill: hex('#6E3F53'),
    miasmaBorder: hex('#C77D98'),

    /** 右上角平台胶囊留空区 */
    capsuleFill: hex('#556070', 0.45),
    capsuleBorder: hex('#AEB8C4', 0.8),

    /** 灰盒标注文字颜色 */
    labelPrimary: hex('#EEF2F6'),
    labelMuted: hex('#B8C4D0'),

    /** 水缸内底角垫块、内壁线与灰盒海眼喷口 */
    tankCornerFill: hex('#273645'),
    tankWallBorder: hex('#52798F'),
    nozzleFill: hex('#2E4C63'),
    nozzleBorder: hex('#64DFDF', 0.85),

    /** 灰盒水流气泡颜色（浅青白半透 + 高光） */
    bubbleFill: hex('#D8F6FF', 0.52),
    bubbleHighlight: hex('#FFFFFF', 0.78),

    /** 灰盒悬空柱与底托 */
    pillarRodFill: hex('#DCE4EC'),
    pillarBaseFill: hex('#9FB3C8'),
    pillarBorder: hex('#F4F8FB'),

    /** 灰盒七种锁脉环配色 */
    ring: {
        red: hex('#EE5253'),
        green: hex('#2ED573'),
        blue: hex('#1E90FF'),
        orange: hex('#FFA502'),
        gold: hex('#FFD32A'),
        goldAccent: hex('#FFF3B0'),
        iron: hex('#57606F'),
        ironAccent: hex('#A4B0BE'),
        wood: hex('#B57642'),
        woodAccent: hex('#E2B488'),
        highlight: hex('#FFFFFF', 0.42),
    },

    /** 调试调参面板配色 */
    tuning: {
        panelBg: hex('#131C26', 0.80),
        panelBorder: hex('#64DFDF', 0.72),
        exportBg: hex('#0D141C', 0.96),
        btnFill: hex('#2B3B4E'),
        btnActiveFill: hex('#2B6B73'),
        btnMutedFill: hex('#232C37'),
        btnBorder: hex('#7CA2BD'),
        sliderTrack: hex('#2C3A4A'),
        sliderFill: hex('#48C9B0'),
        sliderKnob: hex('#E8F8F5'),
        sliderDefaultMark: hex('#FFD166'),
        accentText: hex('#76E5DC'),
        mutedText: hex('#93A4B5'),
    },
} as const;
