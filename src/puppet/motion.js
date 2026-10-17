// 关键帧动作：数据格式、曲线求值、分层播放。
//
// 动作文件（public/motions/<name>.json）：
// {
//   "name": "wave", "label": "挥手",
//   "layer": "arms",            // 所在层：body / arms / head / face。层只决定叠加顺序，不再是"一层一个槽"
//   "priority": 1,              // 可选：0 = 待机小动作，1 = 普通互动，2 = 大动作；冲突时高的不让路
//   "writes": ["armL"],         // 可选：手动声明独占参数；不写就按 tracks 里的 set/max 轨道自动推导
//   "facing": "front",          // 需要的朝向：front / side / back；不写 = 任意朝向
//   "duration": 1.5,            // 总时长（秒）
//   "loop": [0.45, 0.95],       // 可选：循环区间。开头段播完后在这里重复，松开后播结束段（三段式）
//   "hold": 1.5,                // 可选：没人松开时，循环最多持续几秒（0 或不填 = 一直循环直到松开）
//   "fadeIn": 0.1, "fadeOut": 0.2,
//   "stopWalk": true,           // 可选：播放时停下脚步
//   "tracks": {
//     "armL": { "mode": "set", "keys": [[0, 0, "easeOut"], [0.3, 1.25, "back"], ...] }
//   }
// }
// 关键帧 [时间, 数值, 到下一帧的曲线]。曲线是预设名，或 CSS 风格的贝塞尔 [x1, y1, x2, y2]（y 可超出 0..1，做冲过头的效果）。
// 轨道模式：add 在待机参数上叠加；set 按权重替换；max 取较大值（眨眼类）；scale 按倍数缩放（呼吸幅度）。

export const LAYERS = ['body', 'arms', 'head', 'face'];
export const LAYER_LABELS = { body: '身体', arms: '手臂', head: '头', face: '表情' };
export const MODES = { add: '叠加', set: '替换', max: '取大', scale: '缩放' };

