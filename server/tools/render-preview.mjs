#!/usr/bin/env node
// 用无头 Edge/Chrome 打开 /render.html，渲染四视角预览图并保存为 data/items/<id>/preview.png
// 用法：node server/tools/render-preview.mjs <藏品id> [--port 5344]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ITEMS = path.resolve(__dirname, '../../data/items');

const id = process.argv[2];
const portArg = process.argv.indexOf('--port');
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : Number(process.env.PORT || 5344);
if (!id || !/^[a-z0-9][a-z0-9-]{2,60}$/.test(id)) { console.error('用法：node render-preview.mjs <藏品id> [--port 5344]'); process.exit(2); }

function findBrowser() {
  const cands = [
    process.env.BROWSER_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
  ].filter(Boolean);
  return cands.find(p => fs.existsSync(p));
}

const browser = findBrowser();
if (!browser) { console.error('找不到 Edge/Chrome，无法渲染预览（可设置环境变量 BROWSER_PATH）'); process.exit(3); }

const dir = path.join(ITEMS, id);
const png = path.join(dir, 'preview.png');
const errFile = path.join(dir, 'preview-error.txt');
const before = fs.existsSync(png) ? fs.statSync(png).mtimeMs : 0;
try { fs.unlinkSync(errFile); } catch { /* 无 */ }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shiguang-render-'));
const url = `http://127.0.0.1:${port}/render.html?id=${id}&post=1&t=${Date.now()}`;
const proc = spawn(browser, [
  '--headless=new', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--hide-scrollbars', '--window-size=1600,1300',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  url,
], { stdio: 'ignore', windowsHide: true });

const t0 = Date.now();
const timer = setInterval(() => {
  const done = fs.existsSync(png) && fs.statSync(png).mtimeMs > before;
  const failed = fs.existsSync(errFile);
  if (done || failed || Date.now() - t0 > 120000) {
    clearInterval(timer);
    proc.kill();
    setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 浏览器可能还占着文件 */ } }, 1500);
    if (done) { console.log(`✅ 预览已生成：${png}\n   请用 Read 查看这张图，与原始照片逐项对比。`); process.exit(0); }
    if (failed) { console.log(`❌ 浏览器里构建模型出错：\n${fs.readFileSync(errFile, 'utf8').slice(0, 1500)}`); process.exit(1); }
    console.log('❌ 渲染超时（120 秒），请确认回忆馆服务器正在运行'); process.exit(1);
  }
}, 500);
