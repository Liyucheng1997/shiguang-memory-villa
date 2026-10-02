// 拾光回忆馆 · 本地服务器
// - 托管前端（public/）和藏品数据（data/items/）
// - 接收照片上传，排队调用本机 `claude` CLI（Opus 5.5 · high effort，走本地订阅额度）生成 3D 模型
import express from 'express';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Generator, claudeStatus } from './generator.js';
import { ROOMS, defaultDecor } from '../public/js/rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const ITEMS = path.join(DATA, 'items');
const TRASH = path.join(DATA, 'trash');
const PORT = Number(process.env.PORT || 5344);

await fs.mkdir(ITEMS, { recursive: true });

const app = express();
app.use(express.json({ limit: '60mb' }));

// ---------------------------------------------------------------- 工具函数
const metaPath = id => path.join(ITEMS, id, 'meta.json');
const validId = id => /^[a-z0-9][a-z0-9-]{2,60}$/.test(id);

async function readMeta(id) {
  return JSON.parse(await fs.readFile(metaPath(id), 'utf8'));
}
async function writeMeta(id, meta) {
  const tmp = metaPath(id) + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(meta, null, 2), 'utf8');
  await fs.rename(tmp, metaPath(id));
  return meta;
}
async function patchMeta(id, patch) {
  const m = await readMeta(id);
  return writeMeta(id, { ...m, ...patch, updatedAt: new Date().toISOString() });
}
async function listItems() {
  const dirs = await fs.readdir(ITEMS, { withFileTypes: true });
  const out = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    try {
      const m = await readMeta(d.name);
      // 每次模型更新都换一个版本号，浏览器不会拿到旧缓存
      try { m.modelVersion = Math.round((await fs.stat(path.join(ITEMS, d.name, 'model.js'))).mtimeMs); } catch { m.modelVersion = 0; }
      out.push(m);
    } catch { /* 忽略损坏的目录 */ }
  }
  return out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}
function newId(name) {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(2, 14);
  const rand = Math.random().toString(36).slice(2, 6);
  return `item-${stamp}-${rand}`;
}

const generator = new Generator({
  itemsDir: ITEMS,
  root: ROOT,
  port: PORT,
  readMeta, patchMeta,
});

// ---------------------------------------------------------------- API
app.get('/api/status', async (_req, res) => {
  res.json({ claude: await claudeStatus(), queue: generator.queueInfo(), rooms: ROOMS.map(r => ({ id: r.id, name: r.name })) });
});

app.get('/api/items', async (_req, res) => res.json(await listItems()));

app.get('/api/items/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'bad id' });
  try { res.json(await readMeta(req.params.id)); } catch { res.status(404).json({ error: 'not found' }); }
});

// 新增藏品：{ name, story, discardedAt, room, photos: [dataURL, ...], notes }
app.post('/api/items', async (req, res) => {
  const { name = '', story = '', discardedAt = '', room = 'auto', photos = [], notes = '' } = req.body || {};
  if (!Array.isArray(photos) || photos.length === 0) return res.status(400).json({ error: '至少需要一张照片' });
  if (photos.length > 6) return res.status(400).json({ error: '最多 6 张照片' });
  const id = newId(name);
  const dir = path.join(ITEMS, id);
  await fs.mkdir(dir, { recursive: true });
  const saved = [];
  for (let i = 0; i < photos.length; i++) {
    const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/s.exec(photos[i]);
    if (!m) continue;
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const fname = i === 0 ? `photo.${ext}` : `photo-${i + 1}.${ext}`;
    await fs.writeFile(path.join(dir, fname), Buffer.from(m[2], 'base64'));
    saved.push(fname);
  }
  if (!saved.length) { await fs.rm(dir, { recursive: true, force: true }); return res.status(400).json({ error: '照片格式不支持（请用 JPG/PNG/WebP）' }); }
  const meta = await writeMeta(id, {
    id, name: String(name).slice(0, 60) || '未命名的旧物', story: String(story).slice(0, 4000),
    notes: String(notes).slice(0, 1000), discardedAt: String(discardedAt).slice(0, 40),
    room: ROOMS.some(r => r.id === room) ? room : 'auto',
    roomLocked: ROOMS.some(r => r.id === room),
    createdAt: new Date().toISOString(), status: 'queued', photos: saved, generator: 'claude-opus-5-5 · effort high',
  });
  generator.enqueue(id);
  res.json(meta);
});

app.patch('/api/items/:id', async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) return res.status(400).json({ error: 'bad id' });
  const allowed = ['name', 'story', 'discardedAt', 'room', 'era', 'category'];
  const body = req.body || {};
  const patch = {};
  for (const k of allowed) if (k in body) patch[k] = String(body[k]).slice(0, 4000);
  if (patch.room) { patch.roomLocked = true; if (!('placement' in body)) patch.placement = null; }
  // 缩放：0.1 ~ 5 倍
  if ('scale' in body) { const v = Number(body.scale); if (Number.isFinite(v)) patch.scale = Math.min(5, Math.max(0.1, v)); }
  // 手动摆放：{ room, x, y, z, rot, pedestal }；null = 恢复自动摆放
  if ('placement' in body) {
    const pl = body.placement;
    if (pl === null) patch.placement = null;
    else if (pl && ['x', 'y', 'z', 'rot'].every(k => Number.isFinite(Number(pl[k]))) && ROOMS.some(r => r.id === pl.room)) {
      patch.placement = { room: pl.room, x: +pl.x, y: +pl.y, z: +pl.z, rot: +pl.rot, ...(typeof pl.pedestal === 'boolean' ? { pedestal: pl.pedestal } : {}) };
      patch.room = pl.room; patch.roomLocked = true;
    }
  }
  try { res.json(await patchMeta(id, patch)); } catch { res.status(404).json({ error: 'not found' }); }
});

