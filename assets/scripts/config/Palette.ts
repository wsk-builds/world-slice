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

    /** 左右喷射键占位 */
    jetBtnFill: hex('#D96B52'),
    jetBtnBorder: hex('#F4A28C'),

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
} as const;
