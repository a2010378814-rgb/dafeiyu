// 用 Electron 在后台渲染角色的各个朝向、走路帧和转身过程，保存 PNG 供检查。
// 用法：先启动开发服务器（npx vite --port 5178），然后
//   npx electron scripts/render-character.cjs <输出目录>
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const outDir = path.resolve(process.argv[2] || 'character-renders');
const W = 600;
const H = 800;

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
  const shot = async (name) => {
    const url = await run(`api.step(0); return document.getElementById('c').toDataURL('image/png');`);
    fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
  };
  // 各朝向静止
  for (const f of ['front', 'left', 'right', 'back']) {
    await run(`c.walking = false; c.setFacing('${f}'); api.step(1.5);`);
    await shot(`facing_${f}`);
  }
  // 朝左走路：一个周期取 8 帧
  await run(`c.setFacing('left'); c.walking = true; api.step(2);`);
  for (let i = 0; i < 8; i++) {
    await run(`api.step(0.09);`);
    await shot(`walk_${i}`);
  }
  // 转身过程：从朝左停下，转到背面（经过正面？不，左 → 背面直接），再到正面
  await run(`c.walking = false; api.step(1.5); c.setFacing('back');`);
  for (let i = 0; i < 8; i++) {
    await run(`api.step(1 / 30);`);
    await shot(`turn_${i}`);
  }
  console.log('done', outDir);
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
