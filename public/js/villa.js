// 别墅建筑：地基、房间、墙（门洞/窗洞）、踢脚线、墙裙、门窗、吊灯、屋顶、花园。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROOMS, VILLA, roomBox, kelvinColor } from './rooms.js';
import { finish, finishMaterial, labelTexture } from './textures.js';

const H = VILLA.height, T = VILLA.wallT;
const GROUND = -0.36;

// 世界坐标盒式 UV（单位：米），保证相邻墙段纹理连续
function worldBoxUV(geo) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let u, v;
    if (nx >= ny && nx >= nz) { u = z; v = y; } else if (ny >= nz) { u = x; v = z; } else { u = x; v = y; }
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
// 世界坐标里的盒子：[x0,x1] [y0,y1] [z0,z1]
function boxGeo(x0, x1, y0, y1, z0, z1) {
  const g = new THREE.BoxGeometry(Math.max(1e-3, x1 - x0), Math.max(1e-3, y1 - y0), Math.max(1e-3, z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return worldBoxUV(g);
}
// 把一组同材质盒子合并成一个 Mesh，减少 draw call
function mergedMesh(geos, material, { cast = true, receive = true, name } = {}) {
  if (!geos.length) return null;
  const m = new THREE.Mesh(mergeGeometries(geos, false), material);
  m.castShadow = cast; m.receiveShadow = receive;
  if (name) m.name = name;
  return m;
}
// 让饰面贴图按“米”平铺
function meterMaterial(name, extra) {
  const m = finishMaterial(name, extra);
  const tile = m.userData.tile || 1;
  for (const k of ['map', 'bumpMap', 'roughnessMap']) if (m[k]) { m[k].repeat.set(1 / tile, 1 / tile); }
  return m;
}

export function buildVilla(scene, { renderer } = {}) {
  const villa = new THREE.Group(); villa.name = 'villa';
  scene.add(villa);
  const ceilings = [], lamps = [], roomLights = [], roomFloors = new Map(), highlights = new Map();

  // ---------------------------------------------------------------- 共享材质
  const M = {
    trim: new THREE.MeshPhysicalMaterial({ color: '#5a3a24', roughness: 0.45, clearcoat: 0.4 }),       // 门套、踢脚线
    trimLight: new THREE.MeshPhysicalMaterial({ color: '#f3eee4', roughness: 0.5, clearcoat: 0.2 }),  // 白色线脚
    cap: new THREE.MeshStandardMaterial({ color: '#3b2b20', roughness: 0.7 }),                       // 墙顶截面（剖切面）
    ceiling: new THREE.MeshStandardMaterial({ color: '#f6f2ea', roughness: 0.95, side: THREE.DoubleSide }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#dfeef2', roughness: 0.03, metalness: 0, transparent: true, opacity: 0.18, envMapIntensity: 2, depthWrite: false }),
    frame: new THREE.MeshPhysicalMaterial({ color: '#f1ece2', roughness: 0.4, clearcoat: 0.5 }),
    brass: new THREE.MeshPhysicalMaterial({ color: '#c9a45c', metalness: 1, roughness: 0.3 }),
    exterior: meterMaterial('plaster'),
    stone: meterMaterial('stone'),
  };
  const lanternMat = new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffcf7a', emissiveIntensity: 2.5 });
  const porchLight = new THREE.PointLight('#ffc77a', 0, 12, 1.6);
  const finishCache = new Map();
  const fin = name => { if (!finishCache.has(name)) finishCache.set(name, meterMaterial(name)); return finishCache.get(name); };

  // ---------------------------------------------------------------- 地面 & 地基
  const grassMat = meterMaterial('grass');
  const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 64), grassMat);
  ground.rotation.x = -Math.PI / 2; ground.position.y = GROUND;
  { const uv = ground.geometry.attributes.uv, p = ground.geometry.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i), p.getY(i)); }
  ground.receiveShadow = true; ground.name = 'ground';
  villa.add(ground);

  const P = 0.35; // 地基外扩
  // 顶面必须低于地板底面（-0.04），否则与各房间地板共面 → z-fighting 闪烁
  const plinth = mergedMesh([boxGeo(VILLA.minX - P, VILLA.maxX + P, GROUND - 0.05, -0.045, VILLA.minZ - P, VILLA.maxZ + P)], M.stone, { name: 'plinth' });
  villa.add(plinth);

  // ---------------------------------------------------------------- 房间
  const roomRefs = new Map();
  const colliders = []; // 行走碰撞：XZ 平面上的矩形 { x0, x1, z0, z1 }
  for (const room of ROOMS) {
    const b = roomBox(room);
    const g = new THREE.Group(); g.name = `room:${room.id}`; villa.add(g);

    // 地板
    const floor = new THREE.Mesh(boxGeo(b.x0, b.x1, -0.04, 0, b.z0, b.z1), fin(room.finish.floor));
    floor.receiveShadow = true; floor.name = `floor:${room.id}`; floor.userData.roomId = room.id; floor.userData.isFloor = true;
    g.add(floor); roomFloors.set(room.id, floor);

    // 悬停高亮层（总览模式下）
    const hl = new THREE.Mesh(new THREE.PlaneGeometry(b.w - 0.3, b.d - 0.3), new THREE.MeshBasicMaterial({ color: '#ffd28a', transparent: true, opacity: 0, depthWrite: false }));
    hl.rotation.x = -Math.PI / 2; hl.position.set(b.cx, 0.012, b.cz); hl.renderOrder = 2; hl.userData.roomId = room.id; hl.raycast = () => {};
    g.add(hl); highlights.set(room.id, hl);

    // 天花板
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.d), M.ceiling);
    ceil.rotation.x = Math.PI / 2; ceil.position.set(b.cx, H - 0.001, b.cz); ceil.visible = false; ceil.name = `ceiling:${room.id}`;
    ceil.castShadow = true; // 进屋后天花板挡住阳光，只剩窗口透进来的光斑
    ceil.raycast = () => {};
    g.add(ceil); ceilings.push(ceil);

    // 四面墙（墙裙几何总是生成，按装修设置显示/隐藏）
    const geos = { wall: [], dado: [], ext: [], cap: [], base: [], rail: [], trim: [], frame: [], glass: [], sill: [], crown: [] };
    for (const side of ['n', 's', 'w', 'e']) buildWall(room, b, side, geos);
    const add = (list, mat, opts) => { const m = mergedMesh(list, mat, opts); if (m) g.add(m); return m; };
    const walls = add(geos.wall, fin(room.finish.wall), { name: `walls:${room.id}` });
    const dado = add(geos.dado, fin(room.finish.dado || 'paint-green'));
    add(geos.ext, M.exterior);
    add(geos.cap, M.cap, { cast: false });
    add(geos.base, M.trim);
    const rail = add(geos.rail, M.trimLight);
    add(geos.trim, M.trim);
    add(geos.frame, M.frame);
    add(geos.sill, M.trimLight);
    add(geos.crown, M.trimLight, { cast: false });
    const glass = add(geos.glass, M.glass, { cast: false, receive: false });
    if (glass) glass.renderOrder = 3;

    // 灯：挂点在天花板上，灯具样式可换
    const lampSpots = room.corridor ? [[-8.5, b.cz], [0, b.cz], [8.5, b.cz]] : [[b.cx, b.cz]];
    const lampHolders = lampSpots.map(([lx, lz]) => {
      const h = new THREE.Group(); h.position.set(lx, H, lz); h.visible = false; h.userData.roomId = room.id;
      g.add(h); lamps.push(h); return h;
    });
    const light = new THREE.PointLight('#ffe2bc', 1, room.corridor ? 14 : 12, 1.5);
    light.position.set(b.cx, H - 0.9, b.cz); light.userData.roomId = room.id; light.userData.base = 0;
    g.add(light); roomLights.push(light);
    roomRefs.set(room.id, { room, floor, walls, dado, rail, lampHolders, light, settings: null });

    // 地毯
    if (['bedroom', 'living', 'study', 'kids'].includes(room.id)) {
      const rug = makeRug(room.id, Math.min(b.w - 3.2, 4.6), Math.min(b.d - 3.4, 3.2));
      rug.position.set(b.cx, 0.004, b.cz + 0.1); g.add(rug);
    }
    // 门口的房间铭牌
    if (!room.corridor) {
      const door = room.openings.find(o => o.kind === 'door' && (o.side === 's' || o.side === 'n') && !(room.entrance && o.side === 's'));
      if (door) {
        const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.16), new THREE.MeshPhysicalMaterial({ map: labelTexture([room.name, room.en]), metalness: 0.6, roughness: 0.35 }));
        const zFace = door.side === 's' ? b.z1 + 0.002 : b.z0 - 0.002;
        plaque.position.set(door.at + door.w / 2 + 0.45, 1.6, zFace);
        plaque.rotation.y = door.side === 's' ? 0 : Math.PI;
        villa.add(plaque);
      }
    }
  }

  // 墙体生成：按门窗洞切分
  function buildWall(room, b, side, geos) {
    const along = side === 'n' || side === 's';
    const exterior = (side === 'n' && b.z0 === VILLA.minZ) || (side === 's' && b.z1 === VILLA.maxZ) || (side === 'w' && b.x0 === VILLA.minX) || (side === 'e' && b.x1 === VILLA.maxX);
    // 墙沿 u 方向的范围
    const u0 = along ? b.x0 : b.z0 + T, u1 = along ? b.x1 : b.z1 - T;
    // 墙厚方向 [w0,w1]，以及室内面所在位置/朝向
    let w0, w1, inner, dir;
    if (side === 'n') { w0 = b.z0; w1 = b.z0 + T; inner = w1; dir = 1; }
    if (side === 's') { w0 = b.z1 - T; w1 = b.z1; inner = w0; dir = -1; }
    if (side === 'w') { w0 = b.x0; w1 = b.x0 + T; inner = w1; dir = 1; }
    if (side === 'e') { w0 = b.x1 - T; w1 = b.x1; inner = w0; dir = -1; }
    const outer = dir > 0 ? w0 : w1;
    const B = (ua, ub, y0, y1, wa, wb) => along ? boxGeo(ua, ub, y0, y1, wa, wb) : boxGeo(wa, wb, y0, y1, ua, ub);

    const ops = room.openings.filter(o => o.side === side).map(o => ({ ...o, a: o.at - o.w / 2, b: o.at + o.w / 2, bottom: o.sill, top: o.sill + o.h }));
    const cuts = [u0, u1, ...ops.flatMap(o => [o.a, o.b])].filter(v => v >= u0 && v <= u1).sort((a, c) => a - c);
    const dadoH = 1.05;
    const skin = 0.006; // 墙裙/外墙面层厚度

    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], c = cuts[i + 1];
      if (c - a < 1e-3) continue;
      const mid = (a + c) / 2;
      const o = ops.find(o => mid > o.a && mid < o.b);
      const spans = o ? [[0, o.bottom], [o.top, H]].filter(([y0, y1]) => y1 - y0 > 1e-3) : [[0, H]];
      for (const [y0, y1] of spans) {
        geos.wall.push(B(a, c, y0, y1, w0, w1));
        if (y0 === 0) colliders.push(along ? { x0: a, x1: c, z0: w0, z1: w1 } : { x0: w0, x1: w1, z0: a, z1: c });
        // 墙顶剖切面
        if (y1 >= H - 1e-3) geos.cap.push(B(a, c, H, H + 0.012, w0 - 0.004, w1 + 0.004));
        // 外墙面
        if (exterior) geos.ext.push(B(a, c, y0, y1, dir > 0 ? outer - skin : outer, dir > 0 ? outer : outer + skin));
        // 墙裙
        if (dadoH && y0 < dadoH) geos.dado.push(B(a, c, y0, Math.min(y1, dadoH), dir > 0 ? inner : inner - skin, dir > 0 ? inner + skin : inner));
        if (dadoH && y0 < dadoH && y1 >= dadoH) geos.rail.push(B(a, c, dadoH - 0.015, dadoH + 0.03, dir > 0 ? inner : inner - 0.022, dir > 0 ? inner + 0.022 : inner));
        // 顶角线
        if (y1 >= H - 1e-3) {
          geos.crown.push(B(a, c, H - 0.09, H, dir > 0 ? inner : inner - 0.035, dir > 0 ? inner + 0.035 : inner));
          geos.crown.push(B(a, c, H - 0.13, H - 0.09, dir > 0 ? inner : inner - 0.015, dir > 0 ? inner + 0.015 : inner));
        }
        // 踢脚线
        if (y0 === 0) geos.base.push(B(a, c, 0, 0.11, dir > 0 ? inner : inner - 0.016, dir > 0 ? inner + 0.016 : inner));
      }
    }
    // 门窗
    for (const o of ops) {
      const fw = 0.07; // 门套宽
      const fz0 = dir > 0 ? inner : inner - 0.02, fz1 = dir > 0 ? inner + 0.02 : inner;
      if (o.kind === 'door') {
        // 室内侧门套（左右 + 上）
        geos.trim.push(B(o.a - fw, o.a, 0, o.top + fw, fz0, fz1));
        geos.trim.push(B(o.b, o.b + fw, 0, o.top + fw, fz0, fz1));
        geos.trim.push(B(o.a - fw, o.b + fw, o.top, o.top + fw, fz0, fz1));
        // 门洞内衬
        geos.trim.push(B(o.a, o.a + 0.02, 0, o.top, w0, w1));
        geos.trim.push(B(o.b - 0.02, o.b, 0, o.top, w0, w1));
        geos.trim.push(B(o.a, o.b, o.top - 0.02, o.top, w0, w1));
        if (exterior) { // 外侧门套
          const ez0 = dir > 0 ? outer - 0.03 : outer, ez1 = dir > 0 ? outer : outer + 0.03;
          geos.frame.push(B(o.a - 0.12, o.a, 0, o.top + 0.12, ez0, ez1));
          geos.frame.push(B(o.b, o.b + 0.12, 0, o.top + 0.12, ez0, ez1));
          geos.frame.push(B(o.a - 0.12, o.b + 0.12, o.top, o.top + 0.18, ez0 - (dir > 0 ? 0.03 : 0), ez1 + (dir > 0 ? 0 : 0.03)));
        }
      } else {
        const ff = 0.06;
        const fw0 = w0 + 0.02, fw1 = w1 - 0.02, wm0 = (w0 + w1) / 2 - 0.025, wm1 = (w0 + w1) / 2 + 0.025;
        // 窗框
        geos.frame.push(B(o.a, o.a + ff, o.bottom, o.top, fw0, fw1));
        geos.frame.push(B(o.b - ff, o.b, o.bottom, o.top, fw0, fw1));
        geos.frame.push(B(o.a, o.b, o.top - ff, o.top, fw0, fw1));
        geos.frame.push(B(o.a, o.b, o.bottom, o.bottom + ff, fw0, fw1));
        // 窗棂：中梃 + 上亮子横档
        geos.frame.push(B(o.at - 0.025, o.at + 0.025, o.bottom, o.top, wm0, wm1));
        const transom = o.bottom + o.h * 0.72;
        geos.frame.push(B(o.a, o.b, transom - 0.022, transom + 0.022, wm0, wm1));
        geos.glass.push(B(o.a + ff, o.b - ff, o.bottom + ff, o.top - ff, (w0 + w1) / 2 - 0.004, (w0 + w1) / 2 + 0.004));
        // 窗台板（室内侧凸出）
        geos.sill.push(B(o.a - 0.08, o.b + 0.08, o.bottom - 0.035, o.bottom, dir > 0 ? inner - 0.02 : inner - 0.07, dir > 0 ? inner + 0.07 : inner + 0.02));
        geos.trim.push(B(o.a - 0.06, o.a, o.bottom - 0.035, o.top + 0.06, fz0, fz1));
        geos.trim.push(B(o.b, o.b + 0.06, o.bottom - 0.035, o.top + 0.06, fz0, fz1));
        geos.trim.push(B(o.a - 0.06, o.b + 0.06, o.top, o.top + 0.06, fz0, fz1));
        if (exterior) geos.sill.push(B(o.a - 0.1, o.b + 0.1, o.bottom - 0.06, o.bottom, dir > 0 ? outer - 0.1 : outer - 0.02, dir > 0 ? outer + 0.02 : outer + 0.1));
      }
    }
  }

  // ---------------------------------------------------------------- 灯具（多种样式，可在“装修”里切换）
  // 返回以天花板为 y=0、向下悬挂的灯具组；power=0 表示关灯
  const cordMat = new THREE.MeshStandardMaterial({ color: '#222', roughness: 0.6 });
  function makeLamp(style, color, power, small) {
    const g = new THREE.Group();
    const k = small ? 0.65 : 1;
    const bulbMat = new THREE.MeshStandardMaterial({ color: power > 0 ? '#fffaf0' : '#d8d2c8', emissive: color, emissiveIntensity: 6 * power, roughness: 0.3 });
    const glow = (base, amt) => new THREE.MeshPhysicalMaterial({ color: base, roughness: 0.5, side: THREE.DoubleSide, emissive: color, emissiveIntensity: amt * power, clearcoat: 0.4 });
    const cord = drop => {
      const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 24), M.trimLight); rose.position.y = -0.015; g.add(rose);
      if (drop > 0.03) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, drop, 6), cordMat); c.position.y = -drop / 2; g.add(c); }
    };
    const bulb = (y, r = 0.05, x = 0, z = 0) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 12), bulbMat); m.position.set(x, y, z); g.add(m); return m; };
    const lathe = (pts, mat, y) => { const m = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([x, yy]) => new THREE.Vector2(x * k, yy * k)), 40), mat); m.position.y = y; g.add(m); return m; };
    if (style === 'pendant') {            // 搪瓷伞形吊灯
      const d = 0.75 * k; cord(d);
      lathe([[0.02, 0.06], [0.05, 0.05], [0.18, -0.045], [0.3, -0.15], [0.306, -0.156]], glow('#efe2c4', 0.12), -d);
      bulb(-d - 0.07 * k, 0.065 * k);
    } else if (style === 'enamel') {      // 绿色搪瓷灯罩（老工厂、老教室）
      const d = 0.8 * k; cord(d);
      lathe([[0.02, 0.05], [0.05, 0.04], [0.16, -0.06], [0.26, -0.14], [0.27, -0.15]], new THREE.MeshPhysicalMaterial({ color: '#2f5a45', roughness: 0.35, clearcoat: 0.8 }), -d);
      const inner = lathe([[0.019, 0.049], [0.049, 0.039], [0.157, -0.061], [0.26, -0.141]], glow('#f4f1e8', 0.4), -d - 0.002);
      inner.material.side = THREE.BackSide;
      bulb(-d - 0.06 * k, 0.055 * k);
    } else if (style === 'drum') {        // 布艺筒灯
      const d = 0.65 * k; cord(d);
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.32 * k, 0.32 * k, 0.28 * k, 48, 1, true), glow('#efe4d0', 0.5)); shade.position.y = -d - 0.14 * k; g.add(shade);
      const diff = new THREE.Mesh(new THREE.CircleGeometry(0.31 * k, 40), glow('#fff8ec', 0.9)); diff.rotation.x = Math.PI / 2; diff.position.y = -d - 0.27 * k; g.add(diff);
      bulb(-d - 0.12 * k, 0.05 * k);
    } else if (style === 'chandelier') {  // 黄铜烛台水晶灯
      const d = 0.55 * k; cord(d);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34 * k, 0.012, 10, 48), M.brass); ring.rotation.x = Math.PI / 2; ring.position.y = -d - 0.08; g.add(ring);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.22, 16), M.brass); stem.position.y = -d - 0.05; g.add(stem);
      const drops = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0, transmission: 0.9, thickness: 0.02, ior: 1.6, emissive: color, emissiveIntensity: 0.4 * power });
      const candleMat = new THREE.MeshStandardMaterial({ color: '#f6f0e2' });
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2, x = Math.cos(a) * 0.34 * k, z = Math.sin(a) * 0.34 * k;
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.018, 0.03, 12), M.brass); cup.position.set(x, -d - 0.065, z); g.add(cup);
        const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 10), candleMat); candle.position.set(x, -d - 0.01, z); g.add(candle);
        const flame = bulb(-d + 0.05, 0.022, x, z); flame.scale.y = 1.6;
        const drop = new THREE.Mesh(new THREE.OctahedronGeometry(0.025, 0), drops); drop.position.set(x * 1.02, -d - 0.16, z * 1.02); drop.scale.y = 1.8; g.add(drop);
      }
    } else if (style === 'flush') {       // 吸顶灯（乳白灯罩）
      lathe([[0.3, 0], [0.3, -0.03], [0.26, -0.09], [0.12, -0.12], [0, -0.125]], glow('#fbf7ef', 1.4), -0.005);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3 * k, 0.01, 8, 48), M.brass); rim.rotation.x = Math.PI / 2; rim.position.y = -0.01; g.add(rim);
    } else if (style === 'lantern') {     // 红灯笼
      const d = 0.7 * k; cord(d);
      const red = new THREE.MeshPhysicalMaterial({ color: '#b51d17', roughness: 0.6, side: THREE.DoubleSide, emissive: '#ff2a10', emissiveIntensity: 0.9 * power, sheen: 0.5, sheenColor: new THREE.Color('#ff6040') });
      lathe([[0.06, 0], [0.18, -0.04], [0.26, -0.13], [0.28, -0.22], [0.26, -0.31], [0.18, -0.4], [0.06, -0.44]], red, -d);
      for (const y of [-d, -d - 0.44 * k]) { const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.075 * k, 0.075 * k, 0.04, 24), M.brass); cap.position.y = y; g.add(cap); }
      const tassel = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.04, 0.28 * k, 12), new THREE.MeshStandardMaterial({ color: '#c8a03a', roughness: 0.8 })); tassel.position.y = -d - 0.6 * k; g.add(tassel);
    } else {                              // 'bulb' 一根电线吊一只灯泡（老房子）
      const d = 0.9 * k; cord(d);
      const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.06, 16), new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.5 })); sock.position.y = -d - 0.03; g.add(sock);
      const bb = bulb(-d - 0.1, 0.045); bb.scale.y = 1.25;
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.raycast = () => {}; } });
    return g;
  }

  // 应用某个房间的装修设置：{ floor, wall, dado, light: { style, kelvin, intensity, on } }
  function applyRoom(id, s) {
    const r = roomRefs.get(id); if (!r || !s) return;
    r.settings = s;
    r.floor.material = fin(s.floor);
    if (r.walls) r.walls.material = fin(s.wall);
    if (r.dado) { r.dado.visible = !!s.dado; if (s.dado) r.dado.material = fin(s.dado); }
    if (r.rail) r.rail.visible = !!s.dado;
    const L = s.light, color = kelvinColor(L.kelvin), power = L.on ? L.intensity : 0;
    r.light.color.copy(color);
    r.light.userData.base = (r.room.corridor ? 10 : 20) * power;
    for (const h of r.lampHolders) { h.clear(); h.add(makeLamp(L.style, color, power, r.room.corridor)); }
    refreshLights();
  }

  // ---------------------------------------------------------------- 地毯
  function makeRug(id, w, d) {
    const palettes = {
      bedroom: ['#7b2e2a', '#e8d6b3', '#2f4a5a', '#c99a4a'],
      living: ['#304a63', '#e6d7b8', '#9a3a2e', '#d1a85a'],
      study: ['#4a3a2a', '#c8b48a', '#6b2f22', '#2d3f33'],
      kids: ['#e3a64a', '#f3ead6', '#4f8fb3', '#d8574b'],
    };
    const [c1, c2, c3, c4] = palettes[id];
    const c = document.createElement('canvas'); c.width = 1024; c.height = 768; const ctx = c.getContext('2d');
    ctx.fillStyle = c1; ctx.fillRect(0, 0, 1024, 768);
    ctx.strokeStyle = c2; ctx.lineWidth = 18; ctx.strokeRect(40, 40, 944, 688);
    ctx.strokeStyle = c4; ctx.lineWidth = 6; ctx.strokeRect(72, 72, 880, 624);
    // 中心团花
    ctx.save(); ctx.translate(512, 384);
    for (let ring = 5; ring > 0; ring--) {
      ctx.fillStyle = ring % 2 ? c2 : c3;
      ctx.beginPath();
      for (let k = 0; k <= 16; k++) { const a = k / 16 * Math.PI * 2, rr = ring * 38 * (k % 2 ? 0.78 : 1); ctx.lineTo(Math.cos(a) * rr * 1.3, Math.sin(a) * rr); }
      ctx.fill();
    }
    ctx.restore();
    // 角花
    for (const [x, y] of [[130, 130], [894, 130], [130, 638], [894, 638]]) { ctx.fillStyle = c3; ctx.beginPath(); ctx.arc(x, y, 34, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = c2; ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.fill(); }
    // 绒毛噪点
    for (let i = 0; i < 40000; i++) { ctx.fillStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '0,0,0'},0.05)`; ctx.fillRect(Math.random() * 1024, Math.random() * 768, 2, 2); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const rug = new THREE.Mesh(new RoundedBoxGeometry(w, 0.012, d, 2, 0.005), new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.95, sheen: 0.8, sheenColor: new THREE.Color(c2), sheenRoughness: 0.7 }));
    // 只让顶面用完整贴图
    rug.geometry.attributes.uv && fixTopUV(rug.geometry, w, d);
    rug.receiveShadow = true;
    return rug;
  }
  function fixTopUV(geo, w, d) {
    const p = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, 0.5 - p.getZ(i) / d);
  }

  // ---------------------------------------------------------------- 正门：门廊、台阶、敞开的双扇木门
  const foyer = ROOMS.find(r => r.entrance);
  const fdoor = foyer.openings.find(o => o.side === 's' && o.kind === 'door');
  {
    const zf = VILLA.maxZ;
    const stepMat = M.stone;
    for (let i = 0; i < 3; i++) {
      const s = mergedMesh([boxGeo(fdoor.at - 1.6, fdoor.at + 1.6, GROUND + i * 0.12 - 0.05, GROUND + (i + 1) * 0.12, zf + P, zf + P + 1.2 - i * 0.4)], stepMat);
      villa.add(s);
    }
    // 门廊平台
    villa.add(mergedMesh([boxGeo(fdoor.at - 2.2, fdoor.at + 2.2, GROUND, 0, zf, zf + P + 0.01)], stepMat));
    // 柱子 + 雨棚
    const colMat = new THREE.MeshPhysicalMaterial({ color: '#efe6d6', roughness: 0.6 });
    for (const sx of [-1, 1]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 2.9, 24), colMat);
      col.position.set(fdoor.at + sx * 1.9, 1.45, zf + 1.35); col.castShadow = col.receiveShadow = true; villa.add(col);
      colliders.push({ x0: fdoor.at + sx * 1.9 - 0.17, x1: fdoor.at + sx * 1.9 + 0.17, z0: zf + 1.18, z1: zf + 1.52 });
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.34), colMat); base.position.set(fdoor.at + sx * 1.9, 0.06, zf + 1.35); base.castShadow = true; villa.add(base);
      const capital = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.32), colMat); capital.position.set(fdoor.at + sx * 1.9, 2.92, zf + 1.35); villa.add(capital);
    }
    const canopy = mergedMesh([boxGeo(fdoor.at - 2.25, fdoor.at + 2.25, 2.97, 3.12, zf, zf + 1.6)], M.trimLight, { name: 'canopy' });
    villa.add(canopy);
    // 双扇门（向内开 70°）
    const doorMat = new THREE.MeshPhysicalMaterial({ color: '#6b2f1c', roughness: 0.45, clearcoat: 0.6, map: finish('walnut-planks').map });
    const leafW = fdoor.w / 2 - 0.02, leafH = fdoor.h - 0.03;
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(fdoor.at + sx * (fdoor.w / 2 - 0.02), 0, zf - T + 0.03);
      pivot.rotation.y = sx * -1.2;
      const leaf = new THREE.Mesh(new RoundedBoxGeometry(leafW, leafH, 0.05, 2, 0.006), doorMat);
      leaf.position.set(-sx * leafW / 2, leafH / 2, -0.025); leaf.castShadow = true; pivot.add(leaf);
      // 门板凸起装饰框
      for (const [py, ph] of [[leafH * 0.72, leafH * 0.38], [leafH * 0.28, leafH * 0.38]]) {
        const panel = new THREE.Mesh(new RoundedBoxGeometry(leafW * 0.68, ph, 0.02, 2, 0.006), doorMat);
        panel.position.set(-sx * leafW / 2, py, 0.004); pivot.add(panel);
        const panel2 = panel.clone(); panel2.position.z = -0.054; pivot.add(panel2);
      }
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 12), M.brass);
      knob.position.set(-sx * (leafW - 0.08), 1.0, 0.035); pivot.add(knob);
      villa.add(pivot);
    }
    // 门牌
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.36), new THREE.MeshPhysicalMaterial({ map: labelTexture(['拾光回忆馆', 'MEMORY  VILLA'], { w: 1024, h: 240, bg: '#2f2418', fg: '#e8c98a' }), roughness: 0.4, metalness: 0.2 }));
    sign.position.set(fdoor.at, 2.78, zf + 0.03); villa.add(sign);
    // 门灯（夜里更亮，并多一盏门廊灯）
    porchLight.position.set(fdoor.at, 2.6, zf + 1.0); villa.add(porchLight);
    for (const sx of [-1, 1]) {
      const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.26, 6), lanternMat);
      lantern.position.set(fdoor.at + sx * 1.25, 2.1, zf + 0.12); villa.add(lantern);
    }
  }

  // ---------------------------------------------------------------- 花园
  const garden = new THREE.Group(); garden.name = 'garden'; villa.add(garden);
  {
    // 门前小路
    const pave = meterMaterial('paving');
    const path = new THREE.Mesh(boxGeo(fdoor.at - 1.2, fdoor.at + 1.2, GROUND - 0.02, GROUND + 0.015, VILLA.maxZ + P + 1.2, VILLA.maxZ + 22), pave);
    path.receiveShadow = true; garden.add(path);
    // 绿篱
    const hedgeMat = new THREE.MeshStandardMaterial({ color: '#3f5d2c', roughness: 0.95, bumpMap: finish('grass').bumpMap, bumpScale: 2 });
    const hedges = [];
    const hz = VILLA.maxZ + P + 0.8, hx0 = VILLA.minX - 0.4, hx1 = VILLA.maxX + 0.4;
    const hedge = (x0, x1, z0, z1) => { colliders.push({ x0, x1, z0, z1 }); const g = new RoundedBoxGeometry(x1 - x0, 0.7, z1 - z0, 3, 0.18); g.translate((x0 + x1) / 2, GROUND + 0.35, (z0 + z1) / 2); worldBoxUV(g); hedges.push(g); };
    hedge(hx0, fdoor.at - 2.6, hz, hz + 0.6); hedge(fdoor.at + 2.6, hx1, hz, hz + 0.6);
    garden.add(mergedMesh(hedges, hedgeMat));
    // 树
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#5a4030', roughness: 0.9 });
    const leafMats = ['#4b6b34', '#5c7a3a', '#3e5e2e', '#6b8a3e'].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, bumpMap: finish('grass').bumpMap, bumpScale: 3 }));
    // 树冠：带噪声起伏的球体，比纯低多边形更柔和
    const blobGeos = [0, 1, 2, 3].map(k => {
      const g = new THREE.IcosahedronGeometry(1, 3);
      const p = g.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const d = 1 + 0.16 * Math.sin(v.x * 5.1 + k) * Math.cos(v.y * 4.3 - k) + 0.09 * Math.sin(v.z * 9.7 + v.x * 3.1 + k * 2);
        v.multiplyScalar(d); p.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
      return g;
    });
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const trees = [[-19, 12], [-24, 4], [-21, -6], [-17, -14], [19, 13], [24, 3], [21, -7], [16, -15], [-6, -17], [5, -18], [-11, 17], [11, 17.5], [30, 14], [-30, 12], [0, -24]];
    for (const [tx, tz] of trees) {
      const t = new THREE.Group(); t.position.set(tx, GROUND, tz);
      colliders.push({ x0: tx - 0.3, x1: tx + 0.3, z0: tz - 0.3, z1: tz + 0.3 });
      const h = 2.2 + rnd() * 1.6;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.18, h, 8), trunkMat); trunk.position.y = h / 2; trunk.castShadow = true; t.add(trunk);
      for (let k = 0; k < 7; k++) {
        const r = 0.9 + rnd() * 0.9;
        const blob = new THREE.Mesh(blobGeos[k % 4], leafMats[(k + Math.floor(tx)) & 3]); blob.scale.setScalar(r);
        blob.position.set((rnd() - 0.5) * 1.8, h + (rnd() - 0.2) * 1.4, (rnd() - 0.5) * 1.8);
        blob.scale.y *= 0.85; blob.castShadow = true; blob.receiveShadow = true; t.add(blob);
      }
      t.scale.setScalar(1.1 + rnd() * 0.5);
      garden.add(t);
    }
    // 花坛
    const flowerColors = ['#e05a4f', '#f2c14e', '#f7f3ea', '#d97bb0', '#8f6bd1'];
    for (const sx of [-1, 1]) {
      const bed = new THREE.Mesh(boxGeo(-1.6, 1.6, GROUND, GROUND + 0.28, -0.5, 0.5), M.stone); bed.position.x = fdoor.at + sx * 4.4; bed.position.z = VILLA.maxZ + P + 1.8; bed.castShadow = true; garden.add(bed);
      colliders.push({ x0: bed.position.x - 1.6, x1: bed.position.x + 1.6, z0: bed.position.z - 0.5, z1: bed.position.z + 0.5 });
      const soil = new THREE.Mesh(boxGeo(-1.5, 1.5, GROUND + 0.28, GROUND + 0.3, -0.4, 0.4), new THREE.MeshStandardMaterial({ color: '#3a2a1e', roughness: 1 })); soil.position.copy(bed.position); garden.add(soil);
      const fg = new THREE.Group();
      for (let i = 0; i < 46; i++) {
        const f = new THREE.Mesh(new THREE.SphereGeometry(0.05 + rnd() * 0.04, 8, 6), new THREE.MeshStandardMaterial({ color: flowerColors[i % 5], roughness: 0.7 }));
        f.position.set((rnd() - 0.5) * 2.9, GROUND + 0.38 + rnd() * 0.12, (rnd() - 0.5) * 0.7); fg.add(f);
      }
      fg.position.copy(bed.position); fg.position.y = 0; garden.add(fg);
    }
  }

  // ---------------------------------------------------------------- 屋顶（开场时盖着，进馆时揭开）
  const roof = new THREE.Group(); roof.name = 'roof'; villa.add(roof);
  {
    const ov = 0.7;
    const x0 = VILLA.minX - ov, x1 = VILLA.maxX + ov, z0 = VILLA.minZ - ov, z1 = VILLA.maxZ + ov;
    const h0 = H + 0.25, h1 = h0 + 4.2;
    const half = (z1 - z0) / 2;
    const r0 = x0 + half, r1 = x1 - half, zc = (z0 + z1) / 2;
    const A = [x0, h0, z0], Bv = [x1, h0, z0], C = [x1, h0, z1], D = [x0, h0, z1], R1 = [r0, h1, zc], R2 = [r1, h1, zc];
    const pos = [], uv = [];
    const slope = Math.hypot(half, h1 - h0);
    const tri = (p, q, r, uvs) => { pos.push(...p, ...q, ...r); uv.push(...uvs); };
    // 南坡（D C R2 R1）
    tri(D, C, R2, [x0, 0, x1, 0, r1, slope]); tri(D, R2, R1, [x0, 0, r1, slope, r0, slope]);
    // 北坡（B A R1 R2）
    tri(Bv, A, R1, [x1, 0, x0, 0, r0, slope]); tri(Bv, R1, R2, [x1, 0, r0, slope, r1, slope]);
    // 西坡（A D R1）、东坡（C B R2）
    tri(A, D, R1, [z0, 0, z1, 0, zc, slope]); tri(C, Bv, R2, [z1, 0, z0, 0, zc, slope]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const roofMat = meterMaterial('roof');
    roofMat.side = THREE.DoubleSide;
    const roofMesh = new THREE.Mesh(g, roofMat); roofMesh.castShadow = true; roofMesh.receiveShadow = true; roof.add(roofMesh);
    // 檐口 & 屋脊
    const fascia = [boxGeo(x0, x1, h0 - 0.28, h0 + 0.02, z0 - 0.04, z0 + 0.1), boxGeo(x0, x1, h0 - 0.28, h0 + 0.02, z1 - 0.1, z1 + 0.04),
      boxGeo(x0 - 0.04, x0 + 0.1, h0 - 0.28, h0 + 0.02, z0, z1), boxGeo(x1 - 0.1, x1 + 0.04, h0 - 0.28, h0 + 0.02, z0, z1),
      boxGeo(r0, r1, h1 - 0.06, h1 + 0.12, zc - 0.12, zc + 0.12)];
    roof.add(mergedMesh(fascia, M.trimLight));
    // 檐下顶棚
    const soffit = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), M.ceiling); soffit.rotation.x = Math.PI / 2; soffit.position.set(0, h0 - 0.26, 0); roof.add(soffit);
    // 墙顶到屋檐之间的封檐带
    const frieze = [boxGeo(VILLA.minX - 0.01, VILLA.maxX + 0.01, H, h0 - 0.26, VILLA.minZ - 0.01, VILLA.minZ + T), boxGeo(VILLA.minX - 0.01, VILLA.maxX + 0.01, H, h0 - 0.26, VILLA.maxZ - T, VILLA.maxZ + 0.01),
      boxGeo(VILLA.minX - 0.01, VILLA.minX + T, H, h0 - 0.26, VILLA.minZ, VILLA.maxZ), boxGeo(VILLA.maxX - T, VILLA.maxX + 0.01, H, h0 - 0.26, VILLA.minZ, VILLA.maxZ)];
    roof.add(mergedMesh(frieze, M.exterior));
    // 烟囱
    const chimney = mergedMesh([boxGeo(-8.6, -7.6, h0, h1 + 0.9, -4.6, -3.6), boxGeo(-8.7, -7.5, h1 + 0.9, h1 + 1.05, -4.7, -3.5)], M.stone);
    roof.add(chimney);
    // 老虎窗（南坡两扇）
    for (const dx of [-7, 7]) {
      const dz = z1 - 3.4, dy = h0 + (h1 - h0) * (3.4 / half);
      const dormer = new THREE.Group(); dormer.position.set(dx, dy - 0.6, dz);
      const body = new THREE.Mesh(boxGeo(-0.8, 0.8, 0, 1.3, -1.2, 0.6), M.exterior); body.castShadow = true; dormer.add(body);
      const win = new THREE.Mesh(boxGeo(-0.5, 0.5, 0.25, 1.1, 0.6, 0.62), new THREE.MeshPhysicalMaterial({ color: '#33424a', roughness: 0.1, metalness: 0.3 })); dormer.add(win);
      const fr = mergedMesh([boxGeo(-0.56, 0.56, 0.19, 0.25, 0.6, 0.66), boxGeo(-0.56, 0.56, 1.1, 1.16, 0.6, 0.66), boxGeo(-0.56, -0.5, 0.19, 1.16, 0.6, 0.66), boxGeo(0.5, 0.56, 0.19, 1.16, 0.6, 0.66), boxGeo(-0.02, 0.02, 0.25, 1.1, 0.6, 0.65)], M.frame); dormer.add(fr);
      const gable = new THREE.Shape([new THREE.Vector2(-0.95, 0), new THREE.Vector2(0.95, 0), new THREE.Vector2(0, 0.7)]);
      const capGeo = new THREE.ExtrudeGeometry(gable, { depth: 1.95, bevelEnabled: false });
      capGeo.translate(0, 0, -1.3);
      const cap = new THREE.Mesh(capGeo, roofMat); cap.position.set(0, 1.3, 0); cap.castShadow = true;
      dormer.add(cap);
      roof.add(dormer);
    }
  }

  // ---------------------------------------------------------------- 模式切换
  let curRoom = null, curInside = false;
  function refreshLights() {
    for (const l of roomLights) l.intensity = l.userData.base * (curInside ? (l.userData.roomId === curRoom ? 1 : 0.75) : 0.55);
  }
  function setMode(mode, roomId) {
    curRoom = roomId;
    for (const [, hl] of highlights) hl.material.opacity = 0;
    refreshLights();
  }
  // 相机在室内（低于屋顶高度）时显示天花板和灯具：既挡住阳光，也让门外的房间看起来完整
  function updateCamera(camera, mode, roomId) {
    const inside = mode !== 'overview' && mode !== 'intro' && camera.position.y < H - 0.05;
    if (inside !== curInside || roomId !== curRoom) { curInside = inside; curRoom = roomId; refreshLights(); }
    for (const c of ceilings) c.visible = inside;
    for (const l of lamps) l.visible = inside;
  }
  function highlightRoom(id) {
    for (const [rid, hl] of highlights) hl.material.opacity = rid === id ? 0.22 : 0;
  }
  function setNight(on) {
    lanternMat.emissiveIntensity = on ? 5 : 2.5;
    porchLight.intensity = on ? 14 : 0;
  }
  // 行走时脚下的地面高度：室内 0，台阶逐级，花园 GROUND
  const zf = VILLA.maxZ;
  function floorHeight(x, z) {
    if (x > VILLA.minX - P && x < VILLA.maxX + P && z > VILLA.minZ - P && z < VILLA.maxZ + P) return 0;
    if (Math.abs(x - fdoor.at) < 1.6 && z < zf + P + 1.2) return z < zf + P + 0.4 ? 0 : z < zf + P + 0.8 ? GROUND + 0.24 : GROUND + 0.12;
    return GROUND;
  }
  /** 坐标所在房间 id（不在室内返回 null） */
  function roomAt(x, z) {
    for (const r of ROOMS) { const b = roomBox(r); if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return r.id; }
    return null;
  }

  return { group: villa, roof, ceilings, lamps, roomLights, roomFloors, highlights, roomRefs, colliders, setMode, updateCamera, highlightRoom, applyRoom, setNight, floorHeight, roomAt, GROUND };
}
