// 正面视角的绑定配置（坐标为 1536×1536 PSD 像素，y 向下）。
// 支点来自 model/2d/front_rig/manifest.json 里各图层的实际范围，见 PROJECT_STATUS.md。
import { eyeDeform, smooth } from './puppet.js';

export const NAME = 'front';
export const CENTER_X = 765; // 身体中线，切换视角时用来对齐

export const HEAD = { cx: 761, cy: 430, rx: 215, ry: 250, rz: 205 };
export const NECK = { x: 766, y: 640 };
export const HIP = { x: 765, y: 1000 };
export const WAIST = { x: 765, y: 960 };
export const SHOULDER = { l: { x: 872, y: 706 }, r: { x: 652, y: 714 } };
// 手肘（袖子中段，按原图实测）：前臂绕这里弯。l = 画面右边那只手（角色的左手）
export const ELBOW = { l: { x: 945, y: 852 }, r: { x: 583, y: 852 } };

// 眼睛上沿、下沿的弧线（眼白 ∪ 虹膜的轮廓，按 model/2d/front_rig 实测拟合）：y = a·d² + b·d + c，d = x − cx
export const EYES = {
  r: { fit: { cx: 660.5, x0: 615, x1: 706, top: [0.01304, -0.05769, 448.24], bottom: [-0.01017, 0.07781, 544.01] } },
  l: { fit: { cx: 867.5, x0: 823, x1: 912, top: [0.0127, 0.12384, 437.33], bottom: [-0.01053, -0.07676, 532.49] } },
};
// 嘴：原画张嘴的上沿中点（程序画的嘴型以这里为原点，见 mouth.js）
export const MOUTH = { cx: 765, top: 556 };
export const EARS = { r: { x: 502, y: 468 }, l: { x: 1038, y: 452 } };
export const TAIL_ROOT = { x: 905, y: 1045 };
export const HIPS = { r: { x: 690, y: 1035 }, l: { x: 842, y: 1035 } }; // 被拎起时两腿各自绕髋摆
export const AHOGE_BASE = { x: 735, y: 128 };

