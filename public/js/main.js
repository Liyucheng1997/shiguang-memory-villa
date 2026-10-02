// 拾光回忆馆 · 主程序：渲染、漫游/鸟瞰/近看、摆放、装修、昼夜
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildVilla } from './villa.js';
import { Collection } from './items.js';
import { Walker } from './walk.js';
import { ROOMS, roomById, roomBox, VILLA, defaultDecor } from './rooms.js';
import { setAnisotropy } from './textures.js';
import { UI } from './ui.js';

const params = new URLSearchParams(location.search);
const container = document.getElementById('scene');

// ---------------------------------------------------------------- 渲染器
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
container.appendChild(renderer.domElement);
setAnisotropy(renderer.capabilities.getMaxAnisotropy());

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
labelRenderer.domElement.className = 'labels';
container.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#e8d8bf', 70, 190);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 400);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const sky = new Sky();
sky.scale.setScalar(350);
scene.add(sky);
const sun = new THREE.DirectionalLight('#ffdcae', 3.0);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 100 });
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.025; sun.shadow.radius = 3;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight('#dfe8f5', '#7a6248', 0.55);
scene.add(hemi);

// 近看藏品时的展柜聚光灯
const spot = new THREE.SpotLight('#fff8f0', 0, 9, 0.5, 0.6, 1.2);
spot.castShadow = true; spot.shadow.mapSize.set(2048, 2048); spot.shadow.bias = -0.0002; spot.shadow.normalBias = 0.02;
scene.add(spot, spot.target);

// ---------------------------------------------------------------- 后期：GTAO 环境光遮蔽
const hq = !params.has('lq') && !/Mobi|Android/i.test(navigator.userAgent);
let composer = null;
if (hq) {
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 0.85;
  gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.6, thickness: 1.2, scale: 1.0, samples: 12 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  composer.addPass(gtao);
  composer.addPass(new OutputPass());
}

// ---------------------------------------------------------------- 场景内容
const villa = buildVilla(scene, { renderer });
const collection = new Collection(scene, { renderer });
const walker = new Walker(camera, renderer.domElement, {
  colliders: villa.colliders,
  floorHeight: villa.floorHeight,
  obstacles: () => collection.obstacles(),
});

// 鸟瞰模式的房间名标签
const roomLabels = [];
for (const r of ROOMS) {
  const b = roomBox(r);
  const el = document.createElement('div');
  el.className = 'room-label';
  el.innerHTML = `<b>${r.name}</b><small>${r.en}</small><i></i>`;
  el.addEventListener('click', () => enterRoom(r.id));
  const obj = new CSS2DObject(el);
  obj.position.set(b.cx, 0.3, b.cz);
  obj.userData.roomId = r.id;
  scene.add(obj);
  roomLabels.push(obj);
}

// ---------------------------------------------------------------- 昼夜
const TIMES = {
  morning: { phi: 72, theta: 62, color: '#ffd4a8', sun: 2.4, turb: 4, ray: 2.0, mie: 0.005, exp: 0.95, fog: '#e7ddcf', env: 0.55, hemi: 0.5, skyHemi: '#e4ecf6' },
  noon:    { phi: 32, theta: -20, color: '#fff4e2', sun: 3.4, turb: 3, ray: 1.0, mie: 0.004, exp: 0.88, fog: '#dfe5e8', env: 0.6, hemi: 0.6, skyHemi: '#dfe8f5' },
  dusk:    { phi: 66, theta: -52, color: '#ffbc84', sun: 2.8, turb: 7, ray: 2.2, mie: 0.007, exp: 1.0, fog: '#e8d2b4', env: 0.5, hemi: 0.5, skyHemi: '#ecdcc8' },
  night:   { phi: 50, theta: -30, color: '#8ea6ff', sun: 0.32, turb: 2, ray: 0.3, mie: 0.002, exp: 1.15, fog: '#151a26', env: 0.1, hemi: 0.12, skyHemi: '#33405c', skyPhi: 97 },
};
let timeCfg = TIMES.dusk;
function applyTime(name) {
  const t = TIMES[name] || TIMES.dusk;
  timeCfg = t;
  const dir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(t.phi), THREE.MathUtils.degToRad(t.theta));
  sun.position.copy(dir).multiplyScalar(40);
  sun.color.set(t.color); sun.intensity = t.sun;
  const su = sky.material.uniforms;
  su.turbidity.value = t.turb; su.rayleigh.value = t.ray; su.mieCoefficient.value = t.mie; su.mieDirectionalG.value = 0.85;
  su.sunPosition.value.setFromSphericalCoords(1, THREE.MathUtils.degToRad(t.skyPhi || t.phi), THREE.MathUtils.degToRad(t.theta));
  renderer.toneMappingExposure = t.exp;
  scene.fog.color.set(t.fog);
  SKY_OUT.set(t.skyHemi);
  villa.setNight(name === 'night');
}
// 室内外不同的环境光：进屋后压低天光，让窗口光斑和灯光出层次
const ambient = { env: 0.55, hemi: 0.55, inside: false };
const SKY_IN = new THREE.Color('#f6e4c8'), SKY_OUT = new THREE.Color('#dfe8f5');

