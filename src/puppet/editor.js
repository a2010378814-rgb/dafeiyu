import * as THREE from 'three';
import { Character } from './character.js';
import { Idle } from './idle.js';
import {
  EASES, EASE_LABELS, PARAM_INFO, LAYERS, LAYER_LABELS, MODES,
  sampleTrack, easeFn, applyMotionAt, loadMotions,
} from './motion.js';

// 关键帧动作编辑器（motion-editor.html）：左边实时预览角色，底下时间轴和曲线，右边属性面板。
// 动作数据格式见 motion.js 开头的说明；保存走开发服务器的 POST /__motions/save（见 vite.config.js）。
// 初版由 G老师（Codex）编写，Claude 对接接口。编辑器不在动作数据上附加选中状态、关键帧 ID 等临时字段。

const $ = (selector) => document.querySelector(selector);
const clone = (value) => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const namePattern = /^[a-z0-9_-]{1,40}$/;
const LEFT = 190;
const ROW = 34;
const RULER = 34;
const END_PAD = 15;
const VIEW = { cx: 770, cy: 770, h: 1520 };

function enumValues(value) {
  if (Array.isArray(value)) {
    return value.map((item) => typeof item === 'string' ? item : item.value ?? item.name);
  }
  return Object.keys(value || {});
}
const layers = enumValues(LAYERS);
const modes = enumValues(MODES);
const eases = [...new Set([...enumValues(EASES), ...Object.keys(EASE_LABELS || {})])];

