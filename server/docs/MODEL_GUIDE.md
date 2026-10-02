# 拾光回忆馆 · 建模规范

每件藏品是一个 ES module：`data/items/<id>/model.js`。回忆馆在浏览器里动态 import 它，调用
`build(THREE, kit)` 得到模型，放进别墅的房间里。校验器也会在 Node 里运行同一份代码。

## 文件约定

```js
export const info = { name: '搪瓷缸', dimensions: [0.11, 0.1, 0.09] }; // 宽(x) 高(y) 深(z)，米

export default function build(THREE, kit) {
  const root = new THREE.Group();
  // ……搭建……
  return root;
}
```

- **单位米**。按真实尺寸建模（衣柜约 1×1.6~2×0.55，搪瓷杯约 0.08 宽）。
- **原点**：物体底面中心落在 (0,0,0)，最低点 y≈0。**正面朝 +Z**（摆放时 +Z 面向观众）。
- **不能 import 任何东西**；只用参数里的 `THREE`（three r186）和 `kit`。不要访问 `document`、`window`、网络、`Math.random`（用 `kit.rng(seed)`，保证每次构建结果一致）。
- 不要加灯光、相机、地面；场景由回忆馆提供（有 HDR 环境反射、阴影）。
- 性能：Mesh < 800，三角面 < 300k。大量重复件（螺丝、琴键、书本）可以循环创建但共享 geometry/material；必要时 `THREE.InstancedMesh`。
- 材质要复用：同一种材料创建一次，多处共用。

## 质量要求（重要）

单张照片无法看到背面，按常识合理补全，但正面和可见面要尽量**像照片里那一件**，而不是“一个泛泛的某类物品”。

1. **比例先行**：先从照片量出主要比例（宽高比、各部件位置占比），写在代码注释里，再按比例建模。
2. **分件建模**：真实物体由哪些零件组成就分成哪些 Mesh（柜体/门/把手/合页/腿；杯身/杯把/杯口包边……），零件之间要接触、不要悬空或互相穿插得太明显。
3. **边缘不要锐利**：板件用 `kit.box`（自带小圆角），旋转体用 `kit.geo.lathe` 做出唇边、倒角。
4. **材质分频**：主色 + 纹理（木纹/织物/噪声）+ 粗糙度变化 + 凹凸。金属用 metalness=1。漆面/釉面用 clearcoat。
5. **标志性细节**：商标、文字、花纹、按钮、刻度、缝线、铆钉、贴纸——用 `kit.textures.canvas` 画出来贴上，或用小几何体做出来。
6. **旧化**：岁月痕迹（掉漆、磨损、锈点、污渍、褪色）是回忆的一部分，照片里有就要表现出来。
7. **可交互**：门、抽屉、盖子、翻盖、开关等用 `kit.hinge` / `kit.slider` 做成可动部件，访客点击即可开合。打开后能看到的内部也要建（内壁、隔板、里面的东西）。
8. 照片里有、但不属于该物体本身的东西（背景、地板、旁边的杂物）不要建。

## kit API

