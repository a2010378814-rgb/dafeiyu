// 桌宠窗口的渲染进程。

// 桌宠窗口的渲染进程。
//
// 窗口只比人物略大（罗丽丝、Shimeji 都是这样）：人物在窗口里固定不动，她在"世界"里的位置
// （character.x 横向偏移、character.height 离地高度，单位是 PSD 像素）换算成屏幕上的窗口位置，
// 走路、被拖、掉落时移动的是窗口。地面 = 所在屏幕工作区的底边（任务栏顶上）。
// 窗口透明处鼠标点击会穿透：鼠标移动时读取鼠标下的像素，落在人物身上才接收点击。
// 主进程接口见 electron/preload.cjs（window.pet）；在普通浏览器里打开时用一个空接口代替，便于调试。
import * as THREE from 'three';
import { Character } from '../puppet/character.js';
import { Idle } from '../puppet/idle.js';
import { Behavior } from '../puppet/behavior.js';

const pet = window.pet ?? {
  getInfo: async () => ({
    bounds: { x: 0, y: 0, width: innerWidth, height: innerHeight },
    display: { id: 0, bounds: { x: 0, y: 0, width: innerWidth, height: innerHeight }, workArea: { x: 0, y: 0, width: innerWidth, height: innerHeight }, scaleFactor: 1 },
    displays: [], settings: {}, dev: true,
  }),
  displayNear: async () => null,
  desktopIcons: async () => null,
  setBounds() {}, setIgnoreMouse() {}, saveSettings() {}, setMotions() {}, setState() {}, showMenu() {}, onCommand() {},
};
const inElectron = !!window.pet;

// ---- 画面范围（PSD 像素）：人物加上头发、尾巴、手臂、跳起来的空间
const CX = 765;          // 身体中线
const FOOT_Y = 1490;     // 脚底
const FRAME = { x0: 250, x1: 1290, y0: -140, y1: 1530 };
const FW = FRAME.x1 - FRAME.x0;
const FH = FRAME.y1 - FRAME.y0;
const BASE_HEIGHT = 240; // 100% 大小时人物（PSD 约 1450 高）在屏幕上的高度（逻辑像素）；用户觉得 300 偏大
const EDGE = 380;        // 走到离屏幕边缘这么远（PSD 像素）就掉头

const canvas = document.getElementById('c');
// 不保留画面缓冲（保留会让浏览器每帧多复制一次画面）；判断鼠标下的像素放在每帧刚画完时做
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, stencil: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(FRAME.x0, FRAME.x1, -FRAME.y0, -FRAME.y1, -10, 10);

const info = await pet.getInfo();
const settings = { scale: 1, free: true, talking: false, ...info.settings };
let display = info.display;
let s = 1;               // 屏幕逻辑像素 / PSD 像素
let anchorX = 0;         // character.x = 0 时身体中线在屏幕上的 x
let win = { x: 0, y: 0, w: 0, h: 0 };

const character = await new Character('rig').load();

// 衣柜：outfits/index.json 列出所有款，每款一个 outfit.json（只覆盖换掉的图层）
async function loadOutfits() {
  try {
    const names = await (await fetch('outfits/index.json')).json();
    const list = [];
    for (const name of names) {
      try {
        const o = await (await fetch(`outfits/${name}/outfit.json`)).json();
        list.push({ name, label: o.label ?? name });
      } catch { list.push({ name, label: name }); }
    }
    return list;
  } catch { return []; }
}
const outfits = await loadOutfits();
if (settings.outfit) await character.setOutfit(settings.outfit).catch(() => {});
pet.setOutfits?.([{ name: '', label: '默认外观' }, ...outfits]);
scene.add(character.group);
const idle = new Idle(character);
const behavior = new Behavior(character);
behavior.enabled = settings.free;
idle.talking = settings.talking;

const groundY = () => display.workArea.y + display.workArea.height;
const baseGround = groundY;