// ---------------------------------------------------------------- 相机与模式
// mode: intro（外景开场） | walk（第一人称漫游） | overview（鸟瞰） | item（近看藏品）
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.screenSpacePanning = false;
controls.enabled = false;

const state = { mode: 'intro', roomId: null, itemId: null, placing: null, returnTo: null };
let tween = null;
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function flyTo(pos, target, dur = 1.6, done) {
  const t0 = new THREE.Vector3(); camera.getWorldDirection(t0); t0.multiplyScalar(4).add(camera.position);
  tween = { p0: camera.position.clone(), t0: state.mode === 'walk' || !controls.enabled ? t0 : controls.target.clone(), p1: pos.clone(), t1: target.clone(), t: 0, dur, done };
  controls.enabled = false;
  walker.enabled = false;
}
function setOrbit(mode) {
  if (mode === 'intro') Object.assign(controls, { minDistance: 18, maxDistance: 60, maxPolarAngle: 1.45, minPolarAngle: 0.6, enablePan: false });
  if (mode === 'overview') Object.assign(controls, { minDistance: 8, maxDistance: 70, maxPolarAngle: 1.3, minPolarAngle: 0.1, enablePan: true });
  if (mode === 'item') Object.assign(controls, { minDistance: 0.35, maxDistance: 6, maxPolarAngle: 1.65, minPolarAngle: 0.15, enablePan: true });
}

let roofT = 0, roofTarget = 0;
function applyRoof() {
  const k = ease(roofT);
  villa.roof.position.y = k * 22;
  villa.roof.rotation.z = k * 0.08;
  villa.roof.visible = roofT < 0.999;
}

function goIntro() {
  cancelPlacing();
  state.mode = 'intro'; state.roomId = null; state.itemId = null;
  roofTarget = 0;
  villa.setMode('intro');
  collection.setLabelsVisible('none');
  spot.intensity = 0;
  setOrbit('intro');
  flyTo(new THREE.Vector3(2, 4.2, 30), new THREE.Vector3(-6.5, 2.4, 0), 1.8, () => { controls.target.set(-6.5, 2.4, 0); controls.enabled = true; });
  ui.onMode(state);
}
/** 进入漫游；pose = { x, z, yaw, pitch }，不给则从当前位置继续 */
function goWalk(pose, dur = 1.6) {
  state.mode = 'walk'; state.itemId = null;
  roofTarget = 1;
  villa.setMode('walk');
  spot.intensity = 0;
  const p = pose || { x: walker.pos.x, z: walker.pos.z, yaw: walker.yaw, pitch: walker.pitch };
  const { pos, target } = Walker.pose(p.x, p.z, p.yaw, p.pitch ?? -0.08, villa.floorHeight(p.x, p.z));
  flyTo(pos, target, dur, () => { walker.syncFromCamera(); walker.enabled = true; });
  ui.onMode(state);
}
function goOverview() {
  cancelPlacing();
  state.mode = 'overview'; state.itemId = null; state.roomId = null;
  roofTarget = 1;
  villa.setMode('overview');
  collection.setLabelsVisible('none');
  spot.intensity = 0;
  setOrbit('overview');
  flyTo(new THREE.Vector3(4, 27, 25), new THREE.Vector3(0, 0, 0.5), 2.0, () => { controls.target.set(0, 0, 0.5); controls.enabled = true; });
  ui.onMode(state);
}
// 从门口进入某个房间
function roomEntryPose(room) {
  const b = roomBox(room);
  const door = room.openings.find(o => o.kind === 'door' && !(room.entrance && o.side === 's')) || room.openings[0];
  const inward = { n: [0, 1], s: [0, -1], w: [1, 0], e: [-1, 0] }[door.side];
  const dp = door.side === 'n' || door.side === 's' ? [door.at, door.side === 'n' ? b.z0 : b.z1] : [door.side === 'w' ? b.x0 : b.x1, door.at];
  if (room.corridor) return { x: 0, z: 0.5, yaw: Math.PI / 2, pitch: -0.05 };
  return { x: dp[0] + inward[0] * 0.9, z: dp[1] + inward[1] * 0.9, yaw: Math.atan2(-inward[0], -inward[1]), pitch: -0.12 };
}
function enterRoom(id) {
  const room = roomById(id);
  if (!room) return;
  cancelPlacing();
  state.roomId = id;
  goWalk(roomEntryPose(room), state.mode === 'overview' || state.mode === 'intro' ? 2.0 : 1.4);
}
const PORCH = { x: 0, z: VILLA.maxZ + 3.2, yaw: 0, pitch: 0.02 };

