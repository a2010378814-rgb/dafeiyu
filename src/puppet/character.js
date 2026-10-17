// 角色：把正面、侧面、背面三套图层组合在一起，负责转身、走路、被拎起和动作播放。
//
// 动作是关键帧数据（public/motions/*.json，见 motion.js），分层播放：身体、手臂、头、表情各一层，
// 不同层同时叠加（可以边走边点头、边跳边挥手），同层新动作和旧动作交叉淡化。
//
// 转身分三段：预备（头和眼睛先转向目标方向、身子微蹲）→ 翻转（当前视角横向压扁，换图后弹回）
// → 余势（头发、裙摆、尾巴被甩出去再回来）。正面 ↔ 背面要经过侧面。
// 坐标：world 与 PSD 像素同尺度；角色的位置 x 是相对初始位置的横向偏移，height 是离地高度。
import * as THREE from 'three';
import { DEFAULT_PARAMS, Puppet, Spring } from './puppet.js';

import * as FRONT from './rig-front.js';
import * as SIDE from './rig-side.js';
import * as BACK from './rig-back.js';
import { Animator, loadMotions } from './motion.js';

/**
 * 被拎起时一条腿的钟摆：髋部被手提着加速时，腿因惯性甩向反方向，再在重力下来回荡。
 * 角度为正时脚往画面左边甩。
 */
class Pendulum {
  constructor(length, damping) {
    this.L = length;
    this.c = damping;
    this.a = 0;
    this.w = 0;
  }
  step(dt, ax, hang) {
    const g = 6400;
    const acc = hang
      ? -(g / this.L) * Math.sin(this.a) + (ax / this.L) * Math.cos(this.a) - this.c * this.w
      : -60 * this.a - 12 * this.w; // 落地后很快收回站姿
    this.w += acc * dt;
    this.a += this.w * dt;
    if (Math.abs(this.a) > 0.8) { // 腿不会甩过头
      this.a = Math.sign(this.a) * 0.8;
      this.w *= -0.3;
    }
    return this.a;
  }
}

const FACINGS = ['front', 'left', 'right', 'back'];
const FOOT_Y = 1490;     // 三个视角脚底都在这一行（PSD 像素）
const PREP = 0.13;       // 预备
const OUT = 0.11;        // 压扁
const IN = 0.2;          // 弹回
const HOP = 12;          // 转身时跳起的高度
const WALK_SPEED = 560;  // 走路速度（PSD 像素/秒），和腿的摆幅大致匹配，脚不打滑
const easeIn = (t) => t * t;
const easeOutBack = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
const isSide = (f) => f === 'left' || f === 'right';

/** 画面上的转动方向：从 a 转到 b 时头发往哪边甩（+1 往右，-1 往左）。 */
function turnDir(a, b) {
  const order = { left: 0, front: 1, right: 2 };
  if (a in order && b in order) return order[b] > order[a] ? -1 : 1;
  return a === 'left' || b === 'right' ? 1 : -1; // 经过背面
}

export class Character {
  constructor(base = 'rig', motionsBase = 'motions') {
    this.base = base.replace(/\/$/, '');
    this.motionsBase = motionsBase;
    this.group = new THREE.Group();
    this.params = { ...DEFAULT_PARAMS };
    this.facing = 'front';
    this.queue = [];
    this.turn = null;        // 正在进行的转身 { from, to, t }
    this.walking = false;
    this.walkSpeed = 1;      // 步频倍数
    this.lastSide = 'left';  // 正面 ↔ 背面时经过哪一侧
    this.onFacing = null;    // 视角切换完成的回调
    this.x = 0;              // 横向位置
    this.height = 0;         // 离地高度（被拎起、下落）
    this.vy = 0;
    this.lifted = false;
    this.frozen = false;   // 爬墙时由 main.js 控制高度，先关掉重力
    this.liftTarget = null;
    this.prevPos = { x: 0, y: 0 };
    this.vel = { x: 0, y: 0 };
    this.legs = { l: new Pendulum(300, 1.6), r: new Pendulum(340, 1.9) }; // 被拎起时两腿的钟摆（长短略不同，不会同步）
    this.land = new Spring(120, 9);  // 落地时的压扁回弹
    this.animator = new Animator();
    this.motions = {};       // 动作库 { name: 动作数据 }
    this.pending = null;     // 等转身完成后再播放的动作 { name, opts }
    this.onAction = null;    // 动作开始/结束的回调 (name, started)
    this.animator.onEvent = (name, started) => this.onAction?.(name, started);
    this.preview = null;     // 编辑器用：(q) => {}，每帧在动作之后改本帧参数
    this.time = 0;
    this.frame = this.params; // 本帧实际使用的参数（待机参数 + 动作、转身的叠加）
  }