// ---- 桌面图标当台面
// 只读：主进程每 1.5 秒推一次图标矩形（屏幕坐标，已换算成 DIP）。
// 她把这些图标当"台子"：小台阶直接迈，高一点的顺着边缘爬，踩空就按自己的重力掉下来。
// 图标站台：先归档关掉。原因是图标都排在屏幕上半部，REACH 只够到最下面那一排，
// 站上去这件事本身没错，但要支持更高就得做"爬到任意高度"，那是下一步的事。
const ICON_PLATFORMS = false;
const REACH = 340;        // 能爬上去的最大高度差（屏幕像素）
const STEP_UP = 12;       // 这么小的落差直接迈上去，不用爬
const CLIMB_SPEED = 135;  // 爬升速度（屏幕像素/秒）
let iconRects = [];
let groundScreen = groundY(); // 当前脚下那块台面的屏幕 y
let mode = "ground";          // ground | climb | fall
let climbTarget = 0;          // 正在爬的那块台面顶边
let climbX = 0;               // 爬的时候锁住的 x（PSD 单位）
let climbPhase = 0;           // 手脚交替的相位
let climbArc = 0;             // 到顶/落地时轻轻一弹

/** 某个屏幕 x 处，容得下她的最高台面（图标顶边或工作区底边）。 */
function surfaceAt(sx) {
  const base = baseGround();
  let y = base;
  for (const r of iconRects) {
    if (sx < r.x || sx > r.x + r.w) continue;
    if (base - r.y > REACH) continue; // 太高，够不着
    if (r.y < y) y = r.y;
  }
  return y;
}

/** 她脚底在屏幕上的 y。 */
const feetY = () => groundScreen - character.height * s;

/** 前面是不是一堵"墙"（脚下的台面比现在高，且高过 STEP_UP）。 */
function wallAhead(sx, feet) {
  let best = null;
  for (const r of iconRects) {
    if (sx < r.x - 1 || sx > r.x + r.w + 1) continue;
    const rise = feet - r.y;
    if (rise < STEP_UP || rise > REACH) continue;
    if (!best || r.y > best.y) best = r;
  }
  return best;
}

/** 走 / 爬 / 掉三种状态。位置由 character.x 与 character.height 决定，重力在 character.js 里。 */
function updateMove(dt) {
  if (!ICON_PLATFORMS) return;
  if (character.lifted) {
    character.frozen = false;
    return;              // 被拎着的时候不踩台面，放开再算
  }
  const feet = feetY();

  if (mode === "climb") {
    character.frozen = true;   // 爬的时候关掉重力，由这里控制高度
    character.walking = false;
    character.x = climbX;
    climbPhase += dt * 7.5;
    character.height += (CLIMB_SPEED / s) * dt;
    if (feetY() <= climbTarget) {   // 扒到顶了
      groundScreen = climbTarget;
      character.height = 0;
      character.vy = 0;
      climbArc = 12;
      mode = "ground";
    }
    climbArc *= Math.exp(-6 * dt);
    return;
  }

  if (mode === "fall") {
    character.frozen = false;
    if (character.height <= 0) {    // character.js 里已经落地并给了压扁
      character.height = 0;
      character.vy = 0;
      mode = "ground";
      climbArc = 0;
    }
    return;
  }

  const target = surfaceAt(screenCenterX());
  if (target < groundScreen - 0.5) {
    const rise = groundScreen - target;
    if (rise <= STEP_UP) {
      groundScreen = target;        // 小台阶：直接迈上去
    } else if (wallAhead(screenCenterX(), feet)) {
      mode = "climb";               // 前面是墙：爬
      climbTarget = target;
      climbX = character.x;
      character.walking = false;
      character.vy = 0;
    }
  } else if (target > groundScreen + 0.5) {
    // 踩空：地面变低，落差变成离地高度，之后交给角色自己的重力
    character.height += (target - groundScreen) / s;
    groundScreen = target;
    mode = "fall";
  }
  climbArc *= Math.exp(-6 * dt);
  if (climbArc < 0.2) climbArc = 0;
}


