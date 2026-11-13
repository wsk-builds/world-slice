import { FlowVec2 } from './FlowField';

/**
 * 计算单个圈端点处的水流跟随加速度（纯逻辑，单位：缸内像素/秒²）。
 * 公式：加速度 = (基准跟随度 × 圈种跟随倍率) × (该点水速 − 端点当前速度)。
 */
export function calcEndpointFollowAccel(
    waterVx: number,
    waterVy: number,
    endVx: number,
    endVy: number,
    baseFollowRate: number,
    kindFlowFollow: number,
    out: FlowVec2 = { x: 0, y: 0 },
): FlowVec2 {
    const rate = Math.max(0, baseFollowRate * kindFlowFollow);
    out.x = rate * (waterVx - endVx);
    out.y = rate * (waterVy - endVy);
    return out;
}