  async load() {
    await this.buildPuppets(this.outfit);
    try {
      this.motions = await loadMotions(this.motionsBase);
    } catch (e) {
      console.error('动作库读取失败', e);
    }
    this.buildHolders();
    this.show(this.facing);
    return this;
  }

  /** 按衣柜重新搭三套傀儡（outfit 为空就是默认外观）。 */
  async buildPuppets(outfit) {
    const [front, side, back] = await Promise.all([
      new Puppet(`${this.base}/front`, FRONT, outfit).load(),
      new Puppet(`${this.base}/side`, SIDE, outfit).load(),
      new Puppet(`${this.base}/back`, BACK, outfit).load(),
    ]);
    this.puppets = { front, side, back };
  }

  /** 三个视角的 holding group：都在"正面身体中线、脚底"处对齐。 */
  buildHolders() {
    this.holders = {};
    for (const [k, pup] of Object.entries(this.puppets)) {
      const holder = new THREE.Group();
      holder.position.set(FRONT.CENTER_X, -FOOT_Y, 0);
      pup.group.position.set(-pup.view.CENTER_X, FOOT_Y, 0);
      holder.add(pup.group);
      holder.visible = false;
      this.group.add(holder);
      this.holders[k] = holder;
    }
  }

  /** 换装：name 为空回到默认外观；返回是否真的换了。 */
  async setOutfit(name) {
    let outfit = null;
    if (name) {
      try {
        const res = await fetch(`outfits/${name}/outfit.json`);
        if (!res.ok) return false;
        outfit = { ...(await res.json()), base: `outfits/${name}` };
      } catch {
        return false;
      }
    }
    for (const holder of Object.values(this.holders ?? {})) this.group.remove(holder);
    this.holders = {};
    await this.buildPuppets(outfit);
    this.outfit = outfit;
    this.buildHolders();
    this.show(this.facing);
    return true;
  }

  puppetFor(facing) {
    return facing === 'front' ? this.puppets.front : facing === 'back' ? this.puppets.back : this.puppets.side;
  }

  get puppet() { return this.puppetFor(this.facing); }

  /** 当前没有转身、也没有排队的转身。 */
  get settled() { return !this.turn && !this.queue.length; }

  show(facing, squash = 1, hop = 0) {
    const pup = this.puppetFor(facing);
    for (const [k, h] of Object.entries(this.holders)) h.visible = this.puppets[k] === pup;
    pup.mirrored = facing === 'right';
    const h = this.holders[pup.view.NAME];
    const st = 1 + this.frame.stretch + this.land.x;
    h.scale.x = squash * (pup.mirrored ? -1 : 1) / Math.sqrt(Math.max(st, 0.5));
    h.scale.y = st * (1 + (1 - squash) * 0.06);
    h.position.y = -FOOT_Y - hop;
  }

