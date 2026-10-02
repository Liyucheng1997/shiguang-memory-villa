// 阿尔萨斯胡桃木雕花大衣柜（armoire alsacienne，18 世纪末–19 世纪初样式）
// 参考照片：photo.jpg（Wikimedia Commons，CC BY-SA 4.0）
// 坐标：单位米，原点在地面中心，正面朝 +Z。
//
// 照片测量（960×1280，柜高 1060px ≈ 2.10m → 约 505px/m）：
//   檐口最宽 802px ≈ 1.60m；柜身（两侧圆角立柱外缘）726px ≈ 1.44m；底座 762px ≈ 1.51m
//   圆球脚高 ≈0.11m；底座线脚 0.11–0.23m；柜身 0.23–1.78m
//   檐口“宪兵帽”拱：两端顶 ≈1.94m，正中顶 ≈2.10m；檐口下沿两端 1.78m、正中 1.89m（门顶随之起拱）
//   左门 x≈-0.60…-0.055，右门 0.05…0.60；中梃宽 ≈0.10m，连环雕花 0.97–1.81m，下接小柱头 0.89–0.93m
//   每扇门：上面板（拱顶）+ 中部 S 形肾形雕花圆饰（≈0.78–1.21m）+ 下面板（0.38–0.78m）
//   洛可可长锁片长 ≈0.28m、中心离地 ≈1.14m，靠中缝；黄铜长合页（fiche）每门 2 根，中心 ≈1.47m / 0.50m
//   两侧圆角立柱上各有一枚雕花小玫瑰（≈0.95m）

export const info = {
  name: '胡桃木雕花大衣柜',
  dimensions: [1.6, 2.1, 0.6],
};

