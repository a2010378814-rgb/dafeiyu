// 动作调度器：通道冲突、优先级、叠加。这些是"动作一多就抖"的根因所在，先用测试钉住行为。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Animator, exclusiveParams, motionsConflict, PARAM_INFO } from '../src/puppet/motion.js';

const track = (mode, v = 1) => ({ mode, keys: [[0, 0, 'linear'], [1, v, 'linear']] });

function motion(name, layer, tracks, extra = {}) {
  return { name, layer, duration: 2, fadeIn: 0, fadeOut: 0.2, tracks, ...extra };
}

/** 所有参数的初始值，避免 applyTrack 因为缺键而跳过。 */
function blankParams() {
  const q = {};
  for (const k of Object.keys(PARAM_INFO)) q[k] = 0;
  q.walk = 0; q.walkPhase = 0;
  return q;
}

const activeOf = (an) => an.active().sort();

test('独占参数：set/max 算，add/scale 不算，face 不算', () => {
  const m = motion('m', 'arms', {
    armL: track('set'),      // 独占
    pitch: track('max'),     // 独占
    lean: track('add'),      // 可叠加
    breath: track('scale'),  // 可缩放
    mouth: track('set'),     // face，不算
    blink: track('max'),     // face，不算
  });
  assert.deepEqual([...exclusiveParams(m)].sort(), ['armL', 'pitch']);
});

test('不写 mode 时按 PARAM_INFO 的默认模式判断', () => {
  const m = motion('m', 'arms', {
    armL: { keys: [[0, 0, 'linear']] },   // PARAM_INFO 里 armL 默认 set
    lean: { keys: [[0, 0, 'linear']] },   // lean 默认 add
  });
  assert.deepEqual([...exclusiveParams(m)], ['armL']);
});

test('writes 手动声明优先', () => {
  const m = motion('m', 'arms', { lean: track('add') }, { writes: ['lean'] });
  assert.deepEqual([...exclusiveParams(m)], ['lean']);
});

test('通道不重叠的动作可以同时播（旧行为会被同层踢掉）', () => {
  const an = new Animator();
  an.play(motion('a', 'arms', { armL: track('set') }));
  an.play(motion('b', 'head', { pitch: track('set') }));
  assert.deepEqual(activeOf(an), ['a', 'b']);
});

test('同一层里参数不重叠也能共存', () => {
  const an = new Animator();
  an.play(motion('a', 'arms', { armL: track('set') }));
  const second = an.play(motion('b', 'arms', { pitch: track('set') }));
  assert.ok(second, '不应该被拒绝');
  assert.deepEqual(activeOf(an), ['a', 'b']);
});

test('同一参数冲突时，同优先级新的替换旧的', () => {
  const an = new Animator();
  const a = an.play(motion('a', 'arms', { armL: track('set') }));
  an.play(motion('b', 'head', { armL: track('set') }));
  assert.notEqual(a.fadeOutStart, null, '旧动作应该开始淡出');
  assert.deepEqual(activeOf(an), ['b']);
});

test('低优先级动作被拒绝，且不打断高优先级动作', () => {
  const an = new Animator();
  const a = an.play(motion('big', 'body', { bob: track('set') }, { priority: 2 }));
  const res = an.play(motion('small', 'head', { bob: track('set') }, { priority: 1 }));
  assert.equal(res, null);
  assert.equal(a.fadeOutStart, null, '高优先级动作不该被影响');
  assert.deepEqual(activeOf(an), ['big']);
});

test('高优先级可以抢占低优先级', () => {
  const an = new Animator();
  const low = an.play(motion('low', 'body', { bob: track('set') }, { priority: 0 }));
  an.play(motion('high', 'body', { bob: track('set') }, { priority: 2 }));
  assert.notEqual(low.fadeOutStart, null);
  assert.deepEqual(activeOf(an), ['high']);
});

test('face 参数不判冲突：两个动作都改嘴型也能共存', () => {
  const an = new Animator();
  an.play(motion('a', 'face', { mouth: track('set', 3) }));
  an.play(motion('b', 'face', { mouth: track('set', 5) }));
  assert.deepEqual(activeOf(an), ['a', 'b']);
});

test('可叠加参数不判冲突：两个动作都 add lean 也能共存', () => {
  const an = new Animator();
  an.play(motion('a', 'body', { lean: track('add', 0.05) }));
  an.play(motion('b', 'body', { lean: track('add', 0.03) }));
  assert.deepEqual(activeOf(an), ['a', 'b']);
});

test('motionsConflict 对称', () => {
  const a = motion('a', 'arms', { armL: track('set') });
  const b = motion('b', 'head', { armL: track('set') });
  const c = motion('c', 'head', { pitch: track('set') });
  assert.equal(motionsConflict(a, b), true);
  assert.equal(motionsConflict(b, a), true);
  assert.equal(motionsConflict(a, c), false);
});

test('连续播 200 次不崩，参数始终有限', () => {
  const names = ['wave', 'hop', 'nod', 'shake', 'tilt', 'stretch', 'sleepy', 'look', 'pet'];
  const defs = names.map((n, i) => motion(n, ['body', 'arms', 'head', 'face'][i % 4], {
    armL: track('set', 0.5), bob: track('add', -3), mouth: track('set', 2),
  }, { priority: i % 3 }));
  const an = new Animator();
  const q = blankParams();
  for (let i = 0; i < 200; i++) {
    an.play(defs[i % defs.length]);
    for (let f = 0; f < 6; f++) { an.update(1 / 60, q); }
    for (const [k, v] of Object.entries(q)) {
      assert.ok(Number.isFinite(v), `${k} 在压力测试里变成 ${v}`);
    }
    // 每帧参数不能剧烈跳变（set 类参数一帧跳超过量程就算抖）
    for (const p of ['armL', 'pitch', 'yaw', 'mouth']) {
      assert.ok(Math.abs(q[p]) <= 10, `${p} 越界: ${q[p]}`);
    }
  }
});

test('release 走完淡出后动作被移除，busy 归位', () => {
  const an = new Animator();
  an.play(motion('a', 'head', { pitch: track('set') }));
  assert.equal(an.busy(), true);
  an.release('a', true);
  const q = blankParams();
  for (let i = 0; i < 240; i++) an.update(1 / 60, q); // 4 秒，留浮点余量
  assert.equal(an.busy(), false);
  assert.deepEqual(activeOf(an), []);
});