// 重新生成 / 带反馈地修改模型
app.post('/api/items/:id/regenerate', async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) return res.status(400).json({ error: 'bad id' });
  try {
    const feedback = String(req.body?.feedback || '').slice(0, 2000);
    await patchMeta(id, { status: 'queued', error: null, feedback });
    generator.enqueue(id, { feedback, refine: Boolean(req.body?.refine) });
    res.json({ ok: true });
  } catch { res.status(404).json({ error: 'not found' }); }
});

// 整栋房子的装修（地板/墙面/墙裙/灯具/时间）
const VILLA_FILE = path.join(DATA, 'villa.json');
app.get('/api/villa', async (_req, res) => {
  try { res.json(JSON.parse(await fs.readFile(VILLA_FILE, 'utf8'))); } catch { res.json(defaultDecor()); }
});
app.put('/api/villa', async (req, res) => {
  const def = defaultDecor(), body = req.body || {};
  const out = { time: ['morning', 'noon', 'dusk', 'night'].includes(body.time) ? body.time : def.time, rooms: {} };
  for (const id of Object.keys(def.rooms)) {
    const r = body.rooms?.[id] || {}, d = def.rooms[id], L = r.light || {};
    out.rooms[id] = {
      floor: typeof r.floor === 'string' ? r.floor.slice(0, 40) : d.floor,
      wall: typeof r.wall === 'string' ? r.wall.slice(0, 40) : d.wall,
      dado: typeof r.dado === 'string' ? r.dado.slice(0, 40) : d.dado,
      light: {
        style: typeof L.style === 'string' ? L.style.slice(0, 20) : d.light.style,
        kelvin: Math.min(6500, Math.max(1800, Number(L.kelvin) || d.light.kelvin)),
        intensity: Math.min(3, Math.max(0, Number.isFinite(+L.intensity) ? +L.intensity : d.light.intensity)),
        on: typeof L.on === 'boolean' ? L.on : true,
      },
    };
  }
  const tmp = VILLA_FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(out, null, 2), 'utf8');
  await fs.rename(tmp, VILLA_FILE);
  res.json(out);
});

app.get('/api/jobs/:id', (req, res) => res.json(generator.job(req.params.id) || { status: 'unknown', log: [] }));

app.post('/api/items/:id/cancel', (req, res) => res.json({ ok: generator.cancel(req.params.id) }));

// “删除”只是移进 data/trash，永不真正抹掉回忆
app.delete('/api/items/:id', async (req, res) => {
  const { id } = req.params;
  if (!validId(id) || id === 'wardrobe-001') return res.status(400).json({ error: 'bad id' });
  await generator.cancelAndWait(id);
  await fs.mkdir(TRASH, { recursive: true });
  // Windows 上刚结束的 claude 进程可能还占着目录，稍等重试
  for (let i = 0; i < 12; i++) {
    try {
      await fs.rename(path.join(ITEMS, id), path.join(TRASH, `${id}-${Date.now()}`));
      return res.json({ ok: true });
    } catch (e) {
      if (e.code === 'ENOENT') return res.status(404).json({ error: 'not found' });
      if (e.code !== 'EBUSY' && e.code !== 'EPERM') throw e;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  res.status(409).json({ error: '文件正被占用，请稍后再试' });
});

// 生成过程中由无头浏览器回传的预览截图
app.post('/api/items/:id/preview', async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) return res.status(400).end();
  if (req.body?.error) { await fs.writeFile(path.join(ITEMS, id, 'preview-error.txt'), String(req.body.error).slice(0, 4000)); return res.json({ ok: true }); }
  const m = /^data:image\/png;base64,(.+)$/s.exec(req.body?.png || '');
  if (!m) return res.status(400).end();
  await fs.writeFile(path.join(ITEMS, id, req.body.name === 'thumb' ? 'thumb.png' : 'preview.png'), Buffer.from(m[1], 'base64'));
  res.json({ ok: true });
});

// ---------------------------------------------------------------- 静态资源
app.use('/items', express.static(ITEMS, { etag: true, maxAge: 0 }));
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three'), { maxAge: '7d' }));
app.use(express.static(path.join(ROOT, 'public'), { maxAge: 0 }));

// 关闭服务器时顺带结束正在运行的 claude 子进程（下次启动会自动从头续做）
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { const id = generator.running; if (id) generator.jobs.get(id)?.proc?.kill(); process.exit(0); });
}

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  拾光回忆馆已开馆 → http://localhost:${PORT}\n`);
  generator.resumePending(listItems);
});
