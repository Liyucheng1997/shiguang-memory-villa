// 调用本机 Claude Code CLI 把旧物照片变成程序化 Three.js 模型。
// 使用 `claude -p`，因此走的是本机登录的 Claude 订阅额度（会主动去掉 ANTHROPIC_API_KEY，避免误走 API 计费）。
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkModel } from './tools/check-model.mjs';
import { ROOMS } from '../public/js/rooms.js';

const MODEL = process.env.SHIGUANG_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.SHIGUANG_EFFORT || 'high';
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const TIMEOUT_MS = Number(process.env.SHIGUANG_TIMEOUT_MIN || 40) * 60_000;

function cleanEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;      // 强制使用订阅登录态
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDECODE;             // 允许从 Claude Code 会话里启动的服务器再拉起 CLI
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}

export function claudeStatus() {
  return new Promise(resolve => {
    execFile(CLAUDE_BIN, ['--version'], { env: cleanEnv(), timeout: 15000, windowsHide: true }, (err, stdout) => {
      if (err) resolve({ available: false, error: err.code === 'ENOENT' ? '找不到 claude 命令，请先安装 Claude Code 并登录' : String(err.message).slice(0, 200), model: MODEL, effort: EFFORT });
      else resolve({ available: true, version: stdout.trim(), model: MODEL, effort: EFFORT });
    });
  });
}

const fmtTool = (name, input = {}) => {
  const base = p => (p ? path.basename(String(p)) : '');
  switch (name) {
    case 'Read': return `查看 ${base(input.file_path)}`;
    case 'Write': return `写入 ${base(input.file_path)}`;
    case 'Edit': return `修改 ${base(input.file_path)}`;
    case 'Bash': {
      const c = String(input.command || '');
      if (c.includes('check-model')) return '运行模型校验';
      if (c.includes('render-preview')) return '渲染预览图，对照照片检查';
      return `执行 ${c.slice(0, 60)}`;
    }
    default: return name;
  }
};

export class Generator {
  constructor({ itemsDir, root, port, readMeta, patchMeta }) {
    Object.assign(this, { itemsDir, root, port, readMeta, patchMeta });
    this.queue = [];
    this.jobs = new Map();
    this.running = null;
  }

  queueInfo() {
    return { running: this.running, waiting: this.queue.map(q => q.id) };
  }
  job(id) {
    const j = this.jobs.get(id);
    if (!j) return null;
    const { proc, ...rest } = j;
    if (rest.status !== 'generating') delete rest.live;
    return { ...rest, position: this.queue.findIndex(q => q.id === id) + 1 };
  }

  enqueue(id, opts = {}) {
    if (this.running === id || this.queue.some(q => q.id === id)) return;
    this.jobs.set(id, { id, status: 'queued', log: [{ t: Date.now(), msg: '已加入生成队列' }], startedAt: null });
    this.queue.push({ id, opts });
    this.pump();
  }

  cancel(id) {
    const qi = this.queue.findIndex(q => q.id === id);
    if (qi >= 0) { this.queue.splice(qi, 1); this.patchMeta(id, { status: 'failed', error: '已取消' }).catch(() => {}); return true; }
    const j = this.jobs.get(id);
    if (j?.proc) { j.cancelled = true; j.proc.kill(); return true; }
    return false;
  }

  async resumePending(listItems) {
    for (const m of await listItems()) {
      if (m.status === 'queued' || m.status === 'generating') this.enqueue(m.id, { feedback: m.feedback || '' });
    }
  }

  log(id, msg, kind = 'info') {
    const j = this.jobs.get(id);
    if (!j) return;
    j.log.push({ t: Date.now(), msg: String(msg).slice(0, 600), kind });
    if (j.log.length > 400) j.log.splice(0, j.log.length - 400);
  }

  async pump() {
    if (this.running || !this.queue.length) return;
    const { id, opts } = this.queue.shift();
    this.running = id;
    const job = this.jobs.get(id);
    job.status = 'generating'; job.startedAt = Date.now();
    try {
      await this.patchMeta(id, { status: 'generating', error: null });
      await this.generate(id, opts);
    } catch (e) {
      this.log(id, `生成失败：${e.message}`, 'error');
      job.status = 'failed';
      await this.patchMeta(id, { status: 'failed', error: e.message }).catch(() => {});
    } finally {
      this.running = null;
      job.proc = null;
      job.finishedAt = Date.now();
      this.pump();
    }
  }

