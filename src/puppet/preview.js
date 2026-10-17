// 2D 动画预览页：待机、转身、走路、动作、自由活动、拎起、摸头。
// URL 参数：?ui=0&auto=0&bg=dark&facing=left&walk=1&free=1
// 操作：← → 转向并走路，↑ 背面，↓ 正面，空格停下；按住人物拖动 = 拎起来；在头上来回划 = 摸头。
import * as THREE from 'three';
import { DEFAULT_PARAMS } from './puppet.js';
import { Idle } from './idle.js';
import { Character } from './character.js';
import { Behavior } from './behavior.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, stencil: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);
if (params.get('bg') === 'dark') document.body.classList.add('dark');

const scene = new THREE.Scene();
// 取景：以人物站立位置为中心，高 1520（PSD 像素）；宽度随窗口比例，人物可以在里面走来走去
const VIEW = { cx: 770, cy: 770, h: 1520 };
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
const character = await new Character('rig').load();
scene.add(character.group);
const behavior = new Behavior(character);
function resize() {
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  const aspect = canvas.clientWidth / canvas.clientHeight;
  const h = VIEW.h;
  const w = h * aspect;
  camera.left = VIEW.cx - w / 2;
  camera.right = VIEW.cx + w / 2;
  camera.top = -VIEW.cy + h / 2;
  camera.bottom = -VIEW.cy - h / 2;
  camera.updateProjectionMatrix();
  // 人物半宽约 350：走到离画面边缘这么远就掉头
  const half = Math.max(0, w / 2 - 380);
  behavior.bounds = { min: -half, max: half };
}
window.addEventListener('resize', resize);
resize();

const puppet = character; // 滑块和自动化接口直接改角色参数
const idle = new Idle(character);
idle.enabled = params.get('auto') !== '0';

/** 屏幕坐标 → three.js 世界坐标。 */
function toWorld(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: camera.left + ((e.clientX - r.left) / r.width) * (camera.right - camera.left),
    y: camera.top - ((e.clientY - r.top) / r.height) * (camera.top - camera.bottom),
  };
}
/** 鼠标位置 → 相对人物的 PSD 坐标（正面图坐标系，y 向下）。 */
function toCharacter(e) {
  const w = toWorld(e);
  return { x: w.x - character.x, y: -(w.y - character.height) };
}
const CX = 765; // 正面身体中线
const onBody = (c) => Math.abs(c.x - CX) < 300 && c.y > 60 && c.y < 1490;
const onHead = (c) => Math.abs(c.x - CX) < 260 && c.y > 60 && c.y < 520;

// ---- 拎起：按住人物拖动；只点一下给个反应
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  const c = toCharacter(e);
  if (!onBody(c)) return;
  canvas.setPointerCapture(e.pointerId);
  drag = { gx: c.x, gy: c.y, sx: e.clientX, sy: e.clientY, moved: false };
  behavior.wake();
});
canvas.addEventListener('pointerup', () => {
  if (drag?.moved) character.endLift();
  else if (drag) character.play(Math.random() < 0.5 ? 'hop' : 'tilt');
  drag = null;
});