```js
// —— 随机 & 工具
kit.rng(seed)                → () => [0,1) 确定性随机
kit.noise2(seed)             → (x,y)=>[-1,1] 柏林噪声，另有 .fbm(x,y,octaves)
kit.clamp, kit.lerp, kit.color(c), kit.v3(x,y,z)

// —— 快捷构造（opts: { pos:[x,y,z], rot:[x,y,z], scale, name, parent, shadow:true }）
kit.group(opts)                          → THREE.Group
kit.mesh(geometry, material, opts)       → THREE.Mesh（自动投/接阴影）
kit.box(w, h, d, material, opts)         → 带圆角的板件，按真实尺寸重算 UV（同一材质大小板件纹理密度一致）
    额外 opts: r 圆角半径(默认0.002)，grain 'x'|'y'|'z' 木纹方向(默认最长边)，tile 贴图覆盖米数(默认1.2)，uvOffset [u,v]

// —— 几何体
kit.geo.roundedBox(w,h,d,r,seg)
kit.geo.lathe([[半径,高度],...], segments=48)      // 自下而上的轮廓，旋转成杯/瓶/灯罩/腿
kit.geo.tube([[x,y,z],...], radius, {closed, radial, tubular})  // 平滑管：把手、电线、衣架、弹簧
kit.geo.extrude(shape, depth, {bevel, bevelSegments, curveSegments, holes})  // shape: [[x,y],...] 或 THREE.Shape；沿 Z 居中挤出
kit.geo.roundedRectShape(w, h, r)          → THREE.Shape（屏幕、按钮、面板）
kit.geo.cylinder(rTop, rBottom, h, seg, open), kit.geo.sphere(r), kit.geo.torus(R, r, rs, ts, arc)
kit.geo.worldUV(geometry, {grain, tile})   // 给任意几何体做盒式投影 UV
kit.geo.merge([geo, ...])                  // 合并几何体以减少 Mesh 数

// —— 贴图（都是程序化生成的 canvas 贴图）
kit.textures.canvas(w, h, (ctx, w, h) => { ... }, {color:true, repeat:[u,v]})  // 自由绘制：文字、商标、花纹、刻度盘、贴纸
kit.textures.wood({style, base, dark, light, seed, figure, wear}) → {map, roughnessMap, bumpMap}
    style: 'rosewood' | 'walnut' | 'oak' | 'pine' | 'teak' | 'cherry' | 'plywood'
kit.textures.noise({seed, scale, octaves, contrast, bias}) → 灰度 Texture（粗糙度/污渍/凹凸）
kit.textures.fabric({color, color2, weave:'plain'|'twill'|'knit', threads}) → {map, bumpMap}
kit.textures.brushed({direction:'u'|'v'}) → 拉丝纹理

// —— 材质（都可以再传 three.js 材质参数覆盖，如 { color, roughness, map, ... }）
kit.mat.wood({style, base, dark, light, seed, gloss:0~1, figure, wear:0~1, bump})
kit.mat.paint({color, gloss})        // 漆面、搪瓷、烤漆
kit.mat.plastic({color, gloss})
kit.mat.chrome({color, roughness}) / kit.mat.brass({color, aged}) / kit.mat.metal({color, roughness, brushed:'u'|'v'})
kit.mat.glass({color, roughness, opacity}) / kit.mat.mirror()
kit.mat.fabric({color, color2, weave, repeat, sheen}) / kit.mat.leather({color, gloss})
kit.mat.ceramic({color, gloss}) / kit.mat.rubber({color}) / kit.mat.paper({color})
kit.mat.emissive({color, intensity})  // 指示灯、屏幕发光
kit.mat.std(params) / kit.mat.physical(params)  // 直接 new MeshStandard/PhysicalMaterial

// —— 可动部件
const door = kit.hinge(root, parent, { pivot:[x,y,z], axis:'y', open:-1.8, label:'左门' });
//   返回一个位于转轴处的 Group；把门板等以“相对转轴”的坐标加进去。open 为打开角度（弧度，正负决定方向）。
//   绕 y 轴：铰链在左边、门向 +x 延伸 → open 取负值；铰链在右边 → 正值。
const drawer = kit.slider(root, parent, { pos:[x,y,z], axis:'z', distance:0.3, label:'抽屉' });
//   返回 Group，打开时沿 axis 平移 distance 米。
```

## 常用手法

- **贴图上的文字/商标**：`kit.textures.canvas(512, 256, (ctx,w,h)=>{ ctx.fillStyle='#c00'; ctx.font='bold 120px serif'; ctx.fillText('红灯',40,170); })`，
  贴到一个很薄的 plane/box 上，或作为 `map` 用在 `kit.mat.paint({ map })`。中文字体用 `"Microsoft YaHei", "PingFang SC", sans-serif`。
- **搪瓷/陶瓷器**：`kit.geo.lathe` 做出带厚度的杯壁（外轮廓向上、再沿内轮廓向下回到杯底），杯口用小圆弧包边（搪瓷杯的深色包边）。
- **软物（布偶、衣物、坐垫）**：`kit.geo.extrude` 大倒角（bevel 设成厚度的 1/3），或球体/胶囊 `scale` 变形组合。
- **屏幕/玻璃**：玻璃面板用 `kit.mat.glass`；老电视的弧面屏用 `SphereGeometry` 的一小片（phi/theta 限定范围）。
- **电线**：`kit.geo.tube` 加几个自然下垂的控制点。
- **木纹方向**：竖着的板件 `grain:'y'`，横板 `grain:'x'`；对开门想做对称纹理可以把一扇门的 uv.x 镜像（见衣柜范例）。