function options(values, selected, labels = {}) {
  return values.map((value) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(labels[value] ?? value)}</option>`).join('');
}

/* 数据适配只读取原轨道，不把规范化后的对象写回动作。 */
function tracksOf(value = motion) {
  const tracks = value?.tracks || {};
  if (Array.isArray(tracks)) {
    return tracks.map((track, index) => ({
      id: String(index), param: track.param ?? track.parameter ?? track.name,
      track, keys: keysOf(track),
    }));
  }
  return Object.entries(tracks).map(([param, track]) => ({
    id: param, param, track, keys: keysOf(track),
  }));
}
function keysOf(track) {
  return Array.isArray(track) ? track : track?.keys ?? track?.keyframes ?? track?.frames ?? [];
}
function modeOf(track) {
  return track?.mode || 'add';
}
function infoOf(param) {
  const info = PARAM_INFO[param] || {};
  return {
    label: info.label || param,
    min: finite(info.min, -1),
    max: finite(info.max, 1),
  };
}
function loopOf(value = motion) {
  if (!value?.loop) return null;
  const loop = value.loop;
  const start = finite(Array.isArray(loop) ? loop[0] : loop.start);
  const end = finite(Array.isArray(loop) ? loop[1] : loop.end);
  return { start, end };
}
function setLoop(start, end) {
  if (motion.loop && !Array.isArray(motion.loop)) {
    motion.loop.start = start;
    motion.loop.end = end;
  } else {
    motion.loop = [start, end];
  }
}
function normalize() {
  motion.duration = Math.max(.01, finite(motion.duration, 1.5));
  for (const item of tracksOf()) item.keys.sort((a, b) => a[0] - b[0]);
  const loop = loopOf();
  if (loop) {
    const start = clamp(loop.start, 0, Math.max(0, motion.duration - .001));
    setLoop(start, clamp(loop.end, start + .001, motion.duration));
  }
  time = clamp(time, 0, motion.duration);
}
function selectedTrack() {
  return tracksOf().find((item) => item.id === selectedTrackId);
}
function selectedKey() {
  const item = selectedTrack();
  return item?.keys.includes(selectedFrame) ? selectedFrame : null;
}

/* 编辑器画曲线用的求值；求值失败时退回内置实现，保证界面可用。角色预览始终调用 applyMotionAt。 */
function bezierValue(control, progress) {
  const [x1, y1, x2, y2] = control;
  const cubic = (u, a, b) => 3 * (1 - u) ** 2 * u * a + 3 * (1 - u) * u * u * b + u ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (cubic(mid, x1, x2) < progress) lo = mid;
    else hi = mid;
  }
  return cubic((lo + hi) / 2, y1, y2);
}
function easeValue(ease, progress) {
  try {
    const result = easeFn(ease, progress);
    const value = typeof result === 'function' ? result(progress) : result;
    if (Number.isFinite(value)) return value;
  } catch {
    // 退回已知预设或贝塞尔求值。
  }
  if (Array.isArray(ease)) return bezierValue(ease, progress);
  const preset = EASES?.[ease];
  if (typeof preset === 'function') return preset(progress);
  if (Array.isArray(preset)) return bezierValue(preset, progress);
  if (ease === 'easeIn') return progress * progress;
  if (ease === 'easeOut') return 1 - (1 - progress) ** 2;
  if (ease === 'easeInOut') return progress < .5
    ? 2 * progress ** 2 : 1 - (-2 * progress + 2) ** 2 / 2;
  return progress;
}
function valueAt(item, at) {
  try {
    const value = sampleTrack(item.track, at);
    if (Number.isFinite(value)) return value;
  } catch {
    // 退回内置插值，保持编辑界面可用。
  }
  const keys = item.keys;
  if (!keys.length) return modeOf(item.track) === 'scale' ? 1 : 0;
  if (at <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (at < b[0]) {
      const p = (at - a[0]) / Math.max(1e-9, b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * easeValue(a[2] || 'linear', p);
    }
  }
  return keys[keys.length - 1][1];
}

let library = {};
let motion = null;
let motionName = '';
let savedText = '';
let selectedTrackId = null;
let selectedFrame = null;
let time = 0;
let playing = false;
let released = false;
let holdElapsed = 0;
let undoStack = [];
let redoStack = [];
let drag = null;
let saving = false;
let character = null;
let idle = null;
let renderer = null;
let scene = null;
let camera = null;
let previewError = '';
let nameAction = 'new';
let timelineWidth = 600;
let curveHeight = 135;
let curveRange = { min: -1, max: 1 };
let curveDragRange = null;

function serialize(value = motion) {
  return JSON.stringify(value, null, 2);
}
function dirty() {
  return !!motion && serialize() !== savedText;
}
function status(message, error = false) {
  $('#status').textContent = message;
  $('#status').classList.toggle('error', error);
}
function snapshot() {
  const track = selectedTrack();
  return {
    motion: clone(motion),
    trackId: selectedTrackId,
    frameIndex: track ? track.keys.indexOf(selectedFrame) : -1,
    time,
  };
}
function restore(state) {
  motion = clone(state.motion);
  selectedTrackId = state.trackId;
  selectedFrame = selectedTrack()?.keys[state.frameIndex] || null;
  time = clamp(state.time, 0, motion.duration);
  resetPlayback();
  renderProperties();
  refresh();
}
function commit(before) {
  if (serialize(before.motion) === serialize()) return;
  undoStack.push(before);
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
  refresh();
}
function edit(change, rebuild = true) {
  if (!motion) return;
  const before = snapshot();
  change();
  normalize();
  commit(before);
  if (rebuild) renderProperties();
  refresh();
}
function undo() {
  if (!undoStack.length || drag) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
}
function redo() {
  if (!redoStack.length || drag) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
}
function resetPlayback() {
  playing = false;
  released = false;
  holdElapsed = 0;
}
function seek(value) {
  time = clamp(value, 0, motion.duration);
  resetPlayback();
  refresh();
}
function refresh() {
  $('#play').textContent = playing ? '暂停' : '播放';
  $('#undo').disabled = !undoStack.length;
  $('#redo').disabled = !redoStack.length;
  $('#save').disabled = !motion || saving;
  $('#save-as').disabled = !motion || saving;
  $('#new').disabled = saving;
  $('#motion-select').disabled = saving;
  $('#release').disabled = !motion?.loop || released;
  $('#time-label').textContent = `${time.toFixed(3)} s`;
  document.title = `${dirty() ? '* ' : ''}${motion?.label || motionName || '关键帧动作编辑器'}`;
  drawTimeline();
  drawCurve();
}
function renderLibrary() {
  $('#motion-select').innerHTML = Object.entries(library)
    .map(([name, value]) => `<option value="${esc(name)}">${esc(value.label || name)}（${esc(name)}）</option>`).join('');
  if (motionName && !Object.hasOwn(library, motionName)) {
    $('#motion-select').insertAdjacentHTML('beforeend',
      `<option value="${esc(motionName)}">${esc(motion?.label || motionName)}（${esc(motionName)}，未保存）</option>`);
  }
  $('#motion-select').value = motionName;
}
function acceptDiscard() {
  return !dirty() || window.confirm('当前动作尚未保存，确定放弃修改吗？');
}
function openMotion(name, value, unsaved = false) {
  motionName = name;
  motion = clone(value);
  selectedTrackId = null;
  selectedFrame = null;
  time = 0;
  resetPlayback();
  undoStack = [];
  redoStack = [];
  savedText = unsaved ? '' : serialize();
  normalize();
  selectedTrackId = tracksOf()[0]?.id ?? null;
  renderLibrary();
  renderProperties();
  refresh();
}
function field(label, content) {
  return `<label class="field"><span>${label}</span>${content}</label>`;
}
function numberInput(id, value, attributes = '') {
  return `<input id="${id}" type="number" value="${esc(value)}" step="0.01" ${attributes}>`;
}

function renderProperties() {
  if (!motion) {
    $('#properties').innerHTML = '<p class="muted">请选择或新建动作。</p>';
    return;
  }
  const item = selectedTrack();
  const key = selectedKey();
  const loop = loopOf();
  const overflow = tracksOf().reduce((count, track) =>
    count + track.keys.filter((frame) => frame[0] > motion.duration).length, 0);
  const unused = Object.keys(PARAM_INFO).filter((param) => !tracksOf().some((track) => track.param === param));
  const range = item ? infoOf(item.param) : { min: -1, max: 1 };
  const low = key ? Math.min(range.min, key[1]) : range.min;
  const high = key ? Math.max(range.max, key[1]) : range.max;
  $('#properties').innerHTML = `
    <section>
      <h2>动作属性</h2>
      ${field('英文名', `<input type="text" readonly value="${esc(motionName)}">`)}
      ${field('中文名', `<input id="motion-label" type="text" value="${esc(motion.label || '')}">`)}
      ${field('所在层', `<select id="motion-layer">${options(layers, motion.layer, LAYER_LABELS)}</select>`)}
      ${field('需要朝向', `<select id="motion-facing">${options(['', 'front', 'side', 'back'], motion.facing || '', {
        '': '任意', front: '正面', side: '侧面', back: '背面',
      })}</select>`)}
      ${field('时长 / 秒', numberInput('duration', motion.duration, 'min="0.01"'))}
      <label class="check"><input id="has-loop" type="checkbox" ${loop ? 'checked' : ''}>有循环区间</label>
      ${loop ? field('循环起点', numberInput('loop-start', loop.start, 'min="0"')) +
        field('循环终点', numberInput('loop-end', loop.end, 'min="0"')) : ''}
      ${field('最多循环 / 秒', numberInput('hold', motion.hold ?? 0, 'min="0"'))}
      <div class="muted">0 = 一直循环，直到点“松开”（桌宠里由程序决定何时松开）。</div>
      ${field('淡入 / 秒', numberInput('fade-in', motion.fadeIn ?? 0, 'min="0"'))}
      ${field('淡出 / 秒', numberInput('fade-out', motion.fadeOut ?? 0, 'min="0"'))}
      <label class="check"><input id="stop-walk" type="checkbox" ${motion.stopWalk ? 'checked' : ''}>播放时停下脚步</label>
      <div id="warning">${overflow ? `${overflow} 个关键帧超出时长，已保留并标灰。` : ''}</div>
    </section>
    <section>
      <h2>轨道</h2>
      ${tracksOf().map((track) => `
        <div class="track-property">
          <button data-select="${esc(track.id)}" class="${track.id === selectedTrackId ? 'active' : ''}" title="${esc(track.param)}">${esc(infoOf(track.param).label)}</button>
          <select data-mode="${esc(track.id)}" aria-label="轨道模式">${options(modes, modeOf(track.track), MODES)}</select>
          <button data-delete="${esc(track.id)}" title="删除轨道">×</button>
        </div>`).join('')}
      <select id="add-track" aria-label="添加轨道">
        <option value="">＋ 添加轨道</option>
        ${unused.map((param) => `<option value="${esc(param)}">${esc(infoOf(param).label)}（${esc(param)}）</option>`).join('')}
      </select>
    </section>
    <section>
      <h2>选中关键帧</h2>
      ${key ? `
        ${field('时间 / 秒', numberInput('key-time', key[0], 'min="0"'))}
        ${field('数值', numberInput('key-value', key[1]))}
        <input id="key-slider" aria-label="关键帧数值" type="range" min="${low}" max="${high === low ? high + 1 : high}" step="any" value="${key[1]}">
        ${field('到下一帧', `<select id="key-ease">${options(eases, Array.isArray(key[2]) ? '__custom' : key[2] || 'linear', EASE_LABELS)}<option value="__custom" ${Array.isArray(key[2]) ? 'selected' : ''}>自定义</option></select>`)}
        <canvas id="bezier" aria-label="缓动贝塞尔控制点"></canvas>
        <div class="muted">横向 0…1；纵向 −0.6…1.6。拖动控制点自动转为自定义。</div>
      ` : '<div class="muted">点击菱形或曲线上的点。双击轨道空白处新增关键帧。</div>'}
    </section>
    <div class="muted">默认吸附 1/60 秒；Shift 吸附 0.05 秒。Delete 删除。Ctrl+S 保存。</div>
  `;

  const bind = (id, action) => {
    const element = $(`#${id}`);
    if (element) element.addEventListener('change', () => edit(() => action(element)));
  };
  bind('motion-label', (el) => { motion.label = el.value; });
  bind('motion-layer', (el) => { motion.layer = el.value; });
  bind('motion-facing', (el) => {
    if (el.value) motion.facing = el.value;
    else delete motion.facing;
  });
  bind('duration', (el) => { motion.duration = Math.max(.01, finite(el.value, motion.duration)); });
  bind('has-loop', (el) => {
    if (el.checked) setLoop(motion.duration / 3, motion.duration * 2 / 3);
    else delete motion.loop;
    released = false;
    holdElapsed = 0;
  });
  bind('loop-start', (el) => {
    const current = loopOf();
    setLoop(clamp(finite(el.value), 0, current.end - .001), current.end);
  });
  bind('loop-end', (el) => {
    const current = loopOf();
    setLoop(current.start, clamp(finite(el.value), current.start + .001, motion.duration));
  });
  for (const [id, property] of [['hold', 'hold'], ['fade-in', 'fadeIn'], ['fade-out', 'fadeOut']]) {
    bind(id, (el) => { motion[property] = Math.max(0, finite(el.value)); });
  }
  bind('stop-walk', (el) => { motion.stopWalk = el.checked; });
  bind('key-time', (el) => { key[0] = Math.max(0, finite(el.value, key[0])); });
  bind('key-value', (el) => { key[1] = finite(el.value, key[1]); });
  bind('key-ease', (el) => {
    key[2] = el.value === '__custom' ? [.42, 0, .58, 1] : el.value;
  });
  bind('add-track', (el) => {
    if (!el.value) return;
    const param = el.value;
    const exemplar = tracksOf()[0]?.track;
    const mode = PARAM_INFO[param]?.mode || (modes.includes('add') ? 'add' : modes[0]);
    const keys = [[0, mode === 'scale' ? 1 : 0, 'easeInOut']];
    const keyField = exemplar && !Array.isArray(exemplar) && 'keyframes' in exemplar
      ? 'keyframes' : exemplar && !Array.isArray(exemplar) && 'frames' in exemplar ? 'frames' : 'keys';
    motion.tracks ||= {};
    if (Array.isArray(motion.tracks)) {
      const paramField = exemplar && 'parameter' in exemplar ? 'parameter'
        : exemplar && 'name' in exemplar && !('param' in exemplar) ? 'name' : 'param';
      motion.tracks.push({ [paramField]: param, mode, [keyField]: keys });
      selectedTrackId = String(motion.tracks.length - 1);
    } else {
      motion.tracks[param] = { mode, [keyField]: keys };
      selectedTrackId = param;
    }
    selectedFrame = keys[0];
  });
  $('#properties').querySelectorAll('[data-select]').forEach((button) => {
    button.onclick = () => selectTrack(button.dataset.select);
  });
  $('#properties').querySelectorAll('[data-mode]').forEach((select) => {
    select.onchange = () => edit(() => {
      const track = tracksOf().find((entry) => entry.id === select.dataset.mode);
      if (Array.isArray(track.track)) {
        const replacement = { mode: select.value, keys: track.keys };
        motion.tracks[track.id] = replacement;
      } else track.track.mode = select.value;
    });
  });
  $('#properties').querySelectorAll('[data-delete]').forEach((button) => {
    button.onclick = () => edit(() => {
      if (Array.isArray(motion.tracks)) motion.tracks.splice(Number(button.dataset.delete), 1);
      else delete motion.tracks[button.dataset.delete];
      selectedTrackId = tracksOf()[0]?.id ?? null;
      selectedFrame = null;
    });
  });

  const slider = $('#key-slider');
  if (slider) {
    let before = null;
    slider.addEventListener('input', () => {
      before ||= snapshot();
      key[1] = finite(slider.value, key[1]);
      $('#key-value').value = key[1];
      refresh();
    });
    const finish = () => {
      if (!before) return;
      commit(before);
      before = null;
      renderProperties();
    };
    slider.addEventListener('change', finish);
    slider.addEventListener('blur', finish);
  }
  setupBezier();
}

