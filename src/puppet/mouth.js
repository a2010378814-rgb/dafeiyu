// 程序画的嘴型。原画只有一张"张嘴笑"，其他嘴型照它的配色和线条画：
// 圆底、嘴角两个小尖、粉色填充、内侧上方略深、外面一圈暗红细描边。
// 嘴型按参数 mouth 的数值选（取最近的一档），动画里口型是逐格切换的，不做中间过渡。

export const MOUTH_SHAPES = [
  { v: 0, id: 'closed', label: '闭嘴笑 ‿' },
  { v: 0.5, id: 'small', label: '小张嘴' },
  { v: 1, id: 'open', label: '张嘴笑（原画）' },
  { v: 2, id: 'ah', label: '大张嘴' },
  { v: 3, id: 'o', label: 'o 形' },
  { v: 4, id: 'grin', label: '咧嘴' },
  { v: 5, id: 'cat', label: '猫嘴 ω' },
  { v: 6, id: 'wavy', label: '波浪嘴' },
  { v: 7, id: 'pout', label: '嘟嘴' },
];

export function mouthShape(v) {
  let best = MOUTH_SHAPES[2];
  for (const s of MOUTH_SHAPES) if (Math.abs(s.v - v) < Math.abs(best.v - v)) best = s;
  return best;
}

// 颜色取自原画的嘴（front_rig/11_mouth.png）
const LINE = '#8a2a30';
const SHADE = '#d9868b';
const FILL = '#f4aea8';
const LIGHT = '#f9c3ba';
const TONGUE = '#ee8c92';

// 画布：以嘴的上沿中点为原点，范围 x -40..40、y -16..54（PSD 像素），放大 4 倍绘制
export const MOUTH_BOX = { left: -40, top: -16, w: 80, h: 70, scale: 4 };

/** 张开的嘴：上沿微微上拱，两边弧线收到圆底。w 宽、h 深。 */
function openPath(g, w, h, flat = 0) {
  const x = w / 2;
  g.beginPath();
  g.moveTo(-x, 0);
  g.quadraticCurveTo(0, -1.5 - h * 0.06, x, 0);
  g.bezierCurveTo(x + w * 0.02, h * (0.55 + flat * 0.3), w * (0.3 + flat * 0.15), h, 0, h);
  g.bezierCurveTo(-w * (0.3 + flat * 0.15), h, -x - w * 0.02, h * (0.55 + flat * 0.3), -x, 0);
  g.closePath();
}

function fillMouth(g, h, tongue) {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, SHADE);
  grad.addColorStop(0.35, FILL);
  grad.addColorStop(1, LIGHT);
  g.fillStyle = grad;
  g.fill();
  if (tongue) {
    g.save();
    g.clip();
    g.fillStyle = TONGUE;
    g.beginPath();
    g.ellipse(tongue.x, tongue.y, tongue.rx, tongue.ry, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}

function strokeLine(g, width = 1.8) {
  g.strokeStyle = LINE;
  g.lineWidth = width;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.stroke();
}

/** 嘴角的小尖（原画两边嘴角往上翘出一点）。 */
function corners(g, x) {
  g.beginPath();
  g.moveTo(-x + 1, 1);
  g.lineTo(-x - 0.8, -2.6);
  g.moveTo(x - 1, 1);
  g.lineTo(x + 0.8, -2.6);
  strokeLine(g, 1.6);
}

/** 在 2D 画布上画一个嘴型（原画那一档不用画，直接显示原图层）。 */
export function drawMouth(canvas, id) {
  const g = canvas.getContext('2d');
  const B = MOUTH_BOX;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.setTransform(B.scale, 0, 0, B.scale, -B.left * B.scale, -B.top * B.scale);
  switch (id) {
    case 'small':
      openPath(g, 30, 17);
      fillMouth(g, 17);
      strokeLine(g);
      corners(g, 15);
      break;
    case 'ah':
      openPath(g, 46, 38);
      fillMouth(g, 38, { x: 0, y: 33, rx: 14, ry: 9 });
      openPath(g, 46, 38); // 画舌头时路径被换掉了，描边前重新描一遍嘴的轮廓
      strokeLine(g, 2);
      corners(g, 23);
      break;
    case 'o':
      g.beginPath();
      g.ellipse(0, 13, 11, 13, 0, 0, Math.PI * 2);
      fillMouth(g, 26);
      strokeLine(g);
      break;
    case 'grin':
      openPath(g, 50, 16, 1);
      fillMouth(g, 16);
      strokeLine(g);
      corners(g, 25);
      break;
    case 'cat':
      g.beginPath();
      g.moveTo(-13, 3);
      g.quadraticCurveTo(-6.5, 12, 0, 4);
      g.quadraticCurveTo(6.5, 12, 13, 3);
      strokeLine(g, 2.2);
      break;
    case 'wavy':
      g.beginPath();
      for (let i = 0; i <= 32; i++) {
        const x = -16 + i;
        const y = 6 + Math.sin((i / 32) * Math.PI * 4) * 2.4;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      strokeLine(g, 2.2);
      break;
    case 'pout':
      g.beginPath();
      g.moveTo(-8, 9);
      g.quadraticCurveTo(0, 1, 8, 9);
      strokeLine(g, 2.2);
      break;
    case 'closed':
    default:
      g.beginPath();
      g.moveTo(-17, 3);
      g.quadraticCurveTo(0, 13, 17, 3);
      strokeLine(g, 2.4);
      break;
  }
}