function focusItem(id) {
  const info = collection.focusInfo(id);
  if (!info) return;
  cancelPlacing();
  if (state.mode === 'walk') state.returnTo = { mode: 'walk', pose: { x: walker.pos.x, z: walker.pos.z, yaw: walker.yaw, pitch: walker.pitch } };
  else if (state.mode !== 'item') state.returnTo = { mode: state.mode };
  state.mode = 'item'; state.itemId = id; state.roomId = info.roomId;
  roofTarget = 1;
  villa.setMode('item', info.roomId);
  collection.setLabelsVisible('none');
  setOrbit('item');
  const dist = info.radius * 2.3 + 0.5;
  const side = new THREE.Vector3(info.front.z, 0, -info.front.x).multiplyScalar(dist * 0.35);
  const pos = info.center.clone().addScaledVector(info.front, dist).add(side).add(new THREE.Vector3(0, info.radius * 0.45 + 0.15, 0));
  clampToRoom(pos, info.roomId);
  flyTo(pos, info.center, 1.3, () => { controls.target.copy(info.center); controls.enabled = true; });
  spot.position.copy(info.center).addScaledVector(info.front, 1.6).add(new THREE.Vector3(0.6, Math.max(2.2, info.height + 1.2), 0));
  spot.position.y = Math.min(spot.position.y, VILLA.height - 0.1);
  spot.target.position.copy(info.center);
  spot.angle = Math.min(0.9, Math.atan((info.radius + 0.4) / spot.position.distanceTo(info.center)) * 1.4);
  spot.intensity = 14;
  ui.onMode(state);
}
function back() {
  if (state.placing) return cancelPlacing();
  if (state.mode === 'item') {
    const r = state.returnTo;
    if (r?.mode === 'overview') goOverview(); else goWalk(r?.pose, 1.2);
  } else if (state.mode === 'overview') goWalk(null);
}
function clampToRoom(p, roomId) {
  const room = roomById(roomId); if (!room) return p;
  const b = roomBox(room), m = 0.32;
  p.x = THREE.MathUtils.clamp(p.x, b.x0 + m, b.x1 - m);
  p.z = THREE.MathUtils.clamp(p.z, b.z0 + m, b.z1 - m);
  p.y = THREE.MathUtils.clamp(p.y, 0.3, VILLA.height - 0.25);
  return p;
}

// ---------------------------------------------------------------- 拾取
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null, hoverRoom = null;
const roomGroups = () => villa.group.children.filter(o => o.name.startsWith('room:'));
function setPointer(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}
function pick(ev) {
  setPointer(ev);
  const targets = [...collection.pickables(), ...roomGroups()];
  for (const h of raycaster.intersectObjects(targets, true)) {
    if (!h.object.visible || h.object.material?.opacity === 0 || h.object.material?.transparent && h.object.material.opacity < 0.2) continue;
    let o = h.object;
    while (o && o.userData.itemId == null && o.userData.roomId == null) o = o.parent;
    return { hit: h, itemId: h.object.userData.itemId ?? o?.userData.itemId, roomId: o?.userData.roomId, isFrame: h.object.userData.isFrame, isFloor: h.object.userData.isFloor, object: h.object };
  }
  return null;
}