function selectTrack(id, key = null) {
  selectedTrackId = id;
  selectedFrame = key;
  renderProperties();
  refresh();
}
function canvasContext(canvas, width, height) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext('2d');
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  context.font = '12px system-ui, sans-serif';
  return context;
}
function plotWidth() {
  return Math.max(1, timelineWidth - LEFT - END_PAD);
}
function timeX(value) {
  return LEFT + value / motion.duration * plotWidth();
}
function xTime(value) {
  return (value - LEFT) / plotWidth() * motion.duration;
}
function pointerPosition(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
function snapTime(value, event) {
  const step = event.shiftKey ? .05 : 1 / 60;
  return Math.max(0, Math.round(value / step) * step);
}
function diamond(context, x, y, size, fill) {
  context.fillStyle = fill;
  context.beginPath();
  context.moveTo(x, y - size);
  context.lineTo(x + size, y);
  context.lineTo(x, y + size);
  context.lineTo(x - size, y);
  context.closePath();
  context.fill();
}
function drawTimeline() {
  if (!motion) return;
  const tracks = tracksOf();
  const height = Math.max(RULER + ROW, RULER + tracks.length * ROW);
  const context = canvasContext($('#timeline'), timelineWidth, height);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, timelineWidth, height);
  const loop = loopOf();
  if (loop) {
    context.fillStyle = '#dcefe580';
    context.fillRect(timeX(loop.start), 0, timeX(loop.end) - timeX(loop.start), height);
  }
  context.fillStyle = '#f3f5f7';
  context.fillRect(0, 0, LEFT, height);
  context.fillStyle = '#64717b';
  context.fillText('轨道 / 参数 / 模式', 10, 22);

  context.save();
  context.beginPath();
  context.rect(LEFT, 0, plotWidth() + END_PAD, height);
  context.clip();
  const count = Math.floor(motion.duration * 10);
  for (let i = 0; i <= count; i++) {
    const x = timeX(i / 10);
    const major = i % 5 === 0;
    context.strokeStyle = major ? '#cbd4dc' : '#e9edf0';
    context.beginPath();
    context.moveTo(x, major ? 0 : RULER - 7);
    context.lineTo(x, height);
    context.stroke();
    if (major) {
      context.fillStyle = '#64717b';
      context.fillText((i / 10).toFixed(1), x + 3, 14);
    }
  }
  context.restore();

  tracks.forEach((item, index) => {
    const y = RULER + index * ROW;
    if (item.id === selectedTrackId) {
      context.fillStyle = '#dcebf455';
      context.fillRect(0, y, timelineWidth, ROW);
    }
    context.strokeStyle = '#e0e5e9';
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(timelineWidth, y);
    context.stroke();
    context.save();
    context.beginPath();
    context.rect(0, y, LEFT - 5, ROW);
    context.clip();
    context.fillStyle = '#30383e';
    context.fillText(infoOf(item.param).label, 10, y + 14);
    context.fillStyle = '#81909b';
    context.font = '10px system-ui, sans-serif';
    context.fillText(`${item.param} · ${MODES[modeOf(item.track)] ?? modeOf(item.track)}`, 10, y + 28);
    context.restore();

    for (const key of item.keys) {
      const outside = key[0] > motion.duration;
      const x = outside ? timeX(motion.duration) + 7 : timeX(key[0]);
      diamond(context, x, y + ROW / 2, key === selectedFrame ? 7 : 5,
        outside ? '#a9afb5' : key === selectedFrame ? '#df8b30' : '#477c9d');
    }
  });
  if (loop) {
    for (const value of [loop.start, loop.end]) {
      const x = timeX(value);
      context.fillStyle = '#4c9673';
      context.fillRect(x - 4, 18, 8, 15);
    }
  }
  context.strokeStyle = '#d34c4c';
  context.beginPath();
  context.moveTo(timeX(time), 0);
  context.lineTo(timeX(time), height);
  context.stroke();
  diamond(context, timeX(time), 4, 4, '#d34c4c');
}
function rangeOf(item) {
  const info = infoOf(item.param);
  let min = Math.min(0, info.min);
  let max = Math.max(0, info.max);
  for (const key of item.keys) {
    min = Math.min(min, key[1]);
    max = Math.max(max, key[1]);
  }
  for (let i = 0; i <= 300; i++) {
    const value = valueAt(item, motion.duration * i / 300);
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (max - min < .000001) max = min + 1;
  const padding = (max - min) * .08;
  return { min: min - padding, max: max + padding };
}
function valueY(value, range = curveRange) {
  return 12 + (range.max - value) / (range.max - range.min) * (curveHeight - 24);
}
function yValue(y, range = curveRange) {
  return range.max - (y - 12) / (curveHeight - 24) * (range.max - range.min);
}
function drawCurve() {
  const context = canvasContext($('#curve'), timelineWidth, curveHeight);
  context.fillStyle = '#fbfcfd';
  context.fillRect(0, 0, timelineWidth, curveHeight);
  if (!motion) return;
  const item = selectedTrack();
  if (!item) {
    context.fillStyle = '#7d8992';
    context.fillText('选择轨道查看曲线', 12, 25);
    return;
  }
  curveRange = curveDragRange || rangeOf(item);
  context.fillStyle = '#637580';
  context.fillText(infoOf(item.param).label, 10, 20);
  context.fillText(curveRange.max.toFixed(3), LEFT - 65, 15);
  context.fillText(curveRange.min.toFixed(3), LEFT - 65, curveHeight - 6);
  context.strokeStyle = '#bdc8d0';
  context.beginPath();
  context.moveTo(LEFT, valueY(0));
  context.lineTo(timelineWidth, valueY(0));
  context.stroke();

  context.save();
  context.beginPath();
  context.rect(LEFT - 6, 0, plotWidth() + END_PAD + 6, curveHeight);
  context.clip();
  context.strokeStyle = '#477c9d';
  context.lineWidth = 1.7;
  context.beginPath();
  const samples = Math.max(100, Math.ceil(plotWidth()));
  for (let i = 0; i <= samples; i++) {
    const at = motion.duration * i / samples;
    const x = timeX(at);
    const y = valueY(valueAt(item, at));
    if (i === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  for (const key of item.keys) {
    const outside = key[0] > motion.duration;
    const x = outside ? timeX(motion.duration) + 7 : timeX(key[0]);
    context.beginPath();
    context.arc(x, valueY(key[1]), key === selectedFrame ? 5.5 : 4.5, 0, Math.PI * 2);
    context.fillStyle = outside ? '#a9afb5' : key === selectedFrame ? '#df8b30' : '#477c9d';
    context.fill();
  }
  context.strokeStyle = '#d34c4c';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(timeX(time), 0);
  context.lineTo(timeX(time), curveHeight);
  context.stroke();
  context.restore();
}
function hitKey(item, point, curve = false) {
  return [...item.keys].reverse().find((key) => {
    const x = key[0] > motion.duration ? timeX(motion.duration) + 7 : timeX(key[0]);
    return Math.abs(x - point.x) <= 9 && (!curve || Math.abs(valueY(key[1]) - point.y) <= 9);
  });
}

function beginDrag(event, canvas, type, extra = {}) {
  resetPlayback();
  drag = { type, canvas, pointerId: event.pointerId, before: snapshot(), ...extra };
  canvas.setPointerCapture(event.pointerId);
  event.preventDefault();
}
$('#timeline').addEventListener('pointerdown', (event) => {
  if (!motion || event.button !== 0) return;
  const canvas = event.currentTarget;
  const point = pointerPosition(event, canvas);
  if (point.y < RULER && point.x >= LEFT) {
    const loop = loopOf();
    const handle = loop && point.y >= 16
      ? ['start', 'end'].find((edge) => Math.abs(point.x - timeX(loop[edge])) < 8) : null;
    beginDrag(event, canvas, handle ? 'loop' : 'seek', { edge: handle });
    if (!handle) seek(xTime(point.x));
    return;
  }
  const item = tracksOf()[Math.floor((point.y - RULER) / ROW)];
  if (!item) return;
  if (point.x < LEFT) {
    selectTrack(item.id);
    return;
  }
  const key = hitKey(item, point);
  selectTrack(item.id, key || null);
  if (key) beginDrag(event, canvas, 'key', {
    key, offsetX: point.x - (key[0] > motion.duration ? timeX(motion.duration) + 7 : timeX(key[0])),
  });
});
$('#timeline').addEventListener('dblclick', (event) => {
  if (!motion) return;
  const point = pointerPosition(event, event.currentTarget);
  if (point.y < RULER || point.x < LEFT || point.x > timeX(motion.duration)) return;
  const item = tracksOf()[Math.floor((point.y - RULER) / ROW)];
  if (!item || hitKey(item, point)) return;
  const at = clamp(snapTime(xTime(point.x), event), 0, motion.duration);
  const value = valueAt(item, at);
  edit(() => {
    const key = [at, value, 'easeInOut'];
    item.keys.push(key);
    selectedTrackId = item.id;
    selectedFrame = key;
  });
});
$('#curve').addEventListener('pointerdown', (event) => {
  const item = selectedTrack();
  if (!item || event.button !== 0) return;
  const point = pointerPosition(event, event.currentTarget);
  const key = hitKey(item, point, true);
  if (!key) return;
  selectedFrame = key;
  curveDragRange = { ...curveRange };
  renderProperties();
  beginDrag(event, event.currentTarget, 'curve', {
    key,
    offsetX: point.x - (key[0] > motion.duration ? timeX(motion.duration) + 7 : timeX(key[0])),
    offsetY: point.y - valueY(key[1]),
  });
  refresh();
});
function moveDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const point = pointerPosition(event, drag.canvas);
  if (drag.type === 'seek') time = clamp(xTime(point.x), 0, motion.duration);
  if (drag.type === 'loop') {
    const loop = loopOf();
    const at = clamp(snapTime(xTime(point.x), event), 0, motion.duration);
    if (drag.edge === 'start') setLoop(Math.min(at, loop.end - .001), loop.end);
    else setLoop(loop.start, Math.max(at, loop.start + .001));
  }
  if (drag.type === 'key' || drag.type === 'curve') {
    drag.key[0] = snapTime(xTime(point.x - drag.offsetX), event);
    if (drag.type === 'curve') {
      drag.key[1] = yValue(point.y - drag.offsetY, curveDragRange);
    }
    normalize();
    time = clamp(drag.key[0], 0, motion.duration);
    if ($('#key-time')) $('#key-time').value = drag.key[0].toFixed(4);
    if ($('#key-value')) $('#key-value').value = drag.key[1].toFixed(4);
  }
  if (drag.type === 'bezier') {
    const control = drag.key[2];
    const index = drag.control * 2;
    control[index] = clamp((point.x - 20) / drag.width, 0, 1);
    control[index + 1] = clamp(1.6 - (point.y - 10) / 130 * 2.2, -.6, 1.6);
    drawBezier(drag.canvas, control);
  }
  refresh();
}
function finishDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const current = drag;
  drag = null;
  curveDragRange = null;
  if (current.canvas.hasPointerCapture(event.pointerId)) current.canvas.releasePointerCapture(event.pointerId);
  if (event.type === 'pointercancel') restore(current.before);
  else {
    normalize();
    if (current.type !== 'seek') commit(current.before);
    renderProperties();
    refresh();
  }
}
for (const canvas of [$('#timeline'), $('#curve')]) {
  canvas.addEventListener('pointermove', moveDrag);
  canvas.addEventListener('pointerup', finishDrag);
  canvas.addEventListener('pointercancel', finishDrag);
  canvas.addEventListener('lostpointercapture', (event) => {
    if (drag?.canvas === canvas) finishDrag(event);
  });
}

function controlOf(ease) {
  if (Array.isArray(ease)) return [...ease];
  if (Array.isArray(EASES?.[ease])) return [...EASES[ease]];
  return {
    linear: [0, 0, 1, 1],
    easeIn: [.42, 0, 1, 1],
    easeOut: [0, 0, .58, 1],
    easeInOut: [.42, 0, .58, 1],
  }[ease] || [.42, 0, .58, 1];
}
function drawBezier(canvas, control) {
  const width = canvas.parentElement.clientWidth;
  const context = canvasContext(canvas, width, 150);
  const x = (value) => 20 + value * (width - 40);
  const y = (value) => 10 + (1.6 - value) / 2.2 * 130;
  context.strokeStyle = '#e1e6ea';
  for (const value of [0, 1]) {
    context.beginPath();
    context.moveTo(x(0), y(value));
    context.lineTo(x(1), y(value));
    context.stroke();
  }
  context.strokeStyle = '#a8b7c2';
  context.beginPath();
  context.moveTo(x(0), y(0));
  context.lineTo(x(control[0]), y(control[1]));
  context.moveTo(x(1), y(1));
  context.lineTo(x(control[2]), y(control[3]));
  context.stroke();
  context.strokeStyle = '#477c9d';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(x(0), y(0));
  context.bezierCurveTo(x(control[0]), y(control[1]), x(control[2]), y(control[3]), x(1), y(1));
  context.stroke();
  for (let i = 0; i < 2; i++) {
    context.fillStyle = i ? '#d28b43' : '#477c9d';
    context.beginPath();
    context.arc(x(control[i * 2]), y(control[i * 2 + 1]), 6, 0, Math.PI * 2);
    context.fill();
  }
}
function setupBezier() {
  const canvas = $('#bezier');
  const key = selectedKey();
  if (!canvas || !key) return;
  drawBezier(canvas, controlOf(key[2]));
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const point = pointerPosition(event, canvas);
    const control = controlOf(key[2]);
    const width = canvas.clientWidth - 40;
    const distances = [0, 1].map((i) => Math.hypot(
      point.x - 20 - control[i * 2] * width,
      point.y - 10 - (1.6 - control[i * 2 + 1]) / 2.2 * 130,
    ));
    const index = distances[0] <= distances[1] ? 0 : 1;
    if (distances[index] > 16) return;
    beginDrag(event, canvas, 'bezier', { key, control: index, width });
    key[2] = control;
    $('#key-ease').value = '__custom';
  });
  canvas.addEventListener('pointermove', moveDrag);
  canvas.addEventListener('pointerup', finishDrag);
  canvas.addEventListener('pointercancel', finishDrag);
  canvas.addEventListener('lostpointercapture', (event) => {
    if (drag?.canvas === canvas) finishDrag(event);
  });
}

