// 把 model/ 里构建好的 VRM 复制到 public/models/。
// 独立仓库里通常没有 model/（那是建模工程），public/models 已经带了成品，跳过即可。
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(appDir, '..', 'model', 'claude-whale.vrm');
const dstDir = join(appDir, 'public', 'models');

if (!existsSync(src)) {
  console.log('没找到 model/claude-whale.vrm，直接用 public/models 里现成的模型。');
  process.exit(0);
}
mkdirSync(dstDir, { recursive: true });
copyFileSync(src, join(dstDir, 'claude-whale.vrm'));
console.log('model synced ->', join(dstDir, 'claude-whale.vrm'));