async function pollIcons() {
  if (!ICON_PLATFORMS) return;
  try {
    const data = await pet.desktopIcons?.();
    if (data?.ok && Array.isArray(data.icons)) iconRects = data.icons;
  } catch {
    // 拿不到就当没有图标，桌宠照常在地面上走
  }
}

/** 人物身体中线在屏幕上的 x。 */
const screenCenterX = () => anchorX + character.x * s;

function updateBounds() {
  const wa = display.workArea;
  behavior.bounds = { min: (wa.x - anchorX) / s + EDGE, max: (wa.x + wa.width - anchorX) / s - EDGE };
}

/** 设定大小档位：保持脚底中点在屏幕上的位置不变。 */
function applyScale(scale) {
  const keepX = win.w ? screenCenterX() : null;
  settings.scale = scale;
  s = (BASE_HEIGHT * scale) / 1450;
  win.w = Math.round(FW * s);
  win.h = Math.round(FH * s);
  renderer.setSize(win.w, win.h, false);
  canvas.style.width = `${win.w}px`;
  canvas.style.height = `${win.h}px`;
  if (keepX !== null) {
    anchorX = keepX;
    character.x = 0;
    character.prevPos.x = 0;
  }
  updateBounds();
}

/** 回到当前屏幕底部某个位置（默认右侧）。 */
function placeAt(x) {
  anchorX = x;
  character.x = 0;
  character.prevPos.x = 0;
  character.height = 0;
  updateBounds();
}

// ---- 初始位置：上次保存的位置（还在某块屏幕上的话），否则主屏幕右下角
applyScale(settings.scale);
if (Number.isFinite(settings.x)) {
  const d = await pet.displayNear(settings.x, groundY());
  if (d) display = d;
  placeAt(Math.min(Math.max(settings.x, display.workArea.x + 150 * s), display.workArea.x + display.workArea.width - 150 * s));
} else {
  placeAt(display.workArea.x + display.workArea.width - 40 - (CX - FRAME.x0) * s);
}

/** 每帧：按人物的世界位置算出窗口位置；窗口位置取整，取整误差反向补到相机上，人物不会抖。 */
function layout() {
  const idealX = screenCenterX() - (CX - FRAME.x0) * s;
  const idealY = groundScreen - (FOOT_Y - FRAME.y0) * s - character.height * s - climbArc;
  const x = Math.round(idealX);
  const y = Math.round(idealY);
  if (x !== win.x || y !== win.y) {
    win.x = x;
    win.y = y;
    pet.setBounds(x, y, win.w, win.h);
  }
  const ox = (x - idealX) / s;
  const oy = (y - idealY) / s;
  camera.left = FRAME.x0 + character.x + ox;
  camera.right = FRAME.x1 + character.x + ox;
  camera.top = -FRAME.y0 + character.height - oy;
  camera.bottom = -FRAME.y1 + character.height - oy;
  camera.updateProjectionMatrix();
}

// ---- 鼠标：点击穿透、拖动、摸头、点一下、右键菜单
const pixel = new Uint8Array(4);
let ignoring = true;
function setIgnore(v) {
  if (v !== ignoring) {
    ignoring = v;
    pet.setIgnoreMouse(v);
  }
}
/**
 * 鼠标下是不是人物：每帧刚画完时读鼠标所在那个像素的透明度（画面缓冲不保留，只能在刚画完时读）。
 * 鼠标移动只记下位置，结果在下一帧更新；overChar 是最近一次的结果。
 */
