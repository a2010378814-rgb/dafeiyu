// 桌宠的 Electron 主进程：透明小窗口、托盘和右键菜单、设置保存、和页面通信（接口见 preload.cjs）。
// 初版由 G老师（Codex）编写，Claude 接入时修正了右键菜单位置并加了 getCursor。
'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  net,
  protocol,
  screen,
  shell,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

// 正式模式下用自定义协议 pet:// 提供 dist 里的文件：页面要用 fetch 读图层清单和动作文件，
// 而 Chromium 不允许 fetch 读 file:// 地址。必须在 app ready 之前注册。
const distDir = path.join(__dirname, '../dist');
protocol.registerSchemesAsPrivileged([
  { scheme: 'pet', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function servePetProtocol() {
  protocol.handle('pet', (request) => {
    const { pathname } = new URL(request.url);
    const relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const file = path.normalize(path.join(distDir, relative));
    // 只允许读 dist 目录里的文件
    if (!file.startsWith(distDir + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

const dev = process.argv.includes('--dev');
const devUrl = 'http://127.0.0.1:5178/index.html';
const scales = [0.6, 0.8, 1, 1.25, 1.5];

let win = null;
let tray = null;
let settingsPath = '';
let settings = {};
let settingsDirty = false;
let saveTimer = null;
let ignoreMouse = true;
let motions = [];
let outfits = [];
let state = { free: false, scale: 1, talking: false, outfit: '' };
let quitting = false;
let wantVisible = true;

// ---- 桌面图标（只读）
// 常驻一个 PowerShell 读取器，1.5 秒输出一行 JSON；页面按需拉取最近一次结果。
// 注意：只拿位置，不移动、不删除任何图标。
let iconWatcher = null;
let iconState = { ok: false, count: 0, icons: [], updatedAt: 0, error: null };

/** 图标矩形是 Explorer 的物理像素，页面用的是 DIP：按所在屏幕的缩放比换算。 */
function toDipRect(rect) {
  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)) return null;
  const point = screen.screenToDipPoint({ x: rect.x, y: rect.y });
  const factor = screen.getDisplayNearestPoint(point)?.scaleFactor || 1;
  return {
    x: point.x,
    y: point.y,
    w: Math.round((rect.w ?? 0) / factor),
    h: Math.round((rect.h ?? 0) / factor),
  };
}

/** 本机可能只有 Windows PowerShell（没有 pwsh 7）：只在真实存在的绝对路径里挑，找不到就用自带的 5.1。 */
let resolvedShell = null;
function resolvePowerShell() {
  if (resolvedShell) return resolvedShell;
  const candidates = [];
  if (process.env.PWSH_PATH) candidates.push(process.env.PWSH_PATH);
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) candidates.push(path.join(dir, 'pwsh.exe'));
  candidates.push(
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  );
  resolvedShell = candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  }) || 'powershell.exe';
  return resolvedShell;
}

function startIconWatcher() {  if (iconWatcher) return;
  const script = path.join(__dirname, '..', '..', 'tools', 'desktop-icons.ps1');
  if (!fs.existsSync(script)) {
    iconState = { ...iconState, ok: false, error: 'missing-script' };
    return;
  }
  try {
    iconWatcher = spawn(
      resolvePowerShell(),
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Watch', '-Interval', '1500'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch (error) {
    iconState = { ...iconState, ok: false, error: error.message };
    return;
  }

  let buffer = '';
  iconWatcher.stdout.setEncoding('utf8');
  iconWatcher.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line.startsWith('{')) continue;
      try {
        const data = JSON.parse(line);
        if (data.ok && Array.isArray(data.icons)) {
          iconState = { ok: true, count: data.count, icons: data.icons.map(toDipRect).filter(Boolean), updatedAt: Date.now(), error: null };
        } else {
          iconState = { ...iconState, ok: false, error: data.error ?? 'bad-payload' };
        }
      } catch {
        // 半行或脏数据：丢掉，等下一次
      }
    }
  });
  iconWatcher.on('error', (error) => {
    iconState = { ...iconState, ok: false, error: error.message };
  });
  iconWatcher.on('exit', () => {
    iconWatcher = null;
  });
}

function stopIconWatcher() {
  if (!iconWatcher) return;
  const child = iconWatcher;
  iconWatcher = null;
  try {
    child.kill();
  } catch {
    // 已经退出
  }
}

function getWindow() {
  return win && !win.isDestroyed() ? win : null;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function serializeDisplay(display) {
  return {
    id: display.id,
    bounds: { ...display.bounds },
    workArea: { ...display.workArea },
    scaleFactor: display.scaleFactor,
  };
}

function readSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    settings = isObject(value) ? value : {};
  } catch {
    settings = {};
  }
}

function flushSettings() {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!settingsDirty || !settingsPath) return;

  const temporaryPath = `${settingsPath}.${process.pid}.tmp`;

  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(temporaryPath, JSON.stringify(settings, null, 2), 'utf8');
    fs.renameSync(temporaryPath, settingsPath);
    settingsDirty = false;
  } catch (error) {
    console.error('保存桌宠设置失败：', error.message);
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // 临时文件可能尚未创建。
    }
  }
}

