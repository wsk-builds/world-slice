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

    /** 悬空三段式锥形十字玉柱配色（青碧玉色，贴合参考视频立体柱感与东海玉柱设定） */
    pillarRodFill: hex('#3CA389'),
    pillarBaseFill: hex('#2C826C'),
    pillarBorder: hex('#8EE6CE'),

    /** 柱子充能刻度与柱尖灵珠配色（T017） */
    pillarEnergy: {
        tickDisabled: hex('#1C3631'),
        tickOff: hex('#214E45'),
        tickLit: hex('#5CE6D0'),
        tickSkill: hex('#FFE066'),
        orbDisabled: hex('#243E3A'),
        orbIdle: hex('#3FA896'),
        orbCharged: hex('#7CF7E8'),
        orbSkill: hex('#FFD95A'),
        orbFlash: hex('#FFF7CC'),
    },

    /** T018 左柱「潮引」漩流线配色 */
    tidePullVortexOuter: hex('#5CE6D0', 0.78),
    tidePullVortexInner: hex('#FFF7CC', 0.92),

    /** T019 右柱「定海」缸底暖流线与波纹配色 */
    calmSeaWarmOuter: hex('#F7C97E', 0.56),
    calmSeaWarmInner: hex('#FFF1C4', 0.78),

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

    /** 灰盒 HUD 配色 */
    hud: {
        countdownNormal: hex('#EEF2F6'),
        countdownUrgent: hex('#FF6B6B'),
        pauseBtnActive: hex('#364D63'),
        overlayBackdrop: hex('#0B1219', 0.62),
        cardBg: hex('#1C2836', 0.96),
        cardBorder: hex('#64DFDF'),
        cardWonBorder: hex('#48C9B0'),
        cardLostBorder: hex('#FF6B6B'),
        actionBtnFill: hex('#2B6B73'),
        actionBtnBorder: hex('#8EE6CE'),
        actionBtnLostFill: hex('#7A3844'),
        actionBtnLostBorder: hex('#FF9AA2'),
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

    /** T021 敲玻璃震纹与拇指热区调试配色 */
    glassTap: {
        rippleOuter: hex('#A8F5FF', 0.86),
        rippleInner: hex('#FFFFFF', 0.92),
        rippleHitAccent: hex('#FFE066', 0.92),
    },
    hotZone: {
        fill: hex('#64DFDF', 0.16),
        border: hex('#64DFDF', 0.78),
        boundary: hex('#FFE066', 0.85),
    },

    /** T022 拖拽摆关器配色 */
    editor: {
        panelBg: hex('#111A24', 0.92),
        panelBorder: hex('#64DFDF', 0.78),
        exportBg: hex('#0D141C', 0.97),
        btnFill: hex('#28384A'),
        btnActiveFill: hex('#2B6B73'),
        btnPrimaryFill: hex('#2E7D6B'),
        btnDangerFill: hex('#7A3440'),
        btnMutedFill: hex('#202833'),
        btnBorder: hex('#7CA2BD'),
        btnActiveBorder: hex('#8EE6CE'),
        selectionRing: hex('#FFE066', 0.96),
        selectionCross: hex('#64DFDF', 0.9),
        validText: hex('#5CE6D0'),
        errorText: hex('#FF7B7B'),
    },
} as const;
