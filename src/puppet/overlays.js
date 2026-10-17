// 表情小件：脸红、汗滴、头顶符号。都是程序画的小画布，作为图层叠在人物上，跟着头一起动。
// 每个视角在 rig-*.js 里用 OVERLAYS 声明要哪些、放在哪（PSD 像素坐标）。
//   blush（0..1）：两颊粉色加斜线，按数值渐显
//   sweat（0..1）：头边一颗汗滴，按数值渐显并往下滑一点
//   emote（按档）：0 无 · 1 ！ · 2 ？ · 3 ♪ · 4 … · 5 ♥ · 6 zzz
//   mouthSide（按嘴型）：侧脸的张嘴，参数 mouth，见 mouth.js

export const EMOTES = ['', '!', '?', '♪', '…', '♥', 'zzz'];
const LINE = '#5a3a3e';
const SCALE = 3; // 画布按 3 倍绘制

/** 在画布上画脸红：一团柔和的粉色加三道斜线。w、h 为单侧脸颊范围。 */
function drawBlush(g, w, h) {
  const grad = g.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
  grad.addColorStop(0, 'rgba(255,120,140,0.55)');
  grad.addColorStop(1, 'rgba(255,120,140,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(230,80,100,0.75)';
  g.lineWidth = 2;
  g.lineCap = 'round';
  for (let i = -1; i <= 1; i++) {
    const cx = w / 2 + i * w * 0.22;
    g.beginPath();
    g.moveTo(cx - w * 0.06, h * 0.65);
    g.lineTo(cx + w * 0.06, h * 0.35);
    g.stroke();
  }
}

/** 汗滴：上尖下圆的蓝色水滴，带描边和高光。 */
function drawSweat(g, w, h) {
  g.beginPath();
  g.moveTo(w / 2, 1);
  g.bezierCurveTo(w * 0.9, h * 0.45, w * 0.95, h - 1, w / 2, h - 1);
  g.bezierCurveTo(w * 0.05, h - 1, w * 0.1, h * 0.45, w / 2, 1);
  g.fillStyle = '#9fd8f5';
  g.fill();
  g.strokeStyle = '#3b78a8';
  g.lineWidth = 1.6;
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath();
  g.ellipse(w * 0.38, h * 0.62, w * 0.09, h * 0.12, -0.4, 0, Math.PI * 2);
  g.fill();
}

/** 头顶符号：白色描边的深色字，像漫画里的符号。 */
function drawEmote(g, w, h, id) {
  const ch = EMOTES[id];
  if (!ch) return;
  if (ch === '♥') {
    g.beginPath();
    const s = w * 0.36;
    g.moveTo(w / 2, h * 0.82);
    g.bezierCurveTo(w / 2 - s * 1.6, h * 0.45, w / 2 - s * 0.6, h * 0.05, w / 2, h * 0.32);
    g.bezierCurveTo(w / 2 + s * 0.6, h * 0.05, w / 2 + s * 1.6, h * 0.45, w / 2, h * 0.82);
    g.fillStyle = '#ff7a95';
    g.fill();
    g.strokeStyle = '#a3324c';
    g.lineWidth = 2;
    g.stroke();
    return;
  }
  g.font = `bold ${ch === 'zzz' ? h * 0.42 : h * 0.72}px "Segoe UI", "Microsoft YaHei", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.strokeStyle = 'white';
  g.lineWidth = 5;
  g.strokeText(ch, w / 2, h / 2);
  g.fillStyle = ch === '♪' ? '#4f86c6' : LINE;
  g.fillText(ch, w / 2, h / 2);
}

/**
 * 侧脸的张嘴：原画侧面只有一条小弧线（闭嘴笑），张嘴类的嘴型在脸的轮廓边上画一个小开口盖住它。
 * 画布原点在开口的上嘴角（脸的轮廓上），向右是脸内侧。id 见 mouth.js。
 */
const SIDE_MOUTH = { small: [22, 7], ah: [22, 14], o: [13, 10], grin: [24, 5], cat: [20, 6] }; // [宽, 高]，宽要盖住原画那条线
function drawMouthSide(g, id) {
  const [w, h] = SIDE_MOUTH[id] ?? [12, 6];
  const x0 = 6;
  const y0 = 8;
  g.beginPath();
  if (id === 'o') {
    g.ellipse(x0 + w / 2, y0 + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else {
    g.moveTo(x0, y0);
    g.quadraticCurveTo(x0 + w * 0.6, y0 - 1.5, x0 + w, y0 + 1);
    g.quadraticCurveTo(x0 + w * 0.85, y0 + h, x0 + w * 0.15, y0 + h);
    g.quadraticCurveTo(x0 - 1, y0 + h * 0.5, x0, y0);
  }
  const grad = g.createLinearGradient(0, y0, 0, y0 + h);
  grad.addColorStop(0, '#d9868b');
  grad.addColorStop(1, '#f6b4ad');
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = '#8a2a30';
  g.lineWidth = 1.3;
  g.lineJoin = 'round';
  g.stroke();
}
export const SIDE_MOUTH_SHAPES = Object.keys(SIDE_MOUTH);

/** 把一个叠加件画到它的画布上。kind：blush / sweat / emote / mouthSide；value 是 emote 的档位或侧脸嘴型名。 */
export function drawOverlay(canvas, kind, rect, value) {
  const g = canvas.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  if (kind === 'blush') drawBlush(g, rect.w, rect.h);
  else if (kind === 'sweat') drawSweat(g, rect.w, rect.h);
  else if (kind === 'emote') drawEmote(g, rect.w, rect.h, value);
  else if (kind === 'mouthSide') drawMouthSide(g, value);
}

export const OVERLAY_SCALE = SCALE;