// 每个图层：所属运动组、头部跟随权重的计算方式、深度（用于转头）、网格密度
// group: head | body | arm.l | arm.r | legs | skirt | tail
export const LAYERS = {
  'back hair': { group: 'hair-back', depth: -1, grid: 28 },
  tail: { group: 'tail', grid: 10 },
  // 两条腿、两只鞋各自一层（split_layer.py），被拎起时各绕自己的髋摆；r = 画面左边那条
  'footwear-r': { group: 'legs', leg: 'r', grid: 4 },
  'footwear-l': { group: 'legs', leg: 'l', grid: 4 },
  'leg-r': { group: 'legs', leg: 'r', grid: 10 },
  'leg-l': { group: 'legs', leg: 'l', grid: 10 },
  // 裙身和荷叶边分开：荷叶边比裙身慢半拍
  skirt: { group: 'skirt', grid: 20 },
  'skirt-frill': { group: 'skirt', grid: 20, frill: true },
  // 手举到头边时（上臂抬得很高，或前臂弯起来）改画在头发和鳍耳上面
  'handwear-l': { group: 'arm.l', grid: 16, raise: [{ param: 'armL', above: 1.5 }, { param: 'elbowL', above: 0.6 }] },
  'handwear-r': { group: 'arm.r', grid: 16, raise: [{ param: 'armR', above: 1.5 }, { param: 'elbowR', above: 0.6 }] },
  neck: { group: 'neck', grid: 6 },
  topwear: { group: 'body', grid: 20 },
  face: { group: 'head', depth: 1, grid: 24 },
  mouth: { group: 'head', depth: 1.02, grid: 6, part: 'mouth' },
  'eyewhite-r': { group: 'head', depth: 1.01, grid: 10, part: 'eyewhite', side: 'r' },
  'eyewhite-l': { group: 'head', depth: 1.01, grid: 10, part: 'eyewhite', side: 'l' },
  'irides-l': { group: 'head', depth: 1.02, grid: 8, part: 'iris', side: 'l' },
  'irides-r': { group: 'head', depth: 1.02, grid: 8, part: 'iris', side: 'r' },
  // 眼睛高光单独一层（front_details.py）：跟着眼珠走但略滞后，闭眼时一起被眼皮挡住
  'highlight-l': { group: 'head', depth: 1.025, grid: 3, part: 'iris', side: 'l', highlight: true },
  'highlight-r': { group: 'head', depth: 1.025, grid: 3, part: 'iris', side: 'r', highlight: true },
  'eyelash-l': { group: 'head', depth: 1.03, grid: 12, part: 'lash', side: 'l' },
  'eyelash-r': { group: 'head', depth: 1.03, grid: 12, part: 'lash', side: 'r' },
  'eyebrow-l': { group: 'head', depth: 1.04, grid: 6, part: 'brow', side: 'l' },
  'eyebrow-r': { group: 'head', depth: 1.04, grid: 6, part: 'brow', side: 'r' },
  // 鳍耳长在头侧偏后：转头时和脸反向错开
  'ear-r': { group: 'head', depth: -0.35, grid: 8, part: 'ear', side: 'r' },
  'ear-l': { group: 'head', depth: -0.35, grid: 8, part: 'ear', side: 'l' },
  // 前发按发丝线切成五块（split_layer.py + specs/front_hair.json），各有自己的弹簧，甩动有先后。
  // 深度必须相同：深度不同时转头各块移动量不同，头顶的切缝会被拉开
  'hair-lock-l': { group: 'hair-front', depth: 1.08, grid: 14, strand: { spring: 'hairL', root: 280, tip: 560 } },
  'hair-lock-r': { group: 'hair-front', depth: 1.08, grid: 18, strand: { spring: 'hairR', root: 280, tip: 740 } },
  'hair-bang-l': { group: 'hair-front', depth: 1.08, grid: 16, strand: { spring: 'bangL', root: 260, tip: 740 } },
  'hair-center': { group: 'hair-front', depth: 1.08, grid: 18, strand: { spring: 'bangs', root: 250, tip: 470, amp: 0.6 } },
  'hair-ahoge': { group: 'hair-front', depth: 1.08, grid: 6, ahoge: true },
  // 领口蝴蝶结（front_details.py）：轻轻晃
  bow: { group: 'body', grid: 4, swing: { spring: 'bow', pivot: { x: 757, y: 700 } } },
  headwear: { group: 'head', depth: 1.1, grid: 4 },
  // 从卫衣上切出来的挂绳（V 字绳 + 夹子 + 胸牌）和两根抽绳：绕顶端像钟摆一样摆（model/build/front_accessories.py）
  lanyard: { group: 'body', grid: 8, swing: { spring: 'lanyard', pivot: { x: 762, y: 700 } } },
  'string-l': { group: 'body', grid: 6, swing: { spring: 'stringL', pivot: { x: 693, y: 700 } } },
  'string-r': { group: 'body', grid: 6, swing: { spring: 'stringR', pivot: { x: 831, y: 700 } } },
};

// 角度上限（弧度）：2D 转头只适合小角度，更大的转向要切换到侧面图
export const LIMITS = { yaw: 0.20, pitch: 0.14, roll: 0.12 };

// 弹簧：[刚度, 阻尼]
export const SPRINGS = {
  hairL: [28, 4.5], hairR: [28, 4.5], hairC: [36, 5],
  bangs: [60, 7], backL: [18, 3.2], backC: [20, 3.5], backR: [18, 3.2],
  ahoge: [45, 3.0], earL: [55, 4.0], earR: [55, 4.0],
  tail: [22, 3.0], skirt: [30, 3.5], hem: [40, 5.0],
  sleeveL: [35, 4.0], sleeveR: [35, 4.0],
  lanyard: [16, 1.6], stringL: [26, 2.0], stringR: [24, 2.0],
  bangL: [24, 3.6], frill: [26, 2.6], bow: [60, 4],
};

