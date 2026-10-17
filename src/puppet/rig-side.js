// 侧面视角（脸朝画面左边，即角色的左侧）的绑定配置。坐标为 1536×1536 PSD 像素，y 向下。
// 支点按 model/2d/side_rig 的图层范围和原图实测，见 PROJECT_STATUS.md。
// 朝右时由 Character 整体镜像（发夹在另一侧看不到，镜像时隐藏）。
import { eyeDeform, smooth } from './puppet.js';

export const NAME = 'side';
export const CENTER_X = 660;

export const HEAD = { cx: 665, cy: 370, rx: 210, ry: 240, rz: 200 };
export const NECK = { x: 648, y: 600 };       // 点头、歪头都绕这里转（侧面的点头就是画面内的旋转）
export const HIP = { x: 660, y: 1010 };
export const SHOULDER = { x: 702, y: 705 };
export const HIPS = { near: { x: 663, y: 1066 }, far: { x: 636, y: 1057 } };
export const FOOT_Y = 1480;
// 眼睛上沿、下沿的弧线（按 model/2d/side_rig 实测拟合，见 rig-front.js 的说明）
export const EYE = { fit: { cx: 566.5, x0: 540, x1: 593, top: [0.02046, 0.41658, 417.83], bottom: [-0.02493, -0.40229, 503.06] } };
export const EAR_ROOT = { x: 724, y: 402 };
export const TAIL_ROOT = { x: 778, y: 1088 };
export const AHOGE_BASE = { x: 662, y: 124 };

export const LAYERS = {
  'leg-far': { group: 'leg', leg: 'far', grid: 10 },
  tail: { group: 'tail', grid: 12 },
  'leg-near': { group: 'leg', leg: 'near', grid: 10 },
  bottomwear: { group: 'skirt', grid: 20 },
  neck: { group: 'neck', grid: 6 },
  'back hair': { group: 'hair-back', grid: 28 },
  topwear: { group: 'body', grid: 18 },
  arm: { group: 'arm', grid: 12 },
  face: { group: 'head', grid: 16 },
  ear: { group: 'head', part: 'ear', grid: 8 },
  eyewhite: { group: 'head', part: 'eyewhite', side: 'l', grid: 8 },
  eyelash: { group: 'head', part: 'lash', side: 'l', grid: 10 },
  iris: { group: 'head', part: 'iris', side: 'l', grid: 6 },
  'front hair': { group: 'hair-front', grid: 26 },
  // 发夹在角色左侧，朝右（镜像）时看不到：隐藏发夹，换上一块不带发夹残影的干净头发（layers_build 生成）
  'headwear-cover': { group: 'hair-front', grid: 6, onlyWhenMirrored: true },
  headwear: { group: 'head', grid: 4, hideWhenMirrored: true },
};

// 侧面不做左右转头（那是正面/背面的事），只用点头和一点歪头
export const LIMITS = { yaw: 0.2, pitch: 0.14, roll: 0.12 };

export const SPRINGS = {
  lock: [26, 4.2], bangs: [55, 6.5], ahoge: [45, 3.0], ear: [50, 4.0],
  back: [14, 2.8], back2: [20, 3.2], bounce: [60, 6], nod: [70, 7],
  skirt: [32, 3.6], hem: [40, 5], sleeve: [35, 4], tail: [20, 2.8], tail2: [30, 3.2],
};

const rot = (P, x, y, c, a) => P.rotateAround(x, y, c.x, c.y, a);