// ---------------------------------------------------------------- 摆放模式
// 藏品跟着鼠标走：可以放在地板上，也可以放在其它家具上面；滚轮/Q/E 旋转，左键放下，右键/Esc 取消
const _n = new THREE.Vector3();
function startPlacing(id) {
  const e = collection.entries.get(id);
  if (!e?.holder || !e.pos) return;
  if (state.mode === 'item') { const r = state.returnTo; if (r?.mode === 'overview') goOverview(); else goWalk(r?.pose, 1.0); }
  state.placing = { id, orig: { ...e.pos }, rot: e.pos.rot, pedestal: e.meta.placement?.pedestal, last: { ...e.pos }, valid: true };
  collection.moving = id;
  ui.setPlacing(state.placing, e.meta.name);
  renderer.domElement.style.cursor = 'crosshair';
}
function updatePlacing(ev) {
  const P = state.placing; if (!P) return;
  const e = collection.entries.get(P.id);
  setPointer(ev);
  const targets = [...villa.roomFloors.values(), ...collection.pickables({ exclude: P.id }).filter(o => !o.userData.isFrame)];
  const hits = raycaster.intersectObjects(targets, true);
  for (const h of hits) {
    if (!h.face || !h.object.visible) continue;
    _n.copy(h.face.normal).transformDirection(h.object.matrixWorld);
    if (_n.y < 0.6) continue; // 只能放在朝上的表面
    const room = villa.roomAt(h.point.x, h.point.z);
    const onFloor = !!h.object.userData.isFloor;
    P.valid = !!room;
    P.last = { room: room || P.orig.room, x: h.point.x, y: onFloor ? 0 : h.point.y, z: h.point.z, rot: P.rot, pedestal: P.pedestal };
    collection.place(e, P.last);
    ui.setPlacing(P, e.meta.name);
    return;
  }
}
function rotatePlacing(delta) {
  const P = state.placing; if (!P) return;
  P.rot += delta; P.last.rot = P.rot;
  collection.place(collection.entries.get(P.id), P.last);
}
async function commitPlacing() {
  const P = state.placing; if (!P || !P.valid) return;
  const e = collection.entries.get(P.id);
  const placement = { room: P.last.room, x: +P.last.x.toFixed(3), y: +P.last.y.toFixed(3), z: +P.last.z.toFixed(3), rot: +P.rot.toFixed(4), ...(typeof P.pedestal === 'boolean' ? { pedestal: P.pedestal } : {}) };
  e.meta.placement = placement; e.meta.room = placement.room; collection.touch(P.id);
  state.placing = null; collection.moving = null;
  renderer.domElement.style.cursor = '';
  ui.setPlacing(null);
  await ui.patch(P.id, { placement });
  ui.toast(`已放到${roomById(placement.room)?.name || ''}`);
  refresh();
}
function cancelPlacing() {
  const P = state.placing; if (!P) return;
  const e = collection.entries.get(P.id);
  state.placing = null; collection.moving = null;
  if (e) collection.place(e, P.orig);
  renderer.domElement.style.cursor = '';
  ui.setPlacing(null);
}
walker.wheelBlocked = () => !!state.placing;
renderer.domElement.addEventListener('wheel', e => { if (state.placing) { e.preventDefault(); rotatePlacing(Math.sign(e.deltaY) * Math.PI / 12); } }, { passive: false });
renderer.domElement.addEventListener('contextmenu', e => { if (state.placing) { e.preventDefault(); cancelPlacing(); } });

