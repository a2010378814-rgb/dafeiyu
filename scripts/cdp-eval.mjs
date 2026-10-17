// 在运行中的桌宠页面里执行一段代码并打印结果（桌宠需带 --remote-debugging-port=9333 启动）。
// 用法：node scripts/cdp-eval.mjs "<表达式>"   例：node scripts/cdp-eval.mjs "petApi.win"
const expr = process.argv[2] ?? 'document.title';
const list = await (await fetch('http://127.0.0.1:9333/json')).json();
const page = list.find((p) => p.type === 'page' && p.url.includes('index.html'));
if (!page) throw new Error('没找到桌宠页面');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
ws.send(JSON.stringify({
  id: 1, method: 'Runtime.evaluate',
  params: { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true },
}));
const msg = await new Promise((ok) => { ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) ok(m); }; });
ws.close();
const r = msg.result;
if (r.exceptionDetails) console.log('ERROR', r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
else console.log(JSON.stringify(r.result.value, null, 1));
