// 拾光回忆馆 · 主程序：渲染、相机漫游、交互
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
import { ROOMS, DISPLAY_ROOMS, roomById, roomBox, VILLA } from './rooms.js';
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
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 400);

// 环境反射（镀铬、漆面靠它出效果）
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

// 黄昏的天空与阳光——“拾光”
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(58), THREE.MathUtils.degToRad(-38));
const sky = new Sky();
sky.scale.setScalar(350);
const su = sky.material.uniforms;
su.turbidity.value = 6; su.rayleigh.value = 1.6; su.mieCoefficient.value = 0.006; su.mieDirectionalG.value = 0.85;
su.sunPosition.value.copy(sunDir);
scene.add(sky);

const sun = new THREE.DirectionalLight('#ffdcae', 3.0);
sun.position.copy(sunDir).multiplyScalar(40);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 100 });
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.025; sun.shadow.radius = 3;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight('#dfe8f5', '#7a6248', 0.55);
const SKY_OUT = new THREE.Color('#dfe8f5'), SKY_IN = new THREE.Color('#f6e4c8');
scene.add(hemi);

// 聚焦藏品时的展柜聚光灯
const spot = new THREE.SpotLight('#fff8f0', 0, 9, 0.5, 0.6, 1.2);
spot.castShadow = true; spot.shadow.mapSize.set(2048, 2048); spot.shadow.bias = -0.0002; spot.shadow.normalBias = 0.02;
scene.add(spot, spot.target);

// ---------------------------------------------------------------- 后期：GTAO 环境光遮蔽
const hq = !params.has('lq') && !/Mobi|Android/i.test(navigator.userAgent);
let composer = null, gtao = null;
if (hq) {
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.addPass(new RenderPass(scene, camera));
  gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
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

// 总览模式的房间名标签
const roomLabels = [];
for (const r of ROOMS) {
  const b = roomBox(r);
  const el = document.createElement('div');
  el.className = 'room-label';
  el.innerHTML = `<b>${r.name}</b><small>${r.en}</small><i></i>`;
  el.addEventListener('click', () => r.corridor ? null : enterRoom(r.id));
  const obj = new CSS2DObject(el);
  obj.position.set(b.cx, 0.3, b.cz);
  obj.userData.roomId = r.id;
  scene.add(obj);
  roomLabels.push(obj);
}

// ---------------------------------------------------------------- 相机 & 漫游
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.screenSpacePanning = false;

const state = { mode: 'intro', roomId: null, itemId: null };
let tween = null;

function flyTo(pos, target, dur = 1.6, done) {
  tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone(), t: 0, dur, done };
  controls.enabled = false;
}
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function setControlLimits(mode) {
  if (mode === 'intro') Object.assign(controls, { minDistance: 18, maxDistance: 60, maxPolarAngle: 1.45, minPolarAngle: 0.6, enablePan: false });
  if (mode === 'overview') Object.assign(controls, { minDistance: 10, maxDistance: 70, maxPolarAngle: 1.25, minPolarAngle: 0.15, enablePan: true });
  if (mode === 'room') Object.assign(controls, { minDistance: 0.8, maxDistance: 7, maxPolarAngle: 1.62, minPolarAngle: 0.25, enablePan: true });
  if (mode === 'item') Object.assign(controls, { minDistance: 0.35, maxDistance: 5, maxPolarAngle: 1.65, minPolarAngle: 0.15, enablePan: true });
}

// 屋顶揭开/盖上
let roofT = 0, roofTarget = 0;
function setRoof(open) { roofTarget = open ? 1 : 0; }
// 室内外不同的环境光：进屋后压低天光，让窗口光斑和灯光出层次
const ambient = { env: 0.55, hemi: 0.55, envT: 0.55, hemiT: 0.55 };
function setAmbient(inside) { ambient.envT = inside ? 0.36 : 0.55; ambient.hemiT = inside ? 0.38 : 0.55; ambient.inside = inside; }
function applyRoof() {
  const k = ease(roofT);
  villa.roof.position.y = k * 22;
  villa.roof.rotation.z = k * 0.08;
  villa.roof.visible = roofT < 0.999;
}

