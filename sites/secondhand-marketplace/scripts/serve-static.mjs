#!/usr/bin/env node
// 校验用静态服务器：直接托管 vite 产物（含 assets/*.js 的 module 加载），
// 并注入 window.__API_BASE__ 指向真实后端，让页面走真接口。
// 用法：node scripts/serve-static.mjs <目录> <端口> <API基址>
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';

const root = process.argv[2];
const port = Number(process.argv[3] || 8092);
const apiBase = process.argv[4] || '';
if (!root) {
  console.error('用法: node serve-static.mjs <目录> <端口> <API基址>');
  process.exit(2);
}
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let p = normalize(decodeURIComponent(url.pathname));
  // 目录请求补 index.html：托管 root 是相对目录时，join(dir,'/') 会指到目录本身，
  // readFile 直接 EISDIR → 首页 404（第一轮就撞在这个坑上）。
  if (p === '/' || p.endsWith('/')) p = join(p, 'index.html');
  if (p.includes('..')) {
    res.writeHead(400).end('bad path');
    return;
  }
  let file = join(root, p);
  try {
    let body = await readFile(file);
    let type = MIME[extname(file)] ?? 'application/octet-stream';
    if (extname(file) !== '.html') {
      res.writeHead(200, { 'content-type': type });
      res.end(body);
      return;
    }
    const inject = `<script>window.__API_BASE__=${JSON.stringify(apiBase)};</script>`;
    let html = body.toString('utf8');
    const theme = url.searchParams.get('theme');
    const themeTag = theme ? `<script>window.__THEME__=${JSON.stringify(theme)};</script>` : '';
    html = html.replace('<head>', `<head>\n    ${inject}${themeTag}`);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`static ${root} -> http://127.0.0.1:${port}/  api=${apiBase}`);
});