/** 每个顶点的变形：局部变形（头发、裙摆等）→ 头部转动 → 身体（呼吸、手臂、倾斜、颠动）。 */
export function deform(P, cfg, x, y, p) {
  const S = P.springs;
  const breathUp = -p.breath * 3.0;

  // ---- 1. 局部变形（在静止坐标里）
  switch (cfg.group) {
    case 'hair-front': {
      if (cfg.strand || cfg.ahoge) {
        // 切开的发缕：各用自己的弹簧，发根不动、越靠发梢摆得越多（发根附近的切口因此不会裂开）
        if (cfg.strand) {
          const st = cfg.strand;
          const w = smooth(st.root, st.tip, y);
          x += S[st.spring].x * w * w * (st.amp ?? 1);
        } else {
          const w = smooth(AHOGE_BASE.y + 10, AHOGE_BASE.y - 70, y);
          [x, y] = P.rotateAround(x, y, AHOGE_BASE.x, AHOGE_BASE.y, S.ahoge.x * w);
        }
        break;
      }
      // 没切开的整块前发（旧素材）：两侧鬓发和中间刘海按位置分区摆动
      const side = x < HEAD.cx - 140 ? 'L' : x > HEAD.cx + 140 ? 'R' : 'C';
      const wl = smooth(HEAD.cx - 110, HEAD.cx - 180, x);
      const wr = smooth(HEAD.cx + 110, HEAD.cx + 180, x);
      const tipSide = smooth(430, 760, y);
      const tipBang = smooth(260, 480, y) * (1 - wl) * (1 - wr);
      x += (S.hairL.x * wl + S.hairR.x * wr) * tipSide * tipSide + S.bangs.x * tipBang * 0.5;
      if (side === 'C' && y < AHOGE_BASE.y + 10) {
        // 呆毛：绕根部摆
        const w = smooth(AHOGE_BASE.y + 10, AHOGE_BASE.y - 70, y);
        [x, y] = P.rotateAround(x, y, AHOGE_BASE.x, AHOGE_BASE.y, S.ahoge.x * w);
      }
      break;
    }
    case 'hair-back': {
      const wl = smooth(HEAD.cx - 60, HEAD.cx - 200, x);
      const wr = smooth(HEAD.cx + 60, HEAD.cx + 200, x);
      const wc = 1 - wl - wr;
      const tip = smooth(520, 1010, y);
      x += (S.backL.x * wl + S.backR.x * wr + S.backC.x * wc) * tip * tip;
      break;
    }
    case 'skirt': {
      const t = smooth(990, 1180, y);
      const side = (x - HIP.x) / 240;
      x += S.skirt.x * t;
      y += Math.abs(S.skirt.x) * 0.15 * t * side * Math.sign(S.skirt.x || 1);
      if (cfg.frill) x += S.frill.x * smooth(1110, 1185, y);
      break;
    }
    case 'body': {
      const t = smooth(1000, 1090, y);
      x += S.hem.x * t;
      break;
    }
    case 'tail': {
      [x, y] = P.rotateAround(x, y, TAIL_ROOT.x, TAIL_ROOT.y, S.tail.x);
      break;
    }
    case 'arm.l':
    case 'arm.r': {
      const sl = cfg.group === 'arm.l' ? S.sleeveL : S.sleeveR;
      x += sl.x * smooth(880, 1050, y);
      break;
    }
    default:
      break;
  }
  if (cfg.part === 'ear') {
    const root = EARS[cfg.side];
    const sp = cfg.side === 'l' ? S.earL : S.earR;
    const dir = cfg.side === 'l' ? 1 : -1;
    const w = smooth(0, 40, Math.abs(x - root.x));
    [x, y] = P.rotateAround(x, y, root.x, root.y, sp.x * dir * w);
  }
  if (cfg.part === 'lash' || cfg.part === 'eyewhite' || cfg.part === 'iris') {
    const c = cfg.side === 'l' ? p.blinkL : p.blinkR;
    y = eyeDeform(EYES[cfg.side], cfg.part, c, x, y, p.happy);
    if (cfg.part === 'iris') {
      // 原图的虹膜几乎贴满眼眶，只能小幅移动，大幅"看向一边"靠转头；高光比眼珠少动一点
      const k = cfg.highlight ? 0.7 : 1;
      x += p.eyeX * 4.5 * k;
      y += p.eyeY * 3 * k;
    }
  }
  if (cfg.part === 'brow') {
    const c = cfg.side === 'l' ? p.blinkL : p.blinkR;
    y += c * 4;
  }

  if (cfg.group === 'legs' && cfg.leg && (p.dangle || p.dangle2)) {
    // 腿已经各自一层：绕自己的髋摆
    const hip = HIPS[cfg.leg];
    const a = cfg.leg === 'r' ? p.dangle : p.dangle2;
    [x, y] = P.rotateAround(x, y, hip.x, hip.y, a * smooth(hip.y, hip.y + 60, y));
  } else if (cfg.group === 'legs' && (p.dangle || p.dangle2)) {
    // 两条腿在同一图层里（旧素材）：按横坐标在左右两个髋之间平滑过渡，各摆各的
    const w = smooth(HIPS.r.x + 40, HIPS.l.x - 40, x);
    const a = p.dangle * (1 - w) + p.dangle2 * w;
    const hx = HIPS.r.x + (HIPS.l.x - HIPS.r.x) * w;
    [x, y] = P.rotateAround(x, y, hx, HIPS.r.y, a * smooth(HIPS.r.y, HIPS.r.y + 60, y));
  }

  // ---- 2. 头部转动
  let headW = 0;
  if (cfg.group === 'head') headW = 1;
  else if (cfg.group === 'hair-front') headW = smooth(820, 560, y);
  else if (cfg.group === 'hair-back') headW = smooth(800, 560, y);
  else if (cfg.group === 'neck') headW = smooth(660, 600, y) * 0.6;
  if (headW > 0) {
    const depth = cfg.depth ?? 1;
    const [hx, hy] = P.headTransform(x, y, depth, p);
    x += (hx - x) * headW;
    y += (hy - y) * headW;
  }

  if (cfg.swing) {
    const pv = cfg.swing.pivot;
    [x, y] = P.rotateAround(x, y, pv.x, pv.y, S[cfg.swing.spring].x * smooth(pv.y, pv.y + 25, y));
  }

  // ---- 3. 身体：呼吸、手臂、上身倾斜、整体颠动
  const upper = cfg.group !== 'legs' && cfg.group !== 'tail';
  if (cfg.group === 'body') {
    const t = smooth(WAIST.y, 600, y);
    y += breathUp * t;
    x = WAIST.x + (x - WAIST.x) * (1 + p.breath * 0.006 * t);
  } else if (cfg.group === 'head' || cfg.group === 'hair-front' || cfg.group === 'neck'
    || (cfg.group === 'hair-back' && y < 800)) {
    y += breathUp;
  }
  if (cfg.group === 'arm.l' || cfg.group === 'arm.r') {
    // 两节骨骼：先绕肘弯前臂，再绕肩转整条手臂。权重按"沿手臂方向的位置"平滑过渡，
    // 关节处转角渐变（不是位置混合），袖子不会塌陷或剪切成一块
    const k = cfg.group === 'arm.l' ? 'l' : 'r';
    const sgn = k === 'l' ? -1 : 1;
    const sh = SHOULDER[k];
    const el = ELBOW[k];
    const ax = el.x - sh.x;
    const ay = el.y - sh.y;
    const len = Math.hypot(ax, ay);
    const t = ((x - sh.x) * ax + (y - sh.y) * ay) / len;
    const bend = k === 'l' ? p.elbowL : p.elbowR;
    if (bend) [x, y] = P.rotateAround(x, y, el.x, el.y, sgn * bend * smooth(len - 35, len + 35, t));
    const up = k === 'l' ? p.armL : p.armR;
    [x, y] = P.rotateAround(x, y, sh.x, sh.y, sgn * up * smooth(-20, 35, t));
    y += breathUp * 0.8;
  }
  // 上身扭转：用不同幅度的横移模拟（前面的东西移得多，后发反向）
  if (p.bodyTurn) {
    const shift = {
      head: 9, 'hair-front': 9, neck: 7, body: 6, 'arm.l': 5, 'arm.r': 5, skirt: 2.5, 'hair-back': -3,
    }[cfg.group] ?? 0;
    if (shift) {
      const w = cfg.group === 'body' || cfg.group === 'skirt' ? smooth(1090, 760, y) * 0.7 + 0.3 : 1;
      x += p.bodyTurn * shift * w;
    }
  }
  if (upper && p.lean) {
    const w = cfg.group === 'skirt' ? 0.4 : 1;
    [x, y] = P.rotateAround(x, y, HIP.x, HIP.y, p.lean * w);
  }
  y += p.bob;
  return [x, y];
}