function goIntro() {
  state.mode = 'intro'; state.roomId = null; state.itemId = null;
  setRoof(false);
  villa.setMode('intro');
  setAmbient(false);
  setControlLimits('intro');
  collection.setLabelsVisible('none');
  spot.intensity = 0;
  flyTo(new THREE.Vector3(2, 4.2, 30), new THREE.Vector3(-6.5, 2.4, 0), 1.8); // 别墅偏右，给左侧标题留空
  ui.onMode(state);
}
function goOverview() {
  state.mode = 'overview'; state.roomId = null; state.itemId = null;
  setRoof(true);
  villa.setMode('overview');
  setAmbient(false);
  setControlLimits('overview');
  collection.setLabelsVisible('none');
  spot.intensity = 0;
  flyTo(new THREE.Vector3(4, 27, 25), new THREE.Vector3(0, 0, 0.5), 2.0);
  ui.onMode(state);
}
function roomEntry(room) {
  const b = roomBox(room);
  const door = room.openings.find(o => o.kind === 'door' && !(room.entrance && o.side === 's')) || room.openings[0];
  // 从门口往里看
  const inward = { n: [0, 1], s: [0, -1], w: [1, 0], e: [-1, 0] }[door.side];
  const dp = door.side === 'n' || door.side === 's' ? [door.at, door.side === 'n' ? b.z0 : b.z1] : [door.side === 'w' ? b.x0 : b.x1, door.at];
  const depth = Math.abs(inward[0]) ? b.w : b.d;
  const pos = new THREE.Vector3(dp[0] + inward[0] * 0.7, 2.45, dp[1] + inward[1] * 0.7);
  pos.x = THREE.MathUtils.lerp(pos.x, b.cx, 0.2); pos.z = THREE.MathUtils.lerp(pos.z, b.cz, 0.1);
  // 看向房间深处约 2/3 处、齐腰高度
  const target = new THREE.Vector3(dp[0] + inward[0] * depth * 0.62, 1.0, dp[1] + inward[1] * depth * 0.62);
  target.x = THREE.MathUtils.lerp(target.x, b.cx, 0.6); target.z = THREE.MathUtils.lerp(target.z, b.cz, Math.abs(inward[0]) ? 0.6 : 0);
  return { pos, target };
}
function enterRoom(id) {
  const room = roomById(id);
  if (!room) return;
  state.prevMode = state.mode;
  state.mode = 'room'; state.roomId = id; state.itemId = null;
  setRoof(true);
  villa.setMode('room', id);
  setAmbient(true);
  setControlLimits('room');
  collection.setLabelsVisible(id);
  spot.intensity = 0;
  const { pos, target } = roomEntry(room);
  flyTo(pos, target, state.prevMode === 'overview' ? 2.0 : 1.5);
  ui.onMode(state);
}
function focusItem(id, { open = false } = {}) {
  const info = collection.focusInfo(id);
  if (!info) return;
  state.mode = 'item'; state.itemId = id; state.roomId = info.roomId;
  setRoof(true);
  villa.setMode('item', info.roomId);
  setAmbient(true);
  setControlLimits('item');
  collection.setLabelsVisible('none');
  const dist = info.radius * 2.3 + 0.5;
  const side = new THREE.Vector3(info.front.z, 0, -info.front.x).multiplyScalar(dist * 0.35);
  const pos = info.center.clone().addScaledVector(info.front, dist).add(side).add(new THREE.Vector3(0, info.radius * 0.45 + 0.15, 0));
  clampToRoom(pos, info.roomId);
  flyTo(pos, info.center, 1.4);
  // 聚光灯从斜上方打过去
  spot.position.copy(info.center).addScaledVector(info.front, 1.6).add(new THREE.Vector3(0.6, Math.max(2.2, info.height + 1.2), 0));
  spot.position.y = Math.min(spot.position.y, VILLA.height - 0.1);
  spot.target.position.copy(info.center);
  spot.angle = Math.min(0.9, Math.atan((info.radius + 0.4) / spot.position.distanceTo(info.center)) * 1.4);
  spot.intensity = 14;
  ui.onMode(state);
  if (open) collection.togglePart(id);
}
function back() {
  if (state.mode === 'item') enterRoom(state.roomId);
  else if (state.mode === 'room') goOverview();
  else if (state.mode === 'overview') goIntro();
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
function pick(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const targets = [...collection.pickables()];
  if (state.mode === 'overview') targets.push(...villa.roomFloors.values());
  if (state.mode === 'room' || state.mode === 'item') targets.push(...[...villa.group.children].filter(o => o.name.startsWith('room:')));
  const hits = raycaster.intersectObjects(targets, true);
  for (const h of hits) {
    if (!h.object.visible || h.object.material?.opacity === 0) continue;
    let o = h.object;
    while (o && o.userData.itemId == null && o.userData.roomId == null) o = o.parent;
    return { hit: h, itemId: h.object.userData.itemId ?? o?.userData.itemId, roomId: o?.userData.roomId, isFrame: h.object.userData.isFrame, object: h.object };
  }
  return null;
}
renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointermove', e => {
  if (state.mode === 'intro' || tween) return;
  const p = pick(e);
  const overItem = p?.itemId != null && !(state.mode === 'overview' && p.isFrame);
  renderer.domElement.style.cursor = overItem || (state.mode === 'overview' && p?.roomId && !roomById(p.roomId)?.corridor) ? 'pointer' : '';
  const rid = state.mode === 'overview' && p?.roomId && !roomById(p.roomId)?.corridor ? p.roomId : null;
  if (rid !== hoverRoom) { hoverRoom = rid; villa.highlightRoom(rid); }
});
renderer.domElement.addEventListener('pointerup', e => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5 || tween) return;
  if (state.mode === 'intro') return;
  const p = pick(e);
  if (!p) return;
  if (p.itemId != null) {
    if (state.mode === 'item' && state.itemId === p.itemId && !p.isFrame) {
      const idx = collection.partIndexOf(p.object);
      const opened = collection.togglePart(p.itemId, idx);
      ui.onPartsChanged(p.itemId);
      return;
    }
    focusItem(p.itemId);
    ui.selectItem(p.itemId);
    return;
  }
  if (state.mode === 'overview' && p.roomId && !roomById(p.roomId)?.corridor) enterRoom(p.roomId);
});
addEventListener('keydown', e => {
  if (e.target.closest('input,textarea,select')) return;
  if (e.key === 'Escape') { if (ui.closeModal()) return; back(); }
});