function showNameDialog(action) {
  if (action === 'new' && !acceptDiscard()) return;
  nameAction = action;
  $('#name-title').textContent = action === 'new' ? '新建动作' : '另存为';
  $('#new-name').value = '';
  $('#new-label').value = '';
  $('#label-field').hidden = action !== 'new';
  $('#name-error').textContent = '';
  $('#name-dialog').showModal();
  $('#new-name').focus();
}
async function saveMotion(targetName = motionName) {
  if (!motion || saving) return false;
  if (!namePattern.test(targetName)) {
    status('英文名只允许 1～40 位小写字母、数字、下划线或连字符。', true);
    return false;
  }
  normalize();
  const data = clone(motion);
  const text = serialize(data);
  saving = true;
  refresh();
  status('正在保存…');
  try {
    const response = await fetch('/__motions/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: targetName, motion: data }, null, 2),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) {
      throw new Error(result.error || result.message || `HTTP ${response.status}`);
    }
    library[targetName] = clone(data);
    if (character) character.motions = { ...character.motions, [targetName]: clone(data) };
    motionName = targetName;
    savedText = text;
    renderLibrary();
    renderProperties();
    status(`已保存 ${targetName}.json${dirty() ? '；保存期间的新修改尚未保存。' : ''}`);
    return true;
  } catch (error) {
    status(`保存失败：${error.message}`, true);
    return false;
  } finally {
    saving = false;
    refresh();
  }
}
$('#new').onclick = () => showNameDialog('new');
$('#save-as').onclick = () => showNameDialog('save-as');
$('#save').onclick = () => saveMotion();
$('#cancel-name').onclick = () => $('#name-dialog').close();
$('#name-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('#new-name').value.trim();
  if (!namePattern.test(name)) {
    $('#name-error').textContent = '请输入 1～40 位小写字母、数字、下划线或连字符。';
    return;
  }
  if (Object.hasOwn(library, name) || name === motionName) {
    $('#name-error').textContent = '这个英文名已存在，请换一个名字。';
    return;
  }
  if (nameAction === 'new') {
    openMotion(name, {
      label: $('#new-label').value.trim() || name,
      duration: 1.5,
      layer: 'head',
      tracks: {},
      fadeIn: .15,
      fadeOut: .15,
      stopWalk: false,
    }, true);
    $('#name-dialog').close();
    status('已新建动作，尚未保存。');
  } else {
    const button = $('#name-form button[type="submit"]');
    button.disabled = true;
    try {
      if (await saveMotion(name)) $('#name-dialog').close();
      else $('#name-error').textContent = '保存失败，请查看底部提示。';
    } finally {
      button.disabled = false;
    }
  }
});
$('#motion-select').addEventListener('change', (event) => {
  if (!acceptDiscard()) {
    event.target.value = motionName;
    return;
  }
  const name = event.target.value;
  if (library[name]) openMotion(name, library[name]);
});
$('#undo').onclick = undo;
$('#redo').onclick = redo;
$('#home').onclick = () => { if (motion) seek(0); };
function togglePlay() {
  if (!motion) return;
  if (time >= motion.duration) {
    time = 0;
    released = false;
    holdElapsed = 0;
  }
  playing = !playing;
  refresh();
}
$('#play').onclick = togglePlay;
$('#release').onclick = () => { released = true; refresh(); };
$('#idle').onchange = () => { if (idle) idle.enabled = $('#idle').checked; };
$('#facing').onchange = () => {
  try {
    character?.setFacing($('#facing').value);
  } catch (error) {
    status(`切换朝向失败：${error.message}`, true);
  }
};
window.addEventListener('beforeunload', (event) => {
  if (!dirty()) return;
  event.preventDefault();
  event.returnValue = '';
});
window.addEventListener('keydown', (event) => {
  const typing = event.target instanceof Element &&
    !!event.target.closest('input, textarea, select, [contenteditable="true"]');
  if ($('#name-dialog').open) return;
  const command = event.ctrlKey || event.metaKey;
  if (command && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (typing) event.target.blur();
    saveMotion();
    return;
  }
  if (typing) return;
  if (command && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  } else if (command && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    redo();
  } else if (event.code === 'Space') {
    event.preventDefault();
    togglePlay();
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    const item = selectedTrack();
    const key = selectedKey();
    if (!item || !key) return;
    event.preventDefault();
    edit(() => {
      item.keys.splice(item.keys.indexOf(key), 1);
      selectedFrame = null;
    });
  }
});

