// 打开任意页面截图，并打印页面的报错（用于检查编辑器等页面能否正常运行）。
// 用法：npx electron scripts/shot.cjs <页面，如 motion-editor.html> <输出.png> [等待毫秒] [截图前执行的代码]
// （不要直接传网址：Electron 会把像网址的命令行参数当成要打开的页面，脚本就不运行了）
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');

const [page, out, wait = '3000', code = ''] = process.argv.slice(2);
const url = `http://127.0.0.1:5178/${page}`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1400, height: 900, show: false, webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') console.log(`PAGE ${e.level}:`, e.message);
  });
  await win.loadURL(url);
  await new Promise((r) => setTimeout(r, Number(wait)));
  if (code) console.log('RESULT', JSON.stringify(await win.webContents.executeJavaScript(code)));
  await new Promise((r) => setTimeout(r, 500));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG());
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