// ---------------------------------------------------------------- UI
const ui = new UI({
  collection,
  actions: {
    enter: () => goOverview(),
    overview: () => goOverview(),
    intro: () => goIntro(),
    room: id => enterRoom(id),
    item: (id, opts) => focusItem(id, opts),
    back,
    togglePart: (id, idx) => collection.togglePart(id, idx),
    refresh: () => refresh(),
  },
});

async function refresh() {
  try {
    const items = await (await fetch('/api/items')).json();
    await collection.sync(items);
    ui.setItems(items);
    for (const l of roomLabels) {
      const n = items.filter(i => (i.room === l.userData.roomId) || (l.userData.roomId === 'foyer' && (i.room === 'auto' || !roomById(i.room)))).length;
      const r = roomById(l.userData.roomId);
      l.element.querySelector('i').textContent = r.corridor ? `${items.length} 张照片` : n ? `${n} 件` : '空';
    }
    return items;
  } catch (e) { console.error(e); return []; }
}

// ---------------------------------------------------------------- 主循环
const timer = new THREE.Timer();
const tmp = new THREE.Vector3();
function frame(ts) {
  timer.update(ts);
  const dt = Math.min(timer.getDelta(), 0.05), time = timer.getElapsed();
  if (tween) {
    tween.t += dt / tween.dur;
    const k = ease(Math.min(1, tween.t));
    camera.position.lerpVectors(tween.p0, tween.p1, k);
    // 弧线飞行：中段抬高一点
    camera.position.y += Math.sin(Math.PI * k) * Math.min(4, tween.p0.distanceTo(tween.p1) * 0.12);
    controls.target.lerpVectors(tween.t0, tween.t1, k);
    if (tween.t >= 1) { const d = tween.done; tween = null; controls.enabled = true; d?.(); }
  }
  controls.update();
  if (!tween && (state.mode === 'room' || state.mode === 'item')) clampToRoom(camera.position, state.roomId);

  // 屋顶动画
  if (roofT !== roofTarget) {
    roofT += Math.sign(roofTarget - roofT) * Math.min(Math.abs(roofTarget - roofT), dt * 0.9);
    applyRoof();
  }
  // 房间标签只在总览显示
  for (const l of roomLabels) l.visible = state.mode === 'overview' && !tween;

  ambient.env += (ambient.envT - ambient.env) * Math.min(1, dt * 2);
  ambient.hemi += (ambient.hemiT - ambient.hemi) * Math.min(1, dt * 2);
  scene.environmentIntensity = ambient.env; hemi.intensity = ambient.hemi;
  hemi.color.lerp(ambient.inside ? SKY_IN : SKY_OUT, Math.min(1, dt * 2));
  villa.updateCamera(camera, state.mode);
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
camera.position.set(14, 6, 46);
controls.target.set(0, 2.6, 0);
setControlLimits('intro');
await refresh();
ui.ready();
frame();
goIntro();

// 深链接：?item=xxx 直接看某件藏品，?room=bedroom 直接进房间
if (params.get('item')) setTimeout(() => { focusItem(params.get('item')); ui.selectItem(params.get('item')); }, 300);
else if (params.get('room')) setTimeout(() => enterRoom(params.get('room')), 300);
else if (params.has('overview')) setTimeout(goOverview, 300);

// 有藏品在生成中时定时刷新
setInterval(async () => {
  if (ui.hasPending()) await refresh();
}, 5000);

window.__memory = { finishTween: () => { if (tween) tween.t = 1; roofT = roofTarget; applyRoof(); ambient.env = ambient.envT; ambient.hemi = ambient.hemiT; }, scene, camera, controls, collection, villa, state, enterRoom, focusItem, goOverview, renderer };
