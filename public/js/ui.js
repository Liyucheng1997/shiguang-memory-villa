// 界面：房间导航、藏品信息面板、上传弹窗、生成进度
import { ROOMS, DISPLAY_ROOMS, roomById, FLOOR_OPTIONS, WALL_OPTIONS, DADO_OPTIONS, LAMP_STYLES, TIME_OPTIONS } from './rooms.js';
import { finishThumb } from './textures.js';
import { escapeHtml as esc } from './items.js';

const $ = (sel, root = document) => root.querySelector(sel);

export class UI {
  constructor({ collection, actions }) {
    this.collection = collection;
    this.a = actions;
    this.items = [];
    this.selected = null;
    this.jobTimer = null;
    this.photos = [];
    this.bind();
    this.checkStatus();
  }

  bind() {
    $('#enter-btn').onclick = () => { document.body.classList.add('entered'); this.a.enter(); };
    $('#btn-overview').onclick = () => this.a.overview();
    $('#btn-walk').onclick = () => { document.body.classList.add('entered'); this.a.walk(); };
    $('#btn-view').onclick = () => { document.body.classList.add('entered'); this.state?.mode === 'overview' ? this.a.walk() : this.a.overview(); };
    $('#btn-decor').onclick = () => this.toggleDecor();
    $('#decor-close').onclick = () => this.toggleDecor(false);
    $('#placing-cancel').onclick = () => this.a.back();
    $('#btn-add').onclick = () => this.openUpload();
    $('#panel-close').onclick = () => { this.closePanel(); if (this.state?.mode === 'item') this.a.back(); };
    $('#crumbs').addEventListener('click', e => {
      const c = e.target.closest('[data-go]'); if (!c) return;
      const go = c.dataset.go;
      if (go === 'intro') this.a.intro(); else if (go === 'overview') this.a.overview(); else if (go === 'walk') this.a.walk(); else this.a.room(go);
    });
    // 房间列表
    const nav = $('#room-list');
    nav.innerHTML = DISPLAY_ROOMS.map(r => `<button class="room-btn" data-room="${r.id}"><span class="room-name">${r.name}</span><span class="room-count" data-count="${r.id}">0</span></button>`).join('');
    nav.addEventListener('click', e => { const b = e.target.closest('[data-room]'); if (b) { document.body.classList.add('entered'); this.a.room(b.dataset.room); } });
    $('#item-list').addEventListener('click', e => { const b = e.target.closest('[data-item]'); if (b) { document.body.classList.add('entered'); this.a.item(b.dataset.item); this.selectItem(b.dataset.item); } });
    // 装修面板
    $('#decor-room').innerHTML = ROOMS.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
    $('#decor-room').onchange = () => this.renderDecor();
    $('#decor-body').addEventListener('click', e => {
      const b = e.target.closest('[data-set]'); if (!b) return;
      const [field, value] = [b.dataset.set, b.dataset.value];
      const rid = $('#decor-room').value;
      if (field === 'time') this.a.setDecor('*time', value);
      else if (field === 'style') this.a.setDecor(rid, { light: { style: value } });
      else if (field === 'on') this.a.setDecor(rid, { light: { on: !this.a.getDecor().rooms[rid].light.on } });
      else if (field === 'all') { for (const r of ROOMS) this.a.setDecor(r.id, { light: { on: value === '1' } }); }
      else this.a.setDecor(rid, { [field]: value });
      this.renderDecor();
    });
    $('#decor-body').addEventListener('input', e => {
      const el = e.target; const rid = $('#decor-room').value;
      if (el.dataset.range === 'intensity') this.a.setDecor(rid, { light: { intensity: +el.value / 100, on: true } });
      if (el.dataset.range === 'kelvin') this.a.setDecor(rid, { light: { kelvin: +el.value } });
      const out = el.parentElement.querySelector('output'); if (out) out.textContent = el.dataset.range === 'kelvin' ? `${el.value}K` : `${el.value}%`;
    });
    $('#decor-body').addEventListener('change', e => { if (e.target.dataset.range) this.renderDecor(); });

    // 上传弹窗
    const modal = $('#upload');
    modal.addEventListener('click', e => { if (e.target === modal) this.closeModal(); });
    $('#upload-cancel').onclick = () => this.closeModal();
    const drop = $('#dropzone'), input = $('#file-input');
    drop.onclick = () => input.click();
    input.onchange = () => this.addFiles(input.files);
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); this.addFiles(e.dataTransfer.files); });
    addEventListener('paste', e => { if (!modal.classList.contains('open')) return; const files = [...e.clipboardData.items].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile()); if (files.length) this.addFiles(files); });
    $('#f-room').innerHTML = `<option value="auto">让 Claude 判断</option>` + DISPLAY_ROOMS.map(r => `<option value="${r.id}">${r.name} · ${r.hint.split('、').slice(0, 3).join('、')}…</option>`).join('');
    $('#upload-form').onsubmit = e => { e.preventDefault(); this.submit(); };
  }

  ready() { document.body.classList.add('ready'); }

  async checkStatus() {
    try {
      const s = await (await fetch('/api/status')).json();
      const pill = $('#claude-status');
      if (s.claude.available) { pill.className = 'pill ok'; pill.innerHTML = `<i></i>${s.claude.model.replace('claude-', '').replace(/-(\d)-(\d)/, ' $1.$2')} · ${s.claude.effort}`; pill.title = `本地 Claude Code ${s.claude.version}，使用你的订阅额度`; }
      else { pill.className = 'pill bad'; pill.innerHTML = `<i></i>Claude 未连接`; pill.title = s.claude.error; }
    } catch { /* 静态预览时没有后端 */ }
  }

  onMode(state) {
    this.state = state;
    document.body.dataset.mode = state.mode;
    const crumbs = [`<a data-go="intro">拾光回忆馆</a>`];
    if (state.mode !== 'intro') crumbs.push(`<a data-go="overview">别墅</a>`);
    if (state.roomId) crumbs.push(`<a data-go="${state.roomId}">${roomById(state.roomId)?.name}</a>`);
    if (state.itemId) crumbs.push(`<span>${esc(this.items.find(i => i.id === state.itemId)?.name || '')}</span>`);
    $('#crumbs').innerHTML = crumbs.join('<b>›</b>');
    document.querySelectorAll('.room-btn').forEach(b => b.classList.toggle('active', b.dataset.room === state.roomId));
    const hints = {
      intro: '',
      walk: 'W A S D / 方向键走动 · 按住拖动环顾 · 双击地面走过去 · 点击藏品查看 · M 鸟瞰',
      overview: '拖动旋转 · 滚轮缩放 · 点击房间走进去 · M 回到漫游',
      item: '拖动环绕 · 点击柜门/抽屉开合 · Esc 返回',
    };
    $('#hint').textContent = hints[state.mode] || '';
    $('#btn-view').innerHTML = state.mode === 'overview' ? '🚶 漫游' : '🗺 鸟瞰';
    this.renderItemList();
    if (this.decorOpen) this.renderDecor();
  }
  onRoomChanged(rid) {
    if (!this.state) return;
    this.onMode(this.state);
  }
  closePanelIfOpen() {
    if (!$('#panel').classList.contains('open')) return false;
    this.closePanel(); return true;
  }

  // ---------------------------------------------------------------- 装修面板
  toggleDecor(force) {
    this.decorOpen = force ?? !this.decorOpen;
    $('#decor').classList.toggle('open', this.decorOpen);
    if (this.decorOpen) {
      const rid = this.a.currentRoom();
      if (rid) $('#decor-room').value = rid;
      this.renderDecor();
    }
  }
  renderDecor() {
    const d = this.a.getDecor();
    const rid = $('#decor-room').value;
    const r = d.rooms[rid];
    if (!r) return;
    const sw = (field, opts, cur) => `<div class="swatches">${opts.map(([v, label]) => `<button class="sw ${v === cur ? 'on' : ''}" data-set="${field}" data-value="${v}" title="${label}">${v ? `<img src="${finishThumb(v)}" alt="">` : '<i>∅</i>'}<span>${label}</span></button>`).join('')}</div>`;
    const chips = (field, opts, cur) => `<div class="chips">${opts.map(([v, label]) => `<button class="chip ${v === cur ? 'on' : ''}" data-set="${field}" data-value="${v}">${label}</button>`).join('')}</div>`;
    const L = r.light;
    $('#decor-body').innerHTML = `
      <h4>时间</h4>${chips('time', TIME_OPTIONS, d.time)}
      <h4>灯具 <button class="toggle ${L.on ? 'on' : ''}" data-set="on">${L.on ? '开' : '关'}</button></h4>
      ${chips('style', LAMP_STYLES, L.style)}
      <label class="range">亮度<input type="range" min="0" max="250" step="5" value="${Math.round(L.intensity * 100)}" data-range="intensity"><output>${Math.round(L.intensity * 100)}%</output></label>
      <label class="range">色温<input type="range" min="1800" max="6500" step="100" value="${L.kelvin}" data-range="kelvin" class="kelvin"><output>${L.kelvin}K</output></label>
      <div class="chips"><button class="chip" data-set="all" data-value="1">全屋开灯</button><button class="chip" data-set="all" data-value="0">全屋关灯</button></div>
      <h4>地板</h4>${sw('floor', FLOOR_OPTIONS, r.floor)}
      <h4>墙面</h4>${sw('wall', WALL_OPTIONS, r.wall)}
      <h4>墙裙</h4>${sw('dado', DADO_OPTIONS, r.dado)}`;
  }

  // ---------------------------------------------------------------- 摆放提示条
  setPlacing(P, name) {
    const bar = $('#placing');
    if (!P) { bar.classList.remove('open'); return; }
    bar.classList.add('open');
    $('#placing-text').innerHTML = `正在摆放「${esc(name || '')}」 · ${P.valid ? `放到 ${roomById(P.last?.room)?.name || ''}` : '<em>这里不能放</em>'}`;
  }

  setItems(items) {
    this.items = items;
    for (const r of DISPLAY_ROOMS) {
      const n = items.filter(i => i.room === r.id || (r.id === 'foyer' && !roomById(i.room))).length;
      const el = $(`[data-count="${r.id}"]`); if (el) el.textContent = n;
    }
    $('#total-count').textContent = items.length;
    this.renderItemList();
    if (this.selected) this.renderPanel(this.selected);
  }

  renderItemList() {
    const rid = this.state?.roomId;
    const list = rid ? this.items.filter(i => i.room === rid || (rid === 'foyer' && !roomById(i.room))) : this.items;
    $('#item-list-title').textContent = rid ? `${roomById(rid).name}里的藏品` : '全部藏品';
    $('#item-list').innerHTML = list.length ? list.map(i => `
      <button class="item-btn ${i.id === this.state?.itemId ? 'active' : ''}" data-item="${i.id}">
        <img src="/items/${i.id}/${i.photos?.[0] || 'photo.jpg'}" alt="" loading="lazy">
        <span><b>${esc(i.name)}</b><small>${i.status === 'ready' ? esc(roomById(i.room)?.name || '') + (i.era ? ' · ' + esc(i.era) : '') : i.status === 'failed' ? '⚠ 生成失败' : '⏳ 正在建模…'}</small></span>
      </button>`).join('') : `<p class="empty">这里还空着。<br>点右上角「收藏旧物」上传一张照片吧。</p>`;
  }

  hasPending() { return this.items.some(i => i.status === 'queued' || i.status === 'generating'); }

  // ---------------------------------------------------------------- 信息面板
  selectItem(id) {
    this.selected = id;
    this.renderPanel(id);
    $('#panel').classList.add('open');
  }
  closePanel() {
    $('#panel').classList.remove('open');
    this.selected = null;
    clearInterval(this.jobTimer); this.jobTimer = null;
  }

  renderPanel(id) {
    const m = this.items.find(i => i.id === id);
    if (!m) return;
    const entry = this.collection.entries.get(id);
    const parts = entry?.parts || [];
    const photos = (m.photos || []).map(p => `/items/${id}/${p}`);
    const dims = m.dimensions ? m.dimensions.map(v => Math.round(v * 100)).join(' × ') + ' 厘米' : '';
    const pending = m.status === 'queued' || m.status === 'generating';
    $('#panel-body').innerHTML = `
      <div class="photos">${photos.map((p, i) => `<img src="${p}" class="${i ? 'thumb' : 'main'}" alt="原始照片">`).join('')}</div>
      <h2 contenteditable="true" spellcheck="false" data-field="name">${esc(m.name)}</h2>
      <div class="meta-row">
        <span>${esc(roomById(m.room)?.name || '门厅')}</span>
        ${m.category ? `<span>${esc(m.category)}</span>` : ''}
        ${m.era ? `<span>${esc(m.era)}</span>` : ''}
        ${dims ? `<span>${dims}</span>` : ''}
      </div>
      ${m.discardedAt ? `<p class="farewell">告别于 ${esc(m.discardedAt)}</p>` : ''}
      <div class="story" contenteditable="true" spellcheck="false" data-field="story" data-placeholder="写下关于它的回忆……">${esc(m.story || '')}</div>
      ${m.description && !m.story ? `<p class="desc">${esc(m.description)}</p>` : ''}
      <div class="parts">
        ${this.state?.mode !== 'item' && entry?.holder ? `<button class="btn" id="btn-focus">🔍 近看</button>` : ''}
        ${parts.length ? `<button class="btn ${this.state?.mode === 'item' ? '' : 'ghost'}" data-part="all">✦ 打开 / 关上</button>${parts.map((p, i) => `<button class="btn ghost" data-part="${i}">${esc(p.label)}</button>`).join('')}` : ''}
      </div>
      ${entry?.model ? `
      <div class="arrange">
        <h4>尺寸与摆放</h4>
        <label class="range">大小<input type="range" id="scale" min="30" max="250" step="1" value="${Math.round((entry.scale || 1) * 100)}"><output id="scale-out">${Math.round((entry.scale || 1) * 100)}%</output></label>
        <div class="dims"><span id="dims-text">${entry.size.map(v => Math.round(v * 100)).join(' × ')} 厘米</span>
          <label>高 <input type="number" id="height-cm" min="1" max="500" value="${Math.round(entry.size[1] * 100)}"> 厘米</label></div>
        <div class="chips">
          <button class="chip" id="btn-move">✥ 移动摆放 <kbd>G</kbd></button>
          <button class="chip ${entry.pos?.pedestal ? 'on' : ''}" id="btn-ped">展台</button>
          <button class="chip" id="btn-scale-reset">原始大小</button>
          ${m.placement ? `<button class="chip" id="btn-auto">自动摆放</button>` : ''}
        </div>
      </div>` : ''}
      ${pending || m.status === 'failed' ? `<div class="job"><div class="job-head">${m.status === 'failed' ? '⚠ 生成失败：' + esc(m.error || '') : '<span class="spinner"></span> Claude 正在为它建模'}</div><ol class="job-log" id="job-log"></ol></div>` : ''}
      <details class="refine">
        <summary>${m.status === 'failed' ? '重新生成' : '让 Claude 改进模型'}</summary>
        <textarea id="feedback" rows="3" placeholder="例如：把手应该是黄铜色的；柜子再高一点；正面左下角有一块掉漆"></textarea>
        <button class="btn" id="btn-regen">${m.status === 'failed' ? '重新生成' : '提交修改意见'}</button>
      </details>
      <div class="panel-foot">
        <label>放到 <select id="move-room">${DISPLAY_ROOMS.map(r => `<option value="${r.id}" ${r.id === m.room ? 'selected' : ''}>${r.name}</option>`).join('')}</select></label>
        ${id !== 'wardrobe-001' ? `<button class="link danger" id="btn-remove">移出展馆</button>` : ''}
      </div>
      ${m.source ? `<p class="source">${esc(m.source)}</p>` : ''}
      <p class="source">${esc(m.generator || '')}${m.generatedAt ? ' · ' + new Date(m.generatedAt).toLocaleString() : ''}</p>`;

    const body = $('#panel-body');
    $('#btn-focus')?.addEventListener('click', () => this.a.item(id));
    if (entry?.model) {
      let saveT = null;
      const setScale = (s, save = true) => {
        s = Math.min(2.5, Math.max(0.3, s));
        this.a.scale(id, s);
        $('#scale').value = Math.round(s * 100); $('#scale-out').textContent = `${Math.round(s * 100)}%`;
        $('#dims-text').textContent = `${entry.size.map(v => Math.round(v * 100)).join(' × ')} 厘米`;
        if (document.activeElement !== $('#height-cm')) $('#height-cm').value = Math.round(entry.size[1] * 100);
        if (save) { clearTimeout(saveT); saveT = setTimeout(() => this.patch(id, { scale: +s.toFixed(3) }), 400); }
      };
      $('#scale').oninput = e => setScale(+e.target.value / 100);
      $('#height-cm').onchange = e => { const h = +e.target.value / 100; if (h > 0) setScale(h / entry.baseSize[1]); };
      $('#btn-scale-reset').onclick = () => setScale(1);
      $('#btn-move').onclick = () => this.a.move(id);
      $('#btn-ped').onclick = () => { this.a.pedestal(id, !entry.pos?.pedestal); setTimeout(() => this.renderPanel(id), 50); };
      $('#btn-auto')?.addEventListener('click', async () => { await this.a.autoPlace(id); this.renderPanel(id); });
    }
    body.querySelectorAll('[data-part]').forEach(b => b.onclick = () => {
      const v = b.dataset.part;
      this.a.togglePart(id, v === 'all' ? undefined : Number(v));
    });
    body.querySelectorAll('[contenteditable][data-field]').forEach(el => el.addEventListener('blur', () => this.patch(id, { [el.dataset.field]: el.innerText.trim() })));
    body.querySelector('.photos .main')?.addEventListener('click', e => window.open(e.target.src, '_blank'));
    $('#btn-regen').onclick = async () => {
      const feedback = $('#feedback').value.trim();
      await fetch(`/api/items/${id}/regenerate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feedback }) });
      this.toast('已交给 Claude，模型更新后会自动替换');
      await this.a.refresh();
    };
    $('#move-room').onchange = async e => { const en = this.collection.entries.get(id); if (en) en.meta.placement = null; await this.patch(id, { room: e.target.value }); await this.a.refresh(); this.a.item(id); };
    const rm = $('#btn-remove');
    if (rm) rm.onclick = async () => {
      if (!confirm(`把「${m.name}」移出展馆？（文件会移到 data/trash，不会真正删除）`)) return;
      const r = await fetch(`/api/items/${id}`, { method: 'DELETE' });
      if (!r.ok) { this.toast(`移出失败：${(await r.json().catch(() => ({}))).error || r.status}`); return; }
      this.closePanel(); await this.a.refresh(); this.toast(`「${m.name}」已移出展馆（在 data/trash 里）`);
    };
    if (pending || m.status === 'failed') this.watchJob(id);
  }

  onPartsChanged() { /* 预留：按钮状态 */ }

  async patch(id, data) {
    await fetch(`/api/items/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const m = this.items.find(i => i.id === id); if (m) Object.assign(m, data);
  }

  watchJob(id) {
    clearInterval(this.jobTimer);
    const tick = async () => {
      if (this.selected !== id) return clearInterval(this.jobTimer);
      try {
        const j = await (await fetch(`/api/jobs/${id}`)).json();
        const ol = $('#job-log'); if (!ol) return;
        const live = j.live ? `<li class="live"><span class="spinner"></span>${liveText(j.live)}</li>` : '';
        ol.innerHTML = ((j.log || []).slice(-60).map(l => `<li class="${l.kind || ''}"><time>${new Date(l.t).toLocaleTimeString()}</time>${esc(l.msg)}</li>`).join('') || '<li>等待中…</li>') + live;
        ol.scrollTop = ol.scrollHeight;
        if (j.status === 'ready' || j.status === 'failed') { clearInterval(this.jobTimer); await this.a.refresh(); if (j.status === 'ready') { this.toast('模型完成，已放进展馆！'); this.a.item(id); } }
      } catch { /* ignore */ }
    };
    tick();
    this.jobTimer = setInterval(tick, 2000);
  }

  // ---------------------------------------------------------------- 上传
  openUpload() {
    this.photos = [];
    $('#upload-form').reset();
    this.renderPreviews();
    $('#upload').classList.add('open');
  }
  closeModal() {
    const m = $('#upload');
    if (!m.classList.contains('open')) return false;
    m.classList.remove('open');
    return true;
  }
  async addFiles(files) {
    for (const f of [...files].slice(0, 6 - this.photos.length)) {
      if (!f.type.startsWith('image/')) continue;
      this.photos.push(await downscale(f, 2000));
    }
    this.renderPreviews();
  }
  renderPreviews() {
    $('#previews').innerHTML = this.photos.map((p, i) => `<div class="pv"><img src="${p}"><button type="button" data-rm="${i}">×</button></div>`).join('');
    $('#previews').querySelectorAll('[data-rm]').forEach(b => b.onclick = e => { e.stopPropagation(); this.photos.splice(Number(b.dataset.rm), 1); this.renderPreviews(); });
    $('#dropzone').classList.toggle('has', this.photos.length > 0);
    $('#upload-submit').disabled = this.photos.length === 0;
  }
  async submit() {
    const btn = $('#upload-submit');
    btn.disabled = true; btn.textContent = '上传中…';
    try {
      const res = await fetch('/api/items', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: $('#f-name').value.trim(), discardedAt: $('#f-date').value.trim(), room: $('#f-room').value,
          story: $('#f-story').value.trim(), notes: $('#f-notes').value.trim(), photos: this.photos,
        }),
      });
      const m = await res.json();
      if (!res.ok) throw new Error(m.error || '上传失败');
      this.closeModal();
      this.toast('照片已收下，Claude 开始建模（通常需要 5–15 分钟）');
      await this.a.refresh();
      document.body.classList.add('entered');
      setTimeout(() => { this.a.item(m.id); this.selectItem(m.id); }, 400);
    } catch (e) {
      alert(e.message);
    } finally {
      btn.disabled = false; btn.textContent = '交给 Claude 建模';
    }
  }

  toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3800);
  }
}

function liveText(l) {
  const kb = (l.chars / 1024).toFixed(1);
  const secs = Math.max(0, Math.round((Date.now() - (l.since || Date.now())) / 1000));
  if (l.kind === 'thinking') return `Claude 正在思考…（${secs} 秒）`;
  if (l.kind === 'tool_use') return l.tool === 'Write' || l.tool === 'Edit' ? `正在编写代码…（${kb} KB）` : `准备调用 ${l.tool}…`;
  return `正在整理思路…（${l.chars} 字）`;
}

// 浏览器端压缩照片（长边不超过 max 像素），减少上传体积
function downscale(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.9));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