/** 物理：d 为本帧头、身体的位移（第一帧为 null），h 为步长。 */
export function physics(S, d, t, h) {
  if (d) {
    const { dhx, dbx, dby } = d;
    // 发梢落后于头的运动
    for (const k of ['hairL', 'hairR']) S[k].push(-dhx * 0.45);
    S.bangs.push(-dhx * 0.12);
    S.bangL.push(-dhx * 0.35);
    S.frill.push(-dbx * 0.4);
    S.bow.push(dbx * 0.0012 + dhx * 0.0006);
    for (const k of ['backL', 'backC', 'backR']) S[k].push(-dbx * 0.35 - dhx * 0.15);
    S.ahoge.push(-dhx * 0.0035 + dby * 0.004);
    S.earL.push(dby * 0.01 + dhx * 0.002);
    S.earR.push(dby * 0.01 - dhx * 0.002);
    S.skirt.push(-dbx * 0.3);
    S.hem.push(-dbx * 0.15);
    S.sleeveL.push(-dbx * 0.2);
    S.sleeveR.push(-dbx * 0.2);
    S.tail.push(-dbx * 0.002 + dby * 0.004);
    // 挂绳、抽绳：身体横向一动就往反方向荡；上下颠（跳、落地）时也晃一下
    S.lanyard.push(dbx * 0.0016 + dby * 0.0006);
    S.stringL.push(dbx * 0.002 - dby * 0.0008);
    S.stringR.push(dbx * 0.002 + dby * 0.0008);
  }
  // 微风：很小的随机摆动，让静止时也不完全僵住
  const breeze = Math.sin(t * 0.9) * 0.6 + Math.sin(t * 2.3 + 1) * 0.3;
  S.hairL.step(h, breeze * 2.0);
  S.hairR.step(h, breeze * 1.6);
  S.hairC.step(h);
  S.bangs.step(h, breeze * 0.8);
  S.bangL.step(h, breeze * 1.7 + Math.sin(t * 1.9 + 2) * 0.4);
  S.backL.step(h, breeze * 2.4);
  S.backC.step(h, breeze * 1.6);
  S.backR.step(h, breeze * 2.4);
  S.ahoge.step(h, Math.sin(t * 1.7) * 0.03);
  S.earL.step(h, Math.sin(t * 1.1) * 0.015);
  S.earR.step(h, Math.sin(t * 1.1 + 0.6) * 0.015);
  S.tail.step(h, Math.sin(t * 1.4) * 0.06);
  S.skirt.step(h, breeze * 0.8);
  S.frill.step(h, breeze * 0.6 + Math.sin(t * 1.6 + 1) * 0.3);
  S.bow.step(h, Math.sin(t * 1.3) * 0.012);
  S.hem.step(h, breeze * 0.4);
  S.sleeveL.step(h, breeze * 0.6);
  S.sleeveR.step(h, -breeze * 0.6);
  S.lanyard.step(h, breeze * 0.006);
  S.stringL.step(h, breeze * 0.01);
  S.stringR.step(h, breeze * 0.008);
}

