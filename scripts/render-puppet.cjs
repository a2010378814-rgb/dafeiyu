// 用 Electron 在后台渲染 2D 动画的若干姿态，保存 PNG，供检查效果。
// 用法：先启动开发服务器（npx vite --port 5178），然后
//   npx electron scripts/render-puppet.cjs <输出目录>
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const outDir = path.resolve(process.argv[2] || 'puppet-renders');
const W = 600;
const H = 800;
// 每个姿态：参数 + 推进的秒数（让物理稳定下来）
const POSES = {
  neutral: [{}, 1.5],
  yaw_left: [{ yaw: -0.2, eyeX: -0.8 }, 1.5],
  yaw_right: [{ yaw: 0.2, eyeX: 0.8 }, 1.5],
  pitch_up: [{ pitch: -0.14, eyeY: -0.8 }, 1.5],
  pitch_down: [{ pitch: 0.14, eyeY: 0.8 }, 1.5],
  roll: [{ roll: 0.12 }, 1.5],
  blink: [{ blinkL: 1, blinkR: 1 }, 0.5],
  half_blink: [{ blinkL: 0.5, blinkR: 0.5 }, 0.5],
  mouth_closed: [{ mouth: 0 }, 0.5],
  mouth_half: [{ mouth: 0.6 }, 0.5],
  arms: [{ armL: 0.35, armR: 0.35 }, 1.5],
};

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({ width: W, height: H, show: false, useContentSize: true,
    webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('PAGE', e.message); });
  await win.loadURL('http://localhost:5178/puppet.html?ui=0&auto=0');
  await win.webContents.executeJavaScript(`new Promise((ok, fail) => {
    let n = 0; const t = () => window.__ready ? ok(true) : (++n > 600 ? fail('timeout') : setTimeout(t, 100)); t(); })`);
  const only = process.argv[3] ? process.argv[3].split(',') : Object.keys(POSES);
  for (const name of only) {
    const [p, secs] = POSES[name];
    const url = await win.webContents.executeJavaScript(`(() => {
      const api = window.puppetApi;
      for (const k in api.puppet.params) api.puppet.params[k] = 0;
      Object.assign(api.puppet.params, { mouth: 1 }, ${JSON.stringify(p)});
      api.renderer.setSize(${W}, ${H}, false);
      dispatchEvent(new Event('resize'));
      api.step(${secs});
      return document.getElementById('c').toDataURL('image/png');
    })()`);
    fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
    console.log('saved', name);
  }
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