export function deform(P, cfg, x, y, p) {
  const S = P.springs;
  const breathUp = -p.breath * 3.0;
  const walk = p.walk;
  const ph = p.walkPhase;

  // ---- 1. 局部变形
  switch (cfg.group) {
    case 'hair-front': {
      // 垂在肩前的鬓发卷（下半部分）和刘海尖（脸前方）各自摆；呆毛绕根部摆
      const lock = smooth(430, 740, y);
      const bang = smooth(250, 470, y) * smooth(560, 500, x);
      x += S.lock.x * lock * lock + S.bangs.x * bang * 0.5;
      y += S.bounce.x * 0.4 * lock;
      if (y < AHOGE_BASE.y + 6) {
        const w = smooth(AHOGE_BASE.y + 6, AHOGE_BASE.y - 60, y);
        [x, y] = rot(P, x, y, AHOGE_BASE, S.ahoge.x * w);
      }
      break;
    }
    case 'hair-back': {
      // 背后的长发：越往下摆得越多；往后飘时发梢略微抬起
      const w = smooth(480, 1020, y);
      const w2 = smooth(780, 1020, y);
      x += S.back.x * w * w + S.back2.x * w2;
      y += -Math.max(0, S.back.x) * 0.22 * w + S.bounce.x * w;
      break;
    }
    case 'skirt': {
      const t = smooth(1030, 1170, y);
      x += S.skirt.x * t;
      y += -Math.abs(S.skirt.x) * 0.12 * t + S.bounce.x * 0.3 * t;
      break;
    }
    case 'body': {
      x += S.hem.x * smooth(990, 1084, y);
      break;
    }
    case 'tail': {
      const dist = Math.hypot(x - TAIL_ROOT.x, y - TAIL_ROOT.y);
      const a = S.tail.x * smooth(0, 80, dist) + S.tail2.x * smooth(120, 320, dist);
      [x, y] = rot(P, x, y, TAIL_ROOT, a);
      break;
    }
    case 'arm': {
      x += S.sleeve.x * smooth(950, 1100, y);
      break;
    }
    case 'leg': {
      // 走路：大腿绕髋前后摆；往前迈（悬空）时小腿向后折（屈膝），脚自然抬起，落地前再伸直。
      // 远侧腿与近侧腿反相。脸朝左，往前就是往 -x：角度为正时腿下端往左。
      const near = cfg.leg === 'near';
      const phase = near ? ph : ph + Math.PI;
      const s = Math.sin(phase);
      const swing = Math.cos(phase); // >0：正在往前迈
      const hip = near ? HIPS.near : HIPS.far;
      const knee = { x: hip.x + 4, y: hip.y + (FOOT_Y - hip.y) * 0.48 };
      // 屈膝在迈步中段最大：前半段弯、后半段伸直
      const bend = Math.max(0, swing) * Math.max(0, Math.sin(phase + 0.9)) * 0.75 * walk;
      [x, y] = rot(P, x, y, knee, -bend * smooth(knee.y - 25, knee.y + 35, y));
      [x, y] = rot(P, x, y, hip, 0.33 * walk * s * smooth(hip.y - 10, hip.y + 80, y));
      break;
    }
    default:
      break;
  }
  if (cfg.part === 'ear') {
    const w = smooth(0, 30, Math.hypot(x - EAR_ROOT.x, y - EAR_ROOT.y));
    [x, y] = rot(P, x, y, EAR_ROOT, S.ear.x * w);
  }
  if (cfg.part === 'lash' || cfg.part === 'eyewhite' || cfg.part === 'iris') {
    const c = p.blinkL;
    y = eyeDeform(EYE, cfg.part, c, x, y, p.happy);
    if (cfg.part === 'iris') {
      x += p.eyeX * 2.5;
      y += p.eyeY * 3;
    }
  }

  // ---- 2. 头部：点头（画面内旋转），歪头和左右转头只取一点点，给侧面也添些变化
  let headW = 0;
  if (cfg.group === 'head') headW = 1;
  else if (cfg.group === 'hair-front') headW = smooth(800, 600, y);
  else if (cfg.group === 'hair-back') headW = smooth(780, 560, y);
  else if (cfg.group === 'neck') headW = smooth(640, 585, y) * 0.6;
  if (headW > 0) {
    // 点头里叠加一点"随步子晃"的滞后（nod 弹簧），头不会跟身体硬连在一起
    const a = -p.pitch * 0.9 + p.roll * 0.25 - p.yaw * 0.15 + P.springs.nod.x;
    const [hx, hy] = rot(P, x, y, NECK, a);
    x += (hx - x) * headW;
    y += (hy - y) * headW;
  }

  // ---- 3. 身体：呼吸、手臂、前倾、颠动
  if (cfg.group === 'body') {
    const t = smooth(1000, 620, y);
    y += breathUp * t;
    x = HIP.x + (x - HIP.x) * (1 + p.breath * 0.006 * t);
  } else if (cfg.group === 'head' || cfg.group === 'hair-front' || cfg.group === 'neck'
    || (cfg.group === 'hair-back' && y < 800)) {
    y += breathUp;
  }
  if (cfg.group === 'arm') {
    // 手臂：待机时用 armL，走路时与近侧腿反向前后摆
    const a = -p.armL * 0.6 - 0.38 * walk * Math.sin(p.walkPhase - 0.35);
    [x, y] = rot(P, x, y, SHOULDER, a * smooth(SHOULDER.y - 20, SHOULDER.y + 50, y));
    y += breathUp * 0.8;
  }
  // 走路时上身略微前倾（脸朝左，前倾 = 上端往左）
  const upper = cfg.group !== 'leg' && cfg.group !== 'tail';
  const lean = p.lean * 0.5 - 0.035 * walk;
  if (upper && lean) {
    const w = cfg.group === 'skirt' ? 0.4 : 1;
    [x, y] = rot(P, x, y, HIP, lean * w);
  }
  y += p.bob;
  return [x, y];
}

