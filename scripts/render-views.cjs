// 用 Electron 在后台按参考三视图的比例渲染模型，保存 PNG，供和参考图对比。
// 用法：先启动开发服务器（npx vite --port 5178），然后
//   npx electron scripts/render-views.cjs <输出目录> [视图,视图...] [额外查询参数]
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const outDir = path.resolve(process.argv[2] || 'renders');
const views = (process.argv[3] || 'front,side,back,face').split(',');
const extra = process.argv[4] || '';
const W = 640;
const H = 1164; // 宽高比与 compare.py 的裁切一致（0.55）

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({ width: W, height: H, show: false, useContentSize: true,
    webPreferences: { backgroundThrottling: false } });
  win.webContents.session.webRequest.onErrorOccurred((d) => console.log('REQERR', d.error, d.url));
  // 额外参数可以覆盖默认值，例如 "model=/models/claude-whale-ai.vrm&pose=rest"
  const q = new URLSearchParams({ ui: '0', spring: '0', pose: 'relaxed' });
  for (const [k, v] of new URLSearchParams(extra)) q.set(k, v);
  await win.loadURL(`http://localhost:5178/viewer.html?${q}`);
  await win.webContents.executeJavaScript(`new Promise((ok, fail) => {
    let n = 0; const t = () => window.__ready ? ok(true) : (++n > 900 ? fail('timeout: ' + document.getElementById('status').textContent) : setTimeout(t, 100)); t(); })`);
  for (const v of views) {
    const dataUrl = await win.webContents.executeJavaScript(`(() => {
      viewer.renderer.setSize(${W}, ${H}, false);
      viewer.applyView('${v}');
      viewer.renderOnce();
      return document.getElementById('c').toDataURL('image/png');
    })()`);
    const file = path.join(outDir, `three_${v}.png`);
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('saved', file);
  }
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
