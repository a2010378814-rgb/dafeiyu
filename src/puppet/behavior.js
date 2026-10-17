// 自由活动：没有人操作时，自己随机走动、做动作、转身看看背后；久了没人理会打瞌睡，被点一下会醒。
// 参考 VPet：越久没人理，越容易自己找事做；动作从动作库（public/motions）里挑。

// 待机时随机挑哪些动作：权重写在动作文件里（weight），0 或不写 = 不参与待机随机。

export class Behavior {
  constructor(ch) {
    this.ch = ch;
    this.enabled = false;
    this.bounds = { min: -600, max: 600 };
    this.state = 'idle';
    this.timer = 2;
    this.quiet = 0; // 多久没人理她了（秒）
  }

  /** 有人操作（移动鼠标、按键）时调用。 */
  poke() { this.quiet = 0; }

  /** 点击、拖动：除了算作有人理她，还会把打瞌睡的她叫醒。 */
  wake() {
    this.quiet = 0;
    this.ch.release('sleepy', true); // 被点一下立刻惊醒
  }

  pickAction() {
    const items = Object.entries(this.ch.motions)
      .filter(([, m]) => Number.isFinite(m.weight) && m.weight > 0)
      .map(([n, m]) => [n, m.weight]);
    let r = Math.random() * items.reduce((s, [, w]) => s + w, 0);
    for (const [n, w] of items) {
      r -= w;
      if (r <= 0) return n;
    }
    return items.length ? items[items.length - 1][0] : null;
  }

  update(dt) {
    const ch = this.ch;
    this.quiet += dt;
    // 走到边上就掉头（手动走路时也生效）
    if (ch.walking && ch.settled) {
      if (ch.facing === 'left' && ch.x < this.bounds.min) ch.setFacing('right');
      else if (ch.facing === 'right' && ch.x > this.bounds.max) ch.setFacing('left');
    }
    if (!this.enabled || ch.lifted || ch.height > 0) return;
    if (ch.busy) return;
    this.timer -= dt;
    if (this.state === 'walk') {
      if (this.timer <= 0) {
        ch.walking = false;
        ch.setFacing('front');
        this.state = 'idle';
        this.timer = 2 + Math.random() * 4;
      }
      return;
    }
    if (this.state === 'back') {
      if (this.timer <= 0) {
        ch.setFacing('front');
        this.state = 'idle';
        this.timer = 2 + Math.random() * 3;
      }
      return;
    }
    if (this.timer > 0 || !ch.settled) return;
    // 很久没人理：打瞌睡（睡着后一直循环，直到被点醒或睡够）
    if (this.quiet > 45 && ch.motions.sleepy && Math.random() < 0.5) {
      ch.play('sleepy', { hold: 20 + Math.random() * 20 });
      this.timer = 4 + Math.random() * 4;
      return;
    }
    const r = Math.random();
    if (r < 0.4) {
      // 走一段：朝离边界远的那边走的概率大一些
      const mid = (this.bounds.min + this.bounds.max) / 2;
      const goLeft = Math.random() < (ch.x > mid ? 0.7 : 0.3);
      ch.setFacing(goLeft ? 'left' : 'right');
      ch.walking = true;
      this.state = 'walk';
      this.timer = 1.5 + Math.random() * 4;
      // 偶尔边走边点头（头和身体在不同层，可以叠加）
      if (Math.random() < 0.25 && ch.motions.nod) ch.play('nod');
    } else if (r < 0.9) {
      const name = this.pickAction();
      if (name) ch.play(name);
      this.timer = 3 + Math.random() * 5;
    } else {
      // 转过身去看看背后
      ch.setFacing('back');
      this.state = 'back';
      this.timer = 2 + Math.random() * 2;
    }
  }
}

