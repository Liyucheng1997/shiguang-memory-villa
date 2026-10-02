// 别墅用的程序化贴图：地板、墙面、屋瓦、草地……全部用 canvas 现画，不依赖外部素材。
import * as THREE from 'three';

const cache = new Map();
let ANISO = 8;
export const setAnisotropy = a => { ANISO = a; };

function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, color = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISO;
  return t;
}
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;

// 噪点叠加（细微的颜色起伏，避免 CG 感）
function speckle(ctx, w, h, r, n = 6000, alpha = 0.05, size = 2) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = r() > 0.5 ? `rgba(255,255,255,${alpha * r()})` : `rgba(0,0,0,${alpha * r()})`;
    ctx.fillRect(r() * w, r() * h, size * r() + 0.5, size * r() + 0.5);
  }
}
// 从颜色画布派生灰度凹凸图：亮处高
function bumpFrom(c, invert = false, blur = 0) {
  const b = canvas(c.width, c.height); const x = b.getContext('2d');
  if (blur) x.filter = `blur(${blur}px)`;
  x.drawImage(c, 0, 0);
  const img = x.getImageData(0, 0, b.width, b.height); const d = img.data;
  for (let i = 0; i < d.length; i += 4) { let g = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11); if (invert) g = 255 - g; d[i] = d[i + 1] = d[i + 2] = g; }
  x.putImageData(img, 0, 0);
  return tex(b, false);
}

function woodStrokes(ctx, x, y, w, h, r, baseHue, light, dark, vertical = false) {
  // 一块木条：底色 + 纵向纹线
  const len = vertical ? h : w, wid = vertical ? w : h;
  ctx.save(); ctx.translate(x, y);
  if (vertical) { ctx.translate(w, 0); ctx.rotate(Math.PI / 2); }
  const l = light + (r() - 0.5) * 8;
  const g = ctx.createLinearGradient(0, 0, 0, wid);
  g.addColorStop(0, hsl(baseHue + (r() - 0.5) * 6, 45, l - 2)); g.addColorStop(1, hsl(baseHue + (r() - 0.5) * 6, 48, l + 2));
  ctx.fillStyle = g; ctx.fillRect(0, 0, len, wid);
  const lines = 10 + r() * 10;
  for (let i = 0; i < lines; i++) {
    ctx.strokeStyle = hsl(baseHue, 50, dark + r() * 10, 0.18 + r() * 0.25);
    ctx.lineWidth = 0.4 + r() * 1.6;
    ctx.beginPath();
    let yy = r() * wid; ctx.moveTo(0, yy);
    const amp = 1 + r() * 3, f = 0.002 + r() * 0.01, ph = r() * 9;
    for (let xx = 0; xx <= len; xx += 8) ctx.lineTo(xx, yy + Math.sin(xx * f + ph) * amp + Math.sin(xx * f * 3.1) * amp * 0.3);
    ctx.stroke();
  }
  // 木结
  if (r() < 0.25) {
    const kx = r() * len, ky = wid * (0.3 + r() * 0.4);
    for (let k = 6; k > 0; k--) { ctx.strokeStyle = hsl(baseHue, 50, dark + k * 2, 0.35); ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(kx, ky, k * 3.2, k * 1.4, 0, 0, Math.PI * 2); ctx.stroke(); }
  }
  ctx.restore();
}

