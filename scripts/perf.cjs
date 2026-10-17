// 性能测试：开一个和桌宠一样的透明置顶窗口（放在主屏幕左下角），分几种情况测各进程的 CPU 占用。
// 用法：先启动开发服务器，然后 npx electron scripts/perf.cjs
// 结果按"单个核心的百分比"换算（Electron 给的是整机百分比，乘以逻辑核心数）。
const { app, BrowserWindow, screen } = require('electron');
const os = require('node:os');

const SECS = 8;
const CORES = os.cpus().length;
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

async function measure(name) {
  app.getAppMetrics(); // 清零计数
  await wait(SECS);
  const m = app.getAppMetrics();
  const per = (p) => p.cpu.percentCPUUsage * CORES;
  const parts = m.map((p) => `${p.type} ${per(p).toFixed(1)}`).join('，');
  const total = m.reduce((s, p) => s + per(p), 0);
  console.log(`${name}：合计单核 ${total.toFixed(1)}%（${parts}）`);
}

app.whenReady().then(async () => {
  const wa = screen.getPrimaryDisplay().workArea;
  const make = async (w, h, x) => {
    const win = new BrowserWindow({
      width: w, height: h, x, y: wa.y + wa.height - h,
      frame: false, transparent: true, resizable: false, hasShadow: false, skipTaskbar: true,
      alwaysOnTop: true, focusable: false, show: false,
      webPreferences: { backgroundThrottling: false },
    });
    win.setIgnoreMouseEvents(true, { forward: true });
    await win.loadURL('http://127.0.0.1:5178/index.html');
    win.showInactive();
    await wait(3);
    return win;
  };
  console.log(`逻辑核心 ${CORES}，刷新率 ${screen.getPrimaryDisplay().displayFrequency}Hz`);

  // 小窗口
  let win = await make(215, 346, wa.x + 20);
  const run = (code) => win.webContents.executeJavaScript(`(() => { const a = window.petApi; const c = a.character; ${code} })()`);
  await run('a.behavior.enabled = false; c.walking = false;');
  await wait(1);
  await measure('小窗口 · 只待机（按状态分档帧率）');
  await run('c.setFacing("left"); c.walking = true;');
  await wait(1);
  await measure('小窗口 · 走路（窗口不动）');
  // 走路时每帧移动窗口（模拟实际桌宠）
  let x = wa.x + 400;
  const mover = setInterval(() => {
    x -= 2;
    if (x < wa.x + 20) x = wa.x + 400;
    win.setBounds({ x, y: wa.y + wa.height - 346, width: 215, height: 346 });
  }, 16);
  await measure('小窗口 · 走路 + 每帧移动窗口');
  clearInterval(mover);
  win.destroy();

  app.quit();
});