let mouse = null;
let overChar = false;
function sampleHit() {
  if (!mouse) return;
  const gl = renderer.getContext();
  const dpr = renderer.getPixelRatio();
  const px = Math.floor(mouse.x * dpr);
  const py = Math.floor((win.h - mouse.y) * dpr);
  overChar = px >= 0 && py >= 0 && px < win.w * dpr && py < win.h * dpr
    && (gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel), pixel[3] > 40);
  if (!drag) setIgnore(!overChar);
}
const hit = () => overChar;
/** 窗口内坐标 → 人物自己的 PSD 坐标（正面图坐标系；相机跟着人物，所以和人物的世界位置无关）。 */
const toPsd = (x, y) => ({ x: FRAME.x0 + x / s, y: FRAME.y0 + y / s });

let drag = null;
const rub = { dist: 0, lastX: null, dir: 0, flips: 0, t: 0 };
window.addEventListener('mousemove', (e) => {
  mouse = { x: e.offsetX, y: e.offsetY };
  if (drag) return;
  if (!overChar) {
    rub.lastX = null;
    return;
  }
  behavior.poke();
  // 在头上来回划：摸头
  const c = toPsd(e.offsetX, e.offsetY);
  if (c.y < 520 && character.facing === 'front') {
    if (rub.lastX !== null) {
      const dx = c.x - rub.lastX;
      rub.dist += Math.abs(dx);
      const d = Math.sign(dx);
      if (d && d !== rub.dir) { rub.flips++; rub.dir = d; }
    }
    rub.lastX = c.x;
    rub.t = performance.now();
    if (rub.dist > 500 && rub.flips >= 2) {
      character.play('pet');
      rub.dist = 0;
      rub.flips = 0;
    }
  } else {
    rub.lastX = null;
  }
});
setInterval(() => { if (performance.now() - rub.t > 800) { rub.dist = 0; rub.flips = 0; } }, 400);
window.addEventListener('mouseleave', () => {
  mouse = null;
  overChar = false;
  if (!drag) setIgnore(true);
});

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !hit()) return;
  canvas.setPointerCapture(e.pointerId);
  const g = toPsd(e.offsetX, e.offsetY);
  // 抓住的点：在身体中线右边多少、脚底以上多少（PSD 像素）
  drag = { gx: g.x - CX, gy: FOOT_Y - g.y, sx: e.screenX, sy: e.screenY, moved: false };
  behavior.wake();
  setIgnore(false);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.screenX - drag.sx, e.screenY - drag.sy) > 5) {
    drag.moved = true;
    character.beginLift();
  }
  if (drag.moved) {
    // 抓点跟着鼠标：身体中线 = 鼠标 x − 抓点偏移；离地高度 = 鼠标离地面多高 − 抓点离脚底多高
    const x = (e.screenX - anchorX) / s - drag.gx;
    const height = (groundScreen - e.screenY) / s - drag.gy;
    character.moveLift(x, height);
  }
});
canvas.addEventListener('pointerup', async (e) => {
  if (!drag) return;
  const wasDrag = drag.moved;
  drag = null;
  if (wasDrag) {
    character.endLift();
    // 拖到别的屏幕上：换成那块屏幕的地面，从当前高度掉下去
    const d = await pet.displayNear(screenCenterX(), e.screenY);
    if (d && d.id !== display.id) {
      const feetY = groundScreen - character.height * s;
      display = d;
      groundScreen = baseGround();
      character.height = Math.max(0, (groundY() - feetY) / s);
      updateBounds();
    }
    saveSoon();
  } else {
    // 点一下：给个明显的反应（开心跳为主，偶尔挥手、歪头）
    const r = Math.random();
    character.play(r < 0.6 ? 'hop' : r < 0.85 ? 'wave' : 'tilt');
  }
});
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  pet.showMenu();
});