  /** 转向：front | left | right | back。正面和背面之间自动经过侧面。 */
  setFacing(target) {
    if (!FACINGS.includes(target)) throw new Error(`unknown facing ${target}`);
    const end = this.queue.length ? this.queue[this.queue.length - 1] : this.turn ? this.turn.to : this.facing;
    if (target === end) return;
    if (!isSide(end) && !isSide(target)) this.queue.push(this.lastSide);
    this.queue.push(target);
  }

  /** 动作要求的朝向是否满足（side = 朝左或朝右都行）。 */
  facingOk(def) {
    if (!def.facing) return true;
    if (def.facing === 'side') return isSide(this.facing);
    return def.facing === this.facing;
  }

  /**
   * 播放动作。需要特定朝向的动作会先转过去再播。
   * 带循环区间的动作如果已经在播，就只是"续命"（例如持续摸头）。opts.hold 覆盖循环持续时间。
   * 返回 false 表示被更高优先级的动作占着、没播（此时不打断正在播的动作）。
   */
  play(name, opts = {}) {
    const def = this.motions[name];
    if (!def || this.lifted) return false;
    const cur = this.animator.find(name);
    if (cur && def.loop) {
      cur.keep(opts.hold ?? def.hold ?? 1);
      return true;
    }
    if (!this.facingOk(def)) {
      if (def.stopWalk) this.walking = false;
      this.setFacing(def.facing === 'side' ? this.lastSide : def.facing);
      this.pending = { name, opts };
      return true;
    }
    if (!this.animator.play(def, opts)) return false;
    if (def.stopWalk) this.walking = false;
    this.pending = null;
    return true;
  }

  /** 让循环中的动作结束（播放它的结束段）；now = true 时立刻跳到结束段。 */
  release(name, now = false) { this.animator.release(name, now); }

  /** 所有动作淡出。 */
  stopAll() {
    this.animator.stopAll();
    this.pending = null;
  }

  /** 身体、手臂、头这几层有没有动作在播（表情层不算），或者有等着播的动作。 */
  get busy() { return !!this.pending || this.animator.busy(['body', 'arms', 'head']); }

  /** 被鼠标拎起：位置跟随 (x, height)。 */
  beginLift() {
    this.stopAll();
    this.walking = false;
    this.lifted = true;
    if (this.facing !== 'front') this.setFacing('front');
  }

  moveLift(x, height) { this.liftTarget = { x, height: Math.max(0, height) }; }

  endLift() {
    this.lifted = false;
    this.liftTarget = null;
    this.vy = this.vel.y * 0.4;
  }

