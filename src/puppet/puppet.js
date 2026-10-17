// 2D 骨骼动画（Live2D 式网格变形）引擎：每个图层是一张细分网格，每帧逐顶点计算变形。
// 坐标：图层数据用 PSD 像素坐标（y 向下）；写入 three.js 时取 (x, -y)。
// 每个视角（正面、侧面、背面）的支点、图层分组、变形方式和物理写在各自的 rig-*.js 里，
// 这里只做通用部分：建网格、眼眶遮罩、闭嘴弧线、头部三维转动、弹簧、逐帧更新。
import * as THREE from 'three';
import { drawMouth, mouthShape, MOUTH_BOX } from './mouth.js';
import { drawOverlay, OVERLAY_SCALE, SIDE_MOUTH_SHAPES } from './overlays.js';

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** 口型分档：0 闭 / 0.6 半张 / 1 全张（原图）。 */

export function rotateAround(x, y, cx, cy, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

// 阻尼弹簧：x 是偏移量，平时回到 0；外部运动通过 push() 让它"甩出去"
export class Spring {
  constructor(stiffness = 40, damping = 6) {
    this.k = stiffness;
    this.d = damping;
    this.x = 0;
    this.v = 0;
  }
  push(dx) { this.x += dx; }
  impulse(dv) { this.v += dv; }
  step(dt, target = 0) {
    const a = this.k * (target - this.x) - this.d * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

export const DEFAULT_PARAMS = {
  yaw: 0, pitch: 0, roll: 0,        // 头部转动（弧度，会被限幅）
  lean: 0,                          // 上半身左右倾（弧度）
  breath: 0,                        // 呼吸 -1..1
  blinkL: 0, blinkR: 0,             // 闭眼程度 0..1
  eyeX: 0, eyeY: 0,                 // 眼珠 -1..1
  mouth: 1,                         // 嘴型（见 mouth.js：0 闭嘴笑、0.5 小张嘴、1 原画张嘴笑、2 大张嘴……）
  armL: 0, armR: 0,                 // 上臂绕肩抬起（弧度，正 = 向外向上）
  elbowL: 0, elbowR: 0,             // 前臂绕肘再弯（弧度，正 = 继续往上弯）
  bob: 0,                           // 整体上下（像素，走路颠动用）
  bodyTurn: 0,                      // 上身朝左右扭（-1..1）：衣服、手臂、头一起横移，后发反向错开
  walk: 0,                          // 走路程度 0..1（侧面用）
  walkPhase: 0,                     // 走路相位（弧度，一个周期迈两步）
  happy: 0,                         // 闭眼时眼睛弯成 ^^ 的程度 0..1（配合 blink 使用）
  stretch: 0,                       // 整体纵向伸缩（以脚底为准，+0.04 = 拉长 4%），由 Character 处理
  dangle: 0, dangle2: 0,             // 被拎起时画面左、右两条腿的摆动角（弧度，正面用）
  blush: 0, sweat: 0,                // 脸红、汗滴 0..1（见 overlays.js）
  emote: 0,                         // 头顶符号：0 无 1 ！ 2 ？ 3 ♪ 4 … 5 ♥ 6 zzz
  moveX: 0, moveY: 0,               // 角色在画面上的位置（图层自己的方向，像素）：移动会带动头发、裙摆
};

/**
 * 眨眼时眼睛各部件的变形（正面、侧面共用）。c：闭眼程度 0..1；happy：开心眯眼（^^）程度。
 *
 * 按 Live2D 的通行做法：闭眼线落在下眼睑那条弧线上、宽度和睁眼时一样；
 * 上睫毛保持粗细整体往下盖，眼白和眼眶遮罩的上沿跟着睫毛下沿一起往下收，
 * 眼珠不压扁、只略往下移，被收起来的眼眶遮罩从上往下挡住（像被眼皮盖住）。
 * E.fit：眼睛上沿、下沿按原图实测拟合的二次曲线 y = a·d² + b·d + c（d = x − cx）。
 */
const poly = (q, d) => q[0] * d * d + q[1] * d + q[2];
export function eyeDeform(E, part, c, x, y, happy = 0) {
  if (!c) return y;
  if (part === 'iris') return y + c * 5;
  const F = E.fit;
  const d = clamp(x, F.x0, F.x1) - F.cx;
  const top = poly(F.top, d);
  const h = poly(F.bottom, 0) - poly(F.top, 0);
  // 普通闭眼：下眼睑弧线（‿）；开心眯眼：抬高一些、弯成 ^
  const lid = poly(F.bottom, d) - 3;
  const arch = poly(F.bottom, 0) - 3 - 0.22 * h + 0.012 * d * d;
  const target = lid + (arch - lid) * happy;
  if (part === 'lash') return y + c * (target - top);
  return y + c * (target - y); // 眼白、眼眶遮罩：收向闭眼线
}

export class Puppet {
  /** view：rig-front.js / rig-side.js / rig-back.js 导出的视角配置。 */
  constructor(baseUrl, view, outfit = null) {
    this.outfit = outfit;   // { base, layers: { front: { topwear: "front.png" } } }
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.view = view;
    this.group = new THREE.Group();
    this.layers = [];
    this.params = { ...DEFAULT_PARAMS };
    this.springs = {};
    for (const [k, [stiff, damp]] of Object.entries(view.SPRINGS)) this.springs[k] = new Spring(stiff, damp);
    this.time = 0;
    this.prevHead = null;
    this.prevBody = null;
    this.mirrored = false; // 由 Character 设置：朝右时把侧面图镜像
  }

  async load() {
    const manifest = await (await fetch(`${this.baseUrl}/manifest.json`)).json();
    // 衣柜：同一套骨架，只把指定图层换成这套衣服的图（尺寸/位置必须和原图层一致）
    const overrides = this.outfit?.layers?.[this.view.NAME] ?? null;
    this.size = { w: manifest.width, h: manifest.height };
    const loader = new THREE.TextureLoader();
    let order = 0;
    for (const info of manifest.layers) {
      const cfg = this.view.LAYERS[info.name] ?? { group: 'body', grid: 8 };
      const file = overrides?.[info.name];
      const tex = await loader.loadAsync(file ? `${this.outfit.base}/${file}` : `${this.baseUrl}/${info.file}`);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const nx = Math.max(2, Math.min(cfg.grid, Math.round(info.w / 18)));
      const ny = Math.max(2, Math.min(cfg.grid, Math.round(info.h / 18)));
      this.addGridLayer(info.name, cfg, tex, info, nx, ny, order++);
    }
    if (this.view.MOUTH) this.addMouth();
    this.addOverlays();
    await this.addEyeMasks();
    this.update(0);
    return this;
  }

  addGridLayer(name, cfg, tex, info, nx, ny, renderOrder) {
    const geom = new THREE.BufferGeometry();
    const count = (nx + 1) * (ny + 1);
    const rest = new Float32Array(count * 2);
    const pos = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    let k = 0;
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const v = j / ny;
        rest[k * 2] = info.x + u * info.w;
        rest[k * 2 + 1] = info.y + v * info.h;
        uv[k * 2] = u;
        uv[k * 2 + 1] = 1 - v;
        k++;
      }
    }
    const index = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        const b = a + 1;
        const c = a + nx + 1;
        const d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    }
    geom.setIndex(index);
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    // 眼珠只画在眼眶里：眼眶遮罩（眼白 ∪ 眼珠原位置，见 addEyeMasks）写模板值，眼珠只在模板值相等处绘制
    if (cfg.part === 'iris') {
      Object.assign(mat, {
        stencilWrite: true, stencilRef: cfg.side === 'l' ? 1 : 2,
        stencilFunc: THREE.EqualStencilFunc, stencilZPass: THREE.KeepStencilOp,
      });
    }
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    const layer = { name, cfg, mesh, geom, rest, pos, info, baseOrder: renderOrder };
    this.layers.push(layer);
    return layer;
  }

  /**
   * 眼眶遮罩：See-through 拆出的眼白没有完整铺满眼眶（被眼珠挡住的地方是空的），
   * 直接用眼白裁眼珠会在眼珠移动时切出直边。这里把眼白和眼珠原位置的不透明区域合并成遮罩，
   * 只写模板、不画颜色，跟眼白一起变形（眨眼时一起收拢）。
   */
  async addEyeMasks() {
    for (const side of ['l', 'r']) {
      const white = this.layers.find((l) => l.cfg.part === 'eyewhite' && l.cfg.side === side);
      const iris = this.layers.find((l) => l.cfg.part === 'iris' && l.cfg.side === side);
      if (!white || !iris) continue;
      const a = white.info;
      const b = iris.info;
      const x0 = Math.min(a.x, b.x);
      const y0 = Math.min(a.y, b.y);
      const x1 = Math.max(a.x + a.w, b.x + b.w);
      const y1 = Math.max(a.y + a.h, b.y + b.h);
      const c = document.createElement('canvas');
      c.width = x1 - x0;
      c.height = y1 - y0;
      const g = c.getContext('2d');
      for (const L of [white, iris]) {
        const img = L.mesh.material.map.image;
        g.drawImage(img, L.info.x - x0, L.info.y - y0);
      }
      const tex = new THREE.CanvasTexture(c);
      // 细分一下，让它能跟着眨眼的纵向收拢一起变形
      const nx = 6;
      const ny = 6;
      const r = new Float32Array((nx + 1) * (ny + 1) * 2);
      const uv = new Float32Array((nx + 1) * (ny + 1) * 2);
      let k = 0;
      for (let j = 0; j <= ny; j++) {
        for (let i = 0; i <= nx; i++) {
          r[k * 2] = x0 + (i / nx) * (x1 - x0);
          r[k * 2 + 1] = y0 + (j / ny) * (y1 - y0);
          uv[k * 2] = i / nx;
          uv[k * 2 + 1] = 1 - j / ny;
          k++;
        }
      }
      const index = [];
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const p0 = j * (nx + 1) + i;
          index.push(p0, p0 + nx + 1, p0 + 1, p0 + 1, p0 + nx + 1, p0 + nx + 2);
        }
      }
      const geom = new THREE.BufferGeometry();
      const pos = new Float32Array(r.length / 2 * 3);
      geom.setIndex(index);
      geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthTest: false, depthWrite: false, colorWrite: false, alphaTest: 0.35,
        stencilWrite: true, stencilRef: side === 'l' ? 1 : 2,
        stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.renderOrder = iris.mesh.renderOrder - 0.5;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.layers.push({ name: `eyemask-${side}`, cfg: { ...white.cfg, grid: 6 }, mesh, geom, rest: r, pos });
    }
  }

  /**
   * 程序画的嘴型（见 mouth.js）：一块跟着头变形的小画布，盖在原画的嘴上。
   * 嘴型选"张嘴笑（原画）"时显示原图层，其他嘴型时隐藏原图层、显示画布。
   */
  addMouth() {
    const M = this.view.MOUTH;
    const B = MOUTH_BOX;
    const canvas = document.createElement('canvas');
    canvas.width = B.w * B.scale;
    canvas.height = B.h * B.scale;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const info = { x: M.cx + B.left, y: M.top + B.top, w: B.w, h: B.h };
    const mouthLayer = this.layers.find((l) => l.cfg.part === 'mouth');
    const layer = this.addGridLayer('mouth-shape', { group: 'head', depth: 1.02, part: 'mouth-shape' }, tex, info, 4, 4,
      mouthLayer ? mouthLayer.mesh.renderOrder + 0.5 : 100);
    this.mouth = { layer, canvas, tex, original: mouthLayer, shape: null };
  }

  /** 表情小件（脸红、汗滴、头顶符号）：视角配置 OVERLAYS 里声明的每一项做成一块小画布图层，画在最上面。 */
  addOverlays() {
    this.overlays = [];
    for (const [i, o] of (this.view.OVERLAYS ?? []).entries()) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(o.rect.w * OVERLAY_SCALE);
      canvas.height = Math.ceil(o.rect.h * OVERLAY_SCALE);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const layer = this.addGridLayer(o.name, o.cfg, tex, o.rect, 3, 3, 900 + i);
      layer.mesh.visible = false;
      if (o.kind === 'blush' || o.kind === 'sweat') drawOverlay(canvas, o.kind, o.rect);
      this.overlays.push({ ...o, layer, canvas, tex, drawn: null });
    }
  }

  updateOverlays(p) {
    for (const o of this.overlays) {
      const v = p[o.param] ?? 0;
      const mesh = o.layer.mesh;
      if (o.kind === 'mouthSide') {
        const id = mouthShape(v).id;
        mesh.visible = SIDE_MOUTH_SHAPES.includes(id);
        if (mesh.visible && id !== o.drawn) {
          drawOverlay(o.canvas, 'mouthSide', o.rect, id);
          o.tex.needsUpdate = true;
          o.drawn = id;
        }
      } else if (o.kind === 'emote') {
        const id = Math.round(v);
        mesh.visible = id > 0;
        if (id > 0 && id !== o.drawn) {
          drawOverlay(o.canvas, 'emote', o.rect, id);
          o.tex.needsUpdate = true;
          o.drawn = id;
        }
      } else {
        mesh.visible = v > 0.01;
        mesh.material.opacity = Math.min(1, v);
      }
    }
  }

  /** 按参数 mouth 切换嘴型（逐格切换，不做中间过渡）。 */
  updateMouth(v) {
    const m = this.mouth;
    const id = mouthShape(v).id;
    const useOriginal = id === 'open' && m.original;
    if (m.original) m.original.mesh.visible = useOriginal;
    m.layer.mesh.visible = !useOriginal;
    if (!useOriginal && id !== m.shape) {
      drawMouth(m.canvas, id);
      m.tex.needsUpdate = true;
    }
    m.shape = useOriginal ? null : id;
  }

  /** 头部在三维中的旋转：按椭球估计每个点的前后深度，再绕头心转动。 */
  headTransform(x, y, depth, p) {
    const H = this.view.HEAD;
    const NECK = this.view.NECK;
    const u = (x - H.cx) / H.rx;
    const v = (y - H.cy) / H.ry;
    const s = 1 - u * u - v * v;
    let z;
    const q = Math.sqrt(Math.max(s, 0));
    if (depth > 0) z = H.rz * (q * 0.9 + 0.1) * depth;          // 脸、五官、刘海：在头的前表面
    else if (depth <= -1) z = -H.rz * (q * 0.8 + 0.2);         // 后发：在头的后面
    else if (depth < 0) z = depth * H.rz * (q * 0.5 + 0.5);    // 耳朵等：头侧偏后
    else z = H.rz * 0.05;
    const cy = Math.cos(p.yaw);
    const sy = Math.sin(p.yaw);
    let nx = H.cx + (x - H.cx) * cy + z * sy;
    const nz = -(x - H.cx) * sy + z * cy;
    // 抬头低头绕"头心和脖子之间"的点转，比绕头心转更像真实的点头
    const pivotY = (H.cy + NECK.y) / 2;
    const cp = Math.cos(p.pitch);
    const sp = Math.sin(p.pitch);
    let ny = pivotY + (y - pivotY) * cp - nz * sp;
    // 歪头：绕脖子转
    const cr = Math.cos(p.roll);
    const sr = Math.sin(p.roll);
    const dx = nx - NECK.x;
    const dy = ny - NECK.y;
    nx = NECK.x + dx * cr - dy * sr;
    ny = NECK.y + dx * sr + dy * cr;
    return [nx, ny];
  }

  rotateAround(x, y, cx, cy, a) { return rotateAround(x, y, cx, cy, a); }

  update(dt) {
    this.time += dt;
    const p = { ...this.params };
    const LIM = this.view.LIMITS;
    p.yaw = clamp(p.yaw, -LIM.yaw, LIM.yaw);
    p.pitch = clamp(p.pitch, -LIM.pitch, LIM.pitch);
    p.roll = clamp(p.roll, -LIM.roll, LIM.roll);
    this.stepPhysics(dt, p);
    const view = this.view;

    for (const L of this.layers) {
      const { cfg, rest, pos } = L;
      // 手臂抬高到头边时要画在头发上面，否则会钻到头发后面看不见
      if (cfg.raise) {
        const up = cfg.raise.some((r) => Math.abs(p[r.param]) > r.above);
        L.mesh.renderOrder = up ? L.baseOrder + 1000 : L.baseOrder;
      }
      if (cfg.hideWhenMirrored) L.mesh.visible = !this.mirrored;
      if (cfg.onlyWhenMirrored) L.mesh.visible = this.mirrored;
      const n = rest.length / 2;
      for (let i = 0; i < n; i++) {
        let x = rest[i * 2];
        let y = rest[i * 2 + 1];
        [x, y] = view.deform(this, cfg, x, y, p);
        pos[i * 3] = x;
        pos[i * 3 + 1] = -y;
        pos[i * 3 + 2] = 0;
      }
      L.geom.attributes.position.needsUpdate = true;
    }
    if (this.mouth) this.updateMouth(p.mouth);
    this.updateOverlays(p);
  }

  /** 物理：头和身体的运动让头发、耳朵、衣摆、尾巴甩出去，再由弹簧拉回。具体怎么甩由视角配置决定。 */
  stepPhysics(dt, p) {
    if (dt <= 0) return;
    // 角色整体移动（走路、被拎着晃）也算进去，打个折，免得甩得太猛
    const mx = (p.moveX ?? 0) * 0.3;
    const my = (p.moveY ?? 0) * 0.3;
    const head = { x: p.yaw * 180 + p.roll * 300 + p.lean * 400 + mx, y: p.pitch * 150 + p.bob + my };
    const body = { x: p.lean * 350 + mx, y: p.bob + my };
    let d = null;
    if (this.prevHead) {
      d = { dhx: head.x - this.prevHead.x, dbx: body.x - this.prevBody.x, dby: body.y - this.prevBody.y };
    }
    this.prevHead = head;
    this.prevBody = body;
    this.view.physics(this.springs, d, this.time, Math.min(dt, 1 / 30), p);
  }

  /** 转身的余势：dir = +1 / -1 表示画面上的旋转方向，k 为力度。各视角自己决定哪些部件被甩出去。 */
  kick(dir, k = 1) {
    this.view.kick?.(this.springs, dir, k);
  }

  /** 切换视角后调用：清掉上一帧的位置，避免把切换当成一次猛烈运动。 */
  resetMotion() {
    this.prevHead = null;
    this.prevBody = null;
  }
}
