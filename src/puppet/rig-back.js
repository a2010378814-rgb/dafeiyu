// 背面视角的绑定配置。坐标为 1536×1536 PSD 像素，y 向下。
// 背面图层少：鳍耳和呆毛都在后发里，按区域单独摆动。支点按 model/2d/back_rig 和原图实测。
import { smooth } from './puppet.js';

export const NAME = 'back';
export const CENTER_X = 766;

// 从背后看，后脑勺就是"前表面"：转头用同一套椭球公式，方向取反
export const HEAD = { cx: 770, cy: 340, rx: 255, ry: 240, rz: 210 };
export const NECK = { x: 770, y: 610 };
export const HIP = { x: 766, y: 1010 };
export const SHOULDER = { r: { x: 578, y: 720 }, l: { x: 962, y: 720 } }; // r = 画面左（See-through 的命名）
export const EARS = { r: { x: 528, y: 428, dir: -1 }, l: { x: 1012, y: 428, dir: 1 } };
export const TAIL_ROOT = { x: 846, y: 1128 };
export const AHOGE_BASE = { x: 776, y: 106 };
// 原图背面的头和头发整体比身体偏左约 25 像素（身体以两腿中线为准是对称的），绘制时挪回来
export const HEAD_SHIFT = 25;

export const LAYERS = {
  'footwear-l': { group: 'legs', grid: 3 },
  'footwear-r': { group: 'legs', grid: 3 },
  legwear: { group: 'legs', grid: 10 },
  'handwear-r': { group: 'hand', side: 'r', grid: 8 },
  'handwear-l': { group: 'hand', side: 'l', grid: 8 },
  tail: { group: 'tail', grid: 12 },
  topwear: { group: 'body', grid: 20 },
  'back hair': { group: 'hair', grid: 34 },
  headwear: { group: 'head', grid: 4 },
};

export const LIMITS = { yaw: 0.2, pitch: 0.14, roll: 0.12 };

export const SPRINGS = {
  backL: [18, 3.2], backC: [20, 3.5], backR: [18, 3.2], ahoge: [45, 3.0], earL: [55, 4.0], earR: [55, 4.0],
  bounce: [60, 6], skirt: [30, 3.5], hem: [40, 5], handL: [35, 4], handR: [35, 4], tail: [22, 3.0],
};

export function deform(P, cfg, x, y, p) {
  const S = P.springs;
  const breathUp = -p.breath * 3.0;

  // ---- 1. 局部变形
  switch (cfg.group) {
    case 'hair': {
      // 发梢分左中右三块摆
      const wl = smooth(700, 520, x);
      const wr = smooth(840, 1020, x);
      const wc = 1 - wl - wr;
      const tip = smooth(520, 1050, y);
      x += (S.backL.x * wl + S.backR.x * wr + S.backC.x * wc) * tip * tip;
      y += S.bounce.x * tip;
      // 鳍耳：伸出头发轮廓的那部分绕耳根转
      for (const side of ['r', 'l']) {
        const E = EARS[side];
        const band = smooth(345, 380, y) * smooth(545, 515, y);
        const w = (side === 'r' ? smooth(E.x, E.x - 50, x) : smooth(E.x, E.x + 50, x)) * band;
        if (w > 0) {
          const sp = side === 'l' ? S.earL : S.earR;
          [x, y] = P.rotateAround(x, y, E.x, E.y, sp.x * E.dir * w);
        }
      }
      if (y < AHOGE_BASE.y + 4) {
        const w = smooth(AHOGE_BASE.y + 4, AHOGE_BASE.y - 50, y);
        [x, y] = P.rotateAround(x, y, AHOGE_BASE.x, AHOGE_BASE.y, S.ahoge.x * w);
      }
      break;
    }
    case 'body': {
      // 卫衣下摆和裙子在同一层：下摆轻摆，裙摆摆得多
      x += S.hem.x * smooth(980, 1050, y) + S.skirt.x * smooth(1085, 1179, y);
      break;
    }
    case 'hand': {
      const sp = cfg.side === 'l' ? S.handL : S.handR;
      x += sp.x * smooth(900, 1070, y);
      break;
    }
    case 'tail': {
      [x, y] = P.rotateAround(x, y, TAIL_ROOT.x, TAIL_ROOT.y, S.tail.x);
      break;
    }
    default:
      break;
  }

  // ---- 2. 头部：后发上半部分（含鳍耳、呆毛）和发夹跟着头转
  let headW = 0;
  if (cfg.group === 'head') headW = 1;
  else if (cfg.group === 'hair') headW = smooth(720, 500, y);
  if (headW > 0) {
    const q = { yaw: -p.yaw * 0.7, pitch: -p.pitch * 0.6, roll: -p.roll };
    const [hx, hy] = P.headTransform(x, y, 1, q);
    x += (hx - x) * headW;
    y += (hy - y) * headW;
  }

  // ---- 3. 身体：呼吸、手、颠动
  if (cfg.group === 'body') {
    const t = smooth(1050, 760, y);
    y += breathUp * t;
  } else if (cfg.group === 'head' || (cfg.group === 'hair' && y < 800)) {
    y += breathUp;
  }
  if (cfg.group === 'hand') {
    const sh = SHOULDER[cfg.side];
    const a = cfg.side === 'l' ? p.armL : -p.armR;
    [x, y] = P.rotateAround(x, y, sh.x, sh.y, a * 0.5);
    y += breathUp * 0.8;
  }
  if (cfg.group === 'hair' || cfg.group === 'head') x += HEAD_SHIFT;
  const upper = cfg.group !== 'legs' && cfg.group !== 'tail';
  if (upper && p.lean) [x, y] = P.rotateAround(x, y, HIP.x, HIP.y, -p.lean);
  y += p.bob;
  return [x, y];
}