export function physics(S, d, t, h, p) {
  const walk = p.walk;
  if (d) {
    const { dhx, dbx, dby } = d;
    // 点头的变化也会甩动鬓发
    const dp = S._pitch === undefined ? 0 : p.pitch - S._pitch;
    S.lock.push(-dhx * 0.25 + dp * 60);
    S.bangs.push(-dhx * 0.08);
    S.back.push(-dbx * 0.3 - dhx * 0.1);
    S.ahoge.push(dby * 0.004 + dp * 0.3);
    S.ear.push(dby * 0.008);
    S.bounce.push(-dby * 0.8);
    S.nod.push(dby * 0.004);
    S.skirt.push(-dbx * 0.3);
    S.tail.push(dby * 0.003);
  }
  S._pitch = p.pitch;
  const breeze = Math.sin(t * 0.9) * 0.6 + Math.sin(t * 2.3 + 1) * 0.3;
  const ph = p.walkPhase;
  // 走路时：头发、裙摆、尾巴被"风"往后带（脸朝左，往后 = +x），并随步子轻轻甩
  S.lock.step(h, breeze * 1.5 + walk * 5);
  S.bangs.step(h, breeze * 0.6 + walk * 2);
  S.back.step(h, breeze * 2.2 + walk * 12);
  S.back2.step(h, Math.sin(t * 1.3) * 1.2 + walk * (4 + 3 * Math.sin(ph * 2)));
  S.bounce.step(h);
  S.nod.step(h);
  S.ahoge.step(h, Math.sin(t * 1.7) * 0.03 + walk * 0.06);
  S.ear.step(h, Math.sin(t * 1.1) * 0.015 + walk * 0.04);
  S.skirt.step(h, breeze * 0.7 + walk * (3 + 2 * Math.sin(ph * 2)));
  S.hem.step(h, breeze * 0.3 + walk * 1.5);
  S.sleeve.step(h, breeze * 0.5 + walk * 2 * Math.sin(ph));
  S.tail.step(h, Math.sin(t * 1.4) * 0.06 + walk * 0.08 * Math.sin(ph));
  S.tail2.step(h, Math.sin(t * 1.4 - 0.8) * 0.05 + walk * 0.1 * Math.sin(ph - 1));
}

/** 转身的余势：后发、鬓发、裙摆、尾巴被甩出去。 */
export function kick(S, dir, k) {
  S.back.push(dir * 26 * k);
  S.back2.push(dir * 12 * k);
  S.lock.push(dir * 10 * k);
  S.skirt.push(dir * 9 * k);
  S.hem.push(dir * 4 * k);
  S.tail.push(dir * 0.14 * k);
  S.ahoge.push(dir * 0.15 * k);
  S.ear.push(0.08 * k);
}

// 表情小件的位置（见 overlays.js）
export const OVERLAYS = [
  { name: 'blush', kind: 'blush', param: 'blush', rect: { x: 520, y: 492, w: 96, h: 44 }, cfg: { group: 'head' } },
  // 侧脸张嘴：原画的嘴是 (507～516, 552～555) 的一条小弧线，脸的轮廓在 x≈492
  { name: 'mouth-side', kind: 'mouthSide', param: 'mouth', rect: { x: 488, y: 545, w: 32, h: 28 }, cfg: { group: 'head' } },
  { name: 'sweat', kind: 'sweat', param: 'sweat', rect: { x: 455, y: 300, w: 36, h: 52 }, cfg: { group: 'head' } },
  { name: 'emote', kind: 'emote', param: 'emote', rect: { x: 760, y: 20, w: 120, h: 120 }, cfg: { group: 'head' } },
];
