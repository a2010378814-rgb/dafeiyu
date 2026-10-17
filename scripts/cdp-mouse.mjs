// 通过调试端口给运行中的桌宠页面发模拟鼠标事件（只发给页面，不动真实鼠标），用于测试拖动、点击。
// 用法：node scripts/cdp-mouse.mjs '<JSON 事件数组>'
//   每个事件 [类型, x, y, 等待毫秒]，类型：move / down / up / right；x、y 是窗口内坐标
const events = JSON.parse(process.argv[2]);
const list = await (await fetch('http://127.0.0.1:9333/json')).json();
const page = list.find((p) => p.type === 'page' && p.url.includes('index.html'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
let id = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); };
const call = (method, params) => new Promise((ok) => { pending.set(++id, ok); ws.send(JSON.stringify({ id, method, params })); });
const TYPES = { move: 'mouseMoved', down: 'mousePressed', up: 'mouseReleased' };
let pressed = false;
for (const [t, x, y, ms = 30] of events) {
  if (t === 'right') {
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 });
  } else {
    if (t === 'down') pressed = true;
    if (t === 'up') pressed = false;
    await call('Input.dispatchMouseEvent', {
      type: TYPES[t], x, y, button: t === 'move' && !pressed ? 'none' : 'left',
      buttons: pressed || t === 'up' ? 1 : 0, clickCount: t === 'move' ? 0 : 1,
    });
  }
  await new Promise((r) => setTimeout(r, ms));
}
ws.close();
console.log('sent', events.length, 'events');
