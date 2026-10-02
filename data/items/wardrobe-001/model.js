// 玫瑰木纹双门衣柜（约 1960–70 年代款式）
// 参考照片：photo.jpg（Wikimedia Commons「Wardrobe (De Luz).jpg」, My Community Sg, CC BY 4.0）
// 坐标：单位米，原点在地面中心，正面朝 +Z。
//
// 照片测量（以柜宽 835px ≈ 1.00m 换算）：
//   总高 ≈1.58m，腿高 ≈0.10m，把手长 ≈0.19m、中心离地 ≈0.77m，锁孔离地 ≈0.66m
//   柜体侧板/顶板在门板外形成一圈凸出的框；门板为对开纹（book-matched）玫瑰木贴面，亮光漆
//   左门左侧可见 3 个小合页；底边有一道磨损的金属压条；四条外撇锥形木腿，脚上套镀铬脚套
// 内部（据照片说明）：一扇门内侧装镜子；顶部挂衣杆；左侧通长挂衣区，右侧分上下两格。

export const info = {
  name: '玫瑰木纹双门衣柜',
  dimensions: [1.0, 1.58, 0.55],
};

export default function build(THREE, kit) {
  const root = new THREE.Group();
  root.name = 'wardrobe';

  // ---------------- 尺寸 ----------------
  const W = 1.0, H = 1.58, D = 0.55;
  const LEG = 0.10;            // 柜底离地
  const T = 0.018;             // 板厚
  const FR = 0.012;            // 外框凸出门面的量
  const zFront = D / 2;        // 外框前沿
  const doorT = 0.018;
  const doorZ = zFront - FR - doorT / 2; // 门板中心 z
  const yBot = LEG, yTop = H;
  const railH = 0.03;          // 底部前横档
  const topH = 0.026;          // 顶框高
  const gap = 0.003;

  // ---------------- 材质 ----------------
  const rosewood = kit.mat.wood({ style: 'rosewood', seed: 31, gloss: 0.72, figure: 1.25, wear: 0.06, bump: 0.25 });
  const rosewoodSide = kit.mat.wood({ style: 'rosewood', seed: 47, gloss: 0.6, figure: 1.1, wear: 0.1, bump: 0.25 });
  const edgeBand = kit.mat.paint({ color: '#3a1d10', gloss: 0.55 });
  const interior = kit.mat.wood({ style: 'teak', base: '#9a6a3e', dark: '#6b4524', light: '#b98a58', seed: 5, gloss: 0.15, figure: 0.6, bump: 0.3 });
  const hardboard = kit.mat.std({ color: '#5a3d26', roughness: 0.92, bumpMap: kit.textures.noise({ seed: 9, scale: 90, contrast: 0.5 }), bumpScale: 0.3 });
  const chrome = kit.mat.chrome({ roughness: 0.12 });
  const wornChrome = kit.mat.chrome({ color: '#d9d6cf', roughness: 0.22, roughnessMap: kit.textures.noise({ seed: 21, scale: 30, contrast: 1.2, bias: 0.45 }) });
  const brassTrim = kit.mat.brass({ color: '#b8a274', roughness: 0.35, aged: 0.6 });
  const legWood = kit.mat.wood({ style: 'teak', base: '#7a4f28', dark: '#4a2c14', light: '#a06a38', seed: 77, gloss: 0.45, figure: 0.5, bump: 0.2 });
  const darkInsert = kit.mat.physical({
    color: '#2a2c2e', roughness: 0.3, clearcoat: 0.6,
    map: kit.textures.canvas(256, 512, (ctx, w, h) => {
      // 把手中间的深灰大理石纹塑料嵌片
      const r = kit.rng(88);
      ctx.fillStyle = '#26282a'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 140; i++) {
        ctx.strokeStyle = `rgba(${150 + r() * 80},${150 + r() * 80},${150 + r() * 80},${0.15 + r() * 0.35})`;
        ctx.lineWidth = 0.5 + r() * 2;
        ctx.beginPath();
        let x = r() * w, y = r() * h; ctx.moveTo(x, y);
        for (let k = 0; k < 4; k++) { x += (r() - 0.5) * 60; y += (r() - 0.3) * 70; ctx.lineTo(x, y); }
        ctx.stroke();
      }
    }),
  });
  const mirror = kit.mat.mirror({ tint: '#dfe6e6' });

  const carcass = kit.group({ name: 'carcass', parent: root });

  // ---------------- 柜体 ----------------
  const carcH = yTop - yBot;
  // 侧板
  for (const s of [-1, 1]) {
    kit.box(T, carcH, D, rosewoodSide, { pos: [s * (W / 2 - T / 2), yBot + carcH / 2, 0], grain: 'y', tile: 1.7, r: 0.0025, parent: carcass, name: s < 0 ? 'side-left' : 'side-right' });
  }
  // 顶板（压在侧板之上，前沿形成顶框）
  kit.box(W, topH, D, rosewoodSide, { pos: [0, yTop - topH / 2, 0], grain: 'x', tile: 1.5, r: 0.003, parent: carcass, name: 'top' });
  // 顶框下沿斜切的深色封边（照片顶部那道深色线脚）
  kit.box(W - 2 * T, 0.008, 0.006, edgeBand, { pos: [0, yTop - topH - 0.004, zFront - 0.003], r: 0.0015, parent: carcass });
  // 前框内侧斜面：在侧板前沿内侧加一条窄的深色斜边，模拟画框式凸边的阴影面
  for (const s of [-1, 1]) {
    const bevel = kit.box(0.006, carcH - topH - railH, FR, edgeBand, { pos: [s * (W / 2 - T - 0.003), yBot + railH + (carcH - topH - railH) / 2, zFront - FR / 2], r: 0.0015, parent: carcass });
    bevel.rotation.y = s * 0.35;
  }
  // 底板 + 底部前横档
  kit.box(W - 2 * T, T, D - 0.01, interior, { pos: [0, yBot + T / 2, -0.005], grain: 'x', parent: carcass, name: 'bottom' });
  kit.box(W - 2 * T, railH, T, rosewoodSide, { pos: [0, yBot + railH / 2, zFront - T / 2], grain: 'x', r: 0.002, parent: carcass, name: 'bottom-rail' });
  // 底边磨旧的金属压条（照片中门下那条发亮的细线）
  kit.box(W - 0.01, 0.007, 0.004, brassTrim, { pos: [0, yBot + 0.0035, zFront + 0.001], r: 0.0015, parent: carcass, name: 'trim-strip' });
  // 背板（纤维板）
  kit.box(W - 2 * T + 0.01, carcH - 0.01, 0.005, hardboard, { pos: [0, yBot + carcH / 2, -D / 2 + 0.006], parent: carcass, name: 'back' });
  // 背面看到的木龙骨
  for (const yy of [yBot + 0.05, yTop - 0.06]) kit.box(W - 2 * T, 0.05, 0.016, interior, { pos: [0, yy, -D / 2 + 0.017], grain: 'x', parent: carcass });

  // ---------------- 内部 ----------------
  const innerW = W - 2 * T;
  const innerTop = yTop - topH, innerBot = yBot + T;
  const innerH = innerTop - innerBot;
  const backZ = -D / 2 + 0.009;
  const innerDepth = (doorZ - doorT / 2 - 0.005) - backZ;
  const innerCZ = backZ + innerDepth / 2;
  // 竖隔板：左边挂衣区约 58%，右边分两格
  const divX = -innerW / 2 + innerW * 0.58;
  kit.box(T, innerH, innerDepth, interior, { pos: [divX, innerBot + innerH / 2, innerCZ], grain: 'y', parent: carcass, name: 'divider' });
  const rightW = innerW / 2 - divX - T / 2;
  const rightCX = divX + T / 2 + rightW / 2;
  // 右侧层板（上格稍高）
  const shelfY = innerBot + innerH * 0.46;
  kit.box(rightW, T, innerDepth, interior, { pos: [rightCX, shelfY, innerCZ], grain: 'x', parent: carcass, name: 'shelf' });
  kit.box(rightW, T, innerDepth, interior, { pos: [rightCX, innerBot + innerH * 0.82, innerCZ], grain: 'x', parent: carcass, name: 'shelf-top' });
  // 内衬：内侧板和顶板用浅色木（覆盖在玫瑰木侧板内侧）
  for (const [x, w] of [[-innerW / 2 + 0.001, 0.002], [innerW / 2 - 0.001, 0.002]]) {
    kit.box(w, innerH, innerDepth, interior, { pos: [x, innerBot + innerH / 2, innerCZ], grain: 'y', parent: carcass });
  }
  kit.box(innerW, 0.002, innerDepth, interior, { pos: [0, innerTop - 0.001, innerCZ], grain: 'x', parent: carcass });

  // 挂衣杆（镀铬圆管 + 两端法兰座）
  const leftW = divX - T / 2 - (-innerW / 2);
  const leftCX = -innerW / 2 + leftW / 2;
  const railY = innerTop - 0.075;
  const rail = kit.mesh(kit.geo.cylinder(0.0095, 0.0095, leftW, 24), wornChrome, { pos: [leftCX, railY, innerCZ], rot: [0, 0, Math.PI / 2], parent: carcass, name: 'hanging-rail' });
  for (const s of [-1, 1]) kit.mesh(kit.geo.cylinder(0.018, 0.018, 0.006, 24), chrome, { pos: [leftCX + s * (leftW / 2 - 0.003), railY, innerCZ], rot: [0, 0, Math.PI / 2], parent: carcass });

  // 衣架 + 旧衣服
  const hangerWood = kit.mat.wood({ style: 'pine', seed: 12, gloss: 0.5, figure: 0.4 });
  const garmentColors = [
    { color: '#6d7f8c', color2: '#5b6b77', weave: 'twill' },   // 灰蓝中山装
    { color: '#e9e2cf', color2: '#d8cfb8', weave: 'plain' },   // 米白衬衫
    { color: '#7b3b2c', color2: '#6a3123', weave: 'knit' },    // 枣红毛衣开衫
    { color: '#3e4a3a', color2: '#333d31', weave: 'twill' },   // 军绿外套
  ];
  const hangerXs = [-0.17, -0.07, 0.03, 0.12].map(v => leftCX + v * (leftW / 0.48));
  hangerXs.forEach((hx, i) => {
    const hg = kit.group({ pos: [hx, railY, innerCZ], rot: [0, Math.PI / 2 + (i % 2 ? 0.06 : -0.05), 0], parent: carcass, name: `hanger-${i}` });
    // 钩子
    kit.mesh(kit.geo.tube([[0, -0.035, 0], [0, 0.004, 0], [0.006, 0.016, 0], [0.016, 0.012, 0], [0.018, 0.0, 0]], 0.0018, { radial: 8 }), chrome, { parent: hg });
    // 衣架横梁（弧形木条）
    const arm = kit.geo.tube([[-0.2, -0.105, 0], [-0.1, -0.06, 0], [0, -0.04, 0], [0.1, -0.06, 0], [0.2, -0.105, 0]], 0.008, { radial: 10, tubular: 40 });
    kit.mesh(arm, hangerWood, { parent: hg });
    // 衣服：用挤出的轮廓做出柔软的衣身
    const g = garmentColors[i];
    const len = i === 3 ? 0.95 : i === 0 ? 0.78 : 0.68;
    const shape = [
      [-0.06, -0.035], [-0.2, -0.1], [-0.235, -0.16], [-0.25, -0.48], [-0.205, -0.5], [-0.19, -0.22],
      [-0.19, -len], [0.19, -len], [0.19, -0.22], [0.205, -0.5], [0.25, -0.48], [0.235, -0.16], [0.2, -0.1], [0.06, -0.035], [0, -0.07],
    ];
    const cloth = kit.mat.fabric({ ...g, threads: 90, repeat: 3, sheen: 0.5 });
    const body = kit.mesh(kit.geo.extrude(shape, 0.05, { bevel: 0.018, bevelSegments: 4, curveSegments: 8 }), cloth, { parent: hg, name: 'garment' });
    body.position.y = -0.005;
    // 衣襟上的纽扣
    if (i !== 2) for (let b = 0; b < 4; b++) kit.mesh(kit.geo.cylinder(0.007, 0.007, 0.004, 12), kit.mat.plastic({ color: i === 1 ? '#f4f0e6' : '#2b2b2b', gloss: 0.7 }), { pos: [0, -0.13 - b * 0.12, 0.027], rot: [Math.PI / 2, 0, 0], parent: hg });
  });

  // 右侧格子里叠放的衣物
  const folded = [['#c9b48a', '#b8a378'], ['#58708a', '#4d6278'], ['#9a4b3c', '#874034'], ['#ece6d6', '#ded6c2'], ['#5b4a3c', '#4c3e32']];
  let fy = shelfY + T / 2;
  folded.slice(0, 3).forEach(([c1, c2], i) => {
    const h = 0.045 + i * 0.005;
    kit.box(rightW * 0.82, h, innerDepth * 0.7, kit.mat.fabric({ color: c1, color2: c2, weave: i === 2 ? 'knit' : 'plain', repeat: 2 }), { pos: [rightCX + (i % 2 ? 0.006 : -0.004), fy + h / 2, innerCZ + 0.01], r: 0.016, seg: 3, parent: carcass });
    fy += h;
  });
  fy = innerBot;
  folded.slice(3).forEach(([c1, c2], i) => {
    const h = 0.06;
    kit.box(rightW * 0.8, h, innerDepth * 0.68, kit.mat.fabric({ color: c1, color2: c2, repeat: 2 }), { pos: [rightCX, fy + h / 2, innerCZ + 0.015], r: 0.02, seg: 3, parent: carcass });
    fy += h;
  });
  // 樟脑丸小纸盒（老衣柜的味道）
  kit.box(0.08, 0.03, 0.05, kit.mat.paper({ color: '#d8c9a0' }), { pos: [rightCX + 0.05, innerBot + innerH * 0.82 + T / 2 + 0.015, innerCZ + 0.04], r: 0.002, parent: carcass, name: 'camphor-box' });

  // ---------------- 门 ----------------
  const openingW = innerW;
  const doorW = (openingW - 3 * gap) / 2;
  const doorY0 = yBot + railH + gap;
  const doorY1 = yTop - topH - gap;
  const doorH = doorY1 - doorY0;
  const doorCY = (doorY0 + doorY1) / 2;

  function makeDoor(side) { // side: -1 左门（铰链在左） / +1 右门（铰链在右）
    const pivotX = side * (openingW / 2 - gap);
    const pivotZ = doorZ + doorT / 2; // 铰链在门前沿外角
    const door = kit.hinge(root, carcass, {
      pivot: [pivotX, doorCY, pivotZ], axis: 'y', open: side < 0 ? -1.85 : 1.85,
      label: side < 0 ? '左门' : '右门', name: side < 0 ? 'door-left' : 'door-right',
    });
    const cx = -side * doorW / 2; // 门板中心相对铰链
    const panel = kit.box(doorW, doorH, doorT, rosewood, { pos: [cx, 0, -doorT / 2], grain: 'y', tile: 1.65, r: 0.0025, uvOffset: [0.37, 0.12], parent: door, name: 'door-panel' });
    // 对开纹：右门 U 镜像
    if (side > 0) {
      const uv = panel.geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, 0.74 - uv.getX(i));
      uv.needsUpdate = true;
    }
    // 门内侧：浅色衬板
    kit.box(doorW - 0.01, doorH - 0.01, 0.002, interior, { pos: [cx, 0, -doorT - 0.001], grain: 'y', parent: door });

    // 合页（每扇门 3 个，可见的管状铰链）
    for (const hy of [doorH / 2 - 0.13, 0.02, -doorH / 2 + 0.13]) {
      kit.mesh(kit.geo.cylinder(0.0032, 0.0032, 0.045, 12), wornChrome, { pos: [0, hy, -0.0015], parent: door });
      for (const e of [-1, 1]) kit.mesh(kit.geo.cylinder(0.0036, 0.0036, 0.003, 12), wornChrome, { pos: [0, hy + e * 0.0235, -0.0015], parent: door });
    }

    // 把手：镀铬梭形框 + 中间深色大理石纹嵌片
    const handleX = -side * (doorW - 0.042); // 靠中缝
    const hy = 0.77 - doorCY;
    const L = 0.19, Wd = 0.022;
    const lens = (len, wid) => { // 两段圆弧组成的梭形
      const s = new THREE.Shape();
      s.moveTo(0, -len / 2);
      s.quadraticCurveTo(wid, 0, 0, len / 2);
      s.quadraticCurveTo(-wid, 0, 0, -len / 2);
      return s;
    };
    const outer = lens(L, Wd * 1.2);             // 外框最宽处 ≈2.6cm
    outer.holes.push(lens(L * 0.84, Wd * 0.62));
    const hGroup = kit.group({ pos: [handleX, hy, 0], parent: door, name: 'handle' });
    kit.mesh(kit.geo.extrude(outer, 0.009, { bevel: 0.0022, bevelSegments: 3, curveSegments: 32 }), chrome, { pos: [0, 0, 0.012], parent: hGroup });
    kit.mesh(kit.geo.extrude(lens(L * 0.84, Wd * 0.62), 0.004, { bevel: 0.0008, curveSegments: 32 }), darkInsert, { pos: [0, 0, 0.006], parent: hGroup });
    for (const e of [-1, 1]) kit.mesh(kit.geo.cylinder(0.004, 0.005, 0.012, 12), chrome, { pos: [0, e * (L / 2 - 0.008), 0.006], rot: [Math.PI / 2, 0, 0], parent: hGroup });

    // 右门内侧镜子（带四个镀铬镜夹）
    if (side > 0) {
      const mw = doorW - 0.12, mh = doorH * 0.62;
      const my = 0.12;
      kit.mesh(kit.geo.roundedBox(mw, mh, 0.004, 0.0015), mirror, { pos: [cx, my, -doorT - 0.004], parent: door, name: 'mirror', shadow: false });
      for (const [ex, ey] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        kit.mesh(kit.geo.roundedBox(0.022, 0.014, 0.004, 0.0015), chrome, { pos: [cx + ex * (mw / 2 - 0.004), my + ey * (mh / 2), -doorT - 0.0065], parent: door });
      }
    }
    // 锁孔（右门，靠中缝下方）
    if (side > 0) {
      const kx = -side * (doorW - 0.02);
      kit.mesh(kit.geo.cylinder(0.0085, 0.0095, 0.003, 32), wornChrome, { pos: [kx, 0.66 - doorCY, 0.0015], rot: [Math.PI / 2, 0, 0], parent: door, name: 'keyhole' });
      kit.mesh(kit.geo.extrude([[-0.0012, -0.004], [0.0012, -0.004], [0.0012, 0.0005], [0.0025, 0.002], [0, 0.0045], [-0.0025, 0.002], [-0.0012, 0.0005]], 0.002, { bevel: 0 }),
        kit.mat.std({ color: '#0b0705', roughness: 0.9 }), { pos: [kx, 0.66 - doorCY, 0.0032], parent: door });
    }
    // 门面上的几处白色小斑点（照片右门上可见的旧痕）
    if (side > 0) {
      const r = kit.rng(5);
      for (let i = 0; i < 7; i++) {
        kit.mesh(kit.geo.cylinder(0.0012 + r() * 0.0012, 0.0012, 0.0004, 8), kit.mat.paint({ color: '#d8cfc4', gloss: 0.2 }),
          { pos: [cx + (r() - 0.3) * 0.12, 0.42 + r() * 0.08, 0.0002], rot: [Math.PI / 2, 0, 0], parent: door, shadow: false });
      }
    }
    return door;
  }
  makeDoor(-1);
  makeDoor(1);

  // ---------------- 腿 ----------------
  const legs = kit.group({ name: 'legs', parent: root });
  const legLen = 0.0955; // 外撇后脚尖正好落地
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const lx = sx * (W / 2 - 0.11), lz = sz * (D / 2 - 0.08);
    // 安装座
    kit.box(0.06, 0.008, 0.06, kit.mat.metal({ color: '#8f8a80', roughness: 0.45 }), { pos: [lx, yBot - 0.004, lz], r: 0.002, parent: legs });
    const legG = kit.group({ pos: [lx, yBot - 0.006, lz], parent: legs });
    legG.rotation.z = sx * 0.13;   // 左右外撇
    legG.rotation.x = -sz * 0.06;  // 前后略撇
    // 锥形木腿（上粗下细：上端半径 0.0205，下端 0.0135）
    kit.mesh(kit.geo.lathe([[0, -legLen + 0.03], [0.0128, -legLen + 0.03], [0.0205, 0], [0, 0]], 32), legWood, { parent: legG, name: 'leg' });
    // 镀铬脚套
    kit.mesh(kit.geo.lathe([[0, -legLen], [0.0085, -legLen], [0.0108, -legLen + 0.006], [0.0132, -legLen + 0.03], [0.0128, -legLen + 0.031], [0, -legLen + 0.031]], 32), chrome, { parent: legG, name: 'ferrule' });
  }

  root.userData.description = '1960–70 年代常见的玫瑰木纹贴面双门衣柜，亮光漆面、镀铬梭形把手、外撇锥形腿。点击可以打开柜门。';
  return root;
}
