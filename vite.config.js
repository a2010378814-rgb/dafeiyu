import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const MOTIONS_DIR = resolve(import.meta.dirname, 'public/motions');

/**
 * 动作编辑器的保存接口（只在开发服务器里有）：
 * POST /__motions/save  { name, motion } → 写 public/motions/<name>.json，并把名字加进 index.json。
 */
function motionStore() {
  return {
    name: 'motion-store',
    configureServer(server) {
      server.middlewares.use('/__motions/save', (req, res) => {
        const reply = (code, obj) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(obj));
        };
        if (req.method !== 'POST') return reply(405, { ok: false, error: '只支持 POST' });
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > 2_000_000) req.destroy();
        });
        req.on('end', async () => {
          try {
            const { name, motion } = JSON.parse(body);
            if (!/^[a-z0-9_-]{1,40}$/i.test(name ?? '')) return reply(400, { ok: false, error: '名字不合法' });
            if (!motion || typeof motion !== 'object' || typeof motion.tracks !== 'object') {
              return reply(400, { ok: false, error: '动作数据不完整' });
            }
            await writeFile(resolve(MOTIONS_DIR, `${name}.json`), `${JSON.stringify({ ...motion, name }, null, 2)}\n`, 'utf8');
            const indexPath = resolve(MOTIONS_DIR, 'index.json');
            let names = [];
            try {
              names = JSON.parse(await readFile(indexPath, 'utf8'));
            } catch {
              names = [];
            }
            if (!names.includes(name)) names.push(name);
            await writeFile(indexPath, `${JSON.stringify(names, null, 2)}\n`, 'utf8');
            reply(200, { ok: true });
          } catch (e) {
            reply(500, { ok: false, error: String(e?.message ?? e) });
          }
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  server: { port: 5178, strictPort: true },
  plugins: [motionStore()],
  build: {
    rollupOptions: {
      input: {
        pet: resolve(import.meta.dirname, 'index.html'),
        viewer: resolve(import.meta.dirname, 'viewer.html'),
        puppet: resolve(import.meta.dirname, 'puppet.html'),
        editor: resolve(import.meta.dirname, 'motion-editor.html'),
      },
    },
  },
});