// ---------------------------------------------------------------- 指针事件
renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointermove', e => {
  if (state.mode === 'intro' || tween) return;
  if (state.placing) { if (!walker.dragging) updatePlacing(e); return; }
  if (e.buttons) return;
  const p = pick(e);
  const overItem = p?.itemId != null && !(state.mode === 'overview' && p.isFrame);
  const rid = state.mode === 'overview' && p?.roomId ? p.roomId : null;
  renderer.domElement.style.cursor = overItem || rid ? 'pointer' : state.mode === 'walk' ? 'grab' : '';
  if (rid !== hoverRoom) { hoverRoom = rid; villa.highlightRoom(rid); }
});
renderer.domElement.addEventListener('pointerup', e => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5 || tween || e.button !== 0) return;
  if (state.mode === 'intro') return;
  if (state.placing) { updatePlacing(e); commitPlacing(); return; }
  const p = pick(e);
  if (!p) return;
  if (p.itemId != null) {
    if (p.isFrame) { focusItem(p.itemId); ui.selectItem(p.itemId); return; }
    if (state.mode === 'overview') { focusItem(p.itemId); ui.selectItem(p.itemId); return; }
    // 漫游/近看：点到门、抽屉就开合；同时打开信息面板
    const idx = collection.partIndexOf(p.object);
    if (idx != null) collection.togglePart(p.itemId, idx);
    ui.selectItem(p.itemId);
    return;
  }
  if (state.mode === 'overview' && p.roomId) enterRoom(p.roomId);
});
renderer.domElement.addEventListener('dblclick', e => {
  if (state.mode !== 'walk' || state.placing) return;
  const p = pick(e);
  if (p?.hit && (p.isFloor || p.hit.point.y < 0.1 && p.itemId == null)) walker.walkTo(p.hit.point.x, p.hit.point.z);
});
addEventListener('keydown', e => {
  if (e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') { if (ui.closeModal()) return; if (state.placing) return cancelPlacing(); if (ui.closePanelIfOpen?.() && state.mode === 'walk') return; back(); }
  if (state.placing && (k === 'q' || k === 'e')) rotatePlacing((k === 'q' ? 1 : -1) * Math.PI / 12);
  if (state.placing && k === 'enter') commitPlacing();
  if (k === 'm' && state.mode !== 'intro') state.mode === 'overview' ? goWalk(null) : goOverview();
  if (k === 'g' && ui.selected && !state.placing && state.mode !== 'intro') startPlacing(ui.selected);
});

// ---------------------------------------------------------------- 装修
let decor = defaultDecor();
let decorTimer = null;
function applyDecor() {
  for (const [id, s] of Object.entries(decor.rooms)) villa.applyRoom(id, s);
  applyTime(decor.time);
}
let decorDirty = false;
function flushDecor() {
  clearTimeout(decorTimer);
  if (!decorDirty) return;
  decorDirty = false;
  fetch('/api/villa', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(decor), keepalive: true }).catch(() => {});
}
function saveDecor() {
  decorDirty = true;
  clearTimeout(decorTimer);
  decorTimer = setTimeout(flushDecor, 400);
}
// 关页面/切走时立刻保存（后台标签页的定时器会被浏览器节流）
addEventListener('pagehide', flushDecor);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushDecor(); });

// ---------------------------------------------------------------- UI
const ui = new UI({
  collection,
  actions: {
    enter: () => goWalk(PORCH, 2.2),
    overview: () => goOverview(),
    walk: () => goWalk(null),
    intro: () => goIntro(),
    room: id => enterRoom(id),
    item: id => focusItem(id),
    back,
    togglePart: (id, idx) => collection.togglePart(id, idx),
    refresh: () => refresh(),
    move: id => startPlacing(id),
    scale: (id, s) => collection.setScale(id, s),
    pedestal: async (id, on) => {
      const e = collection.entries.get(id); if (!e?.pos) return;
      const placement = { room: e.pos.room, x: e.pos.x, y: e.pos.y, z: e.pos.z, rot: e.pos.rot, pedestal: on };
      e.meta.placement = placement; collection.touch(id); collection.place(e, placement);
      await ui.patch(id, { placement });
    },
    autoPlace: async id => { const e = collection.entries.get(id); if (e) { e.meta.placement = null; collection.touch(id); } await ui.patch(id, { placement: null }); collection.layout(); },
    getDecor: () => decor,
    currentRoom: () => state.roomId,
    setDecor: (roomId, patch) => {
      if (roomId === '*time') decor.time = patch;
      else {
        const r = decor.rooms[roomId];
        Object.assign(r, patch.light ? { ...patch, light: { ...r.light, ...patch.light } } : patch);
        villa.applyRoom(roomId, r);
      }
      if (roomId === '*time') applyTime(decor.time);
      saveDecor();
    },
  },
});