// ---- 菜单命令
function syncState() {
  pet.setState({ free: behavior.enabled, scale: settings.scale, talking: idle.talking });
}
let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    settings.x = screenCenterX();
    settings.free = behavior.enabled;
    settings.talking = idle.talking;
    pet.saveSettings(settings);
  }, 1000);
}
pet.onCommand(async (cmd) => {
  behavior.wake();
  switch (cmd.type) {
    case 'play': character.play(cmd.name); break;
    case 'free': behavior.enabled = cmd.on; behavior.timer = 0.5; break;
    case 'talk': idle.talking = cmd.on; break;
    case 'scale': applyScale(cmd.value); break;
    case 'outfit':
      await character.setOutfit(cmd.name || null).catch(() => {});
      settings.outfit = cmd.name || '';
      break;
    case 'facing': character.walking = false; character.setFacing(cmd.value); break;
    case 'home': placeAt(display.workArea.x + display.workArea.width / 2); break;
    case 'displays-changed': {
      const d = await pet.displayNear(screenCenterX(), groundY() - 10);
      if (d) display = d;
      const wa = display.workArea;
      // 屏幕变小后人物可能在外面了：拉回来
      const cx = Math.min(Math.max(screenCenterX(), wa.x + 150 * s), wa.x + wa.width - 150 * s);
      placeAt(cx);
      break;
    }
    default: break;
  }
  syncState();
  saveSoon();
});
pet.setMotions(Object.entries(character.motions).map(([name, m]) => ({ name, label: m.label ?? name })));
syncState();

// ---- 眼睛跟着鼠标：桌宠里每 0.1 秒问主进程要全局鼠标位置（鼠标不在窗口上也能跟）；普通浏览器里只用窗口内的鼠标
const lookAt = (localX, localY) => idle.setLookTarget((localX - CX) / 700, (localY - 430) / 700 - 0.45);
if (pet.getCursor) {
  setInterval(async () => {
    const p = await pet.getCursor();
    if (p) lookAt(FRAME.x0 + (p.x - win.x) / s, FRAME.y0 + (p.y - win.y) / s);
  }, 100);
} else {
  window.addEventListener('mousemove', (e) => {
    const c = toPsd(e.offsetX, e.offsetY);
    lookAt(c.x, c.y);
  });
}

// ---- 桌面图标：启动时拉一次，之后每 1.5 秒拉一次（主进程那边是常驻读取器）
if (ICON_PLATFORMS && pet.desktopIcons) {
  pollIcons();
  setInterval(pollIcons, 1500);
}

// ---- 主循环：按状态分档定帧率（实测 240Hz 屏幕上待机 30 帧占单核约 17%，20 帧约 8%）：
// 拖动 60 帧（跟手）；走路、做动作、转身 40 帧；眨眼或转头时 30 帧；只是呼吸、头发轻飘 20 帧。
// 不用 requestAnimationFrame：它按显示器刷新率回调（240Hz 的屏幕每秒 240 次），即使跳过不画，
// 浏览器和显卡进程也会跟着每秒醒 240 次，实测待机就占单核二十多个百分点。改成按目标帧率自己定时。
const fps = { drag: 60, active: 40, lively: 30, idle: 20 };
let last = performance.now();
let wasWalking = false;
function frame() {
  const now = performance.now();
  const step = Math.min((now - last) / 1000, 0.05);
  last = now;
  idle.update(step);
  behavior.update(step);
  character.update(step);
  updateMove(step);
  layout();
  renderer.render(scene, camera);
  sampleHit();
  // 走路停下后记住位置
  if (wasWalking && !character.walking) saveSoon();
  wasWalking = character.walking;
  const active = character.walking || character.lifted || character.height > 0 || !character.settled
    || character.busy;
  const lively = idle.blink.state !== 'wait'
    || Math.abs(idle.head.yaw.v) + Math.abs(idle.head.pitch.v) > 0.05;
  const target = 1000 / (drag ? fps.drag : active ? fps.active : lively ? fps.lively : fps.idle);
  setTimeout(frame, Math.max(1, target - (performance.now() - now)));
}
frame();

// 供自动化检查
window.petApi = {
  character, idle, behavior, renderer, fps, inElectron,
  get win() { return win; },
  get scale() { return s; },
  get icons() { return iconRects; },
  get ground() { return groundScreen; },
  get mode() { return mode; },
  get feet() { return feetY(); },
  surfaceAt,
};
window.__ready = true;
