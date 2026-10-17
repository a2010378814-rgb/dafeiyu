// 渲染一段连续动作的若干帧（看向左边 → 突然看向右边），检查惯性、过冲、眼头身的先后跟随。
// 用法：npx electron scripts/render-sequence.cjs <输出目录>
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const outDir = path.resolve(process.argv[2] || 'seq');
app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({ width: 600, height: 800, show: false, useContentSize: true,
    webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('PAGE', e.message); });
  await win.loadURL('http://localhost:5178/puppet.html?ui=0');
  await win.webContents.executeJavaScript(`new Promise(ok => { const t = () => window.__ready ? ok() : setTimeout(t, 100); t(); })`);
  await win.webContents.executeJavaScript(`(() => {
    const api = window.puppetApi; api.idle.enabled = true; Math.random = () => 0.99;
    api.idle.setLookTarget(-0.85, -0.5); api.step(2.0); })()`);
  const log = [];
  for (let i = 0; i < 10; i++) {
    const r = await win.webContents.executeJavaScript(`(() => {
      const api = window.puppetApi;
      if (${i} === 0) api.idle.setLookTarget(0.85, -0.5);
      api.step(${i === 0 ? 0.02 : 0.12});
      const p = api.puppet.params;
      return { url: document.getElementById('c').toDataURL('image/png'),
        p: [p.eyeX, p.yaw, p.bodyTurn, p.roll].map(v => +v.toFixed(3)) };
    })()`);
    fs.writeFileSync(path.join(outDir, `f${String(i).padStart(2, '0')}.png`), Buffer.from(r.url.split(',')[1], 'base64'));
    log.push(`f${i}: eyeX=${r.p[0]} yaw=${r.p[1]} bodyTurn=${r.p[2]} roll=${r.p[3]}`);
  }
  console.log(log.join('\n'));
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
