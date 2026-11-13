import { describe, expect, it } from 'vitest';
import { DEFAULT_FEEL_CONFIG } from '../../../assets/scripts/config/FeelConfig';
import { calcRingPillarGeometry } from '../../../assets/scripts/config/GameConst';
import { TankSpace } from '../../../assets/scripts/config/TankSpace';
import { FlowField } from '../../../assets/scripts/core/flow/FlowField';
import { calcEndpointFollowAccel } from '../../../assets/scripts/core/flow/WaterFollow';
import { Bladder } from '../../../assets/scripts/core/input/Bladder';
import { getRingKindConfig } from '../../../assets/scripts/core/rings/RingKinds';

interface SimRing2D {
    x: number;
    y: number;
    vx: number;
    vy: number;
    angleRad: number;
    omega: number;
}

/**
 * 与 Ring + RingLayer + WaterForce 完全同构的轻量 2D 双端点刚体积分，
 * 用于校验 T008 水流施力公式与 FeelConfig 临时参数的物理行为。
 */
function stepSimRing(
    ring: SimRing2D,
    field: FlowField,
    dt: number,
    endOffset: number,
    radiusGyrationSq: number,
    sinkScale = 1,
    flowFollow = 1,
): void {
    const feel = DEFAULT_FEEL_CONFIG;
    const cosA = Math.cos(ring.angleRad);
    const sinA = Math.sin(ring.angleRad);

    const lx = ring.x - cosA * endOffset;
    const ly = ring.y - sinA * endOffset;
    const rx = ring.x + cosA * endOffset;
    const ry = ring.y + sinA * endOffset;

    // 刚体端点速度 v_end = v_cm + omega × r
    const lvx = ring.vx - ring.omega * (-sinA * endOffset);
    const lvy = ring.vy + ring.omega * (-cosA * endOffset);
    const rvx = ring.vx - ring.omega * (sinA * endOffset);
    const rvy = ring.vy + ring.omega * (cosA * endOffset);

    const wLeft = field.velocityAt(lx, ly);
    const wRight = field.velocityAt(rx, ry);

    const aLeft = calcEndpointFollowAccel(wLeft.x, wLeft.y, lvx, lvy, feel.flowFollowRate, flowFollow);
    const aRight = calcEndpointFollowAccel(wRight.x, wRight.y, rvx, rvy, feel.flowFollowRate, flowFollow);

    const ax = 0.5 * (aLeft.x + aRight.x);
    const ay = 0.5 * (aLeft.y + aRight.y) - feel.baseSinkAccel * sinkScale;

    // 力矩 τ/m = 0.5 * (r_L × a_L + r_R × a_R)
    const torquePerMass =
        0.5 *
        ((-cosA * endOffset) * aLeft.y - (-sinA * endOffset) * aLeft.x +
            (cosA * endOffset) * aRight.y - (sinA * endOffset) * aRight.x);
    const alpha = torquePerMass / radiusGyrationSq;

    const linDecay = 1 / (1 + dt * feel.ringLinearDamping);
    const angDecay = 1 / (1 + dt * feel.ringAngularDamping);

    ring.vx = (ring.vx + ax * dt) * linDecay;
    ring.vy = (ring.vy + ay * dt) * linDecay;
    ring.omega = (ring.omega + alpha * dt) * angDecay;

    ring.x += ring.vx * dt;
    ring.y += ring.vy * dt;
    ring.angleRad += ring.omega * dt;

    // 缸底与缸顶边界约束
    if (ring.y < 12) {
        ring.y = 12;
        if (ring.vy < 0) ring.vy = 0;
    } else if (ring.y > TankSpace.height - 12) {
        ring.y = TankSpace.height - 12;
        if (ring.vy > 0) ring.vy = 0;
    }
}

