// 藏品：加载 model.js、缩放、自动/手动摆放、展台与铭牌、生成中的占位、长廊里的原始照片、可动部件动画。
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createKit, applyPart } from './kit.js';
import { ROOMS, roomById, roomBox, VILLA } from './rooms.js';
import { labelTexture } from './textures.js';

const T = VILLA.wallT;
const isBig = ([w, h, d]) => Math.max(w, d) > 0.6 || h > 0.9;

// 长廊墙上挂照片的位置
function hallFrameSpots() {
  const spots = [];
  const north = [[-12.6, -9.5], [-7.5, -0.6], [2.7, 8.5], [10.5, 12.6]];
  const south = [[-12.6, -9.5], [-7.5, -1.7], [1.7, 7.5], [9.5, 12.6]];
  const fill = (segs, z, rot) => {
    for (const [a, b] of segs) {
      const n = Math.max(1, Math.floor((b - a) / 1.35));
      for (let i = 0; i < n; i++) spots.push({ x: a + (b - a) * (i + 0.5) / n, z, rot });
    }
  };
  fill(north, -1 + T + 0.025, 0);
  fill(south, 2 - T - 0.025, Math.PI);
  return spots.sort((p, q) => Math.abs(p.x) - Math.abs(q.x)); // 从靠近门厅处开始挂
}

