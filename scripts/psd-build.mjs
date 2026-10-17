// 按 manifest.json（layers_fix.py 的输出）把修好的图层写回一个分层 PSD，图层名采用 See-through / Anime2.5DRig 的命名。
// 用法：node scripts/psd-build.mjs <图层目录> <输出.psd>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initializeCanvas, writePsdBuffer } from 'ag-psd';
import { PNG } from 'pngjs';

initializeCanvas(
  () => { throw new Error('canvas not available'); },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
);

// 补出来的部件改成规范名
const RENAME = { 'ear-r': 'ears', 'ear-l': 'ears', 'footwear-r': 'footwear', 'footwear-l': 'footwear' };

const [, , dir, out] = process.argv;
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const { width, height } = manifest;
const composite = new Uint8ClampedArray(width * height * 4);
const children = [];
for (const l of manifest.layers) {
  const png = PNG.sync.read(readFileSync(join(dir, l.file)));
  const data = new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength);
  children.push({
    name: RENAME[l.name] ?? l.name,
    left: l.x, top: l.y, right: l.x + l.w, bottom: l.y + l.h,
    imageData: { width: l.w, height: l.h, data },
  });
  // 合成预览图（简单的 alpha 叠加）
  for (let y = 0; y < l.h; y++) {
    for (let x = 0; x < l.w; x++) {
      const s = (y * l.w + x) * 4;
      const a = data[s + 3] / 255;
      if (a === 0) continue;
      const d = ((l.y + y) * width + (l.x + x)) * 4;
      for (let c = 0; c < 3; c++) composite[d + c] = data[s + c] * a + composite[d + c] * (1 - a);
      composite[d + 3] = Math.min(255, data[s + 3] + composite[d + 3] * (1 - a));
    }
  }
}
const buffer = writePsdBuffer({ width, height, children, imageData: { width, height, data: composite } },
  { generateThumbnail: false });
writeFileSync(out, buffer);
console.log('wrote', out, children.map((c) => c.name).join(', '));
