// 把分层 PSD 拆成一张张 PNG，并输出图层清单 layers.json（名称、层级、位置、尺寸、可见性、不透明度、混合模式）。
// 用法：node scripts/psd-export.mjs <输入.psd> <输出目录>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initializeCanvas, readPsd } from 'ag-psd';
import { PNG } from 'pngjs';

// Node 里没有 canvas：只提供 ImageData 的替代实现（useImageData 模式下够用）
initializeCanvas(
  () => { throw new Error('canvas not available'); },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
);

const [, , input, outDir] = process.argv;
mkdirSync(outDir, { recursive: true });
const psd = readPsd(readFileSync(input), { useImageData: true, skipThumbnail: true });
const layers = [];
let n = 0;

function safe(name) {
  return name.replace(/[\\/:*?"<>|\s]+/g, '_');
}

function walk(children, path) {
  for (const layer of children ?? []) {
    const name = layer.name ?? `layer${n}`;
    if (layer.children) {
      walk(layer.children, [...path, name]);
      continue;
    }
    const idx = n++;
    const entry = {
      index: idx, name, group: path.join('/'), hidden: !!layer.hidden,
      opacity: layer.opacity ?? 1, blendMode: layer.blendMode ?? 'normal',
      left: layer.left ?? 0, top: layer.top ?? 0, right: layer.right ?? 0, bottom: layer.bottom ?? 0,
    };
    const img = layer.imageData;
    if (img && img.width > 0 && img.height > 0) {
      const png = new PNG({ width: img.width, height: img.height });
      png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
      const file = `${String(idx).padStart(2, '0')}_${safe(name)}.png`;
      writeFileSync(join(outDir, file), PNG.sync.write(png));
      entry.file = file;
    }
    layers.push(entry);
  }
}

walk(psd.children, []);
const doc = { width: psd.width, height: psd.height, layers };
writeFileSync(join(outDir, 'layers.json'), JSON.stringify(doc, null, 1));
console.log(`PSD ${psd.width}x${psd.height}, ${layers.length} layers`);
for (const l of layers) {
  console.log(`${String(l.index).padStart(2)} ${l.hidden ? 'H' : ' '} ${l.group ? l.group + '/' : ''}${l.name}  ` +
    `[${l.left},${l.top} - ${l.right},${l.bottom}] op=${l.opacity} ${l.blendMode}`);
}
