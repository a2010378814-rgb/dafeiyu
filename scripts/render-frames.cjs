// 按时间序列渲染若干帧（用于检查动作、转身、走路），每帧一张 PNG。
// 用法：npx electron scripts/render-frames.cjs <输出目录> <名称> <准备代码> <帧数> <帧间隔秒> [每帧前代码]
//   准备代码里可用 api（window.puppetApi）和 c（角色），例如 "c.play('wave')"
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const [outDir, name, setup, count = '8', every = '0.1', before = ''] = process.argv.slice(2);
const W = Number(process.env.W || 600);
const H = Number(process.env.H || 800);

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({ width: W, height: H, show: false, useContentSize: true,
    webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('PAGE', e.message); });
  await win.loadURL('http://localhost:5178/puppet.html?ui=0&auto=0');
  await win.webContents.executeJavaScript(`new Promise((ok, fail) => {
    let n = 0; const t = () => window.__ready ? ok(true) : (++n > 600 ? fail('timeout') : setTimeout(t, 100)); t(); })`);
  const run = (code) => win.webContents.executeJavaScript(`(() => { const api = window.puppetApi; const c = api.character;
    api.renderer.setSize(${W}, ${H}, false); dispatchEvent(new Event('resize')); ${code} })()`);
  await run(`api.step(1); ${setup};`);
  for (let i = 0; i < Number(count); i++) {
    const url = await run(`${before}; api.step(${Number(every)}); return document.getElementById('c').toDataURL('image/png');`);
    fs.writeFileSync(path.join(outDir, `${name}_${String(i).padStart(2, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
  }
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