function scheduleSettings(value) {
  if (!isObject(value)) return;

  try {
    // 只接受可以持久化的 JSON 对象，并与 IPC 参数解除引用。
    const copy = JSON.parse(JSON.stringify(value));
    if (!isObject(copy)) return;
    settings = copy;
  } catch {
    return;
  }

  settingsDirty = true;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSettings, 500);
}

function sendCommand(command) {
  const current = getWindow();
  if (!current || current.webContents.isDestroyed()) return;
  current.webContents.send('pet:command', command);
}

function setVisible(visible) {
  wantVisible = visible;
  const current = getWindow();
  if (!current) return;

  if (visible) {
    current.showInactive();
  } else {
    current.hide();
  }
  refreshTrayMenu();
}

function toggleVisible() {
  const current = getWindow();
  if (current) setVisible(!current.isVisible());
}

function buildMenu(forTray) {
  const template = [
    { label: 'Claude 桌宠', enabled: false },
    { type: 'separator' },
    {
      label: '动作',
      submenu: motions.length
        ? motions.map(({ name, label }) => ({
            label,
            click: () => sendCommand({ type: 'play', name }),
          }))
        : [{ label: '暂无动作', enabled: false }],
    },
    {
      label: '衣柜',
      submenu: [
        {
          label: '默认外观',
          type: 'radio',
          checked: !state.outfit,
          click: () => { state.outfit = ''; sendCommand({ type: 'outfit', name: '' }); refreshTrayMenu(); },
        },
        ...outfits.map((o) => ({
          label: o.label,
          type: 'radio',
          checked: state.outfit === o.name,
          click: () => { state.outfit = o.name; sendCommand({ type: 'outfit', name: o.name }); refreshTrayMenu(); },
        })),
      ],
    },
    {
      label: '自由活动',
      type: 'checkbox',
      checked: state.free,
      click: (item) => {
        state.free = item.checked;
        sendCommand({ type: 'free', on: item.checked });
        refreshTrayMenu();
      },
    },
    {
      label: '说话',
      type: 'checkbox',
      checked: state.talking,
      click: (item) => {
        state.talking = item.checked;
        sendCommand({ type: 'talk', on: item.checked });
        refreshTrayMenu();
      },
    },
    {
      label: '朝向',
      submenu: [
        ['正面', 'front'],
        ['朝左', 'left'],
        ['朝右', 'right'],
        ['背面', 'back'],
      ].map(([label, value]) => ({
        label,
        click: () => sendCommand({ type: 'facing', value }),
      })),
    },
    {
      label: '大小',
      submenu: scales.map((value) => ({
        label: `${Math.round(value * 100)}%`,
        type: 'radio',
        checked: state.scale === value,
        click: () => {
          state.scale = value;
          sendCommand({ type: 'scale', value });
          refreshTrayMenu();
        },
      })),
    },
    {
      label: '回到屏幕中间',
      click: () => sendCommand({ type: 'home' }),
    },
  ];

  if (forTray) {
    template.push({
      label: getWindow()?.isVisible() ? '隐藏' : '显示',
      click: toggleVisible,
    });
  }

  if (dev) {
    template.push({
      label: '打开动作编辑器',
      click: () => {
        shell
          .openExternal('http://127.0.0.1:5178/motion-editor.html')
          .catch((error) => {
            console.error('打开动作编辑器失败：', error.message);
          });
      },
    });
  }

  template.push(
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  );

  return Menu.buildFromTemplate(template);
}

function refreshTrayMenu() {
  if (tray && !tray.isDestroyed() && !quitting) {
    tray.setContextMenu(buildMenu(true));
  }
}

function createTray() {
  const iconPath = path.join(
    __dirname,
    dev ? '../public/icon.png' : '../dist/icon.png',
  );
  const source = nativeImage.createFromPath(iconPath);
  const icon = source.isEmpty()
    ? source
    : source.resize({ width: 16, height: 16 });

  tray = new Tray(icon);
  tray.setToolTip('Claude 桌宠');
  tray.on('click', toggleVisible);
  refreshTrayMenu();
}

function isTrustedSender(event) {
  const current = getWindow();
  return Boolean(
    current &&
      !current.webContents.isDestroyed() &&
      event.sender === current.webContents &&
      event.senderFrame === current.webContents.mainFrame,
  );
}

