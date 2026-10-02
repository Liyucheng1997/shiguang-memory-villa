// 拾光回忆馆 · 建模工具箱 (Model Kit)
// 每个藏品的 model.js 都通过 `build(THREE, kit)` 用它来搭建程序化模型。
// 浏览器和 Node 校验器共用这一份代码：Node 下没有 canvas，会自动换成空实现。

import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const HAS_DOM = typeof document !== 'undefined';

// ---------------------------------------------------------------------------
// canvas（Node 下用 Proxy 吞掉所有绘制调用，让模型代码照常运行）
function fakeContext(w, h) {
  const grad = { addColorStop() {} };
  const img = () => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
  return new Proxy({}, {
    get(_, k) {
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient') return () => grad;
      if (k === 'getImageData' || k === 'createImageData') return img;
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'canvas') return { width: w, height: h };
      return () => {};
    },
    set() { return true; },
  });
}
function makeCanvas(w, h) {
  if (HAS_DOM) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  return { width: w, height: h, getContext: () => fakeContext(w, h), isFake: true };
}

// ---------------------------------------------------------------------------
// 确定性随机 & 噪声
function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(s) {
  if (typeof s === 'number') return s;
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function makeNoise2(seed = 1) {
  const rand = mulberry32(hashSeed(seed));
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h, x, y) => { const g = h & 7; const u = g < 4 ? x : y; const v = g < 4 ? y : x; return ((g & 1) ? -u : u) + ((g & 2) ? -2 * v : 2 * v); };
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  // px/py：周期（整数）。在 [0,px) 范围内采样即可得到无缝平铺的噪声
  const noise = (x, y, px = 256, py = 256) => {
    const fx = Math.floor(x), fy = Math.floor(y);
    const X0 = ((fx % px) + px) % px, Y0 = ((fy % py) + py) % py;
    const X1 = (X0 + 1) % px, Y1 = (Y0 + 1) % py;
    x -= fx; y -= fy;
    const u = fade(x), v = fade(y);
    const h00 = perm[perm[X0 & 255] + (Y0 & 255)], h10 = perm[perm[X1 & 255] + (Y0 & 255)];
    const h01 = perm[perm[X0 & 255] + (Y1 & 255)], h11 = perm[perm[X1 & 255] + (Y1 & 255)];
    const l1 = grad(h00, x, y) + u * (grad(h10, x - 1, y) - grad(h00, x, y));
    const l2 = grad(h01, x, y - 1) + u * (grad(h11, x - 1, y - 1) - grad(h01, x, y - 1));
    return (l1 + v * (l2 - l1)) * 0.25; // ~[-1,1]
  };
  noise.fbm = (x, y, oct = 4, lac = 2, gain = 0.5) => {
    let s = 0, a = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f); f *= lac; a *= gain; }
    return s;
  };
  /** 无缝 fbm：u,v ∈ [0,1)，fu/fv 为基础频率（整数） */
  noise.tile = (u, v, fu, fv, oct = 4) => {
    let s = 0, a = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { s += a * noise(u * fu * f, v * fv * f, fu * f, fv * f); f *= 2; a *= 0.5; }
    return s;
  };
  return noise;
}

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
function hexToRgb(hex) {
  const c = typeof hex === 'number' ? hex : parseInt(String(hex).replace('#', ''), 16);
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}
function mixRgb(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

// ---------------------------------------------------------------------------
export function createKit(THREE, options = {}) {
  const texCache = new Map();
  const maxAniso = options.maxAnisotropy || 8;
  const quality = options.quality ?? 1; // 0.5 = 低画质贴图

  function finishTexture(canvas, { color = true, repeat, wrap = true } = {}) {
    const t = canvas.isFake ? new THREE.Texture() : new THREE.CanvasTexture(canvas);
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (repeat) t.repeat.set(repeat[0], repeat[1] ?? repeat[0]);
    t.anisotropy = maxAniso;
    t.needsUpdate = true;
    return t;
  }

  // 像素级生成器：fn(u, v) -> [r,g,b] 或 number(灰度 0-1)
  function pixelCanvas(w, h, fn) {
    const c = makeCanvas(w, h);
    if (c.isFake) return c;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const r = fn(x / w, y / h, x, y);
        const i = (y * w + x) * 4;
        if (typeof r === 'number') { const g = clamp(r) * 255; d[i] = d[i + 1] = d[i + 2] = g; }
        else { d[i] = r[0]; d[i + 1] = r[1]; d[i + 2] = r[2]; }
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  const size = n => Math.max(64, Math.round(n * quality));

  // ---------------------------------------------------------------------------
  // 程序化贴图
  const textures = {
    /** 自由绘制：draw(ctx, w, h) */
    canvas(w, h, draw, opts = {}) {
      const c = makeCanvas(w, h);
      if (!c.isFake) draw(c.getContext('2d'), w, h);
      return finishTexture(c, opts);
    },

    /**
     * 木纹。纹理的 V 方向 = 木纹方向（配合 kit.box 的 grain 参数）。
     * style: 'rosewood' 玫瑰木/酸枝（深色强烈火焰纹） | 'walnut' 胡桃 | 'oak' 橡木 | 'pine' 松木 | 'teak' 柚木 | 'cherry' 樱桃 | 'plywood' 胶合板
     * 返回 { map, roughnessMap, bumpMap }
     */
    wood({ style = 'walnut', base, dark, light, seed = 7, res = 1024, figure = 1, pores = 1, wear = 0 } = {}) {
      const key = `wood:${style}:${base}:${dark}:${light}:${seed}:${res}:${figure}:${pores}:${wear}:${quality}`;
      if (texCache.has(key)) return texCache.get(key);
      // [底色, 深纹, 亮色, 主纹线条数, 细纹线条数, 扭曲强度, 深纹对比]
      const presets = {
        rosewood: ['#341609', '#0b0302', '#ad5a2e', 60, 150, 12, 0.9],
        walnut:   ['#5a3a24', '#24150b', '#7f5638', 16, 48, 2.2, 0.6],
        oak:      ['#a77d4e', '#6b4626', '#c9a172', 12, 40, 1.6, 0.45],
        pine:     ['#c99a62', '#8e5c2c', '#e3be8a', 9, 24, 1.4, 0.55],
        teak:     ['#8a5a2e', '#4a2c12', '#b07a45', 14, 44, 1.6, 0.5],
        cherry:   ['#8e4a2c', '#4f2216', '#b36a43', 14, 40, 1.5, 0.45],
        plywood:  ['#c8a679', '#9c7a50', '#dcc196', 6, 20, 0.8, 0.3],
      };
      const p = presets[style] || presets.walnut;
      const B = hexToRgb(base || p[0]), D = hexToRgb(dark || p[1]), L = hexToRgb(light || p[2]);
      const L1 = p[3], L2 = p[4], warpAmt = p[5] * figure, contrast = p[6];
      // 噪声周期为 256，只用 2 的幂作频率 → 贴图天然无缝
      const n = makeNoise2(seed), n2 = makeNoise2(seed + 101), n3 = makeNoise2(seed + 202);
      const W = size(res), H = size(res);
      const heightField = new Float32Array(W * H);
      const TAU = Math.PI * 2;
      const color = pixelCanvas(W, H, (u, v, x, y) => {
        const warp = n.tile(u, v, 2, 1, 4) * warpAmt + n2.tile(u, v, 6, 2, 3) * warpAmt * 0.22;
        const ph = u * L1 + warp;
        const r1 = 0.5 + 0.5 * Math.sin(TAU * ph);
        const r2 = 0.5 + 0.5 * Math.sin(TAU * (u * L2 + warp * 2.4 + n3.tile(u, v, 16, 4, 2) * 0.6));
        const zone = clamp(n.tile(u + 0.31, v, 2, 1, 3) * 0.9 + 0.5);  // 大片的深/浅区域（火焰纹）
        const lineMask = Math.pow(r1, 2.5 + zone * 6) * 0.85 + Math.pow(r2, 8) * 0.45;
        const broad = n2.tile(u, v, 3, 1, 3) * 0.7 + 0.5;          // 大块深浅变化（红褐色条带）
        const streak = n3.tile(u, v, 96, 3, 2) * 0.5 + 0.5;       // 顺纹细丝
        let c = mixRgb(B, L, clamp((broad - 0.3) * 1.9) * (0.55 + zone * 0.45));
        c = mixRgb(c, D, clamp(lineMask * contrast * (1.05 - zone * 0.45) + (streak - 0.5) * 0.3));
        const pore = n3(u * 256, v * 12, 256, 12) > 0.5 - 0.06 * pores ? 0.84 : 1;
        if (wear > 0) c = mixRgb(c, L, clamp((n.tile(u, v, 8, 8, 3) - 0.3) * 3) * wear * 0.5);
        heightField[y * W + x] = 0.55 - lineMask * 0.2 + (pore < 1 ? -0.3 : 0) + (streak - 0.5) * 0.12;
        return [c[0] * pore, c[1] * pore, c[2] * pore];
      });
      const bump = pixelCanvas(W, H, (u, v, x, y) => heightField[y * W + x]);
      const rough = pixelCanvas(W, H, (u, v, x, y) => 0.5 + (0.55 - heightField[y * W + x]) * 0.6);
      const res_ = { map: finishTexture(color), bumpMap: finishTexture(bump, { color: false }), roughnessMap: finishTexture(rough, { color: false }) };
      texCache.set(key, res_);
      return res_;
    },

    /** 通用灰度噪声（磨损/污渍/粗糙度变化），返回 Texture（线性） */
    noise({ seed = 3, scale = 6, octaves = 4, contrast = 1, bias = 0.5, res = 512 } = {}) {
      const key = `noise:${seed}:${scale}:${octaves}:${contrast}:${bias}:${res}:${quality}`;
      if (texCache.has(key)) return texCache.get(key);
      const n = makeNoise2(seed);
      // 无缝：四角混合
      const sc = Math.max(1, Math.round(scale));
      const t = finishTexture(pixelCanvas(size(res), size(res), (u, v) => clamp(bias + n.tile(u, v, sc, sc, octaves) * contrast)), { color: false });
      texCache.set(key, t);
      return t;
    },

    /** 织物：weave 'plain' | 'twill' | 'knit'，返回 { map, bumpMap } */
    fabric({ color = '#7a6a5a', color2, weave = 'plain', seed = 5, threads = 64, res = 512 } = {}) {
      const key = `fabric:${color}:${color2}:${weave}:${seed}:${threads}:${res}:${quality}`;
      if (texCache.has(key)) return texCache.get(key);
      const A = hexToRgb(color), Bc = hexToRgb(color2 || color);
      const n = makeNoise2(seed);
      const hf = (u, v) => {
        const x = u * threads, y = v * threads;
        let h;
        if (weave === 'twill') h = 0.5 + 0.5 * Math.sin((x + y) * Math.PI);
        else if (weave === 'knit') h = Math.abs(Math.sin(x * Math.PI)) * (0.6 + 0.4 * Math.abs(Math.sin((y + Math.abs(Math.sin(x * Math.PI)) * 0.5) * Math.PI * 2)));
        else { const wx = Math.abs(Math.sin(x * Math.PI)), wy = Math.abs(Math.sin(y * Math.PI)); h = ((Math.floor(x) + Math.floor(y)) % 2 === 0) ? wx * 0.8 + wy * 0.2 : wy * 0.8 + wx * 0.2; }
        return clamp(h * 0.8 + n(u * 32, v * 32, 32, 32) * 0.2 + 0.1);
      };
      const W = size(res);
      const map = finishTexture(pixelCanvas(W, W, (u, v) => {
        const h = hf(u, v);
        const c = mixRgb(A, Bc, clamp(n.tile(u, v, 4, 4, 3) + 0.5));
        const k = 0.72 + h * 0.36;
        return [c[0] * k, c[1] * k, c[2] * k];
      }));
      const bumpMap = finishTexture(pixelCanvas(W, W, hf), { color: false });
      const r = { map, bumpMap };
      texCache.set(key, r);
      return r;
    },

    /** 拉丝金属的各向异性细纹（用作 roughnessMap/bumpMap）direction: 'u'|'v' */
    brushed({ seed = 11, direction = 'u', res = 512 } = {}) {
      const key = `brushed:${seed}:${direction}:${res}:${quality}`;
      if (texCache.has(key)) return texCache.get(key);
      const n = makeNoise2(seed);
      const t = finishTexture(pixelCanvas(size(res), size(res), (u, v) => {
        const [a, b] = direction === 'u' ? [u, v] : [v, u];
        return clamp(0.5 + n(a * 4, b * 256, 4, 256) * 0.6 + n(a * 16, b * 512, 16, 512) * 0.3);
      }), { color: false });
      texCache.set(key, t);
      return t;
    },
  };

  // ---------------------------------------------------------------------------
  // 材质（PBR）。所有函数都接受额外的 three.js 材质参数覆盖。
  const mat = {
    std: (p = {}) => new THREE.MeshStandardMaterial(p),
    physical: (p = {}) => new THREE.MeshPhysicalMaterial(p),

    /** 木材。gloss: 0 哑光 ~ 1 钢琴漆（清漆层 clearcoat） */
    wood({ style = 'walnut', base, dark, light, seed = 7, gloss = 0.3, figure = 1, wear = 0, bump = 0.6, res, ...extra } = {}) {
      const t = textures.wood({ style, base, dark, light, seed, figure, wear, res });
      return new THREE.MeshPhysicalMaterial({
        map: t.map, roughnessMap: t.roughnessMap, bumpMap: t.bumpMap, bumpScale: bump,
        roughness: lerp(0.85, 0.42, gloss), metalness: 0,
        clearcoat: gloss, clearcoatRoughness: lerp(0.5, 0.06, gloss),
        ...extra,
      });
    },
    /** 纯色漆面/塑料。gloss 0~1 */
    paint({ color = '#cccccc', gloss = 0.5, ...extra } = {}) {
      return new THREE.MeshPhysicalMaterial({ color, roughness: lerp(0.8, 0.18, gloss), metalness: 0, clearcoat: gloss * 0.8, clearcoatRoughness: lerp(0.4, 0.05, gloss), ...extra });
    },
    plastic({ color = '#dddddd', gloss = 0.4, ...extra } = {}) {
      return new THREE.MeshPhysicalMaterial({ color, roughness: lerp(0.75, 0.2, gloss), metalness: 0, specularIntensity: 0.6, ...extra });
    },
    /** 镀铬（高反光），需要场景环境贴图，回忆馆已提供 */
    chrome({ color = '#f2f4f6', roughness = 0.08, ...extra } = {}) {
      return new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness, ...extra });
    },
    brass({ color = '#c9a24a', roughness = 0.28, aged = 0.3, ...extra } = {}) {
      return new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color).lerp(new THREE.Color('#6b5a33'), aged * 0.5), metalness: 1, roughness: roughness + aged * 0.15, ...extra });
    },
    metal({ color = '#9aa0a6', roughness = 0.35, brushed = false, ...extra } = {}) {
      const p = { color, metalness: 1, roughness };
      if (brushed) { p.roughnessMap = textures.brushed({ direction: brushed === 'v' ? 'v' : 'u' }); p.bumpMap = p.roughnessMap; p.bumpScale = 0.15; }
      return new THREE.MeshPhysicalMaterial({ ...p, ...extra });
    },
    glass({ color = '#ffffff', roughness = 0.02, thickness = 0.01, opacity = 0.25, ...extra } = {}) {
      return new THREE.MeshPhysicalMaterial({ color, metalness: 0, roughness, transmission: 1, thickness, ior: 1.5, transparent: true, opacity, envMapIntensity: 1.5, ...extra });
    },
    /** 镜面（高金属度镜子） */
    mirror({ tint = '#e9eef0', ...extra } = {}) {
      return new THREE.MeshPhysicalMaterial({ color: tint, metalness: 1, roughness: 0.015, ...extra });
    },
    fabric({ color = '#8a7a6a', color2, weave = 'plain', threads = 64, repeat = 4, sheen = 0.6, ...extra } = {}) {
      const t = textures.fabric({ color, color2, weave, threads });
      const map = t.map.clone(); map.repeat.set(repeat, repeat); map.needsUpdate = true;
      const bumpMap = t.bumpMap.clone(); bumpMap.repeat.set(repeat, repeat); bumpMap.needsUpdate = true;
      return new THREE.MeshPhysicalMaterial({ map, bumpMap, bumpScale: 0.8, roughness: 0.9, sheen, sheenColor: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.4), sheenRoughness: 0.6, ...extra });
    },
    leather({ color = '#5a3020', gloss = 0.35, ...extra } = {}) {
      return new THREE.MeshPhysicalMaterial({ color, roughness: lerp(0.8, 0.35, gloss), bumpMap: textures.noise({ seed: 41, scale: 40, contrast: 0.8 }), bumpScale: 0.3, clearcoat: gloss * 0.4, ...extra });
    },
    ceramic({ color = '#f4f1ea', gloss = 0.9, ...extra } = {}) {
      return new THREE.MeshPhysicalMaterial({ color, roughness: lerp(0.6, 0.08, gloss), clearcoat: gloss, clearcoatRoughness: 0.05, ...extra });
    },
    rubber({ color = '#1d1d1d', ...extra } = {}) {
      return new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, ...extra });
    },
    paper({ color = '#efe8d8', ...extra } = {}) {
      return new THREE.MeshStandardMaterial({ color, roughness: 0.95, bumpMap: textures.noise({ seed: 61, scale: 80, contrast: 0.4 }), bumpScale: 0.2, ...extra });
    },
    emissive({ color = '#ffe2a8', intensity = 2, ...extra } = {}) {
      return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, ...extra });
    },
  };

  // ---------------------------------------------------------------------------
  // 几何体
  /**
   * 按真实尺寸重算 UV（盒式投影），保证同一材质在大小不同的板件上纹理密度一致。
   * grain: 'x'|'y'|'z' 木纹沿哪个轴；默认取包围盒最长轴。tile: 一张贴图覆盖多少米。
   */
  function worldUV(geo, { grain, tile = 1.0, offset = [0, 0] } = {}) {
    geo.computeBoundingBox();
    const bb = geo.boundingBox, s = new THREE.Vector3(); bb.getSize(s);
    const g = grain || (s.x >= s.y && s.x >= s.z ? 'x' : s.y >= s.z ? 'y' : 'z');
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    if (!nor) geo.computeVertexNormals();
    const N = geo.attributes.normal;
    const uv = new Float32Array(pos.count * 2);
    const axes = ['x', 'y', 'z'];
    for (let i = 0; i < pos.count; i++) {
      const p = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
      const n = [Math.abs(N.getX(i)), Math.abs(N.getY(i)), Math.abs(N.getZ(i))];
      const dom = axes[n[0] >= n[1] && n[0] >= n[2] ? 0 : n[1] >= n[2] ? 1 : 2];
      const rest = axes.filter(a => a !== dom);
      let vAxis = rest.includes(g) ? g : rest[1];
      let uAxis = rest.find(a => a !== vAxis);
      uv[i * 2] = p[uAxis] / tile + offset[0];
      uv[i * 2 + 1] = p[vAxis] / tile + offset[1];
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return geo;
  }

  let uvSeed = mulberry32(12345);
  const geo = {
    roundedBox(w, h, d, r = 0.003, seg = 2) {
      const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
      return rr > 1e-4 ? new RoundedBoxGeometry(w, h, d, seg, rr) : new THREE.BoxGeometry(w, h, d);
    },
    /** 车削体：profile = [[半径, 高度], ...]（自下而上） */
    lathe(profile, segments = 48, phiStart = 0, phiLength = Math.PI * 2) {
      return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), segments, phiStart, phiLength);
    },
    /** 沿点的平滑管：points = [[x,y,z], ...] */
    tube(points, radius = 0.01, { closed = false, tubular, radial = 12, tension = 0.5 } = {}) {
      const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), closed, 'catmullrom', tension);
      return new THREE.TubeGeometry(curve, tubular || Math.max(16, points.length * 12), radius, radial, closed);
    },
    /** 挤出：shape = [[x,y], ...] 或 THREE.Shape；holes = [[[x,y],...], ...]；挤出方向 +Z，居中 */
    extrude(shape, depth = 0.02, { bevel = 0.002, bevelSegments = 2, curveSegments = 24, holes = [], center = true } = {}) {
      let s = shape;
      if (Array.isArray(shape)) { s = new THREE.Shape(shape.map(([x, y]) => new THREE.Vector2(x, y))); }
      for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
      const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(1e-4, depth - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments, curveSegments });
      if (center) g.translate(0, 0, -depth / 2 + bevel);
      return g;
    },
    /** 圆角矩形 Shape（用于挤出面板、按钮、屏幕） */
    roundedRectShape(w, h, r) {
      const s = new THREE.Shape(); const x = -w / 2, y = -h / 2; r = Math.min(r, w / 2, h / 2);
      s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
      s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
      s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
      return s;
    },
    cylinder: (rTop, rBottom, h, seg = 32, open = false) => new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open),
    sphere: (r, ws = 32, hs = 20) => new THREE.SphereGeometry(r, ws, hs),
    torus: (R, r, rs = 16, ts = 48, arc = Math.PI * 2) => new THREE.TorusGeometry(R, r, rs, ts, arc),
    worldUV,
    merge: (geos) => mergeGeometries(geos, false),
    mergeVertices,
  };

  // ---------------------------------------------------------------------------
  // 快捷构造
  function place(obj, { pos, rot, scale, name, parent, shadow = true, receive = true } = {}) {
    if (pos) obj.position.set(...pos);
    if (rot) obj.rotation.set(...rot);
    if (scale != null) Array.isArray(scale) ? obj.scale.set(...scale) : obj.scale.setScalar(scale);
    if (name) obj.name = name;
    if (obj.isMesh) { obj.castShadow = shadow; obj.receiveShadow = receive; }
    if (parent) parent.add(obj);
    return obj;
  }
  function mesh(geometry, material, opts = {}) { return place(new THREE.Mesh(geometry, material), opts); }

  /**
   * 板件/盒子：自动圆角 + 真实尺寸 UV。opts.r 圆角半径，opts.grain 木纹轴，opts.tile 贴图尺寸(米)
   */
  function box(w, h, d, material, opts = {}) {
    const g = geo.roundedBox(w, h, d, opts.r ?? 0.002, opts.seg ?? 2);
    worldUV(g, { grain: opts.grain, tile: opts.tile ?? 1.2, offset: opts.uvOffset || [uvSeed() * 10, uvSeed() * 10] });
    return mesh(g, material, opts);
  }
  function group(opts = {}) { return place(new THREE.Group(), opts); }

  // ---------------------------------------------------------------------------
  // 可交互部件（门、抽屉、盖子……）。回忆馆中点击即可开合。
  // root 必须是 build() 返回的根节点，或任意祖先已登记 parts 的节点。
  function registerPart(root, part) {
    root.userData.parts = root.userData.parts || [];
    root.userData.parts.push(part);
    part.object.userData.partIndex = root.userData.parts.length - 1;
    return part.object;
  }
  /**
   * 铰链：在 pivot 处创建一个转轴 Group，把门板等加进返回的 Group 里（坐标相对于 pivot）。
   * axis: 'x'|'y'|'z'；open: 打开角度（弧度，正负决定方向）
   */
  function hinge(root, parent, { pivot = [0, 0, 0], axis = 'y', open = -1.9, label = '门', name } = {}) {
    const g = group({ pos: pivot, name: name || `hinge:${label}`, parent });
    return registerPart(root, { type: 'hinge', label, object: g, axis, closed: 0, open });
  }
  /** 滑轨：抽屉等。axis 方向平移 distance 米 */
  function slider(root, parent, { pos = [0, 0, 0], axis = 'z', distance = 0.3, label = '抽屉', name } = {}) {
    const g = group({ pos, name: name || `slider:${label}`, parent });
    return registerPart(root, { type: 'slider', label, object: g, axis, closed: 0, open: distance, base: g.position[axis] });
  }

  return {
    THREE, textures, mat, geo, mesh, box, group, place, hinge, slider,
    rng: (seed = 1) => mulberry32(hashSeed(seed)),
    noise2: (seed = 1) => makeNoise2(seed),
    clamp, lerp,
    color: (c) => new THREE.Color(c),
    v3: (x, y, z) => new THREE.Vector3(x, y, z),
  };
}

/** 打开/关闭某个部件（t: 0 关 ~ 1 开），回忆馆的动画系统调用 */
export function applyPart(part, t) {
  const v = part.closed + (part.open - part.closed) * t;
  if (part.type === 'hinge') part.object.rotation[part.axis] = v;
  else part.object.position[part.axis] = (part.base || 0) + v;
}