  update(dt) {
    this.time += dt;
    const p = this.params; // 持续状态（待机模块每帧写入；走路节奏也存在这里）
    // ---- 走路
    const canWalk = this.walking && isSide(this.facing) && !this.turn && !this.lifted;
    const target = canWalk ? 1 : 0;
    p.walk += (target - p.walk) * (1 - Math.exp(-7 * dt));
    if (p.walk < 0.002 && !target) p.walk = 0;
    if (p.walk > 0) p.walkPhase += dt * (2 * Math.PI / 0.8) * this.walkSpeed;
    else p.walkPhase = 0;
    // 两腿交叉时身体最高，步子迈到最大时最低
    p.bob = -7 * p.walk * (1 - Math.abs(Math.sin(p.walkPhase)));
    if (p.walk > 0) this.x += (this.facing === 'left' ? -1 : 1) * WALK_SPEED * this.walkSpeed * p.walk * dt;

    // ---- 被拎起 / 下落
    if (this.lifted && this.liftTarget) {
      // 平滑地跟着鼠标走：鼠标事件不均匀，直接跳过去会让速度、加速度出现尖峰
      const k = 1 - Math.exp(-30 * dt);
      this.x += (this.liftTarget.x - this.x) * k;
      this.height += (this.liftTarget.height - this.height) * k;
      this.vy = 0;
    } else if ((this.height > 0 || this.vy > 0) && !this.frozen) {
      this.vy -= 8200 * dt;
      this.height += this.vy * dt;
      if (this.height <= 0) {
        this.land.push(-Math.min(0.12, -this.vy / 14000)); // 落地压扁，速度越快压得越扁
        this.height = 0;
        this.vy = 0;
      }
    }
    const vx = (this.x - this.prevPos.x) / Math.max(dt, 1e-3);
    const vy = (this.height - this.prevPos.y) / Math.max(dt, 1e-3);
    const ax = Math.max(-40000, Math.min(40000, (vx - this.vel.x) / Math.max(dt, 1e-3)));
    this.vel = { x: vx, y: vy };
    this.prevPos = { x: this.x, y: this.height };
    // 两腿钟摆：拎着移动时腿被甩向反方向，惯性大的那条晚一点
    const hang = this.lifted || this.height > 0 ? 1 : 0;
    const h = Math.min(dt, 1 / 30);
    this.legs.l.step(h, ax, hang);
    this.legs.r.step(h, ax, hang);
    this.land.step(Math.min(dt, 1 / 30));

    // 本帧参数：在持续状态上叠加拎起、动作、转身的效果（不写回持续状态，避免逐帧累加）
    const q = { ...p };
    this.frame = q;
    q.dangle = this.legs.l.a;
    q.dangle2 = this.legs.r.a;
    if (this.lifted) {
      q.armL = Math.max(q.armL, 0.35);
      q.armR = Math.max(q.armR, 0.35);
      q.mouth = 3; // 被拎起来：惊讶的 o 形嘴、头上冒 ！、流汗
      q.emote = 1;
      q.sweat = Math.max(q.sweat, 0.9);
    }

    // ---- 动作（分层叠加）；编辑器预览在最后套上
    if (this.pending && this.settled) {
      const { name, opts } = this.pending;
      this.pending = null;
      if (this.motions[name]) this.animator.play(this.motions[name], opts);
    }
    this.animator.update(dt, q);
    this.preview?.(q);

    // ---- 转身
    if (!this.turn && this.queue.length) {
      this.turn = { from: this.facing, to: this.queue.shift(), t: 0 };
    }
    if (this.turn) {
      const T = this.turn;
      T.t += dt;
      const dir = turnDir(T.from, T.to);
      const total = PREP + OUT + IN;
      if (T.t < PREP) {
        // 预备：头和眼睛先转向要去的方向，身子微微下蹲
        const u = Math.sin((T.t / PREP) * Math.PI / 2);
        q.yaw += -dir * 0.2 * u;
        q.eyeX = -dir * u;
        q.stretch -= 0.025 * u;
        this.show(T.from);
      } else {
        const hop = HOP * Math.sin(Math.PI * Math.min((T.t - PREP) / (OUT + IN), 1));
        if (T.t < PREP + OUT) {
          q.yaw += -dir * 0.2;
          this.show(T.from, 1 - 0.8 * easeIn((T.t - PREP) / OUT), hop);
        } else {
          if (this.facing !== T.to) {
            this.facing = T.to;
            if (isSide(T.to)) this.lastSide = T.to;
            this.puppet.resetMotion();
            this.puppet.kick(T.to === 'right' ? -dir : dir, 1);
          }
          const u = Math.min((T.t - PREP - OUT) / IN, 1);
          this.show(T.to, 0.2 + 0.8 * easeOutBack(u), hop);
          if (T.t >= total) {
            this.turn = null;
            this.onFacing?.(this.facing);
          }
        }
      }
    }
    if (!this.turn) this.show(this.facing);

    // 角色位置；移动也算进物理（头发、裙摆会被带着飘），镜像时换成图层自己的方向
    this.group.position.set(this.x, this.height, 0);
    const pup = this.puppet;
    Object.assign(pup.params, q);
    pup.params.moveX = (pup.mirrored ? -1 : 1) * this.x;
    pup.params.moveY = -this.height;
    pup.update(dt);
  }
}