function registerIpc() {
  const handle = (name, callback) => {
    ipcMain.handle(`pet:${name}`, (event, ...args) => {
      if (!isTrustedSender(event)) return null;
      return callback(...args);
    });
  };

  const on = (name, callback) => {
    ipcMain.on(`pet:${name}`, (event, ...args) => {
      if (isTrustedSender(event)) callback(...args);
    });
  };

  handle('getInfo', () => {
    const current = getWindow();
    if (!current) return null;

    const bounds = current.getBounds();
    return {
      bounds,
      display: serializeDisplay(screen.getDisplayMatching(bounds)),
      displays: screen.getAllDisplays().map(serializeDisplay),
      settings,
      dev,
    };
  });

  handle('displayNear', (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const point = { x: Math.round(x), y: Math.round(y) };
    if (!isInt32(point.x) || !isInt32(point.y)) return null;
    return serializeDisplay(screen.getDisplayNearestPoint(point));
  });

  on('setBounds', (x, y, width, height) => {
    const current = getWindow();
    if (!current) return;
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) return;

    x = Math.round(x);
    y = Math.round(y);
    width = Math.round(width);
    height = Math.round(height);

    if (
      !isInt32(x) ||
      !isInt32(y) ||
      !isInt32(width) ||
      !isInt32(height) ||
      width <= 0 ||
      height <= 0
    ) return;

    // 高频路径只校验参数并更新窗口。
    current.setBounds({ x, y, width, height }, false);
  });

  on('setIgnoreMouse', (ignore) => {
    const current = getWindow();
    if (!current || typeof ignore !== 'boolean' || ignore === ignoreMouse) {
      return;
    }

    if (ignore) {
      current.setIgnoreMouseEvents(true, { forward: true });
    } else {
      current.setIgnoreMouseEvents(false);
    }
    ignoreMouse = ignore;
  });

  on('saveSettings', scheduleSettings);

  on('setOutfits', (list) => {
    if (!Array.isArray(list)) return;
    outfits = list
      .filter((item) => isObject(item) && typeof item.name === 'string' && typeof item.label === 'string')
      .map(({ name, label }) => ({ name, label }));
    refreshTrayMenu();
  });

  on('setMotions', (list) => {
    if (!Array.isArray(list)) return;
    motions = list
      .filter(
        (item) =>
          isObject(item) &&
          typeof item.name === 'string' &&
          typeof item.label === 'string',
      )
      .map(({ name, label }) => ({ name, label }));
    refreshTrayMenu();
  });

  on('setState', (value) => {
    if (!isObject(value)) return;
    let changed = false;

    for (const key of ['free', 'talking']) {
      if (typeof value[key] === 'boolean' && value[key] !== state[key]) {
        state[key] = value[key];
        changed = true;
      }
    }

    if (scales.includes(value.scale) && value.scale !== state.scale) {
      state.scale = value.scale;
      changed = true;
    }

    if (changed) refreshTrayMenu();
  });

  on('showMenu', () => {
    const current = getWindow();
    if (!current) return;
    // 不传坐标：默认弹在鼠标处（popup 的 x、y 是窗口内坐标，不是屏幕坐标）
    buildMenu(false).popup({ window: current });
  });

  // 全局鼠标位置：鼠标不在桌宠窗口上时，眼睛也能跟着鼠标
  handle('getCursor', () => screen.getCursorScreenPoint());

  // 桌面图标矩形（屏幕坐标，只读）。没有拿到就返回 ok:false，页面那边当"没有图标"处理。
  handle('desktopIcons', () => iconState);

  on('quit', () => app.quit());
}

function isInt32(value) {
  return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
}

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workArea;

  win = new BrowserWindow({
    width: 300,
    height: 420,
    x: workArea.x + workArea.width - 300 - 40,
    y: workArea.y + workArea.height - 420,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  const current = win;
  current.setAlwaysOnTop(true, 'floating');
  current.setIgnoreMouseEvents(true, { forward: true });
  ignoreMouse = true;

  current.once('ready-to-show', () => {
    if (!current.isDestroyed() && wantVisible) current.showInactive();
  });

  current.on('show', refreshTrayMenu);
  current.on('hide', refreshTrayMenu);
  current.on('closed', () => {
    if (win === current) win = null;
  });

  // 桌宠页面不需要导航或创建额外窗口。
  current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  current.webContents.on('will-navigate', (event) => event.preventDefault());
  current.webContents.on('will-attach-webview', (event) => event.preventDefault());

  const loading = dev ? current.loadURL(devUrl) : current.loadURL('pet://app/index.html');

  loading.catch((error) => {
    if (!quitting) console.error('加载桌宠页面失败：', error.message);
  });
}

function notifyDisplaysChanged() {
  sendCommand({ type: 'displays-changed' });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => setVisible(true));

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', () => {
    quitting = true;
    flushSettings();
  });

  app.on('will-quit', () => {
    stopIconWatcher();
    screen.removeListener('display-added', notifyDisplaysChanged);
    screen.removeListener('display-removed', notifyDisplaysChanged);
    screen.removeListener('display-metrics-changed', notifyDisplaysChanged);
    if (tray && !tray.isDestroyed()) tray.destroy();
    tray = null;
  });

  app.whenReady().then(() => {
    settingsPath = path.join(app.getPath('userData'), 'pet-settings.json');
    readSettings();
    registerIpc();
    if (!dev) servePetProtocol();
    createWindow();
    createTray();
    startIconWatcher();

    screen.on('display-added', notifyDisplaysChanged);
    screen.on('display-removed', notifyDisplaysChanged);
    screen.on('display-metrics-changed', notifyDisplaysChanged);
  }).catch((error) => {
    console.error('启动桌宠失败：', error.message);
    app.quit();
  });
}
