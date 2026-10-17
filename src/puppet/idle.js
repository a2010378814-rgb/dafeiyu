// 待机自动动作：呼吸、随机眨眼、看向目标（眼→头→身体分层跟随，带惯性）、细微晃动、自己东张西望、说话口型。
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

/** 二阶弹簧（欠阻尼时会略微冲过目标再回正，动作更有弹性）。 */
class Follow {
  constructor(freq = 2.2, damping = 0.62) {
    this.w = 2 * Math.PI * freq;
    this.z = damping;
    this.x = 0;
    this.v = 0;
  }
  step(target, dt) {
    const a = this.w * this.w * (target - this.x) - 2 * this.z * this.w * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

/** 几个不同频率正弦的叠加，当作平滑噪声（-1..1 附近）。 */
const noise = (t, seed) => (Math.sin(t * 0.73 + seed) * 0.5 + Math.sin(t * 1.37 + seed * 2.1) * 0.3
  + Math.sin(t * 2.91 + seed * 3.7) * 0.2);

export class Idle {
  constructor(puppet) {
    this.puppet = puppet;
    this.enabled = true;
    this.talking = false;
    this.t = 0;
    this.look = { x: 0, y: 0 };      // 鼠标目标
    this.gaze = { x: 0, y: 0 };      // 实际注视点（眼睛扫视后的位置）
    this.mouseIdle = 0;
    this.wander = { x: 0, y: 0, next: 2 };
    this.saccade = 0;
    this.head = { yaw: new Follow(1.9, 0.6), pitch: new Follow(1.9, 0.62), roll: new Follow(1.2, 0.55) };
    this.body = new Follow(0.9, 0.75);
    this.nextBlink = 1.5;
    this.blink = { state: 'wait', t: 0, again: false };
    this.tilt = { target: 0, next: 4 };
    this.mouth = 1;
    this.mouthHold = 0;
  }

  /** x、y 为 -1..1，相对画面中心。 */
  setLookTarget(x, y) {
    const nx = clamp(x, -1, 1);
    const ny = clamp(y, -1, 1);
    if (Math.abs(nx - this.look.x) + Math.abs(ny - this.look.y) > 0.002) this.mouseIdle = 0;
    this.look.x = nx;
    this.look.y = ny;
  }

  update(dt) {
    if (!this.enabled) return;
    const p = this.puppet.params;
    this.t += dt;
    this.mouseIdle += dt;
    const t = this.t;

    // 呼吸：约 4 秒一次
    p.breath = Math.sin(t * Math.PI * 2 / 4.2);

    // 注视目标：鼠标在动就看鼠标；鼠标几秒不动，就自己东张西望
    let tx = this.look.x;
    let ty = this.look.y;
    if (this.mouseIdle > 3.5) {
      this.wander.next -= dt;
      if (this.wander.next <= 0) {
        this.wander.x = (Math.random() - 0.5) * 1.4;
        this.wander.y = -0.6 + (Math.random() - 0.5) * 0.8;
        this.wander.next = 1.5 + Math.random() * 3.5;
      }
      tx = this.wander.x;
      ty = this.wander.y;
    }
    // 眼睛是"跳"过去的（扫视），不是平滑滑过去
    this.saccade -= dt;
    if (this.saccade <= 0 || Math.hypot(tx - this.gaze.x, ty - this.gaze.y) > 0.35) {
      this.gaze.x = tx;
      this.gaze.y = ty;
      this.saccade = 0.25 + Math.random() * 0.4;
    }
    const gy = (this.gaze.y + 0.45) * 0.9; // 目标点相对脸的位置（脸在画面上方）
    p.eyeX = approach(p.eyeX, clamp(this.gaze.x * 1.2, -1, 1), 28, dt);
    p.eyeY = approach(p.eyeY, clamp(gy, -1, 1), 28, dt);

    // 头：转向目标的大部分角度，带惯性和轻微过冲；叠加细微晃动和随呼吸的点头
    const micro = 0.012;
    p.yaw = this.head.yaw.step(this.gaze.x * 0.17 + noise(t, 1) * micro, dt);
    p.pitch = this.head.pitch.step(-gy * 0.09 + noise(t, 5) * micro * 0.8 + p.breath * 0.006, dt);

    // 偶尔歪一下头；看向一侧时头也会顺势歪一点
    this.tilt.next -= dt;
    if (this.tilt.next <= 0) {
      this.tilt.target = Math.random() < 0.45 ? 0 : (Math.random() - 0.5) * 0.16;
      this.tilt.next = 3 + Math.random() * 5;
    }
    p.roll = this.head.roll.step(this.tilt.target + this.gaze.x * 0.035 + noise(t, 9) * micro, dt);

    // 身体：跟着头扭一点，比头慢；重心随时间轻轻左右换
    p.bodyTurn = this.body.step(p.yaw * 2.2, dt);
    p.lean = approach(p.lean, noise(t * 0.5, 13) * 0.012 - p.yaw * 0.04, 1.2, dt);

    // 眨眼：随机间隔，偶尔连眨两下。状态：wait → blink → (gap → blink) → wait
    // 节奏按动画常用的"闭得快、睁得慢"：快速合上 → 停一下 → 慢慢睁开（先快后慢，中途有个接近睁开的瞬间）
    const CLOSE = 0.06;
    const HOLD = 0.035;
    const OPEN = 0.15;
    const DUR = CLOSE + HOLD + OPEN;
    const b = this.blink;
    let c = 0;
    if (b.state === 'blink') {
      b.t += dt;
      if (b.t < CLOSE) c = (b.t / CLOSE) ** 1.6;
      else if (b.t < CLOSE + HOLD) c = 1;
      else c = (1 - Math.min(1, (b.t - CLOSE - HOLD) / OPEN)) ** 2.2;
      if (b.t >= DUR) {
        if (b.again) Object.assign(b, { state: 'gap', t: 0, again: false });
        else Object.assign(b, { state: 'wait', t: 0 });
      }
    } else if (b.state === 'gap') {
      b.t += dt;
      if (b.t >= 0.1) Object.assign(b, { state: 'blink', t: 0 });
    } else {
      this.nextBlink -= dt;
      // 头大幅转向时更容易眨眼（真人转头时常会眨眼）
      if (this.nextBlink <= 0 || (Math.abs(this.head.yaw.v) > 0.6 && this.nextBlink < 2)) {
        Object.assign(b, { state: 'blink', t: 0, again: Math.random() < 0.2 });
        this.nextBlink = 2 + Math.random() * 4;
      }
    }
    p.blinkL = p.blinkR = clamp(c, 0, 1);

    // 嘴型（见 mouth.js）。说话：在几种口型之间随机跳，每个停留几十毫秒（动画里口型是逐格切换的）；
    // 不说话：平时是原画的张嘴笑，偶尔抿嘴笑、小张嘴一会儿
    if (this.talking) {
      this.mouthHold -= dt;
      if (this.mouthHold <= 0) {
        const choices = [0, 0.5, 1, 2, 3, 4].filter((v) => v !== this.mouth);
        this.mouth = choices[Math.floor(Math.random() * choices.length)];
        this.mouthHold = 0.07 + Math.random() * 0.09;
      }
    } else {
      this.mouthHold -= dt;
      if (this.mouthHold <= 0 || ![0, 0.5, 1].includes(this.mouth)) {
        const r = Math.random();
        this.mouth = r < 0.6 ? 1 : r < 0.85 ? 0 : 0.5;
        this.mouthHold = this.mouth === 1 ? 4 + Math.random() * 6 : 2 + Math.random() * 4;
      }
    }
    p.mouth = this.mouth;
  }
}