const BUILDERS = {
  // —— 地板 ——
  planks({ hue = 32, light = 55, dark = 25, seed = 1, plankW = 0.16, plankL = 1.4, size = 2.4 } = {}) {
    const S = 1024, px = S / size, r = rng(seed);
    const c = canvas(S); const ctx = c.getContext('2d');
    const rows = Math.round(size / plankW), rh = S / rows;
    for (let i = 0; i < rows; i++) {
      let x = -r() * plankL * px;
      while (x < S) {
        const L = plankL * px * (0.6 + r() * 0.6);
        woodStrokes(ctx, x, i * rh, L, rh, r, hue, light, dark);
        // 跨越边界时在另一侧补画，保证无缝
        if (x + L > S) woodStrokes(ctx, x - S, i * rh, L, rh, r, hue, light, dark);
        ctx.fillStyle = 'rgba(30,15,5,0.55)'; ctx.fillRect(x, i * rh, 2, rh);
        x += L;
      }
      ctx.fillStyle = 'rgba(30,15,5,0.6)'; ctx.fillRect(0, i * rh, S, 1.5);
    }
    speckle(ctx, S, S, r, 8000, 0.04);
    return { map: tex(c), bumpMap: bumpFrom(c), tile: size, roughness: 0.48, clearcoat: 0.35 };
  },
  // 简单可靠的方块拼花（席纹）
  basket({ hue = 30, light = 46, dark = 22, seed = 3, size = 0.96 } = {}) {
    const S = 1024, r = rng(seed);
    const c = canvas(S); const ctx = c.getContext('2d');
    const cells = 8, cs = S / cells, strips = 4, sw = cs / strips;
    for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
      const vertical = (i + j) % 2 === 0;
      for (let k = 0; k < strips; k++) {
        const hh = light + (r() - 0.5) * 9;
        if (vertical) woodStrokes(ctx, i * cs + k * sw, j * cs, sw, cs, r, hue + (r() - 0.5) * 5, hh, dark, true);
        else woodStrokes(ctx, i * cs, j * cs + k * sw, cs, sw, r, hue + (r() - 0.5) * 5, hh, dark);
        ctx.fillStyle = 'rgba(25,12,4,0.5)';
        if (vertical) ctx.fillRect(i * cs + k * sw, j * cs, 1.2, cs); else ctx.fillRect(i * cs, j * cs + k * sw, cs, 1.2);
      }
      ctx.strokeStyle = 'rgba(25,12,4,0.6)'; ctx.lineWidth = 1.5; ctx.strokeRect(i * cs, j * cs, cs, cs);
    }
    speckle(ctx, S, S, r, 6000, 0.05);
    return { map: tex(c), bumpMap: bumpFrom(c), tile: size, roughness: 0.42, clearcoat: 0.55 };
  },
  // 水磨石（老楼道、老学校的地面）
  terrazzo({ base = [214, 206, 192], seed = 4, size = 1.0, divider = true } = {}) {
    const S = 1024, r = rng(seed);
    const c = canvas(S); const ctx = c.getContext('2d');
    ctx.fillStyle = `rgb(${base})`; ctx.fillRect(0, 0, S, S);
    speckle(ctx, S, S, r, 30000, 0.08, 1.5);
    const palette = ['#2b2a28', '#3d3a36', '#f4f1ea', '#e9e3d6', '#8c4a35', '#a5664a', '#6f7f6a', '#b9a88a', '#5f5a55', '#c9c1b2'];
    for (let i = 0; i < 5200; i++) {
      const x = r() * S, y = r() * S, s = 2 + Math.pow(r(), 2.5) * 14;
      ctx.fillStyle = palette[Math.floor(r() * palette.length)];
      ctx.beginPath();
      const n = 5 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2 + r() * 0.6, rr = s * (0.55 + r() * 0.5); const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.closePath(); ctx.fill();
      // 边缘复制（无缝）
      if (x < 20 || y < 20) { ctx.save(); ctx.translate(x < 20 ? S : 0, y < 20 ? S : 0); ctx.fill(); ctx.restore(); }
    }
    if (divider) { ctx.fillStyle = '#9a7a45'; ctx.fillRect(0, 0, S, 3); ctx.fillRect(0, 0, 3, S); }
    const rough = canvas(256); const rx = rough.getContext('2d'); rx.fillStyle = '#4a4a4a'; rx.fillRect(0, 0, 256, 256); speckle(rx, 256, 256, r, 2000, 0.2, 6);
    return { map: tex(c), roughnessMap: tex(rough, false), tile: size, roughness: 0.22, clearcoat: 0.7 };
  },
  // 方砖（红色缸砖 / 白瓷砖）
  tiles({ color = [150, 62, 44], grout = '#d9cfc2', count = 4, size = 1.2, seed = 5, jitter = 10, gloss = false } = {}) {
    const S = 1024, r = rng(seed);
    const c = canvas(S); const ctx = c.getContext('2d');
    ctx.fillStyle = grout; ctx.fillRect(0, 0, S, S);
    const ts = S / count, gw = Math.max(3, S / count * 0.03);
    for (let i = 0; i < count; i++) for (let j = 0; j < count; j++) {
      const k = (r() - 0.5) * jitter;
      const g = ctx.createLinearGradient(i * ts, j * ts, (i + 1) * ts, (j + 1) * ts);
      g.addColorStop(0, `rgb(${color.map(v => v + k + 4)})`); g.addColorStop(1, `rgb(${color.map(v => v + k - 4)})`);
      ctx.fillStyle = g; ctx.fillRect(i * ts + gw / 2, j * ts + gw / 2, ts - gw, ts - gw);
    }
    speckle(ctx, S, S, r, 9000, gloss ? 0.02 : 0.07, 2);
    const bump = canvas(S); const bx = bump.getContext('2d');
    bx.fillStyle = '#000'; bx.fillRect(0, 0, S, S); bx.fillStyle = '#fff';
    for (let i = 0; i < count; i++) for (let j = 0; j < count; j++) bx.fillRect(i * ts + gw / 2, j * ts + gw / 2, ts - gw, ts - gw);
    return { map: tex(c), bumpMap: tex(bump, false), tile: size, roughness: gloss ? 0.12 : 0.55, clearcoat: gloss ? 0.8 : 0.1 };
  },
  // —— 墙面 ——
  paint({ color = '#efe9df', seed = 6, size = 2 } = {}) {
    const S = 512, r = rng(seed);
    const c = canvas(S); const ctx = c.getContext('2d');
    ctx.fillStyle = color; ctx.fillRect(0, 0, S, S);
    // 刷痕 + 斑驳
    for (let i = 0; i < 900; i++) { ctx.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.025)'; const w = 20 + r() * 80; ctx.fillRect(r() * S, r() * S, w, 2 + r() * 6); }
    speckle(ctx, S, S, r, 5000, 0.05, 2);
    return { map: tex(c), bumpMap: bumpFrom(c, false, 1), tile: size, roughness: 0.85 };
  },
  // 碎花墙纸
  wallpaper({ base = '#efe4cf', motif = '#c9a27c', leaf = '#8fa07a', seed = 7, size = 0.64 } = {}) {
    const S = 512, r = rng(seed);
    const c = canvas(S); const ctx = c.getContext('2d');
    ctx.fillStyle = base; ctx.fillRect(0, 0, S, S);
    // 竖向暗纹
    for (let x = 0; x < S; x += 32) { ctx.fillStyle = 'rgba(160,120,80,0.06)'; ctx.fillRect(x, 0, 14, S); }
    const flower = (x, y, s) => {
      ctx.save(); ctx.translate(x, y);
      ctx.strokeStyle = leaf; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(s * 0.6, s * 0.8, s * 0.2, s * 1.6); ctx.stroke();
      ctx.fillStyle = leaf; ctx.beginPath(); ctx.ellipse(s * 0.45, s * 0.9, s * 0.35, s * 0.14, 0.8, 0, Math.PI * 2); ctx.fill();
      for (let k = 0; k < 5; k++) { ctx.fillStyle = motif; ctx.beginPath(); const a = k / 5 * Math.PI * 2; ctx.ellipse(Math.cos(a) * s * 0.32, Math.sin(a) * s * 0.32, s * 0.28, s * 0.18, a, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = '#e9c98c'; ctx.beginPath(); ctx.arc(0, 0, s * 0.16, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    };
    const pts = [[64, 64], [320, 64], [192, 192], [448, 192], [64, 320], [320, 320], [192, 448], [448, 448]];
    for (const [x, y] of pts) for (const ox of [0, -S, S]) for (const oy of [0, -S, S]) flower(x + ox, y + oy, 26);
    speckle(ctx, S, S, r, 4000, 0.04, 2);
    return { map: tex(c), bumpMap: bumpFrom(c, false, 1), tile: size, roughness: 0.8 };
  },
  // 木护墙板（竖向企口板）
  woodPanel({ hue = 25, light = 30, dark = 14, seed = 8, size = 1.2 } = {}) {
    const S = 1024, r = rng(seed);
    const c = canvas(S); const ctx = c.getContext('2d');
    const n = 8, w = S / n;
    for (let i = 0; i < n; i++) {
      woodStrokes(ctx, i * w, 0, w, S, r, hue, light + (r() - 0.5) * 6, dark, true);
      ctx.fillStyle = 'rgba(10,5,2,0.7)'; ctx.fillRect(i * w, 0, 3, S);
      ctx.fillStyle = 'rgba(255,230,200,0.12)'; ctx.fillRect(i * w + 3, 0, 2, S);
    }
    return { map: tex(c), bumpMap: bumpFrom(c), tile: size, roughness: 0.5, clearcoat: 0.3 };
  },
  // —— 室外 ——
  plaster({ color = '#e8dcc6', seed = 9, size = 3 } = {}) {
    const S = 512, r = rng(seed);
    const c = canvas(S); const ctx = c.getContext('2d');
    ctx.fillStyle = color; ctx.fillRect(0, 0, S, S);
    speckle(ctx, S, S, r, 26000, 0.09, 2.5);
    for (let i = 0; i < 60; i++) { const g = ctx.createRadialGradient(r() * S, r() * S, 0, r() * S, r() * S, 40 + r() * 80); g.addColorStop(0, 'rgba(120,100,70,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, S, S); }
    return { map: tex(c), bumpMap: bumpFrom(c, false, 0.6), tile: size, roughness: 0.92 };
  },
  stone({ seed = 10, size = 2 } = {}) {
    const S = 1024, r = rng(seed);
    const c = canvas(S); const ctx = c.getContext('2d');
    ctx.fillStyle = '#6d655b'; ctx.fillRect(0, 0, S, S);
    const rows = 8, rh = S / rows;
    for (let i = 0; i < rows; i++) {
      let x = (i % 2) * -rh;
      while (x < S) {
        const w = rh * (1.2 + r() * 1.3), l = 52 + r() * 14;
        ctx.fillStyle = hsl(30 + r() * 10, 10 + r() * 8, l); ctx.fillRect(x + 3, i * rh + 3, w - 6, rh - 6);
        if (x + w > S) { ctx.fillRect(x - S + 3, i * rh + 3, w - 6, rh - 6); }
        x += w;
      }
    }
    speckle(ctx, S, S, r, 30000, 0.12, 3);
    return { map: tex(c), bumpMap: bumpFrom(c, false, 1), tile: size, roughness: 0.9 };
  },
  roofTiles({ seed = 11, size = 1.2 } = {}) {
    const S = 512, r = rng(seed);
    const c = canvas(S); const ctx = c.getContext('2d');
    ctx.fillStyle = '#4a2a20'; ctx.fillRect(0, 0, S, S);
    const rows = 8, cols = 8, rh = S / rows, cw = S / cols;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols + 1; j++) {
      const x = j * cw - (i % 2) * cw / 2, y = i * rh;
      const g = ctx.createLinearGradient(0, y, 0, y + rh);
      const l = 30 + r() * 8;
      g.addColorStop(0, hsl(12 + r() * 6, 45, l - 8)); g.addColorStop(0.7, hsl(12, 48, l + 4)); g.addColorStop(1, hsl(12, 40, l - 12));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x + 2, y); ctx.lineTo(x + cw - 2, y); ctx.lineTo(x + cw - 2, y + rh - 4); ctx.quadraticCurveTo(x + cw / 2, y + rh + 4, x + 2, y + rh - 4); ctx.closePath(); ctx.fill();
    }
    speckle(ctx, S, S, r, 6000, 0.1, 2);
    return { map: tex(c), bumpMap: bumpFrom(c), tile: size, roughness: 0.75 };
  },
  grass({ seed = 12, size = 4 } = {}) {
    const S = 1024, r = rng(seed);
    const c = canvas(S); const ctx = c.getContext('2d');
    ctx.fillStyle = '#5d7a3a'; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 80; i++) { const g = ctx.createRadialGradient(r() * S, r() * S, 0, r() * S, r() * S, 60 + r() * 140); g.addColorStop(0, r() > 0.5 ? 'rgba(140,150,60,0.18)' : 'rgba(40,70,30,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, S, S); }
    for (let i = 0; i < 60000; i++) {
      const x = r() * S, y = r() * S, l = 4 + r() * 9;
      ctx.strokeStyle = hsl(75 + r() * 30, 35 + r() * 25, 22 + r() * 25, 0.7);
      ctx.lineWidth = 0.8 + r();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 3, y - l); ctx.stroke();
    }
    return { map: tex(c), bumpMap: bumpFrom(c), tile: size, roughness: 0.95 };
  },
  paving({ seed = 13, size = 1.6 } = {}) {
    const S = 512, r = rng(seed);
    const c = canvas(S); const ctx = c.getContext('2d');
    ctx.fillStyle = '#7d766b'; ctx.fillRect(0, 0, S, S);
    const n = 4, s = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const l = 62 + r() * 10; ctx.fillStyle = hsl(35, 12, l); ctx.fillRect(i * s + 4, j * s + 4, s - 8, s - 8); }
    speckle(ctx, S, S, r, 20000, 0.12, 2);
    return { map: tex(c), bumpMap: bumpFrom(c, false, 1), tile: size, roughness: 0.85 };
  },
};

// 各房间饰面的预设
const PRESETS = {
  'oak-planks': () => BUILDERS.planks({ hue: 30, light: 52, dark: 26, seed: 21 }),
  'walnut-planks': () => BUILDERS.planks({ hue: 22, light: 30, dark: 12, seed: 22, plankW: 0.14 }),
  'light-planks': () => BUILDERS.planks({ hue: 36, light: 66, dark: 40, seed: 23, plankW: 0.2 }),
  parquet: () => BUILDERS.basket({ hue: 26, light: 42, dark: 18, seed: 24 }),
  terrazzo: () => BUILDERS.terrazzo({ seed: 25 }),
  'red-tiles': () => BUILDERS.tiles({ color: [146, 60, 42], grout: '#bfb3a3', count: 4, size: 1.2, seed: 26 }),
  'white-tiles': () => BUILDERS.tiles({ color: [236, 236, 230], grout: '#c9c7c0', count: 8, size: 1.2, seed: 27, jitter: 6, gloss: true }),
  'wallpaper-cream': () => BUILDERS.wallpaper({ seed: 28 }),
  'paint-white': () => BUILDERS.paint({ color: '#f1ede4', seed: 29 }),
  'paint-warm': () => BUILDERS.paint({ color: '#efe3cf', seed: 30 }),
  'paint-green': () => BUILDERS.paint({ color: '#8fb39a', seed: 31 }),     // 老房子的绿色墙裙
  'paint-deepgreen': () => BUILDERS.paint({ color: '#3f5a4c', seed: 32 }),
  'paint-skyblue': () => BUILDERS.paint({ color: '#bcd6e3', seed: 33 }),
  'paint-cream': () => BUILDERS.paint({ color: '#f2e6c9', seed: 34 }),
  'paint-terracotta': () => BUILDERS.paint({ color: '#b2664a', seed: 35 }),
  'wood-panel': () => BUILDERS.woodPanel({ seed: 36 }),
  plaster: () => BUILDERS.plaster({ seed: 37 }),
  stone: () => BUILDERS.stone({ seed: 38 }),
  roof: () => BUILDERS.roofTiles({ seed: 39 }),
  grass: () => BUILDERS.grass({ seed: 40 }),
  paving: () => BUILDERS.paving({ seed: 41 }),
};

/** 取一个饰面（缓存）：{ map, bumpMap?, roughnessMap?, tile, roughness, clearcoat? } */
export function finish(name) {
  if (!cache.has(name)) cache.set(name, (PRESETS[name] || PRESETS['paint-white'])());
  return cache.get(name);
}

/** 用饰面创建材质。uv 需要已按“米”缩放（见 villa.js 的 meterUV） */
export function finishMaterial(name, extra = {}) {
  const f = finish(name);
  const m = new THREE.MeshPhysicalMaterial({
    map: f.map, bumpMap: f.bumpMap || null, bumpScale: f.bumpMap ? 0.6 : 0,
    roughnessMap: f.roughnessMap || null, roughness: f.roughness ?? 0.8,
    clearcoat: f.clearcoat || 0, clearcoatRoughness: 0.25, ...extra,
  });
  m.userData.tile = f.tile;
  return m;
}

/** 画一块文字牌（黄铜铭牌 / 房间名） */
export function labelTexture(lines, { w = 512, h = 160, bg = '#b8955a', fg = '#3a2a14', font = '"Noto Serif SC","Songti SC","SimSun",serif', border = true } = {}) {
  const c = canvas(w, h); const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, bg); g.addColorStop(0.5, '#d9bd84'); g.addColorStop(1, bg);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  if (border) { ctx.strokeStyle = 'rgba(60,40,15,0.6)'; ctx.lineWidth = 4; ctx.strokeRect(8, 8, w - 16, h - 16); }
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const arr = Array.isArray(lines) ? lines : [lines];
  arr.forEach((t, i) => {
    const size = i === 0 ? h * 0.32 : h * 0.17;
    ctx.font = `${i === 0 ? 'bold ' : ''}${size}px ${font}`;
    const y = arr.length === 1 ? h / 2 : h * (0.4 + i * 0.32);
    let text = t; while (ctx.measureText(text).width > w - 40 && text.length > 2) text = text.slice(0, -2) + '…';
    ctx.fillText(text, w / 2, y);
  });
  const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