export class Collection {
  constructor(scene, { renderer, onLoaded } = {}) {
    this.scene = scene;
    this.kit = createKit(THREE, { maxAnisotropy: renderer?.capabilities.getMaxAnisotropy?.() || 8 });
    this.group = new THREE.Group(); this.group.name = 'collection'; scene.add(this.group);
    this.entries = new Map();     // id -> entry
    this.onLoaded = onLoaded;
    this.frameSpots = hallFrameSpots();
    this.texLoader = new THREE.TextureLoader();
    this.moving = null;           // 正在移动的藏品 id（不参与碰撞与拾取）
    this.mats = {
      pedestal: new THREE.MeshPhysicalMaterial({ color: '#efe8dc', roughness: 0.55, clearcoat: 0.3 }),
      pedestalTop: new THREE.MeshPhysicalMaterial({ color: '#3b2618', roughness: 0.35, clearcoat: 0.8 }),
      vitrine: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.02, transparent: true, opacity: 0.12, envMapIntensity: 2.5, depthWrite: false, side: THREE.DoubleSide }),
      holo: new THREE.MeshBasicMaterial({ color: '#ffcf8a', wireframe: true, transparent: true, opacity: 0.55 }),
      frame: new THREE.MeshPhysicalMaterial({ color: '#2f1f14', roughness: 0.35, clearcoat: 0.7 }),
      mat: new THREE.MeshStandardMaterial({ color: '#f4efe4', roughness: 0.9 }),
      ghostOk: new THREE.MeshBasicMaterial({ color: '#7fd18f', transparent: true, opacity: 0.18, depthWrite: false }),
      ghostBad: new THREE.MeshBasicMaterial({ color: '#e0705a', transparent: true, opacity: 0.25, depthWrite: false }),
    };
  }

  /** 与服务器列表同步：新增/更新/删除 */
  async sync(items) {
    const seen = new Set();
    const loads = [];
    for (const meta of items) {
      seen.add(meta.id);
      const e = this.entries.get(meta.id);
      const changed = !e || e.meta.status !== meta.status || e.meta.modelVersion !== meta.modelVersion;
      if (!e) this.entries.set(meta.id, { meta, holder: null, model: null, parts: [], partT: [], partTarget: [] });
      const entry = this.entries.get(meta.id);
      const nameChanged = e && e.meta.name !== meta.name;
      // 本地正在调整的摆放/缩放不要被服务器旧值覆盖
      if (e && (this.moving === meta.id || Date.now() - (e.localEditAt || 0) < 6000)) { meta.placement = e.meta.placement; meta.scale = e.meta.scale; }
      entry.meta = meta;
      if (changed) loads.push(this.load(entry));
      else {
        if (nameChanged) this.refreshLabels(entry);
        if ((meta.scale || 1) !== entry.scale) this.applyScale(entry);
      }
    }
    for (const [id, e] of this.entries) if (!seen.has(id)) { this.dispose(e); this.entries.delete(id); }
    await Promise.all(loads);
    this.layout();
  }

  async load(entry) {
    const { meta } = entry;
    const holder = new THREE.Group(); holder.name = `item:${meta.id}`; holder.userData.itemId = meta.id;
    const scaler = new THREE.Group(); holder.add(scaler);
    let model = null, error = null;
    if (meta.status === 'ready') {
      try {
        const mod = await import(`/items/${meta.id}/model.js?v=${meta.modelVersion || 0}`);
        model = mod.default(THREE, this.kit);
        model.traverse(o => { if (o.isMesh) { o.castShadow = o.castShadow !== false; o.receiveShadow = true; } });
      } catch (e) {
        console.error('加载模型失败', meta.id, e);
        error = e.message;
      }
    }
    if (entry.holder) this.dispose(entry, true);
    Object.assign(entry, { holder, scaler, model, error, placeholder: null });
    entry.parts = model?.userData.parts || [];
    entry.partT = entry.parts.map(() => 0); entry.partTarget = entry.parts.map(() => 0);
    entry.parts.forEach(p => { if (p.type === 'slider') p.base = p.object.position[p.axis]; });

    if (model) {
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      entry.baseSize = [size.x, size.y, size.z];
      scaler.add(model);
    } else {
      entry.baseSize = meta.dimensions || [0.5, 0.5, 0.5];
      entry.placeholder = this.makePlaceholder(meta, error);
      scaler.add(entry.placeholder);
    }
    entry.scale = model ? (meta.scale || 1) : 1;
    scaler.scale.setScalar(entry.scale);
    entry.size = entry.baseSize.map(v => v * entry.scale);
    this.group.add(holder);
    this.makeFrame(entry);
    this.refreshLabels(entry);
    this.onLoaded?.(entry);
  }

  makePlaceholder(meta, error) {
    const g = new THREE.Group();
    const failed = meta.status === 'failed' || error;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), this.mats.holo.clone());
    box.position.y = 0.45; box.userData.spin = true;
    if (failed) box.material.color.set('#e07a6a');
    g.add(box);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.006, 8, 64), new THREE.MeshBasicMaterial({ color: failed ? '#e07a6a' : '#ffcf8a', transparent: true, opacity: 0.8 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.05; ring.userData.pulse = true; g.add(ring);
    const photo = meta.photos?.[0];
    if (photo) {
      this.texLoader.load(`/items/${meta.id}/${photo}`, t => {
        t.colorSpace = THREE.SRGBColorSpace;
        const a = t.image.width / t.image.height;
        const card = new THREE.Mesh(new THREE.PlaneGeometry(a >= 1 ? 0.42 : 0.42 * a, a >= 1 ? 0.42 / a : 0.42), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.92, side: THREE.DoubleSide }));
        card.position.y = 0.45; card.userData.float = true; card.userData.itemId = meta.id; g.add(card);
      });
    }
    g.userData.placeholder = true;
    return g;
  }

  // 长廊里挂的原始照片
  makeFrame(entry) {
    if (entry.frame) { entry.frame.removeFromParent(); entry.frame = null; }
    const photo = entry.meta.photos?.[0];
    if (!photo) return;
    const g = new THREE.Group(); g.userData.itemId = entry.meta.id; g.userData.isFrame = true;
    this.texLoader.load(`/items/${entry.meta.id}/${photo}`, t => {
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      const a = t.image.width / t.image.height;
      const pw = a >= 1 ? 0.78 : 0.78 * a, ph = a >= 1 ? 0.78 / a : 0.78;
      const mw = pw + 0.16, mh = ph + 0.16;
      const fr = new THREE.Mesh(new RoundedBoxGeometry(mw + 0.08, mh + 0.08, 0.04, 2, 0.008), this.mats.frame); fr.position.z = 0.02; fr.castShadow = true; g.add(fr);
      const mat = new THREE.Mesh(new THREE.PlaneGeometry(mw, mh), this.mats.mat); mat.position.z = 0.041; g.add(mat);
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 })); pic.position.z = 0.043; g.add(pic);
      const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.09), new THREE.MeshPhysicalMaterial({ map: labelTexture([entry.meta.name, entry.meta.discardedAt ? `告别于 ${entry.meta.discardedAt}` : roomById(entry.meta.room)?.name || ''], { w: 512, h: 136 }), metalness: 0.6, roughness: 0.35 }));
      plaque.position.set(0, -(mh + 0.08) / 2 - 0.1, 0.01); g.add(plaque);
      g.traverse(o => { o.userData.itemId = entry.meta.id; o.userData.isFrame = true; });
    });
    entry.frame = g;
    this.group.add(g);
  }

  refreshLabels(entry) {
    if (entry.label) { entry.label.removeFromParent(); entry.label = null; }
    const el = document.createElement('div');
    el.className = 'item-label';
    const status = entry.meta.status;
    el.innerHTML = `<span>${escapeHtml(entry.meta.name)}</span>${status === 'ready' ? '' : `<em class="${status}">${status === 'failed' ? '生成失败' : status === 'queued' ? '排队中' : '建模中…'}</em>`}`;
    const label = new CSS2DObject(el);
    label.center.set(0.5, 1);
    entry.label = label;
    entry.holder?.add(label);
    label.position.set(0, (entry.size?.[1] || 0.5) + 0.25, 0);
  }

  /** 计算每件藏品的位置：手动摆放的优先，其余按展位自动排 */
  layout() {
    const sorted = [...this.entries.values()].sort((a, b) => String(a.meta.createdAt).localeCompare(String(b.meta.createdAt)));
    const manual = sorted.filter(e => e.meta.placement || e.meta.id === this.moving);
    for (const e of manual) if (e.meta.id !== this.moving) this.place(e, e.meta.placement);

    const byRoom = new Map(ROOMS.map(r => [r.id, []]));
    for (const e of sorted) {
      if (e.meta.placement || e.meta.id === this.moving) continue;
      const rid = byRoom.has(e.meta.room) && !roomById(e.meta.room).corridor ? e.meta.room : 'foyer';
      byRoom.get(rid).push(e);
    }
    const near = ([x, z]) => manual.some(m => { const p = m.meta.placement || m.pos; return p && Math.hypot(p.x - x, p.z - z) < 1.0; });
    for (const [rid, list] of byRoom) {
      if (!list.length) continue;
      const room = roomById(rid);
      const wall = room.slots.wall.filter(s => !near(s.at)), ped = room.slots.pedestal.filter(p => !near(p));
      const b = roomBox(room);
      const door = room.openings.find(o => o.kind === 'door');
      const doorPt = door ? (door.side === 'n' ? [door.at, b.z0] : door.side === 's' ? [door.at, b.z1] : door.side === 'w' ? [b.x0, door.at] : [b.x1, door.at]) : [b.cx, b.cz];
      let extra = 0;
      for (const e of list) {
        const big = isBig(e.size);
        let slot = null, onWall = false;
        if (big && wall.length) { slot = wall.shift(); onWall = true; }
        else if (!big && ped.length) slot = { at: ped.shift() };
        else if (wall.length) { slot = wall.shift(); onWall = true; }
        else if (ped.length) slot = { at: ped.shift() };
        else {
          const k = extra++;
          slot = { at: [b.x0 + 1.2 + (k % Math.max(1, Math.floor((b.w - 2.4) / 1.3))) * 1.3, b.cz + (Math.floor(k / 5) % 2 ? -1 : 1) * 0.8] };
        }
        let x, z, rot;
        if (onWall) {
          rot = slot.rot;
          const depth = big ? e.size[2] : Math.max(e.size[2], 0.5);
          x = slot.at[0] + Math.sin(rot) * (depth / 2 + 0.07); z = slot.at[1] + Math.cos(rot) * (depth / 2 + 0.07);
        } else {
          [x, z] = slot.at;
          rot = Math.atan2(doorPt[0] - x, doorPt[1] - z);
        }
        this.place(e, { room: rid, x, z, y: 0, rot, pedestal: !big });
      }
    }
    // 长廊照片
    sorted.forEach((e, i) => {
      if (!e.frame) return;
      const s = this.frameSpots[i % this.frameSpots.length];
      e.frame.position.set(s.x, 1.62, s.z);
      e.frame.rotation.y = s.rot;
      e.frame.visible = i < this.frameSpots.length;
    });
  }

  /** 是否放展台：手动指定优先；放在别的东西上面时不放；默认小件放 */
  wantsPedestal(e, p) {
    if ((p.y || 0) > 0.05) return false;
    if (typeof p.pedestal === 'boolean') return p.pedestal;
    return !isBig(e.size);
  }
  pedestalHeight(e) { return THREE.MathUtils.clamp(1.0 - e.size[1] * 0.85, 0.32, 0.92); }

  /** 记录一次本地修改（摆放/缩放），短时间内不被服务器旧数据覆盖 */
  touch(id) { const e = this.entries.get(id); if (e) e.localEditAt = Date.now(); }

  /** 把藏品放到 p = { room, x, y, z, rot, pedestal } */
  place(e, p) {
    if (!e.holder) return;
    const [w, h, d] = e.size;
    if (e.stand) { e.stand.removeFromParent(); e.stand = null; }
    const usePed = this.wantsPedestal(e, p);
    let lift = p.y || 0;
    if (usePed) {
      const ph = this.pedestalHeight(e);
      const fw = Math.max(0.42, Math.max(w, d) + 0.2);
      const stand = new THREE.Group();
      const body = new THREE.Mesh(new RoundedBoxGeometry(fw, ph - 0.03, fw, 3, 0.012), this.mats.pedestal);
      body.position.y = (ph - 0.03) / 2; body.castShadow = body.receiveShadow = true; stand.add(body);
      const top = new THREE.Mesh(new RoundedBoxGeometry(fw + 0.03, 0.03, fw + 0.03, 2, 0.006), this.mats.pedestalTop);
      top.position.y = ph - 0.015; top.castShadow = top.receiveShadow = true; stand.add(top);
      const plinth = new THREE.Mesh(new RoundedBoxGeometry(fw + 0.04, 0.05, fw + 0.04, 2, 0.006), this.mats.pedestalTop);
      plinth.position.y = 0.025; plinth.receiveShadow = true; stand.add(plinth);
      const pw = Math.min(0.3, fw * 0.75);
      const plaque = new THREE.Mesh(new THREE.PlaneGeometry(pw, pw * 0.28), new THREE.MeshPhysicalMaterial({ map: labelTexture([e.meta.name, e.meta.era || e.meta.discardedAt || '']), metalness: 0.6, roughness: 0.35 }));
      plaque.position.set(0, ph * 0.72, fw / 2 + 0.002); stand.add(plaque);
      if (Math.max(w, h, d) < 0.36 && e.model) { // 很小的物件加玻璃罩
        const vh = h + 0.12;
        const glass = new THREE.Mesh(new THREE.BoxGeometry(fw - 0.04, vh, fw - 0.04), this.mats.vitrine);
        glass.position.y = ph + vh / 2; glass.renderOrder = 5; stand.add(glass);
      }
      stand.traverse(o => { o.userData.itemId = e.meta.id; o.userData.isStand = true; });
      stand.position.set(p.x, 0, p.z); stand.rotation.y = p.rot;
      this.group.add(stand);
      e.stand = stand; e.standW = fw;
      lift = ph;
    } else e.standW = 0;
    e.holder.position.set(p.x, lift, p.z);
    e.holder.rotation.y = p.rot;
    e.roomId = p.room || e.meta.room;
    e.holder.userData.roomId = e.roomId;
    e.pos = { room: e.roomId, x: p.x, y: p.y || 0, z: p.z, rot: p.rot, pedestal: usePed };
    e.holder.traverse(o => { if (o.userData.itemId == null) o.userData.itemId = e.meta.id; });
    e.label?.position.set(0, h + 0.25, 0);
    e.holder.updateMatrixWorld(true);
  }

  /** 缩放（1 = 原始尺寸） */
  setScale(id, s) {
    const e = this.entries.get(id); if (!e?.model) return;
    e.meta.scale = s; e.localEditAt = Date.now();
    this.applyScale(e);
  }
  applyScale(e) {
    e.scale = e.meta.scale || 1;
    e.scaler.scale.setScalar(e.scale);
    e.size = e.baseSize.map(v => v * e.scale);
    if (e.pos) this.place(e, e.pos);
  }

  /** 家具碰撞体（OBB），给漫游用 */
  obstacles() {
    const out = [];
    for (const e of this.entries.values()) {
      if (!e.holder || !e.pos || e.meta.id === this.moving || e.pos.y > 0.3) continue;
      const hx = Math.max(e.size[0], e.standW) / 2, hz = Math.max(e.size[2], e.standW) / 2;
      if (e.size[1] < 0.2 && !e.standW) continue; // 很矮的东西可以跨过去
      out.push({ x: e.pos.x, z: e.pos.z, hx, hz, rot: e.pos.rot });
    }
    return out;
  }

  /** 相机聚焦用：世界坐标中心、半径、正面方向 */
  focusInfo(id) {
    const e = this.entries.get(id);
    if (!e?.holder) return null;
    const [w, h, d] = e.size;
    const center = new THREE.Vector3(0, h / 2, 0).applyMatrix4(e.holder.matrixWorld);
    const front = new THREE.Vector3(Math.sin(e.holder.rotation.y), 0, Math.cos(e.holder.rotation.y));
    return { center, radius: Math.max(0.25, Math.hypot(w, h, d) / 2), front, roomId: e.roomId, height: h };
  }

  togglePart(id, index) {
    const e = this.entries.get(id);
    if (!e?.parts.length) return false;
    if (index == null) {
      const open = e.partTarget.every(t => t === 0);
      e.partTarget = e.partTarget.map(() => (open ? 1 : 0));
      return open;
    }
    e.partTarget[index] = e.partTarget[index] ? 0 : 1;
    return e.partTarget[index] === 1;
  }
  partIndexOf(obj) {
    for (let o = obj; o; o = o.parent) if (o.userData.partIndex != null) return o.userData.partIndex;
    return null;
  }

  pickables({ exclude } = {}) {
    const list = [];
    for (const e of this.entries.values()) {
      if (e.meta.id === exclude) continue;
      if (e.holder) list.push(e.holder); if (e.stand) list.push(e.stand); if (e.frame) list.push(e.frame);
    }
    return list;
  }

  setLabelsVisible(roomId) {
    for (const e of this.entries.values()) if (e.label) e.label.visible = roomId === 'all' || e.roomId === roomId;
  }

  update(dt, time) {
    for (const e of this.entries.values()) {
      e.parts.forEach((p, i) => {
        const target = e.partTarget[i];
        if (Math.abs(e.partT[i] - target) < 1e-4) return;
        e.partT[i] += Math.sign(target - e.partT[i]) * Math.min(Math.abs(target - e.partT[i]), dt * 1.3);
        const t = e.partT[i], eased = t * t * (3 - 2 * t);
        applyPart(p, eased);
      });
      if (e.placeholder) e.placeholder.traverse(o => {
        if (o.userData.spin) { o.rotation.y = time * 0.8; o.rotation.x = Math.sin(time * 0.6) * 0.3; }
        if (o.userData.pulse) o.scale.setScalar(1 + Math.sin(time * 2.5) * 0.08);
        if (o.userData.float) { o.position.y = 0.95 + Math.sin(time * 1.4) * 0.04; o.rotation.y = Math.sin(time * 0.5) * 0.4; }
      });
    }
  }

  dispose(e, keepEntry = false) {
    e.holder?.removeFromParent();
    e.stand?.removeFromParent(); e.stand = null;
    e.frame?.removeFromParent(); e.frame = null;
    e.label?.removeFromParent(); e.label = null;
    e.placeholder = null;
    if (!keepEntry) e.holder = null;
  }
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