  async generate(id, { feedback = '' } = {}) {
    const dir = path.join(this.itemsDir, id);
    const meta = await this.readMeta(id);
    const modelFile = path.join(dir, 'model.js');
    const hadModel = await fs.access(modelFile).then(() => true, () => false);
    const job = this.jobs.get(id);

    let prompt = this.buildPrompt(meta, dir, { feedback, hadModel });
    for (let attempt = 1; attempt <= 3; attempt++) {
      this.log(id, attempt === 1 ? `召唤 Claude（${MODEL} · ${EFFORT}）开始观察照片…` : `第 ${attempt} 轮：让 Claude 修复校验发现的问题…`);
      await this.runClaude(id, dir, prompt);
      if (job.cancelled) throw new Error('已取消');
      const report = await checkModel(modelFile);
      if (report.ok) {
        this.log(id, `模型校验通过：${report.size.join(' × ')} 米，${report.meshes} 个网格，${report.triangles} 个三角面${report.parts.length ? '，可动部件：' + report.parts.map(p => p.label).join('、') : ''}`, 'success');
        await this.finish(id, dir, meta, report);
        return;
      }
      this.log(id, `校验未通过：${report.errors.join('；')}`, 'warn');
      prompt = `上一轮生成的 ${modelFile} 没有通过校验，错误如下：\n${report.errors.map(e => '- ' + e).join('\n')}\n\n请阅读 ${modelFile}，修复这些问题（保持模型精细度，不要简化），然后再次运行校验命令确认通过：\nnode "${path.join(this.root, 'server/tools/check-model.mjs')}" "${modelFile}"`;
    }
    throw new Error('三轮修复后模型仍未通过校验');
  }

  async finish(id, dir, meta, report) {
    let analysis = {};
    try { analysis = JSON.parse(await fs.readFile(path.join(dir, 'analysis.json'), 'utf8')); } catch { /* 可选 */ }
    const patch = { status: 'ready', error: null, dimensions: report.size, generatedAt: new Date().toISOString(), feedback: '' };
    if (analysis.name && (!meta.name || meta.name === '未命名的旧物')) patch.name = String(analysis.name).slice(0, 60);
    if (analysis.room && !meta.roomLocked && ROOMS.some(r => r.id === analysis.room && !r.corridor)) patch.room = analysis.room;
    else if (meta.room === 'auto') patch.room = 'foyer';
    for (const k of ['category', 'era', 'material', 'description']) if (analysis[k]) patch[k] = String(analysis[k]).slice(0, 600);
    if (analysis.fidelity != null) patch.fidelity = analysis.fidelity;
    await this.patchMeta(id, patch);
    const job = this.jobs.get(id);
    job.status = 'ready';
    this.log(id, `「${patch.name || meta.name}」已入藏${patch.room ? '，陈列在' + (ROOMS.find(r => r.id === patch.room)?.name || '') : ''}`, 'success');
  }

  buildPrompt(meta, dir, { feedback, hadModel }) {
    const photos = meta.photos.map(p => path.join(dir, p));
    const tools = path.join(this.root, 'server/tools');
    const rooms = ROOMS.filter(r => !r.corridor).map(r => `- ${r.id}（${r.name}）：${r.hint}`).join('\n');
    const lines = [
      `你是「拾光回忆馆」的 3D 建模师。用户扔掉旧东西前拍了照片，你要把它精细地重建成程序化 Three.js 模型，永久陈列在回忆馆里。`,
      ``,
      `## 这件旧物`,
      `- 名称：${meta.name || '（用户没填，请你根据照片起一个朴素的中文名）'}`,
      meta.story ? `- 主人的回忆：${meta.story}` : '',
      meta.notes ? `- 主人补充的细节：${meta.notes}` : '',
      `- 照片（请逐张用 Read 查看）：\n${photos.map(p => '  - ' + p).join('\n')}`,
      ``,
      `## 必读资料`,
      `1. 建模规范与 kit API：${path.join(this.root, 'server/docs/MODEL_GUIDE.md')}`,
      `2. 范例（手工精修的衣柜，学习它的结构、细节密度和写法）：${path.join(this.itemsDir, 'wardrobe-001/model.js')}`,
      ``,
      `## 产出（都写在 ${dir} 里）`,
      `1. ${path.join(dir, 'analysis.json')}：{"name":"中文名","room":"房间id","category":"类别","era":"大致年代","material":"主要材质","description":"一两句话描述","dimensions":[宽,高,深],"fidelity":0~1 的自评还原度}`,
      `   房间可选：\n${rooms}`,
      `2. ${path.join(dir, 'model.js')}：按 MODEL_GUIDE 的约定导出 build(THREE, kit)。`,
      ``,
      `## 工作流程`,
      `1. 仔细看照片：判断物体类别、真实尺寸（用常识和照片比例推算，单位米）、结构分件、每处材质、标志性细节（把手、按钮、商标、花纹、磨损、污渍…）。`,
      `2. 写 analysis.json，再写 model.js。细节要多：倒角、缝隙、五金件、贴图纹理、旧化痕迹都要表现；能开合的部件（门、抽屉、盖子、翻盖）用 kit.hinge / kit.slider 做成可交互的。`,
      `3. 运行校验：node "${path.join(tools, 'check-model.mjs')}" "${path.join(dir, 'model.js')}"`,
      `4. 渲染预览并对照照片：node "${path.join(tools, 'render-preview.mjs')}" ${meta.id} --port ${this.port}`,
      `   然后用 Read 查看生成的 ${path.join(dir, 'preview.png')}（四个视角），逐项和照片比较：轮廓比例、颜色、材质、细节位置。`,
      `5. 发现差异就修改 model.js，重新校验、重新渲染，至少对照修正 2 轮，直到你满意为止。`,
      `6. 只允许读写 ${dir} 里的文件；只用 node 运行上面两个命令。`,
      `最后用一句中文总结你建了什么。`,
    ];
    if (hadModel) {
      lines.push('', `## 注意：这件藏品已有模型 ${path.join(dir, 'model.js')}`,
        feedback ? `主人的修改意见：「${feedback}」。请在现有模型基础上按意见修改，并重新校验和渲染对照。` : `请重新审视现有模型，对照照片提升还原度。`);
    }
    return lines.filter(l => l !== '').join('\n');
  }