export const EASES = {
  linear: [0, 0, 1, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  back: [0.34, 1.56, 0.64, 1],        // 冲过头再回来
  anticipate: [0.36, -0.45, 0.7, 1],  // 先往反方向蓄一下
  step: 'step',                       // 瞬间跳到下一帧
};
export const EASE_LABELS = {
  linear: '匀速', easeIn: '缓入（越来越快）', easeOut: '缓出（越来越慢）', easeInOut: '缓入缓出',
  back: '冲过头再回来', anticipate: '先蓄力再动', step: '瞬间切换',
};

/** 编辑器里每个参数的显示名、取值范围和默认轨道模式。 */
export const PARAM_INFO = {
  yaw: { label: '左右转头', min: -0.25, max: 0.25, mode: 'add' },
  pitch: { label: '抬头/低头', min: -0.16, max: 0.16, mode: 'add' },
  roll: { label: '歪头', min: -0.14, max: 0.14, mode: 'add' },
  lean: { label: '上身倾斜', min: -0.08, max: 0.08, mode: 'add' },
  bodyTurn: { label: '上身扭转', min: -1, max: 1, mode: 'add' },
  bob: { label: '上下位移', min: -90, max: 20, mode: 'add' },
  stretch: { label: '伸缩', min: -0.1, max: 0.1, mode: 'add' },
  breath: { label: '呼吸幅度', min: 0, max: 2, mode: 'scale' },
  blink: { label: '闭眼（双眼）', min: 0, max: 1, mode: 'max' },
  blinkL: { label: '闭左眼', min: 0, max: 1, mode: 'max' },
  blinkR: { label: '闭右眼', min: 0, max: 1, mode: 'max' },
  happy: { label: '眯眼笑 ^^', min: 0, max: 1, mode: 'set' },
  eyeX: { label: '眼珠左右', min: -1, max: 1, mode: 'set' },
  eyeY: { label: '眼珠上下', min: -1, max: 1, mode: 'set' },
  // 嘴型按档切换（见 mouth.js）：0 闭嘴笑 · 0.5 小张嘴 · 1 原画张嘴笑 · 2 大张嘴 · 3 o 形 · 4 咧嘴 · 5 ω · 6 波浪 · 7 嘟嘴
  mouth: { label: '嘴型（0 闭 1 原画 2 大张 3 o 5 ω…）', min: 0, max: 7, mode: 'set', discrete: true },
  armL: { label: '画面右手 抬臂', min: -0.5, max: 2.6, mode: 'set' },
  armR: { label: '画面左手 抬臂', min: -0.5, max: 2.6, mode: 'set' },
  elbowL: { label: '画面右手 弯肘', min: 0, max: 2, mode: 'set' },
  elbowR: { label: '画面左手 弯肘', min: 0, max: 2, mode: 'set' },
  blush: { label: '脸红', min: 0, max: 1, mode: 'max' },
  sweat: { label: '汗滴', min: 0, max: 1, mode: 'max' },
  emote: { label: '头顶符号（1！2？3♪4…5♥6zzz）', min: 0, max: 6, mode: 'set', discrete: true },
};

// ---- 通道与冲突
//
// 动作不再靠"在第几层"决定谁让路，而是看它独占了哪些参数：
// 通道不重叠的动作可以同时播（例如只动手臂的手势 + 只动身体的跳），
// 冲突时按 priority 决定谁让路。
export const PARAM_CHANNEL = {
  armL: 'arms', armR: 'arms', elbowL: 'arms', elbowR: 'arms',
  yaw: 'head', pitch: 'head', roll: 'head', eyeX: 'head', eyeY: 'head',
  lean: 'body', bodyTurn: 'body', bob: 'body', stretch: 'body', breath: 'body',
  dangle: 'legs', dangle2: 'legs',
  blink: 'face', blinkL: 'face', blinkR: 'face', happy: 'face',
  mouth: 'face', blush: 'face', sweat: 'face', emote: 'face',
};

// 叠加（add）和缩放（scale）是相对量，天然可以共存；只有替换（set）和取大（max）算"独占"。
const COMPOSABLE = new Set(['add', 'scale']);

/** 这个动作独占了哪些参数。face 通道不算：表情是叠加资源，多个动作都写时由后应用的覆盖。 */
export function exclusiveParams(motion) {
  const out = new Set();
  // 手写声明优先：有些动作只有 add 轨道，但作者知道它不该和别人同时播。
  if (Array.isArray(motion.writes)) {
    for (const p of motion.writes) if (PARAM_CHANNEL[p] !== 'face') out.add(p);
    return out;
  }
  for (const [param, track] of Object.entries(motion.tracks ?? {})) {
    const mode = track.mode ?? PARAM_INFO[param]?.mode ?? 'add';
    if (COMPOSABLE.has(mode)) continue;
    if (PARAM_CHANNEL[param] === 'face') continue;
    out.add(param);
  }
  return out;
}

/** 两个动作会不会抢同一个独占参数。 */
export function motionsConflict(a, b) {
  for (const p of a.exclusive ?? exclusiveParams(a)) {
    if ((b.exclusive ?? exclusiveParams(b)).has(p)) return true;
  }
  return false;
}

// ---- 曲线

/** CSS 风格的三次贝塞尔缓动：给定 x（时间进度 0..1）求 y。 */
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) { // 牛顿迭代
      const e = sx(t) - x;
      const d = dx(t);
      if (Math.abs(e) < 1e-5) break;
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    if (t < 0 || t > 1 || Math.abs(sx(t) - x) > 1e-3) { // 退回二分
      let lo = 0;
      let hi = 1;
      t = x;
      for (let i = 0; i < 30; i++) {
        if (sx(t) < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
    }
    return sy(t);
  };
}

const easeCache = new Map();
export function easeFn(e) {
  const spec = typeof e === 'string' ? EASES[e] ?? EASES.easeInOut : e ?? EASES.easeInOut;
  if (spec === 'step') return (x) => (x < 1 ? 0 : 1);
  const key = spec.join(',');
  if (!easeCache.has(key)) easeCache.set(key, bezier(...spec));
  return easeCache.get(key);
}

/** 轨道在时间 t 的值。 */
export function sampleTrack(track, t) {
  const k = track.keys;
  if (!k.length) return 0;
  if (t <= k[0][0]) return k[0][1];
  for (let i = 0; i < k.length - 1; i++) {
    const [t0, v0, e] = k[i];
    const [t1, v1] = k[i + 1];
    if (t < t1) {
      const u = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      return v0 + (v1 - v0) * easeFn(e)(u);
    }
  }
  return k[k.length - 1][1];
}

/** 把一个轨道的值按模式和权重写进参数。 */
export function applyTrack(q, param, mode, v, w) {
  const targets = param === 'blink' ? ['blinkL', 'blinkR'] : [param];
  for (const p of targets) {
    if (q[p] === undefined) continue;
    if (PARAM_INFO[param]?.discrete) {
      if (w >= 0.5) q[p] = v; // 按档切换的参数（嘴型）不插值：淡入淡出过半时直接换
      continue;
    }
    if (mode === 'add') q[p] += v * w;
    else if (mode === 'max') q[p] = Math.max(q[p], v * w);
    else if (mode === 'scale') q[p] *= 1 + (v - 1) * w;
    else q[p] += (v - q[p]) * w;
  }
}

/** 动作在时间 t 的效果直接作用到参数（编辑器预览用，不做淡入淡出）。 */
export function applyMotionAt(motion, t, q, w = 1) {
  for (const [param, track] of Object.entries(motion.tracks)) {
    applyTrack(q, param, track.mode ?? PARAM_INFO[param]?.mode ?? 'add', sampleTrack(track, t), w);
  }
}

// ---- 播放

class Instance {
  constructor(motion, opts = {}) {
    this.motion = motion;
    this.t = 0;
    this.age = 0;
    this.exclusive = exclusiveParams(motion);
    // 优先级：0 = 待机小动作，1 = 普通互动，2 = 大动作（跳、躺下）。当前没有动作标，默认都是 1。
    this.priority = opts.priority ?? motion.priority ?? 1;
    this.released = !motion.loop;
    const hold = opts.hold ?? motion.hold;
    this.holdLeft = hold > 0 ? hold : Infinity; // 0 或不填：一直循环，直到 release()
    this.fadeOutStart = null; // 被同层新动作挤掉时开始淡出
    this.fadeOutFrom = 1;
    this.done = false;
  }

  get name() { return this.motion.name; }

  /** 结束循环。now = true 时立刻跳到结束段（例如被点醒），否则播完这一轮循环再结束（例如挥手）。 */
  release(now = false) {
    this.released = true;
    if (now && this.motion.loop) this.t = Math.max(this.t, this.motion.loop[1]);
  }

  /** 保持循环（例如持续摸头时不断续命）。 */
  keep(seconds) {
    this.holdLeft = Math.max(this.holdLeft, seconds);
    this.released = false;
  }

  step(dt) {
    const M = this.motion;
    this.age += dt;
    this.t += dt;
    if (M.loop && !this.released) {
      this.holdLeft -= dt;
      if (this.holdLeft <= 0) this.released = true;
      const [a, b] = M.loop;
      if (!this.released && this.t > b && b > a) this.t = a + ((this.t - a) % (b - a));
    }
    if (this.t >= M.duration) this.done = true;
    if (this.fadeOutStart !== null && this.age - this.fadeOutStart >= (M.fadeOut ?? 0.2)) this.done = true;
  }

  weight() {
    const M = this.motion;
    const fin = M.fadeIn ?? 0.12;
    const fout = M.fadeOut ?? 0.2;
    let w = fin > 0 ? Math.min(1, this.age / fin) : 1;
    if (this.released) w = Math.min(w, Math.max(0, (M.duration - this.t) / Math.max(fout, 1e-3)));
    if (this.fadeOutStart !== null) {
      w = Math.min(w, this.fadeOutFrom * Math.max(0, 1 - (this.age - this.fadeOutStart) / Math.max(fout, 1e-3)));
    }
    return smoothstep(w);
  }

  apply(q) {
    applyMotionAt(this.motion, this.t, q, this.weight());
  }
}

const smoothstep = (x) => x * x * (3 - 2 * x);

/**
 * 分层播放：各层按 body → arms → head → face 的顺序叠加。
 * 同一动作能不能和别的动作同时播，看的是独占参数有没有重叠，而不是在不在同一层。
 */
export class Animator {
  constructor() {
    this.layers = Object.fromEntries(LAYERS.map((l) => [l, []]));
    this.onEvent = null; // (name, started)
  }

  /**
   * 播放动作。通道不重叠的动作可以并存；冲突时：
   * - 两者优先级相同 → 新动作替换旧动作（旧动作开始淡出）
   * - 新动作优先级更高 → 同样替换
   * - 新动作优先级更低 → 直接拒绝，返回 null（旧动作不受影响）
   *
   * 注意：整套排队/组合逻辑仍然在别处——这里只做"能不能播、谁让路"。
   */
  play(motion, opts) {
    const inst = new Instance(motion, opts);
    const list = this.layers[motion.layer] ?? this.layers.body;
    const victims = [];
    for (const l of LAYERS) {
      for (const old of this.layers[l]) {
        if (old.done || old.fadeOutStart !== null) continue;
        if (!motionsConflict(inst, old)) continue;
        if (inst.priority < old.priority) return null;
        victims.push(old);
      }
    }
    for (const v of victims) {
      v.fadeOutFrom = v.weight();
      v.fadeOutStart = v.age;
    }
    list.push(inst);
    this.onEvent?.(motion.name, true);
    return inst;
  }

  find(name) {
    for (const list of Object.values(this.layers)) {
      for (const inst of list) if (inst.name === name && inst.fadeOutStart === null && !inst.done) return inst;
    }
    return null;
  }

  release(name, now = false) { this.find(name)?.release(now); }

  stopAll() {
    for (const list of Object.values(this.layers)) {
      for (const inst of list) {
        if (inst.fadeOutStart === null) {
          inst.fadeOutFrom = inst.weight();
          inst.fadeOutStart = inst.age;
        }
      }
    }
  }

  /** 有没有正在播放（未淡出）的动作；可只看某几层。 */
  busy(layers = LAYERS) {
    return layers.some((l) => this.layers[l].some((i) => !i.done && i.fadeOutStart === null));
  }

  active() {
    return LAYERS.flatMap((l) => this.layers[l].filter((i) => !i.done && i.fadeOutStart === null).map((i) => i.name));
  }

  update(dt, q) {
    for (const l of LAYERS) {
      const list = this.layers[l];
      for (const inst of list) {
        inst.step(dt);
        if (!inst.done) inst.apply(q);
      }
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].done) {
          if (list[i].fadeOutStart === null) this.onEvent?.(list[i].name, false);
          list.splice(i, 1);
        }
      }
    }
  }
}

/** 读取动作库：motions/index.json 列出名字，每个动作一个文件。 */
export async function loadMotions(base = 'motions') {
  const names = await (await fetch(`${base}/index.json`, { cache: 'no-store' })).json();
  const out = {};
  await Promise.all(names.map(async (n) => {
    try {
      const m = await (await fetch(`${base}/${n}.json`, { cache: 'no-store' })).json();
      m.name = n;
      out[n] = m;
    } catch (e) {
      console.error('动作文件读取失败', n, e);
    }
  }));
  return out;
}
