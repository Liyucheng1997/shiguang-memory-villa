#!/usr/bin/env node
// 校验一个藏品模型文件：能否导入、build() 是否成功、尺寸/面数/材质/部件统计。
// 用法：node server/tools/check-model.mjs <model.js 路径> [--json]
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { createKit } from '../../public/js/kit.js';

export async function checkModel(file) {
  const report = { ok: false, errors: [], warnings: [] };
  const t0 = Date.now();
  let mod;
  try {
    mod = await import(pathToFileURL(path.resolve(file)).href + `?t=${Date.now()}`);
  } catch (e) {
    report.errors.push(`导入失败（语法错误或 import 了不存在的模块）：${e.message}`);
    return report;
  }
  if (typeof mod.default !== 'function') {
    report.errors.push('model.js 必须 `export default function build(THREE, kit)`');
    return report;
  }
  let root;
  try {
    root = mod.default(THREE, createKit(THREE));
  } catch (e) {
    report.errors.push(`build() 运行出错：${e.stack?.split('\n').slice(0, 4).join(' | ')}`);
    return report;
  }
  if (!root || !root.isObject3D) {
    report.errors.push('build() 必须返回 THREE.Object3D（通常是 THREE.Group）');
    return report;
  }
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let meshes = 0, tris = 0, nanFound = false;
  const materials = new Set();
  root.traverse(o => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    const pos = g.attributes.position;
    if (!pos) { report.errors.push(`网格 "${o.name}" 没有 position 属性`); return; }
    for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) { nanFound = true; break; }
    tris += g.index ? g.index.count / 3 : pos.count / 3;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => materials.add(m));
    g.computeBoundingBox();
    box.union(g.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  if (nanFound) report.errors.push('存在 NaN/Infinity 顶点坐标');
  if (!meshes) report.errors.push('模型里没有任何 Mesh');
  const size = box.getSize(new THREE.Vector3());
  const r3 = v => Math.round(v * 1000) / 1000;
  report.boundingBox = { min: [r3(box.min.x), r3(box.min.y), r3(box.min.z)], max: [r3(box.max.x), r3(box.max.y), r3(box.max.z)] };
  report.size = [r3(size.x), r3(size.y), r3(size.z)];
  report.meshes = meshes;
  report.triangles = Math.round(tris);
  report.materials = materials.size;
  report.parts = (root.userData.parts || []).map(p => ({ label: p.label, type: p.type, axis: p.axis, open: p.open }));
  report.buildMs = Date.now() - t0;
  report.info = mod.info || null;

  if (Math.abs(box.min.y) > 0.02) report.warnings.push(`模型最低点 y=${r3(box.min.y)}，应当贴地（≈0）`);
  if (Math.abs((box.min.x + box.max.x) / 2) > Math.max(0.05, size.x * 0.1) || Math.abs((box.min.z + box.max.z) / 2) > Math.max(0.05, size.z * 0.15))
    report.warnings.push('模型水平方向没有居中于原点');
  if (Math.max(size.x, size.y, size.z) > 6) report.warnings.push('尺寸超过 6 米，单位应为米，请检查');
  if (Math.max(size.x, size.y, size.z) < 0.01) report.warnings.push('尺寸小于 1 厘米，请检查单位');
  if (tris > 600000) report.warnings.push(`三角面 ${Math.round(tris)} 过多（建议 < 300k）`);
  if (meshes > 1500) report.warnings.push(`Mesh 数 ${meshes} 过多（建议 < 800，可合并或用 InstancedMesh）`);
  if (mod.info?.dimensions) {
    const d = mod.info.dimensions;
    const off = d.map((v, i) => Math.abs(v - size.toArray()[i]) / Math.max(v, 0.01));
    if (Math.max(...off) > 0.15) report.warnings.push(`info.dimensions ${JSON.stringify(d)} 与实际包围盒 ${JSON.stringify(report.size)} 相差超过 15%`);
  }
  report.ok = report.errors.length === 0;
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) { console.error('用法：node check-model.mjs <model.js>'); process.exit(2); }
  const r = await checkModel(file);
  if (process.argv.includes('--json')) console.log(JSON.stringify(r));
  else {
    console.log(r.ok ? '✅ 模型可以正常构建' : '❌ 模型有错误');
    for (const e of r.errors) console.log('  错误：' + e);
    for (const w of r.warnings) console.log('  警告：' + w);
    if (r.size) console.log(`  尺寸(宽×高×深)：${r.size.join(' × ')} 米 | Mesh ${r.meshes} | 三角面 ${r.triangles} | 材质 ${r.materials} | 可动部件 ${r.parts.map(p => p.label).join('、') || '无'} | 构建 ${r.buildMs}ms`);
  }
  process.exit(r.ok ? 0 : 1);
}
