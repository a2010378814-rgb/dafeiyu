// 渲染任意参数组合，便于调试单个姿势。
// 用法：npx electron scripts/render-pose.cjs <输出.png> <朝向> '<参数 JSON>' [推进秒数] [额外代码]
//   例：npx electron scripts/render-pose.cjs out.png front '{"armL":2.2}' 1.5
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const [out, facing = 'front', json = '{}', secs = '1.5', extra = ''] = process.argv.slice(2);
const W = 600;
const H = 800;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: W, height: H, show: false, useContentSize: true,
    webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('PAGE', e.message); });
  await win.loadURL(`http://localhost:5178/puppet.html?ui=0&auto=0&facing=${facing}`);
  await win.webContents.executeJavaScript(`new Promise((ok, fail) => {
    let n = 0; const t = () => window.__ready ? ok(true) : (++n > 600 ? fail('timeout') : setTimeout(t, 100)); t(); })`);
  const url = await win.webContents.executeJavaScript(`(() => {
    const api = window.puppetApi; const c = api.character;
    api.renderer.setSize(${W}, ${H}, false); dispatchEvent(new Event('resize'));
    api.step(1);
    Object.assign(c.params, ${json});
    ${extra}
    api.step(${Number(secs)});
    return document.getElementById('c').toDataURL('image/png');
  })()`);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