/** 转身的余势：头发、裙摆、尾巴被甩出去。 */
export function kick(S, dir, k) {
  S.lanyard.push(-dir * 0.12 * k);
  S.stringL.push(-dir * 0.15 * k);
  S.stringR.push(-dir * 0.15 * k);
  for (const n of ['backL', 'backC', 'backR']) S[n].push(dir * 22 * k);
  S.hairL.push(dir * 10 * k);
  S.hairR.push(dir * 10 * k);
  S.bangL.push(dir * 12 * k);
  S.frill.push(dir * 8 * k);
  S.skirt.push(dir * 9 * k);
  S.hem.push(dir * 4 * k);
  S.tail.push(dir * 0.12 * k);
  S.ahoge.push(dir * 0.15 * k);
  S.earL.push(0.08 * k);
  S.earR.push(0.08 * k);
}

// 表情小件的位置（见 overlays.js）：两颊脸红、头右侧汗滴、头顶右上方符号
export const OVERLAYS = [
  { name: 'blush-r', kind: 'blush', param: 'blush', rect: { x: 598, y: 522, w: 112, h: 50 }, cfg: { group: 'head', depth: 1.03 } },
  { name: 'blush-l', kind: 'blush', param: 'blush', rect: { x: 822, y: 510, w: 112, h: 50 }, cfg: { group: 'head', depth: 1.03 } },
  { name: 'sweat', kind: 'sweat', param: 'sweat', rect: { x: 505, y: 300, w: 36, h: 52 }, cfg: { group: 'head', depth: 0.6 } }, // 头左侧（右侧有发夹）
  { name: 'emote', kind: 'emote', param: 'emote', rect: { x: 955, y: 40, w: 120, h: 120 }, cfg: { group: 'head', depth: 0.6 } },
];