  runClaude(id, cwd, prompt) {
    const job = this.jobs.get(id);
    const args = [
      '-p',
      '--model', MODEL,
      '--effort', EFFORT,
      '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--permission-mode', 'dontAsk',
      '--allowedTools', 'Read', 'Write', 'Edit', 'Glob', 'Bash(node:*)',
      '--add-dir', path.join(this.root, 'server/docs'), path.join(this.itemsDir, 'wardrobe-001'),
      '--no-session-persistence',
    ];
    return new Promise((resolve, reject) => {
      const proc = spawn(CLAUDE_BIN, args, { cwd, env: cleanEnv(), windowsHide: true });
      job.proc = proc;
      const timer = setTimeout(() => { this.log(id, '超时，终止本次生成', 'error'); proc.kill(); }, TIMEOUT_MS);
      let buf = '', stderr = '';
      proc.stdout.on('data', chunk => {
        buf += chunk.toString('utf8');
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (line) this.onEvent(id, line);
        }
      });
      proc.stderr.on('data', c => { stderr += c.toString('utf8'); });
      proc.on('error', e => { clearTimeout(timer); reject(new Error(e.code === 'ENOENT' ? '找不到 claude 命令' : e.message)); });
      proc.on('close', code => {
        clearTimeout(timer);
        if (job.cancelled) return resolve();
        if (code !== 0) {
          const tail = stderr.trim().split('\n').slice(-3).join(' ');
          this.log(id, `Claude 进程退出码 ${code}${tail ? '：' + tail : ''}`, 'warn');
        }
        resolve();
      });
      proc.stdin.end(prompt, 'utf8');
    });
  }

  onEvent(id, line) {
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    if (ev.type === 'assistant' && ev.message?.content) {
      for (const c of ev.message.content) {
        if (c.type === 'text' && c.text.trim()) this.log(id, c.text.trim(), 'think');
        else if (c.type === 'tool_use') this.log(id, fmtTool(c.name, c.input), 'tool');
      }
    } else if (ev.type === 'stream_event' && ev.event) {
      // 实时进度：正在思考 / 正在写代码（字数）
      const j = this.jobs.get(id), e = ev.event;
      if (e.type === 'content_block_start') j.live = { kind: e.content_block?.type, tool: e.content_block?.name, chars: 0, since: Date.now() };
      else if (e.type === 'content_block_delta' && j.live) { const d = e.delta || {}; j.live.chars += (d.thinking || d.text || d.partial_json || '').length; }
      else if (e.type === 'content_block_stop') j.live = null;
    } else if (ev.type === 'result') {
      const j = this.jobs.get(id);
      j.usage = { turns: ev.num_turns, durationMs: ev.duration_ms };
      if (ev.is_error) this.log(id, `Claude 报告错误：${String(ev.result || ev.subtype).slice(0, 300)}`, 'warn');
    } else if (ev.type === 'system' && ev.subtype === 'init') {
      this.log(id, `已连接 ${ev.model || MODEL}`);
    }
  }
}
