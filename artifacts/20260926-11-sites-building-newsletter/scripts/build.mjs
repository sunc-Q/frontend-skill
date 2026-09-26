import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url)); // scripts/
const DIR = path.join(ROOT, '..');                          // scene dir
const SRC = path.join(DIR, 'src');
const read = (p) => fs.readFileSync(p, 'utf8');

const SKINS = [
  { id: 'airmail', label: '航空信封', note: '牛皮纸底 + 红蓝斜纹航空边 + 圆形邮戳名牌 + 虚线信封盖 + 打字体编号' },
  { id: 'botanical', label: '植物图鉴图版', note: '米白图版卡 + 双线规约 + 小型大写花体题名 + 「图版/标本/注解」前缀 + 发丝分隔线' },
  { id: 'funk', label: '七十年代放克', note: '芥末橙棕三色带 + 22px 大圆角 + 同心拱饰 + 硬投影按钮 + 歪斜描边标题' },
];

const body = read(path.join(SRC, 'body.html'));
const app = read(path.join(SRC, 'app.js'));
const base = read(path.join(SRC, 'base.css'));

function escScript(s) {
  return s.replace(/<\/script/gi, '<\\/script');
}

const built = [];
for (const skin of SKINS) {
  const css = base + '\n' + read(path.join(SRC, 'skins', skin.id + '.css'));
  const html = [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>离线信号 OFFLINE SIGNAL · 一封关于不需要网络的技术的周报</title>',
    '<meta name="description" content="离线信号：每周四早 07:00 发信，讲本地优先工具、离线写作与不依赖云的工作流。已有 3,842 人订阅。">',
    '<style>' + css + '</style>',
    '</head>',
    '<body data-skin="' + skin.id + '">',
    body,
    '<script>' + escScript(app) + '</script>',
    '</body>',
    '</html>',
  ].join('\n');
  const out = path.join(DIR, skin.id + '.html');
  fs.writeFileSync(out, html);
  built.push({ id: skin.id, bytes: Buffer.byteLength(html) });
  console.log(skin.id + '.html', Buffer.byteLength(html), 'bytes');
}

// styles.html 对照入口：数字由构建现打印
const cards = SKINS.map((s, i) => [
  '<article class="card">',
  '  <h2>' + s.label + ' <code>' + s.id + '</code></h2>',
  '  <p>' + s.note + '</p>',
  '  <p class="size">' + built[i].bytes.toLocaleString('en-US') + ' 字节 · 单文件 · 双击即开 · 零外链</p>',
  '  <p><a class="open" href="./' + s.id + '.html">打开 ' + s.id + '.html</a></p>',
  '</article>',
].join('\n')).join('\n');

fs.writeFileSync(path.join(DIR, 'styles.html'), [
  '<!doctype html>',
  '<html lang="zh-CN">',
  '<head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>离线信号 · 三风格对照</title>',
  '<style>',
  'body{margin:0;background:#efe9dc;color:#241f17;font:16px/1.7 Georgia,"Songti SC",serif;padding:48px 20px}',
  'h1{font-size:26px;margin:0 0 6px}.sub{color:#6d6353;margin:0 0 28px}',
  '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));gap:18px;max-width:960px;margin:0 auto}',
  '.card{background:#fffdf6;border:1px solid #d5cbb2;padding:20px 22px;border-radius:4px}',
  '.card h2{font-size:18px;margin:0 0 8px}code{font:12px "Courier New",monospace;color:#6d6353}',
  '.size{font:12px "Courier New",monospace;color:#6d6353}',
  '.open{display:inline-block;margin-top:6px;padding:8px 16px;border:1px solid #241f17;text-decoration:none;color:#241f17}',
  '</style></head>',
  '<body>',
  '<div style="max-width:960px;margin:0 auto 24px"><h1>离线信号 OFFLINE SIGNAL · 订阅落地页三风格</h1>',
  '<p class="sub">sites:sites-building（Simple site 静态路径）· 2026-09-26 11:00 轮 · 三页共享同一 body 与同一内联脚本，仅 <code>&lt;style&gt;</code> 不同</p></div>',
  '<div class="grid">',
  cards,
  '</div></body></html>',
].join('\n'));
console.log('styles.html written');