// ---- 摸头：在头上来回划动
const rub = { dist: 0, lastX: null, dir: 0, flips: 0, t: 0 };
window.addEventListener('pointermove', (e) => {
  behavior.poke();
  const c = toCharacter(e);
  // 眼睛和头看向鼠标：以脸的位置为中心归一化
  idle.setLookTarget((c.x - CX) / 700, (c.y - 430) / 700 - 0.45);
  if (drag) {
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) {
      drag.moved = true;
      character.beginLift();
    }
    if (drag.moved) {
      // 抓住的那一点跟着鼠标走；离地高度 = 抓点被抬高了多少
      const w = toWorld(e);
      character.moveLift(w.x - drag.gx, w.y + drag.gy);
    }
    return;
  }
  if (onHead(c) && character.facing === 'front') {
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

// ---- 手动滑块
const SLIDERS = [
  ['yaw', -0.25, 0.25], ['pitch', -0.16, 0.16], ['roll', -0.14, 0.14], ['lean', -0.08, 0.08],
  ['blinkL', 0, 1], ['blinkR', 0, 1], ['eyeX', -1, 1], ['eyeY', -1, 1], ['mouth', 0, 7],
  ['armL', -0.5, 2.6], ['armR', -0.5, 2.6], ['breath', -1, 1], ['happy', 0, 1],
];
const box = document.getElementById('sliders');
for (const [name, min, max] of SLIDERS) {
  const label = document.createElement('label');
  label.innerHTML = `<span>${name}</span><input type="range" min="${min}" max="${max}" step="0.001" value="${DEFAULT_PARAMS[name]}">`;
  const input = label.querySelector('input');
  input.addEventListener('input', () => {
    document.getElementById('auto').checked = false;
    idle.enabled = false;
    puppet.params[name] = Number(input.value);
  });
  box.appendChild(label);
}

const facingSel = document.getElementById('facing');
const walkBox = document.getElementById('walk');
const freeBox = document.getElementById('free');

// ---- 动作按钮（来自动作库 public/motions；可以同时点几个不同层的动作叠加）
const actBox = document.getElementById('actions');
for (const [name, def] of Object.entries(character.motions)) {
  const b = document.createElement('button');
  b.textContent = def.label ?? name;
  b.title = `${name}（${def.layer} 层）`;
  b.addEventListener('click', () => {
    behavior.wake();
    character.play(name);
    walkBox.checked = character.walking;
  });
  actBox.appendChild(b);
}

document.getElementById('auto').addEventListener('change', (e) => { idle.enabled = e.target.checked; });
document.getElementById('talk').addEventListener('change', (e) => { idle.talking = e.target.checked; });
freeBox.addEventListener('change', () => { behavior.enabled = freeBox.checked; behavior.timer = 0.5; });
facingSel.addEventListener('change', () => character.setFacing(facingSel.value));
walkBox.addEventListener('change', () => {
  character.walking = walkBox.checked;
  // 只有侧面能走路：在正面或背面勾选时先转向左边
  if (walkBox.checked && (character.facing === 'front' || character.facing === 'back')) {
    character.setFacing('left');
    facingSel.value = 'left';
  }
});
character.onFacing = (f) => { facingSel.value = f; walkBox.checked = character.walking; };
if (params.get('facing')) { character.setFacing(params.get('facing')); facingSel.value = params.get('facing'); }
if (params.get('walk') === '1') { character.walking = true; walkBox.checked = true; }
if (params.get('free') === '1') { behavior.enabled = true; freeBox.checked = true; }
// 键盘：← → 转向并走路，↑ 背面，↓ 正面，空格停下
window.addEventListener('keydown', (e) => {
  behavior.wake();
  const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'back', ArrowDown: 'front' };
  if (map[e.key]) {
    character.setFacing(map[e.key]);
    character.walking = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
    walkBox.checked = character.walking;
  } else if (e.key === ' ') {
    character.walking = false;
    walkBox.checked = false;
  }
});
document.getElementById('auto').checked = idle.enabled;
if (params.get('ui') === '0') document.getElementById('ui').classList.add('hidden');

function tick(dt) {
  idle.update(dt);
  behavior.update(dt);
  character.update(dt);
}
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  tick(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 供自动化检查：设置参数并推进若干帧（不依赖 requestAnimationFrame）
window.puppetApi = {
  puppet, character, idle, behavior, renderer,
  set(p) { Object.assign(puppet.params, p); },
  step(seconds = 0, fps = 60) {
    const n = Math.max(1, Math.round(seconds * fps));
    for (let i = 0; i < n; i++) tick(1 / fps);
    renderer.render(scene, camera);
  },
};
window.__ready = true;