function advancePlayback(dt) {
  if (!motion || !playing) return;
  let amount = dt * finite($('#speed').value, 1);
  const loop = loopOf();
  if (loop && !released && time <= loop.end) {
    if (time < loop.start) {
      const intro = Math.min(amount, loop.start - time);
      time += intro;
      amount -= intro;
    }
    if (amount > 0 && time >= loop.start) {
      const maximum = Math.max(0, finite(motion.hold));
      const held = maximum > 0 ? Math.min(amount, Math.max(0, maximum - holdElapsed)) : amount;
      const length = loop.end - loop.start;
      if (length > 0) time = loop.start + ((time - loop.start + held) % length);
      holdElapsed += held;
      amount -= held;
      if (maximum > 0 && holdElapsed >= maximum) released = true;
    }
  }
  time += amount;
  if (time >= motion.duration) {
    if ($('#repeat').checked) {
      time %= motion.duration;
      released = false;
      holdElapsed = 0;
    } else {
      time = motion.duration;
      playing = false;
    }
  }
}
function resize() {
  timelineWidth = Math.max(LEFT + 90, $('#timeline-scroll').clientWidth);
  curveHeight = 135;
  if (renderer && camera) {
    const width = Math.max(1, $('#preview').clientWidth);
    const height = Math.max(1, $('#preview').clientHeight);
    const aspect = width / height;
    camera.left = -VIEW.h * aspect / 2;
    camera.right = VIEW.h * aspect / 2;
    camera.top = VIEW.h / 2;
    camera.bottom = -VIEW.h / 2;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
  }
  refresh();
  const canvas = $('#bezier');
  if (canvas && selectedKey()) drawBezier(canvas, controlOf(selectedKey()[2]));
}
async function initializePreview() {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    stencil: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0xffffff, 0);
  $('#preview').appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10000);
  camera.position.set(VIEW.cx, -VIEW.cy, 2000);
  camera.lookAt(VIEW.cx, -VIEW.cy, 0);
  resize();

  character = await new Character('rig').load();
  scene.add(character.group);
  idle = new Idle(character);
  idle.enabled = $('#idle').checked;
  character.setFacing($('#facing').value);
  character.preview = (q) => {
    if (motion) applyMotionAt(motion, time, q);
  };
  $('#preview-note').textContent = '';
}
async function initializeLibrary() {
  let loaded = character?.motions;
  if (!loaded || !Object.keys(loaded).length) loaded = await loadMotions();
  if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
    throw new Error('动作库格式不对，应为 { 名字: 动作数据 }。');
  }
  library = clone(loaded);
  const first = Object.keys(library)[0];
  if (first) openMotion(first, library[first]);
  else {
    renderLibrary();
    renderProperties();
    status('动作库为空，请点击“新建”。');
  }
}
let previousTime = performance.now();
function frame(now) {
  const dt = Math.min(.1, Math.max(0, (now - previousTime) / 1000));
  previousTime = now;
  advancePlayback(dt);
  if (character && renderer) {
    try {
      if (idle?.enabled) idle.update(dt);
      character.update(dt);
      renderer.render(scene, camera);
      if (previewError) {
        previewError = '';
        $('#preview-note').textContent = '';
      }
    } catch (error) {
      if (previewError !== error.message) {
        previewError = error.message;
        $('#preview-note').textContent = `预览失败：${error.message}`;
        status(`预览失败：${error.message}`, true);
      }
    }
  }
  if (playing) refresh();
  else if (motion) {
    $('#play').textContent = '播放';
    $('#time-label').textContent = `${time.toFixed(3)} s`;
    drawTimeline();
    drawCurve();
  }
  requestAnimationFrame(frame);
}
new ResizeObserver(resize).observe($('#preview'));
new ResizeObserver(resize).observe($('#timeline-scroll'));
window.addEventListener('pagehide', () => {
  if (character) character.preview = null;
});
async function initialize() {
  renderProperties();
  refresh();
  requestAnimationFrame(frame);
  try {
    await initializePreview();
  } catch (error) {
    $('#preview-note').textContent = `角色加载失败：${error.message}`;
    status(`角色加载失败：${error.message}`, true);
  }
  try {
    await initializeLibrary();
  } catch (error) {
    renderLibrary();
    renderProperties();
    status(`动作库加载失败：${error.message}；仍可新建动作。`, true);
  }
  resize();
}
initialize();