describe('WaterFollow 与双端点水流施力（T008）', () => {
    it('按「跟随度 ×（水速 − 端点速度）」计算加速度，木圈响应更快、铁圈更沉稳', () => {
        const normalCfg = getRingKindConfig('normal');
        const ironCfg = getRingKindConfig('iron');
        const woodCfg = getRingKindConfig('wood');

        // 端点速度等于水速时，相对水流加速度为 0
        expect(calcEndpointFollowAccel(150, -80, 150, -80, 3.5, normalCfg.flowFollow)).toEqual({ x: 0, y: 0 });

        const aNormal = calcEndpointFollowAccel(0, 600, 0, 100, 3.5, normalCfg.flowFollow);
        const aIron = calcEndpointFollowAccel(0, 600, 0, 100, 3.5, ironCfg.flowFollow);
        const aWood = calcEndpointFollowAccel(0, 600, 0, 100, 3.5, woodCfg.flowFollow);

        expect(aNormal.y).toBeCloseTo(3.5 * 500, 6);
        expect(aIron.y).toBeLessThan(aNormal.y);
        expect(aWood.y).toBeGreaterThan(aNormal.y);
    });

    it('海眼正上方放圈：静水约 3 秒沉底，轻点跳起一小段，按满一口气升到接近缸顶后慢慢落回', () => {
        const dt = 1 / 60;
        const geom = calcRingPillarGeometry(TankSpace.width);
        const endOffset = geom.ringOuterDiameter / 2 - geom.ringThickness / 2;
        const radiusGyrationSq = (geom.ringOuterDiameter * geom.ringOuterDiameter) / 10;
        const leftNozzleX = TankSpace.pctToPxX(DEFAULT_FEEL_CONFIG.nozzlePosPct);

        // 1. 静水沉底时间约 3 秒
        const sinkField = new FlowField({ seed: 1024, turbulenceScale: 0 });
        const sinkRing: SimRing2D = { x: TankSpace.width / 2, y: TankSpace.height - 20, vx: 0, vy: 0, angleRad: 0, omega: 0 };
        let sinkTime = 0;
        while (sinkRing.y > 12.5 && sinkTime < 6) {
            sinkField.step(dt);
            stepSimRing(sinkRing, sinkField, dt, endOffset, radiusGyrationSq);
            sinkTime += dt;
        }
        expect(sinkTime).toBeGreaterThan(2.6);
        expect(sinkTime).toBeLessThan(3.4);

        // 2. 轻点 0.1 秒：跳起一小段（约缸高 25%–55%），随后落回
        const tapField = new FlowField({ seed: 1024, turbulenceScale: 0 });
        const tapBladder = new Bladder();
        const tapRing: SimRing2D = { x: leftNozzleX, y: 20, vx: 0, vy: 0, angleRad: 0, omega: 0 };
        tapBladder.press();
        let tapMaxY = tapRing.y;
        for (let step = 0; step < 120; step++) {
            if (step === 6) {
                tapBladder.release();
            }
            tapField.setJetInputs(tapBladder.output, 0);
            tapField.step(dt);
            tapBladder.step(dt);
            stepSimRing(tapRing, tapField, dt, endOffset, radiusGyrationSq);
            tapMaxY = Math.max(tapMaxY, tapRing.y);
        }
        expect(tapMaxY).toBeGreaterThan(TankSpace.height * 0.25);
        expect(tapMaxY).toBeLessThan(TankSpace.height * 0.60);
        expect(tapRing.y).toBeLessThan(tapMaxY - 80);

        // 3. 按住满一口气（0.65 秒）：一路升到接近缸顶（> 75% 缸高），松手后慢慢落回
        const holdField = new FlowField({ seed: 1024, turbulenceScale: 0 });
        const holdBladder = new Bladder();
        const holdRing: SimRing2D = { x: leftNozzleX, y: 20, vx: 0, vy: 0, angleRad: 0, omega: 0 };
        holdBladder.press();
        let holdMaxY = holdRing.y;
        for (let step = 0; step < 150; step++) {
            if (step === 45) {
                holdBladder.release();
            }
            holdField.setJetInputs(holdBladder.output, 0);
            holdField.step(dt);
            holdBladder.step(dt);
            stepSimRing(holdRing, holdField, dt, endOffset, radiusGyrationSq);
            holdMaxY = Math.max(holdMaxY, holdRing.y);
        }
        expect(holdMaxY).toBeGreaterThan(TankSpace.height * 0.72);
        expect(holdMaxY).toBeGreaterThan(tapMaxY + 140);
        expect(holdRing.y).toBeLessThan(holdMaxY - 120);
    });

    it('圈一头在水柱里、一头在外面时会翻转；多按几次左键使别处的圈顺时针漂移', () => {
        const dt = 1 / 60;
        const geom = calcRingPillarGeometry(TankSpace.width);
        const endOffset = geom.ringOuterDiameter / 2 - geom.ringThickness / 2;
        const radiusGyrationSq = (geom.ringOuterDiameter * geom.ringOuterDiameter) / 10;
        const leftNozzleX = TankSpace.pctToPxX(DEFAULT_FEEL_CONFIG.nozzlePosPct);

        // 1. 圈心偏在左海眼右侧（左端在水柱核心，右端在水柱锥形之外）-> 明显顺时针翻转（angleRad < 0）
        const flipField = new FlowField({ seed: 1024, turbulenceScale: 0 });
        const flipBladder = new Bladder();
        const halfInRing: SimRing2D = {
            x: leftNozzleX + endOffset + 12,
            y: 45,
            vx: 0,
            vy: 0,
            angleRad: 0,
            omega: 0,
        };
        flipBladder.press();
        let maxAbsDeg = 0;
        for (let step = 0; step < 30; step++) {
            flipField.setJetInputs(flipBladder.output, 0);
            flipField.step(dt);
            flipBladder.step(dt);
            stepSimRing(halfInRing, flipField, dt, endOffset, radiusGyrationSq);
            maxAbsDeg = Math.max(maxAbsDeg, Math.abs((halfInRing.angleRad * 180) / Math.PI));
        }
        expect(maxAbsDeg).toBeGreaterThan(25);
        expect(halfInRing.angleRad).toBeLessThan(0);

        // 2. 多按几次左键：上半区的圈向右漂，下半区的圈向左漂，左侧区的圈向上缓漂（全缸顺时针环流）
        const circField = new FlowField({ seed: 1024, turbulenceScale: 0 });
        const circBladder = new Bladder();
        const topRing: SimRing2D = { x: TankSpace.width * 0.55, y: TankSpace.height * 0.90, vx: 0, vy: 0, angleRad: 0, omega: 0 };
        const bottomRing: SimRing2D = { x: TankSpace.width * 0.55, y: 20, vx: 0, vy: 0, angleRad: 0, omega: 0 };
        const startTopX = topRing.x;
        const startBottomX = bottomRing.x;
        let maxTopX = startTopX;

        for (let step = 0; step < 90; step++) {
            // 模拟连按 3 次左键（每次按 0.25s、松 0.25s）
            const phase = step % 30;
            circBladder.setPressed(phase < 15);
            circField.setJetInputs(circBladder.output, 0);
            circField.step(dt);
            circBladder.step(dt);
            stepSimRing(topRing, circField, dt, endOffset, radiusGyrationSq);
            stepSimRing(bottomRing, circField, dt, endOffset, radiusGyrationSq);
            if (topRing.y > TankSpace.height * 0.5) {
                maxTopX = Math.max(maxTopX, topRing.x);
            }
        }

        expect(maxTopX).toBeGreaterThan(startTopX + 20);
        expect(bottomRing.x).toBeLessThan(startBottomX - 40);
    });
});
