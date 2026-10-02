// 藏品：加载 model.js、按房间分配展位、展台/铭牌、生成中的占位、长廊里的原始照片、可动部件动画。
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
  // 从靠近门厅的位置开始挂
  return spots.sort((p, q) => Math.abs(p.x) - Math.abs(q.x));
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
    this.mats = {
      pedestal: new THREE.MeshPhysicalMaterial({ color: '#efe8dc', roughness: 0.55, clearcoat: 0.3 }),
      pedestalTop: new THREE.MeshPhysicalMaterial({ color: '#3b2618', roughness: 0.35, clearcoat: 0.8 }),
      vitrine: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.02, transparent: true, opacity: 0.12, envMapIntensity: 2.5, depthWrite: false, side: THREE.DoubleSide }),
      holo: new THREE.MeshBasicMaterial({ color: '#ffcf8a', wireframe: true, transparent: true, opacity: 0.55 }),
      frame: new THREE.MeshPhysicalMaterial({ color: '#2f1f14', roughness: 0.35, clearcoat: 0.7 }),
      mat: new THREE.MeshStandardMaterial({ color: '#f4efe4', roughness: 0.9 }),
      brass: new THREE.MeshPhysicalMaterial({ color: '#c9a45c', metalness: 1, roughness: 0.3 }),
    };
  }

  /** 与服务器列表同步：新增/更新/删除 */
  async sync(items) {
    const seen = new Set();
    const loads = [];
    for (const meta of items) {
      seen.add(meta.id);
      const e = this.entries.get(meta.id);
      const changed = !e || e.meta.status !== meta.status || e.meta.modelVersion !== meta.modelVersion || e.meta.room !== meta.room;
      if (!e) this.entries.set(meta.id, { meta, holder: null, model: null, parts: [], partT: [], partTarget: [] });
      const entry = this.entries.get(meta.id);
      const nameChanged = e && e.meta.name !== meta.name;
      entry.meta = meta;
      if (changed) loads.push(this.load(entry));
      else if (nameChanged) this.refreshLabels(entry);
    }
    for (const [id, e] of this.entries) if (!seen.has(id)) { this.dispose(e); this.entries.delete(id); }
    await Promise.all(loads);
    this.layout();
  }

  async load(entry) {
    const { meta } = entry;
    const holder = new THREE.Group(); holder.name = `item:${meta.id}`; holder.userData.itemId = meta.id;
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
    // 旧的移除
    if (entry.holder) this.dispose(entry, true);
    entry.holder = holder; entry.model = model; entry.error = error;
    entry.parts = model?.userData.parts || [];
    entry.partT = entry.parts.map(() => 0); entry.partTarget = entry.parts.map(() => 0);
    entry.parts.forEach(p => { if (p.type === 'slider') p.base = p.object.position[p.axis]; });

    if (model) {
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      entry.size = [size.x, size.y, size.z];
      entry.box = box;
      holder.add(model);
    } else {
      entry.size = meta.dimensions || [0.5, 0.5, 0.5];
      entry.placeholder = this.makePlaceholder(meta, error);
      holder.add(entry.placeholder);
    }
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
    // 漂浮的原始照片卡片
    const photo = meta.photos?.[0];
    if (photo) {
      this.texLoader.load(`/items/${meta.id}/${photo}`, t => {
        t.colorSpace = THREE.SRGBColorSpace;
        const a = t.image.width / t.image.height;
        const card = new THREE.Mesh(new THREE.PlaneGeometry(a >= 1 ? 0.42 : 0.42 * a, a >= 1 ? 0.42 / a : 0.42), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.92, side: THREE.DoubleSide }));
        card.position.y = 0.45; card.userData.float = true; g.add(card);
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

  /** 计算每件藏品的位置 */
  layout() {
    const byRoom = new Map(ROOMS.map(r => [r.id, []]));
    const sorted = [...this.entries.values()].sort((a, b) => String(a.meta.createdAt).localeCompare(String(b.meta.createdAt)));
    for (const e of sorted) {
      const rid = byRoom.has(e.meta.room) && !roomById(e.meta.room).corridor ? e.meta.room : 'foyer';
      byRoom.get(rid).push(e);
    }
    for (const [rid, list] of byRoom) {
      const room = roomById(rid);
      if (!list.length) continue;
      const wall = [...room.slots.wall], ped = [...room.slots.pedestal];
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
        else { // 展位用完：沿房间中线继续排
          const k = extra++;
          slot = { at: [b.x0 + 1.2 + (k % Math.max(1, Math.floor((b.w - 2.4) / 1.3))) * 1.3, b.cz + (Math.floor(k / 5) % 2 ? -1 : 1) * 0.8] };
        }
        this.place(e, slot, onWall, big, doorPt, room);
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

  place(e, slot, onWall, big, doorPt, room) {
    const [w, h, d] = e.size;
    const holder = e.holder;
    // 清掉旧展台
    if (e.stand) { e.stand.removeFromParent(); e.stand = null; }
    let x, z, rot, lift = 0;
    if (onWall) {
      rot = slot.rot;
      const fx = Math.sin(rot), fz = Math.cos(rot);
      const depth = big ? d : Math.max(d, 0.5);
      x = slot.at[0] + fx * (depth / 2 + 0.07); z = slot.at[1] + fz * (depth / 2 + 0.07);
    } else {
      [x, z] = slot.at;
      rot = Math.atan2(doorPt[0] - x, doorPt[1] - z);
    }
    // 小件放展台上
    if (!big) {
      const ph = THREE.MathUtils.clamp(1.0 - h * 0.85, 0.32, 0.92);
      const fw = Math.max(0.42, Math.max(w, d) + 0.2);
      const stand = new THREE.Group();
      const body = new THREE.Mesh(new RoundedBoxGeometry(fw, ph - 0.03, fw, 3, 0.012), this.mats.pedestal);
      body.position.y = (ph - 0.03) / 2; body.castShadow = body.receiveShadow = true; stand.add(body);
      const top = new THREE.Mesh(new RoundedBoxGeometry(fw + 0.03, 0.03, fw + 0.03, 2, 0.006), this.mats.pedestalTop);
      top.position.y = ph - 0.015; top.castShadow = top.receiveShadow = true; stand.add(top);
      const plinth = new THREE.Mesh(new RoundedBoxGeometry(fw + 0.04, 0.05, fw + 0.04, 2, 0.006), this.mats.pedestalTop);
      plinth.position.y = 0.025; plinth.receiveShadow = true; stand.add(plinth);
      const plaque = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(0.3, fw * 0.75), Math.min(0.3, fw * 0.75) * 0.28), new THREE.MeshPhysicalMaterial({ map: labelTexture([e.meta.name, e.meta.era || e.meta.discardedAt || '']), metalness: 0.6, roughness: 0.35 }));
      plaque.position.set(0, ph * 0.72, fw / 2 + 0.002); stand.add(plaque);
      // 很小的物件加玻璃罩
      if (Math.max(w, h, d) < 0.36 && e.model) {
        const vh = h + 0.12;
        const glass = new THREE.Mesh(new THREE.BoxGeometry(fw - 0.04, vh, fw - 0.04), this.mats.vitrine);
        glass.position.y = ph + vh / 2; glass.renderOrder = 5; stand.add(glass);
      }
      stand.traverse(o => { o.userData.itemId = e.meta.id; });
      stand.position.set(x, 0, z); stand.rotation.y = rot;
      this.group.add(stand);
      e.stand = stand;
      lift = ph;
    }
    holder.position.set(x, lift, z);
    holder.rotation.y = rot;
    holder.userData.roomId = room.id;
    e.roomId = room.id;
    holder.traverse(o => { o.userData.itemId = e.meta.id; });
    e.label && e.label.position.set(0, h + 0.25, 0);
    holder.updateMatrixWorld(true);
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

  /** 切换可动部件 */
  togglePart(id, index) {
    const e = this.entries.get(id);
    if (!e?.parts.length) return false;
    const idx = index ?? null;
    if (idx == null) { // 全部一起开/关
      const open = e.partTarget.every(t => t === 0);
      e.partTarget = e.partTarget.map(() => (open ? 1 : 0));
      return open;
    }
    e.partTarget[idx] = e.partTarget[idx] ? 0 : 1;
    return e.partTarget[idx] === 1;
  }
  partIndexOf(obj) {
    for (let o = obj; o; o = o.parent) if (o.userData.partIndex != null) return o.userData.partIndex;
    return null;
  }

  pickables() {
    const list = [];
    for (const e of this.entries.values()) { if (e.holder) list.push(e.holder); if (e.stand) list.push(e.stand); if (e.frame) list.push(e.frame); }
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
