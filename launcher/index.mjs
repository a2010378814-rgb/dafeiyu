#!/usr/bin/env node
// 桌宠启动器：缺依赖就先装、没构建就先打包，然后把 Electron 窗口拉起来。
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PKG = createRequire(import.meta.url)(path.join(ROOT, 'package.json'));
const require = createRequire(import.meta.url);
const IS_WIN = process.platform === 'win32';

export function parseArgs(argv) {
  const args = {rebuild: false, help: false, error: null};
  for (const arg of argv) {
    if (arg === '--rebuild') args.rebuild = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else args.error = `看不懂的参数：${arg}`;
  }
  return args;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      stdio: 'inherit',
      shell: IS_WIN,
      windowsHide: false,
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} 退出码 ${code}`))));
  });
}

function usage() {
  return [
    '桌宠启动器',
    '',
    '  node launcher/index.mjs [--rebuild]',
    '',
    '  --rebuild   强制重新构建页面',
  ].join('\n');
}

function main(args) {
  const installed = existsSync(path.join(ROOT, 'node_modules', 'electron'));
  const built = existsSync(path.join(ROOT, 'dist', 'index.html'));

  if (!installed) {
    console.log('');
    console.log('  第一次启动，先把依赖装上（要下载几百 MB，等一会儿）...');
    console.log('');
  }

  const npm = IS_WIN ? 'npm.cmd' : 'npm';

  const steps = [];
  if (!installed) steps.push(() => run(npm, ['install', '--no-audit', '--no-fund']));
  if (args.rebuild || !built) steps.push(() => run(npm, ['run', 'build']));

  return steps
    .reduce((chain, step) => chain.then(step), Promise.resolve())
    .then(() => {
      const electron = require('electron');
      console.log('');
      console.log(`  桌宠起来了  ${PKG.version}`);
      console.log('  托盘图标 / 右键菜单都能关它');
      console.log('');
      return new Promise((resolve, reject) => {
        // 有些终端会带 ELECTRON_RUN_AS_NODE，那会让 electron 退化成 node，必须先摘掉。
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(electron, ['.'], {cwd: ROOT, stdio: 'inherit', env});
        child.on('error', reject);
        child.on('exit', (code) => resolve(code ?? 0));
      });
    })
    .then((code) => {
      process.exitCode = typeof code === 'number' ? code : 0;
    });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(args.error);
    process.exitCode = 1;
  } else if (args.help) {
    console.log(usage());
  } else {
    main(args).catch((error) => {
      console.error('');
      console.error(`启动失败：${error.message}`);
      process.exitCode = 1;
    });
  }
}