export function physics(S, d, t, h) {
  if (d) {
    const { dhx, dbx, dby } = d;
    for (const k of ['backL', 'backC', 'backR']) S[k].push(-dbx * 0.35 + dhx * 0.2);
    S.ahoge.push(dhx * 0.0035 + dby * 0.004);
    S.earL.push(dby * 0.01 - dhx * 0.002);
    S.earR.push(dby * 0.01 + dhx * 0.002);
    S.bounce.push(-dby * 0.5);
    S.skirt.push(dbx * 0.3);
    S.hem.push(dbx * 0.15);
    S.tail.push(dbx * 0.002 + dby * 0.004);
  }
  const breeze = Math.sin(t * 0.9) * 0.6 + Math.sin(t * 2.3 + 1) * 0.3;
  S.backL.step(h, breeze * 2.4);
  S.backC.step(h, breeze * 1.6);
  S.backR.step(h, breeze * 2.4);
  S.ahoge.step(h, Math.sin(t * 1.7) * 0.03);
  S.earL.step(h, Math.sin(t * 1.1) * 0.015);
  S.earR.step(h, Math.sin(t * 1.1 + 0.6) * 0.015);
  S.bounce.step(h);
  S.skirt.step(h, breeze * 0.8);
  S.hem.step(h, breeze * 0.4);
  S.handL.step(h, breeze * 0.6);
  S.handR.step(h, -breeze * 0.6);
  S.tail.step(h, Math.sin(t * 1.4) * 0.06);
}

/** 转身的余势：头发、裙摆、尾巴被甩出去。 */
export function kick(S, dir, k) {
  for (const n of ['backL', 'backC', 'backR']) S[n].push(dir * 22 * k);
  S.skirt.push(dir * 9 * k);
  S.hem.push(dir * 4 * k);
  S.tail.push(dir * 0.12 * k);
  S.ahoge.push(dir * 0.15 * k);
  S.earL.push(0.08 * k);
  S.earR.push(0.08 * k);
}

// 表情小件的位置（见 overlays.js）：背面只有汗滴和头顶符号
export const OVERLAYS = [
  { name: 'sweat', kind: 'sweat', param: 'sweat', rect: { x: 1030, y: 260, w: 36, h: 52 }, cfg: { group: 'head' } },
  { name: 'emote', kind: 'emote', param: 'emote', rect: { x: 930, y: 10, w: 120, h: 120 }, cfg: { group: 'head' } },
];