export default function build(THREE, kit) {
  const root = new THREE.Group();
  root.name = 'armoire-alsace';
  const PI = Math.PI;

  // ---------------- 尺寸 ----------------
  const BW = 0.72;            // 柜身半宽（立柱外缘）
  const ZF = 0.225, ZB = -0.28; // 柜身前沿 / 背面
  const FOOT = 0.11;          // 底座下沿（圆球脚高）
  const BASE_TOP = 0.23;      // 底座顶
  const CORN_Y = 1.78;        // 檐口下沿（两端）
  const CH = 0.16;            // 檐口线脚高（两端）
  const XA = 0.62;            // 拱的半跨
  const arch = x => (Math.abs(x) >= XA ? 0 : 0.5 * (1 + Math.cos(PI * x / XA)));
  const y0 = x => CORN_Y + 0.11 * arch(x);   // 檐口下沿曲线
  const sH = x => 1 + 0.3 * arch(x);          // 线脚在拱顶处加高
  const yTop = x => y0(x) + CH * sH(x);       // 檐口顶曲线（正中 ≈2.10）

  // ---------------- 材质 ----------------
  // 照片里是上过蜡的暖棕胡桃木：框料偏蜜棕，面板偏红褐、带强烈的火焰纹
  const frameWood = kit.mat.wood({ style: 'walnut', base: '#744422', dark: '#43220d', light: '#9c6436', seed: 11, gloss: 0.45, figure: 0.6, wear: 0.18, bump: 0.3 });
  const sideWood = kit.mat.wood({ style: 'walnut', base: '#704222', dark: '#40200c', light: '#986034', seed: 53, gloss: 0.4, figure: 0.9, wear: 0.15, bump: 0.3 });
  const panelWood = kit.mat.wood({ style: 'walnut', base: '#62331a', dark: '#2a1206', light: '#945a30', seed: 23, gloss: 0.5, figure: 1.6, wear: 0.08, bump: 0.25 });
  const carveWood = kit.mat.wood({ style: 'walnut', base: '#744424', dark: '#3e200c', light: '#9c6438', seed: 41, gloss: 0.4, figure: 0.5, wear: 0.25, bump: 0.4 });
  const innerWood = kit.mat.wood({ style: 'oak', base: '#b08a5e', dark: '#7d5c3a', light: '#c9a477', seed: 7, gloss: 0.08, figure: 0.6, bump: 0.35 });
  const footWood = kit.mat.wood({ style: 'walnut', base: '#5a3418', dark: '#2a160a', light: '#7a4a26', seed: 61, gloss: 0.3, figure: 0.5, wear: 0.45 });
  const capWood = frameWood.clone(); capWood.side = THREE.DoubleSide;
  const brass = kit.mat.brass({ color: '#b39250', aged: 0.55, roughness: 0.38, roughnessMap: kit.textures.noise({ seed: 15, scale: 40, contrast: 1.1, bias: 0.45 }) });
  const darkBrass = kit.mat.brass({ color: '#8d6c36', aged: 0.8, roughness: 0.5 });
  const keyholeMat = kit.mat.std({ color: '#070403', roughness: 0.95 });

  // ---------------- 工具函数 ----------------
  const area = pts => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const ccw = pts => (area(pts) < 0 ? pts.slice().reverse() : pts);
  const v2 = pts => pts.map(p => new THREE.Vector2(p[0], p[1]));
  // 挤出：轮廓精确等于 pts（bevelOffset 抵消外扩），背面在 z=0，正面在 depth+2bt
  function extGeo(pts, holes, depth, bt = 0, bs = 0, seg = 3) {
    const shape = new THREE.Shape(v2(ccw(pts)));
    for (const h of holes) shape.holes.push(new THREE.Path(v2(ccw(h).slice().reverse())));
    const g = new THREE.ExtrudeGeometry(shape, {
      depth, steps: 1, curveSegments: 6,
      bevelEnabled: bt > 0, bevelThickness: bt, bevelSize: bs, bevelOffset: -bs, bevelSegments: seg,
    });
    g.translate(0, 0, bt);
    return g;
  }
  function woodUV(g, grain = 'y', tile = 1.2, mirror = false) {
    kit.geo.worldUV(g, { grain, tile });
    if (mirror) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 0.73 - uv.getX(i)); uv.needsUpdate = true; }
    return g;
  }
  const ellArc = (cx, cy, a, b, t0, t1, n) => { const o = []; for (let k = 0; k <= n; k++) { const t = t0 + (t1 - t0) * k / n; o.push([cx + a * Math.cos(t), cy + b * Math.sin(t)]); } return o; };
  const rrect = (cx, cy, w, h, r, n = 5) => {
    const o = [];
    for (const [qx, qy, a0] of [[1, -1, -PI / 2], [1, 1, 0], [-1, 1, PI / 2], [-1, -1, PI]]) {
      for (let k = 0; k <= n; k++) { const a = a0 + (PI / 2) * k / n; o.push([cx + qx * (w / 2 - r) + r * Math.cos(a), cy + qy * (h / 2 - r) + r * Math.sin(a)]); }
    }
    return o;
  };

  // 沿“左侧→左前圆角→正面→右前圆角→右侧”环绕柜身的路径扫掠线脚（檐口、底座）
  function ringPath(yFn, sFn, rc, nFront) {
    const P = [];
    const push = (x, z, nx, nz) => P.push({ x, z, nx, nz, y: yFn(x), s: sFn(x) });
    const nc = 10;
    push(-BW, ZB, -1, 0);
    push(-BW, ZF - rc, -1, 0);
    for (let k = 1; k <= nc; k++) { const a = PI - (PI / 2) * k / nc; push(-BW + rc + rc * Math.cos(a), ZF - rc + rc * Math.sin(a), Math.cos(a), Math.sin(a)); }
    for (let k = 1; k < nFront; k++) push(-BW + rc + (2 * BW - 2 * rc) * k / nFront, ZF, 0, 1);
    for (let k = 0; k <= nc; k++) { const a = PI / 2 - (PI / 2) * k / nc; push(BW - rc + rc * Math.cos(a), ZF - rc + rc * Math.sin(a), Math.cos(a), Math.sin(a)); }
    push(BW, ZB, 1, 0);
    return P;
  }
  function sweepGeo(path, prof, tile = 1.2) {
    const np = prof.length, nq = path.length;
    const pos = new Float32Array(nq * np * 3), uv = new Float32Array(nq * np * 2);
    const pl = [0];
    for (let j = 1; j < np; j++) pl[j] = pl[j - 1] + Math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]);
    let su = 0;
    for (let i = 0; i < nq; i++) {
      const p = path[i];
      if (i > 0) su += Math.hypot(p.x - path[i - 1].x, p.z - path[i - 1].z);
      for (let j = 0; j < np; j++) {
        const [o, u] = prof[j], k = i * np + j;
        pos[k * 3] = p.x + p.nx * o; pos[k * 3 + 1] = p.y + u * p.s; pos[k * 3 + 2] = p.z + p.nz * o;
        uv[k * 2] = su / tile; uv[k * 2 + 1] = pl[j] / tile;
      }
    }
    const idx = [];
    for (let i = 0; i < nq - 1; i++) for (let j = 0; j < np - 1; j++) {
      const a = i * np + j, b = (i + 1) * np + j, c = a + 1, d = b + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  // 扫掠两端（背面）封口
  function sweepCaps(path, prof, parent) {
    for (const p of [path[0], path[path.length - 1]]) {
      const g = new THREE.ShapeGeometry(new THREE.Shape(v2(ccw(prof.map(([o, u]) => [o, u * p.s])))));
      const a = g.attributes.position;
      for (let i = 0; i < a.count; i++) { const o = a.getX(i), u = a.getY(i); a.setXYZ(i, p.x + p.nx * o, p.y + u, p.z); }
      g.computeVertexNormals();
      woodUV(g, 'x');
      kit.mesh(g, capWood, { parent });
    }
  }

  const carcass = kit.group({ name: 'carcass', parent: root });

  // ---------------- 檐口（宪兵帽拱形线脚） ----------------
  const CP = [[-0.01, 0], [0.006, 0]];
  CP.push(...ellArc(0.006, 0.011, 0.009, 0.009, -PI / 2, PI / 2, 8));        // 下沿小圆珠线
  CP.push([0.008, 0.022], [0.014, 0.024], [0.014, 0.03]);
  for (let k = 1; k <= 10; k++) { const t = (PI / 2) * k / 10; CP.push([0.058 - 0.044 * Math.cos(t), 0.03 + 0.052 * Math.sin(t)]); } // 凹弧（cove）
  CP.push([0.062, 0.084]);
  CP.push(...ellArc(0.062, 0.11, 0.018, 0.024, -PI / 2, PI / 2, 10));       // 凸圆（ovolo）
  CP.push([0.066, 0.137], [0.08, 0.14], [0.081, 0.152], [0.076, 0.157], [0.06, 0.16], [-0.04, 0.16]); // 顶部压檐
  const cornPath = ringPath(y0, sH, 0.05, 140);
  kit.mesh(woodUV(sweepGeo(cornPath, CP), 'x', 1.4), frameWood, { parent: carcass, name: 'cornice' });
  sweepCaps(cornPath, CP, carcass);
  // 拱形檐板（檐口后面的起拱顶板）+ 平顶
  {
    const pts = [[-0.70, 1.925], [0.70, 1.925]];
    for (let k = 0; k <= 60; k++) { const x = 0.70 - 1.4 * k / 60; pts.push([x, yTop(x) - 0.004]); }
    kit.mesh(woodUV(extGeo(pts, [], 0.035), 'x'), frameWood, { pos: [0, 0, ZF - 0.07], parent: carcass, name: 'pediment-board' });
    kit.box(2 * BW, 0.012, ZF - ZB, sideWood, { pos: [0, 1.932, (ZF + ZB) / 2], grain: 'x', parent: carcass, name: 'top' });
    // 门洞上方的拱形门楣（开门后可见）
    const hp = [[-0.6, 1.75], [0.6, 1.75]];
    for (let k = 0; k <= 40; k++) { const x = 0.6 - 1.2 * k / 40; hp.push([x, y0(x)]); }
    kit.mesh(woodUV(extGeo(hp, [], 0.03), 'x'), innerWood, { pos: [0, 0, ZF - 0.06], parent: carcass, name: 'header' });
  }

  // ---------------- 底座线脚 ----------------
  const BP = [[-0.01, 0], [0.022, 0], [0.026, 0.004], [0.026, 0.07], [0.03, 0.074]];
  BP.push(...ellArc(0.03, 0.092, 0.012, 0.016, -PI / 2, PI / 2, 8));          // 上沿圆凸线
  BP.push([0.024, 0.11], [0.016, 0.112], [0.01, 0.115], [0.005, 0.118], [0.003, 0.12], [-0.02, 0.12]);
  const basePath = ringPath(() => FOOT, () => 1, 0.05, 6);
  kit.mesh(woodUV(sweepGeo(basePath, BP), 'x', 1.4), frameWood, { parent: carcass, name: 'base' });
  sweepCaps(basePath, BP, carcass);
  kit.box(2 * BW - 0.02, 0.01, ZF - ZB - 0.01, innerWood, { pos: [0, FOOT + 0.006, (ZF + ZB) / 2], grain: 'x', parent: carcass });

  // ---------------- 柜身 ----------------
  const bodyH = CORN_Y - BASE_TOP, bodyCY = (CORN_Y + BASE_TOP) / 2;
  for (const s of [-1, 1]) {
    // 圆角立柱（铰链柱）
    kit.box(0.12, bodyH, 0.1, frameWood, { pos: [s * (BW - 0.06), bodyCY, ZF - 0.05], r: 0.035, grain: 'y', tile: 1.8, parent: carcass, name: s < 0 ? 'pilaster-left' : 'pilaster-right' });
    // 柱头 / 柱础
    kit.box(0.128, 0.028, 0.106, carveWood, { pos: [s * (BW - 0.062), CORN_Y - 0.014, ZF - 0.051], r: 0.012, parent: carcass });
    kit.box(0.128, 0.03, 0.106, carveWood, { pos: [s * (BW - 0.062), BASE_TOP + 0.015, ZF - 0.051], r: 0.012, parent: carcass });
    // 侧板
    const sideD = ZF - 0.06 - ZB;
    kit.box(0.022, bodyH, sideD, sideWood, { pos: [s * (BW - 0.011), bodyCY, ZB + sideD / 2], grain: 'y', tile: 1.8, parent: carcass, name: s < 0 ? 'side-left' : 'side-right' });
    // 侧面两块凸起面板 + 线脚框
    for (const [yc, ph] of [[0.585, 0.55], [1.33, 0.74]]) {
      const zc = -0.07, pw = 0.28;
      const g = woodUV(extGeo(rrect(0, 0, pw, ph, 0.012), [], 0.002, 0.006, 0.02), 'y');
      kit.mesh(g, sideWood, { pos: [s * BW, yc, zc], rot: [0, s * PI / 2, 0], parent: carcass });
      const ring = woodUV(extGeo(rrect(0, 0, pw + 0.036, ph + 0.036, 0.02), [rrect(0, 0, pw - 0.004, ph - 0.004, 0.01)], 0.002, 0.006, 0.007), 'y');
      kit.mesh(ring, frameWood, { pos: [s * BW, yc, zc], rot: [0, s * PI / 2, 0], parent: carcass });
    }
  }
  // 门下横档
  kit.box(1.2, 0.034, 0.03, frameWood, { pos: [0, BASE_TOP + 0.017, ZF - 0.015], grain: 'x', parent: carcass, name: 'bottom-rail' });
  // 背板（竖向拼板）
  for (let i = 0; i < 5; i++) {
    const pw = 2 * (BW - 0.022) / 5;
    kit.box(pw - 0.002, bodyH, 0.018, innerWood, { pos: [-(BW - 0.022) + pw * (i + 0.5), bodyCY, ZB + 0.009], grain: 'y', tile: 2, uvOffset: [i * 0.17, 0], parent: carcass });
  }

  // ---------------- 内部 ----------------
  const inW = 2 * (BW - 0.022);
  const inZ0 = ZB + 0.018, inZ1 = 0.16;
  const inD = inZ1 - inZ0, inCZ = (inZ0 + inZ1) / 2;
  kit.box(inW, 0.03, inD, innerWood, { pos: [0, BASE_TOP + 0.017, inCZ], grain: 'x', parent: carcass, name: 'floor' });
  kit.box(inW, 0.02, inD, innerWood, { pos: [0, 1.76, inCZ], grain: 'x', parent: carcass, name: 'ceiling' });
  const shelfYs = [0.72, 1.1, 1.46];
  for (const sy of shelfYs) {
    kit.box(inW, 0.022, inD - 0.02, innerWood, { pos: [0, sy, inCZ - 0.01], grain: 'x', parent: carcass, name: 'shelf' });
    for (const s of [-1, 1]) kit.box(0.02, 0.025, inD - 0.04, innerWood, { pos: [s * (inW / 2 - 0.01), sy - 0.024, inCZ - 0.01], parent: carcass });
  }
  // 叠好的阿尔萨斯格子布（Kelsch）床单、桌布
  const kelsch = (c, seed) => kit.textures.canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#ece4d2'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = c;
    for (const [o, t] of [[0, 46], [64, 10], [96, 46], [160, 10], [192, 46]]) { ctx.globalAlpha = 0.75; ctx.fillRect(o, 0, t, h); ctx.globalAlpha = 0.55; ctx.fillRect(0, o, w, t); }
    ctx.globalAlpha = 0.08; const r = kit.rng(seed);
    for (let i = 0; i < 600; i++) { ctx.fillStyle = r() > 0.5 ? '#000' : '#fff'; ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1); }
    ctx.globalAlpha = 1;
  });
  const linens = [
    kit.mat.std({ map: kelsch('#a8312c', 3), roughness: 0.95 }),
    kit.mat.std({ map: kelsch('#2f4f86', 4), roughness: 0.95 }),
    kit.mat.fabric({ color: '#ece6d6', color2: '#ded6c2', weave: 'plain', repeat: 3 }),
    kit.mat.fabric({ color: '#d9cdb2', color2: '#cbbd9e', weave: 'twill', repeat: 3 }),
  ];
  const lr = kit.rng(19);
  shelfYs.forEach((sy, si) => {
    for (const sx of [-0.45, 0, 0.45]) {
      let fy = sy + 0.011;
      const n = 3 + Math.floor(lr() * 3);
      for (let k = 0; k < n; k++) {
        const h = 0.026 + lr() * 0.018;
        const m = linens[Math.floor(lr() * linens.length)];
        kit.box(0.36 + lr() * 0.04, h, 0.3, m, { pos: [sx + (lr() - 0.5) * 0.02, fy + h / 2, inCZ + 0.01 + (lr() - 0.5) * 0.02], rot: [0, (lr() - 0.5) * 0.05, 0], r: 0.012, tile: 0.3, parent: carcass, name: `linen-${si}` });
        fy += h;
      }
    }
  });
  // 薰衣草香包
  kit.mesh(kit.geo.sphere(0.04), kit.mat.fabric({ color: '#8c7aa8', color2: '#7a6996', weave: 'plain', repeat: 2 }), { pos: [0.24, shelfYs[1] + 0.035, inCZ + 0.08], scale: [1, 0.55, 0.8], parent: carcass, name: 'lavender-sachet' });
  // 底层：小木匣
  kit.box(0.34, 0.16, 0.26, carveWood, { pos: [-0.38, BASE_TOP + 0.032 + 0.08, inCZ], r: 0.006, parent: carcass, name: 'keepsake-box' });
  kit.box(0.35, 0.02, 0.27, carveWood, { pos: [-0.38, BASE_TOP + 0.032 + 0.17, inCZ], r: 0.006, parent: carcass });

  // ---------------- 黄铜长合页（fiche à vase） ----------------
  const finial = kit.geo.lathe([[0, 0], [0.005, 0.001], [0.0095, 0.007], [0.011, 0.014], [0.008, 0.02], [0.0058, 0.024], [0.0085, 0.027], [0.0085, 0.031], [0, 0.032]], 20);
  for (const s of [-1, 1]) for (const hy of [1.47, 0.5]) {
    const g = kit.group({ pos: [s * 0.6, hy, ZF + 0.004], parent: carcass, name: 'fiche-hinge' });
    kit.mesh(kit.geo.cylinder(0.0078, 0.0078, 0.11, 16), brass, { parent: g });
    kit.mesh(kit.geo.cylinder(0.0088, 0.0088, 0.004, 16), darkBrass, { parent: g }); // 两节交接处
    kit.mesh(finial, brass, { pos: [0, 0.055, 0], parent: g });
    kit.mesh(finial, brass, { pos: [0, -0.055, 0], rot: [PI, 0, 0], parent: g });
  }

  // ---------------- 立柱上的雕花玫瑰 ----------------
  {
    const petals = [];
    for (let k = 0; k < 8; k++) {
      const a = k * PI / 4;
      const p = kit.geo.sphere(0.008); p.scale(1.5, 0.75, 0.55); p.rotateZ(a); p.translate(Math.cos(a) * 0.012, Math.sin(a) * 0.012, 0.004);
      petals.push(p);
    }
    const c = kit.geo.sphere(0.0065); c.scale(1, 1, 0.8); c.translate(0, 0, 0.007); petals.push(c);
    const disc = kit.geo.cylinder(0.024, 0.026, 0.005, 32); disc.rotateX(PI / 2); petals.push(disc);
    for (const dy of [-1, 1]) { const l = kit.geo.sphere(0.007); l.scale(0.9, 4.2, 0.55); l.translate(0, dy * 0.06, 0.001); petals.push(l); }
    const rosette = woodUV(kit.geo.merge(petals), 'y', 0.4);
    for (const s of [-1, 1]) {
      const d = 0.035 * Math.SQRT1_2;
      kit.mesh(rosette, carveWood, { pos: [s * (BW - 0.035 + d), 0.95, ZF - 0.035 + d], rot: [0, s * PI / 4, 0], parent: carcass, name: 'rosette' });
    }
  }

  // ---------------- 门 ----------------
  // 以左门为基准在“柜体坐标”中定义形状，右门按 x 镜像
  const xl = -0.598, xr = -0.053, yb = 0.266;
  const fo = 0.075, fi = 0.075, ft = 0.10, fb = 0.11;
  const xp0 = xl + fo, xp1 = xr - fi, PW = xp1 - xp0;
  const uOf = x => (x - xp0) / PW;  // 0=铰链侧 1=中缝侧
  // 中部肾形圆饰的上下包络（照片：铰链侧低而饱满，中缝侧收起，上沿在中间偏右拱起）
  //   上沿：铰链端 1.11 → u≈0.55 拱到 1.21 → 中缝端 1.15；下沿：铰链端 0.85 → u≈0.3 垂到 0.78 → 中缝端 0.89
  const sq = v => v * v;
  const T = u => (u < 0.55 ? 1.21 - 0.10 * sq((0.55 - u) / 0.55) : 1.21 - 0.06 * sq((u - 0.55) / 0.45));
  const B = u => (u < 0.3 ? 0.78 + 0.07 * sq((0.3 - u) / 0.3) : 0.78 + 0.11 * sq((u - 0.3) / 0.7));
  const doorTop = x => y0(x) - 0.004;

  const outline = () => { const o = [[xl, yb], [xr, yb]]; for (let k = 0; k <= 30; k++) { const x = xr + (xl - xr) * k / 30; o.push([x, doorTop(x)]); } return o; };
  const upper = d => {
    const o = [], n = 32;
    for (let k = 0; k <= n; k++) { const x = xp0 + d + (PW - 2 * d) * k / n; o.push([x, T(uOf(x)) + 0.045 + d]); }
    for (let k = n; k >= 0; k--) { const x = xp0 + d + (PW - 2 * d) * k / n; o.push([x, doorTop(x) - ft - d]); }
    return o;
  };
  const lower = d => {
    const o = [], n = 32;
    for (let k = 0; k <= n; k++) { const x = xp0 + d + (PW - 2 * d) * k / n; o.push([x, yb + fb + d]); }
    for (let k = n; k >= 0; k--) { const x = xp0 + d + (PW - 2 * d) * k / n; o.push([x, B(uOf(x)) - 0.045 - d]); }
    return o;
  };
  const med = (d, p = 6) => { // p 越大两端越方（外圈贴着门框竖边），内圈用小 p 做成圆润的豆形
    const top = [], bot = [], n = 56;
    for (let k = 0; k <= n; k++) {
      const u = k / n, x = xp0 + d + u * (PW - 2 * d), uu = uOf(x);
      const m = (T(uu) + B(uu)) / 2, h0 = (T(uu) - B(uu)) / 2;
      const e = Math.pow(1 - Math.pow(Math.abs(2 * u - 1), p), 1 / p);
      const h = Math.max(0.003, h0 * e - d);
      top.push([x, m + h]); bot.push([x, m - h]);
    }
    return top.concat(bot.reverse());
  };
  // 圆饰中心的豆形鼓面：照片左门中心约 (-0.327, 0.99)，宽 0.30、高 0.24，中缝一端略翘（≈0.2rad）
  const bean = d => {
    const cx = -0.327, cy = 0.99, a = 0.12 - d, b = 0.098 - d, ang = 0.2, p = 2.4, o = [];
    for (let k = 0; k < 64; k++) {
      const t = k / 64 * PI * 2, c = Math.cos(t), s = Math.sin(t);
      let x = a * Math.sign(c) * Math.pow(Math.abs(c), 2 / p), y = b * Math.sign(s) * Math.pow(Math.abs(s), 2 / p);
      y += (s > 0 ? 0.018 * Math.max(0, x / a) : -0.016 * Math.max(0, -x / a)) * Math.abs(s); // 腰果形：上沿右鼓、下沿左鼓
      o.push([cx + x * Math.cos(ang) - y * Math.sin(ang), cy + x * Math.sin(ang) + y * Math.cos(ang)]);
    }
    return o;
  };

  // 洛可可长锁片轮廓（以中心为原点，长 L）
  const escPts = L => {
    const prof = [[0, 0], [0.03, 0.005], [0.07, 0.009], [0.11, 0.011], [0.15, 0.006], [0.2, 0.007], [0.26, 0.013], [0.33, 0.016], [0.4, 0.014], [0.46, 0.008], [0.51, 0.006], [0.57, 0.009], [0.63, 0.013], [0.69, 0.01], [0.75, 0.006], [0.81, 0.006], [0.87, 0.01], [0.92, 0.009], [0.97, 0.004], [1, 0]];
    const sp = new THREE.SplineCurve(prof.map(([t, w]) => new THREE.Vector2(t, w))).getPoints(90);
    const right = sp.map(p => [Math.max(0.0004, p.y), L / 2 - p.x * L]);
    const left = right.slice(1, -1).reverse().map(([w, y]) => [-w, y]);
    return right.concat(left);
  };
  const escGeo = extGeo(escPts(0.28), [], 0.0015, 0.001, 0.0012, 2);
  const escRib = extGeo(escPts(0.25).map(([x, y]) => [x * 0.45, y]), [], 0.001, 0.0008, 0.001, 2);
  const keyholePts = [...ellArc(0, 0, 0.0034, 0.0034, -PI / 2 + 0.6, 3 * PI / 2 - 0.6, 16), [-0.0014, -0.011], [0.0014, -0.011]];
  const keyholeGeo = extGeo(keyholePts, [], 0.0008);

  // 旧化贴花：节疤、手摸处的污渍
  const knotTex = (seed, light) => kit.textures.canvas(256, 256, (ctx, w, h) => {
    const r = kit.rng(seed);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2);
    for (let i = 14; i >= 0; i--) {
      const rr = 18 + i * 7;
      ctx.beginPath();
      for (let k = 0; k <= 40; k++) { const a = k / 40 * PI * 2; const j = 1 + (r() - 0.5) * 0.12; ctx.lineTo(Math.cos(a) * rr * 0.75 * j, Math.sin(a) * rr * 1.25 * j); }
      const t = i / 14;
      ctx.fillStyle = light ? `rgba(${200 - t * 40},${150 - t * 40},${95 - t * 30},${0.85 * (1 - t) + 0.05})` : `rgba(${50 + t * 40},${25 + t * 25},${12 + t * 12},${0.9 * (1 - t) + 0.05})`;
      ctx.fill();
    }
    ctx.fillStyle = light ? 'rgba(90,50,25,0.9)' : 'rgba(25,12,6,0.95)';
    ctx.beginPath(); ctx.ellipse(0, 0, 8, 12, 0.3, 0, PI * 2); ctx.fill();
  }, { color: true });
  const knotLight = kit.mat.std({ map: knotTex(3, true), transparent: true, roughness: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const knotDark = kit.mat.std({ map: knotTex(8, false), transparent: true, roughness: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const grime = kit.mat.std({
    map: kit.textures.canvas(128, 256, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(35,18,8,0.55)'); g.addColorStop(1, 'rgba(35,18,8,0)');
      ctx.setTransform(1, 0, 0, h / w, 0, 0); ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
    }, { color: true }),
    transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  });

  function makeDoor(side) { // -1 左门（铰链在左），+1 右门（铰链在右）
    const px = side * 0.6, pz = ZF - 0.003;
    const door = kit.hinge(root, carcass, { pivot: [px, 0, pz], axis: 'y', open: side < 0 ? -1.9 : 1.9, label: side < 0 ? '左门' : '右门', name: side < 0 ? 'door-left' : 'door-right' });
    const mx = side < 0 ? 1 : -1;
    const L = pts => pts.map(([x, y]) => [mx * x - px, y]);  // 柜体坐标 → 门局部坐标
    const lx = x => mx * x - px;
    const mirror = side > 0;
    const add = (g, mat, z, opts = {}) => kit.mesh(woodUV(g, 'y', 1.2, mirror), mat, { pos: [0, 0, z], parent: door, ...opts });

    // 门框（含三处开孔）
    add(extGeo(L(outline()), [L(upper(0)), L(med(0)), L(lower(0))], 0.024, 0.003, 0.003), frameWood, -0.02, { name: 'door-frame' });
    // 凸起面板（上、下）
    add(extGeo(L(upper(-0.004)), [], 0.008, 0.006, 0.016), panelWood, -0.012, { name: 'panel-upper' });
    add(extGeo(L(lower(-0.004)), [], 0.008, 0.006, 0.016), panelWood, -0.012, { name: 'panel-lower' });
    // 面板周围的凸圆线脚
    add(extGeo(L(upper(-0.026)), [L(upper(0.003))], 0.004, 0.008, 0.008), carveWood, 0.004, { name: 'moulding-upper' });
    add(extGeo(L(lower(-0.026)), [L(lower(0.003))], 0.004, 0.008, 0.008), carveWood, 0.004, { name: 'moulding-lower' });
    // 中部肾形雕花：底板 → 外圈粗圆线 → 内圈细线 → 中心鼓面
    add(extGeo(L(med(-0.004)), [], 0.006, 0.005, 0.01), panelWood, -0.012);
    add(extGeo(L(med(-0.016)), [L(med(0.028))], 0.006, 0.012, 0.014, 4), carveWood, -0.004, { name: 'medallion-roll' });
    add(extGeo(L(med(0.036, 4)), [L(med(0.05, 4))], 0.002, 0.005, 0.006), carveWood, -0.002);
    add(extGeo(L(bean(-0.022)), [L(bean(-0.006))], 0.002, 0.007, 0.007), carveWood, 0.0);
    add(extGeo(L(bean(-0.002)), [], 0.004, 0.007, 0.02, 4), panelWood, 0.0, { name: 'medallion-field' });

    // 洛可可长锁片 + 锁孔
    const ex = lx(-0.088), ey = 1.14;
    kit.mesh(escGeo, brass, { pos: [ex, ey, 0.0105], parent: door, name: 'escutcheon' });
    kit.mesh(escRib, darkBrass, { pos: [ex, ey - 0.005, 0.0135], parent: door });
    kit.mesh(keyholeGeo, keyholeMat, { pos: [ex, ey + 0.14 - 0.33 * 0.28, 0.0152], parent: door, name: 'keyhole' });
    for (const dy of [0.118, -0.118]) kit.mesh(kit.geo.sphere(0.0022), darkBrass, { pos: [ex, ey + dy, 0.0145], parent: door });
    kit.mesh(new THREE.PlaneGeometry(0.1, 0.36), grime, { pos: [ex, ey - 0.02, 0.0102], parent: door, shadow: false });

    // 照片里上面板的节疤
    if (side < 0) kit.mesh(new THREE.PlaneGeometry(0.07, 0.09), knotLight, { pos: [lx(-0.42), 1.37, 0.0082], rot: [0, 0, 0.4], parent: door, shadow: false });
    else kit.mesh(new THREE.PlaneGeometry(0.045, 0.06), knotDark, { pos: [lx(-0.43), 1.35, 0.0082], rot: [0, 0, -0.3], parent: door, shadow: false });

    // 中梃（固定在左门上）：连环雕花 + 小柱头 + 下段凹槽
    if (side < 0) {
      const sx = lx(-0.0015), sw = 0.097;
      const sTop = doorTop(0.05);
      kit.box(sw, sTop - yb, 0.036, frameWood, { pos: [sx, (sTop + yb) / 2, -0.006], grain: 'y', tile: 1.8, r: 0.004, parent: door, name: 'center-stile' });
      // 雕花区边框圆珠线
      const parts = [];
      for (const e of [-1, 1]) { const c = kit.geo.cylinder(0.004, 0.004, 0.87, 10); c.translate(e * 0.031, 1.4, 0); parts.push(c); }
      for (const yy of [0.965, 1.835]) { const c = kit.geo.cylinder(0.004, 0.004, 0.066, 10); c.rotateZ(PI / 2); c.translate(0, yy, 0); parts.push(c); }
      // 连环（17 个椭圆环相扣）
      const n = 17, yA = 1.808, yB = 1.0;
      for (let k = 0; k < n; k++) {
        const t = kit.geo.torus(0.0155, 0.0045, 8, 24); t.scale(1, 1.25, 1); t.translate(0, yA - (yA - yB) * k / (n - 1), 0); parts.push(t);
        if (k < n - 1) { const b = kit.geo.sphere(0.0048); b.scale(1.3, 0.8, 0.9); b.translate(0, yA - (yA - yB) * (k + 0.5) / (n - 1), 0.001); parts.push(b); }
      }
      // 连环下端的小叶饰
      const leaf = kit.geo.sphere(0.01); leaf.scale(1.1, 1.8, 0.6); leaf.translate(0, 0.975, 0); parts.push(leaf);
      kit.mesh(woodUV(kit.geo.merge(parts), 'y', 0.6), carveWood, { pos: [sx, 0, 0.014], parent: door, name: 'chain-carving' });
      // 小柱头、下段凸板、柱础
      kit.box(0.086, 0.044, 0.016, carveWood, { pos: [sx, 0.912, 0.018], r: 0.005, parent: door });
      kit.box(0.072, 0.01, 0.02, carveWood, { pos: [sx, 0.885, 0.016], r: 0.003, parent: door });
      kit.mesh(woodUV(extGeo(rrect(0, 0, 0.056, 0.48, 0.004), [], 0.002, 0.004, 0.01), 'y'), frameWood, { pos: [sx, 0.62, 0.012], parent: door });
      kit.box(0.082, 0.058, 0.016, carveWood, { pos: [sx, 0.35, 0.018], r: 0.005, parent: door });
    }
    return door;
  }
  makeDoor(-1);
  makeDoor(1);

  // ---------------- 车削圆球脚 ----------------
  const footGeo = kit.geo.lathe([[0, 0], [0.034, 0], [0.039, 0.004], [0.039, 0.012], [0.033, 0.017], [0.044, 0.03], [0.053, 0.048], [0.051, 0.066], [0.04, 0.082], [0.03, 0.088], [0.032, 0.094], [0.042, 0.099], [0.042, 0.11], [0, 0.11]], 32);
  for (const [fx, fz] of [[-0.66, 0.19], [0.66, 0.19], [0, 0.2], [-0.66, -0.22], [0.66, -0.22]]) {
    kit.mesh(woodUV(footGeo.clone(), 'y', 0.5), footWood, { pos: [fx, 0, fz], parent: root, name: 'foot' });
  }

  root.userData.description = '阿尔萨斯传统胡桃木双门大衣柜：宪兵帽式拱形檐口、门上 S 形肾形雕花、中梃连环雕刻、黄铜长合页和洛可可锁片、车削圆球脚。点击可以打开柜门，里面叠着阿尔萨斯格子布。';
  return root;
}