async function refresh() {
  try {
    const items = await (await fetch('/api/items')).json();
    await collection.sync(items);
    ui.setItems(items);
    for (const l of roomLabels) {
      const r = roomById(l.userData.roomId);
      const n = items.filter(i => i.room === r.id || (r.id === 'foyer' && !roomById(i.room))).length;
      l.element.querySelector('i').textContent = r.corridor ? `${items.length} 张照片` : n ? `${n} 件` : '空';
    }
    return items;
  } catch (e) { console.error(e); return []; }
}

// ---------------------------------------------------------------- 主循环
const timer = new THREE.Timer();
const lookTmp = new THREE.Vector3();
function frame(ts) {
  timer.update(ts);
  const dt = Math.min(timer.getDelta(), 0.05), time = timer.getElapsed();
  if (tween) {
    tween.t += dt / tween.dur;
    const k = ease(Math.min(1, tween.t));
    camera.position.lerpVectors(tween.p0, tween.p1, k);
    camera.position.y += Math.sin(Math.PI * k) * Math.min(3, tween.p0.distanceTo(tween.p1) * 0.1);
    lookTmp.lerpVectors(tween.t0, tween.t1, k);
    camera.lookAt(lookTmp);
    if (tween.t >= 1) { camera.position.copy(tween.p1); camera.lookAt(tween.t1); const d = tween.done; tween = null; d?.(); }
  } else if (state.mode === 'walk') {
    walker.update(dt);
  } else if (controls.enabled) {
    controls.update();
    if (state.mode === 'item') clampToRoom(camera.position, state.roomId);
  }

  // 漫游时根据所在位置更新“当前房间”
  if (state.mode === 'walk') {
    const rid = villa.roomAt(walker.pos.x, walker.pos.z);
    if (rid !== state.roomId) { state.roomId = rid; collection.setLabelsVisible(rid); ui.onRoomChanged(rid); }
  }

  if (roofT !== roofTarget) { roofT += Math.sign(roofTarget - roofT) * Math.min(Math.abs(roofTarget - roofT), dt * 0.9); applyRoof(); }
  for (const l of roomLabels) l.visible = state.mode === 'overview' && !tween;

  // 环境光：室内压低，夜里更暗
  const inside = state.mode !== 'overview' && state.mode !== 'intro' && camera.position.y < VILLA.height;
  const envT = timeCfg.env * (inside ? 0.65 : 1), hemiT = timeCfg.hemi * (inside ? 0.7 : 1);
  ambient.env += (envT - ambient.env) * Math.min(1, dt * 2);
  ambient.hemi += (hemiT - ambient.hemi) * Math.min(1, dt * 2);
  scene.environmentIntensity = ambient.env; hemi.intensity = ambient.hemi;
  hemi.color.lerp(inside && decor.time !== 'night' ? SKY_IN : SKY_OUT, Math.min(1, dt * 2));
  villa.updateCamera(camera, state.mode, state.roomId);
  collection.update(dt, time);

  if (composer) composer.render(); else renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(frame);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
  composer?.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- 启动
try { const d = await (await fetch('/api/villa')).json(); if (d?.rooms) decor = d; } catch { /* 用默认装修 */ }
applyDecor();
camera.position.set(14, 6, 46);
camera.lookAt(0, 2.6, 0);
walker.pos.set(PORCH.x, 0, PORCH.z);
await refresh();
ui.ready();
frame();
goIntro();

// 深链接：?item=xxx 直接看某件藏品，?room=bedroom 直接进房间
if (params.get('item')) setTimeout(() => { document.body.classList.add('entered'); focusItem(params.get('item')); ui.selectItem(params.get('item')); }, 300);
else if (params.get('room')) setTimeout(() => { document.body.classList.add('entered'); enterRoom(params.get('room')); }, 300);
else if (params.has('overview')) setTimeout(() => { document.body.classList.add('entered'); goOverview(); }, 300);

setInterval(async () => { if (ui.hasPending()) await refresh(); }, 5000);

window.__memory = {
  finishTween: () => { if (tween) tween.t = 1; roofT = roofTarget; applyRoof(); },
  scene, camera, controls, collection, villa, walker, state, enterRoom, focusItem, goOverview, goWalk, startPlacing, renderer, decor: () => decor,
};
