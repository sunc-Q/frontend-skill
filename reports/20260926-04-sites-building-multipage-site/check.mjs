// 20260926-04 多页站点校验器：static-site.md「目录式多页 / spa 语义 / 打包限制」条款断言
// 用法：node .tmp/check.mjs （自起自停 4317/4318 两个临时服务器）
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const OUT = join(import.meta.dirname, '..', 'artifacts', '20260926-04-sites-building-multipage-site');
const STYLES = ['acid-gfx', 'art-nouveau', 'dark-academia'];
const PAGEDIRS = ['', 'releases', 'release', 'about'];
const RESERVED = ['/api', '/internal', '/__qoder_auth', '/__qoder_internal', '/functions', '/storage', '/rest/v1', '/supabase'];
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log(`PASS ${name}${extra ? ' | ' + extra : ''}`); }
  else { fail++; console.log(`FAIL ${name}${extra ? ' | ' + extra : ''}`); }
};

function walk(dir) {
  return readdirSync(dir).flatMap(e => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(OUT);
const htmls = files.filter(f => f.endsWith('.html'));

/* ---------- A. 链接完整性 ---------- */
const RESERVED_RE = new RegExp('(["\'(])(' + RESERVED.map(r => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')/');
let linkCount = 0, allLinksOk = true, dirUrlHits = [], absHits = [], extHits = [], reservedHits = [], missing = [];
for (const f of htmls) {
  const src = readFileSync(f, 'utf8');
  const refs = [...src.matchAll(/(?:href|src)="([^"]+)"/g)].map(m => m[1]);
  for (const r of refs) {
    linkCount++;
    if (/^https?:/i.test(r)) { extHits.push(`${relative(OUT, f)} -> ${r}`); continue; }
    if (r.startsWith('mailto:') || r.startsWith('#')) continue;
    if (RESERVED_RE.test(src)) reservedHits.push(relative(OUT, f));
    if (r.startsWith('/')) absHits.push(`${relative(OUT, f)} -> ${r}`);
    if (r.endsWith('/') || !/[^/]+$/.test(r.split('#')[0])) dirUrlHits.push(`${relative(OUT, f)} -> ${r}`);
    const target = resolve(dirname(f), r.split('#')[0]);
    if (!statOrNothrow(target)) missing.push(`${relative(OUT, f)} -> ${r}`);
  }
}
function statOrNothrow(p) { try { return statSync(p).isFile(); } catch { return false; } }
ok(extHits.length === 0, 'A1 零外部 http(s) 链接', `外链 ${extHits.length}`);
ok(absHits.length === 0, 'A2 无根绝对路径（file:// 与根托管同时可用）', absHits.join('; '));
ok(dirUrlHits.length === 0, 'A3 无目录式 URL 假设（全部显式 index.html 文件链接）', dirUrlHits.join('; '));
ok(missing.length === 0, 'A4 所有内部链接指向真实文件', `缺链 ${missing.join('; ') || '无'}，共 ${linkCount} 条链接`);
ok(reservedHits.length === 0, 'A5 未占用平台保留命名空间', reservedHits.join('; '));

/* ---------- B. 从首页 BFS 可达全部页面 ---------- */
let bfsOk = true, bfsDetail = '';
for (const st of STYLES) {
  const seen = new Set(), q = [join(OUT, st, 'index.html')];
  while (q.length) {
    const cur = q.shift();
    if (seen.has(cur)) continue; seen.add(cur);
    if (!cur.endsWith('.html')) continue;
    const src = readFileSync(cur, 'utf8');
    for (const m of src.matchAll(/href="([^"#]+)"/g)) {
      const r = m[1];
      if (/^https?:|^mailto:/.test(r)) continue;
      const t = resolve(dirname(cur), r);
      if (statOrNothrow(t)) q.push(t);
    }
  }
  const htmlSeen = [...seen].filter(s => s.endsWith('.html'));
  const expect = PAGEDIRS.map(d => join(OUT, st, d, 'index.html'));
  const miss = expect.filter(e => !htmlSeen.includes(e));
  if (miss.length) { bfsOk = false; bfsDetail += `${st} 不可达: ${miss.map(m => relative(OUT, m)).join(',')} `; }
}
ok(bfsOk, 'B 首页 BFS 可达全部 4 页（每风格）', bfsDetail);

/* ---------- C. 内联 JS 语法 ---------- */
let jsOk = true, jsCount = 0, jsErr = '';
for (const f of htmls) {
  for (const m of htmlSrc(f).matchAll(/^<script>([\s\S]*?)<\/script>/gm)) {
    jsCount++;
    try { new vm.Script(m[1]); } catch (e) { jsOk = false; jsErr += `${relative(OUT, f)}: ${e.message} `; }
  }
}
function htmlSrc(f) { return readFileSync(f, 'utf8'); }
ok(jsOk && jsCount === 6, 'C 内联 <script> 语法检查（行首匹配正则，2 页 × 3 风格 = 6 段）', `段数 ${jsCount}${jsErr ? ' 错误: ' + jsErr : ''}`);

/* ---------- D. 纯函数行为断言（从 releases/release 页提取 PURE 段执行） ---------- */
const relSrc = htmlSrc(join(OUT, STYLES[0], 'releases', 'index.html'));
const pureR = relSrc.match(/\/\*PURE-BEGIN\*\/([\s\S]*?)\/\*PURE-END\*\//)[1];
const ctxR = vm.createContext({});
vm.runInContext(pureR + ';this.API={RELEASES,applyFilters,render};', ctxR);
const API = ctxR.API;
ok(API.RELEASES.length === 6, 'D1 目录数据 6 张');
const amb = API.applyFilters(API.RELEASES, '氛围', false);
ok(amb.length === 2 && amb.every(r => r.tag === '氛围'), 'D2 流派筛选「氛围」→2 张且全对');
const oldFirst = API.applyFilters(API.RELEASES, '全部', false);
const newFirst = API.applyFilters(API.RELEASES, '全部', true);
ok(oldFirst[0].id === 'YZ-001' && oldFirst[5].id === 'YZ-006', 'D3 旧→新排序首尾正确');
ok(newFirst[0].id === 'YZ-006' && newFirst[5].id === 'YZ-001', 'D4 新→旧排序首尾正确');
const sameYear = API.applyFilters([{ id: 'B', year: 2020, no: 2, tag: '全部' }, { id: 'A', year: 2020, no: 1, tag: '全部' }], '全部', true);
ok(sameYear[0].id === 'A', 'D5 同年份按编号稳定次级排序');
ok(API.applyFilters(API.RELEASES, '不存在', false).length === 0, 'D6 未知流派→空集');
const rendered = API.render(API.RELEASES);
ok((rendered.match(/<li class="card">/g) || []).length === 6, 'D7 render 输出 6 张卡');
ok((rendered.match(/href="\.\.\/release\/index\.html"/g) || []).length === 1, 'D8 仅精选唱片有详情链接（显式文件链接）');
const emptyHtml = API.render([]);
ok(emptyHtml.includes('该流派下暂无唱片'), 'D9 空态文案存在');
const featSrc = htmlSrc(join(OUT, STYLES[0], 'release', 'index.html'));
const pureF = featSrc.match(/\/\*PURE-BEGIN\*\/([\s\S]*?)\/\*PURE-END\*\//)[1];
const ctxF = vm.createContext({});
vm.runInContext(pureF + ';this.API={TRACKS,totalSec,fmt,renderTracks};', ctxF);
const F = ctxF.API;
ok(F.TRACKS.length === 8, 'D10 曲目 8 段');
ok(F.fmt(F.totalSec(F.TRACKS)) === '41:31' && F.totalSec(F.TRACKS) === F.TRACKS.reduce((a, t) => a + t.sec, 0), 'D11 总长自证：逐行求和一致且为 41:31', 'got ' + F.fmt(F.totalSec(F.TRACKS)));
ok((F.renderTracks(F.TRACKS).match(/<li>/g) || []).length === 8, 'D12 renderTracks 8 行');

/* ---------- E. 三风格 DOM 逐字节一致 ---------- */
let domOk = true, domDetail = '';
for (const d of PAGEDIRS) {
  const buf = STYLES.map(st => readFileSync(join(OUT, st, d, 'index.html')));
  const h = buf.map(b => createHash('sha256').update(b).digest('hex').slice(0, 12));
  if (new Set(h).size !== 1) { domOk = false; domDetail += `/${d || 'index'}: ${h.join('≠')} `; }
}
ok(domOk, 'E 每页三风格 DOM+内联 JS 逐字节一致（风格全在 CSS 层）', domDetail);

/* ---------- F. 色板互斥与分层 ---------- */
const palettes = {};
for (const st of STYLES) {
  const css = htmlSrc(join(OUT, st, 'assets', 'site.css'));
  palettes[st] = new Set((css.match(/#[0-9a-fA-F]{6}/gi) || []).map(c => c.toLowerCase()));
  const body = css.replace(/:root\s*\{[\s\S]*?\}/, '');
  const outside = body.match(/#[0-9a-fA-F]{3,8}/gi);
  ok(!outside, `F2 ${st} 去 :root 后 CSS 不出现裸十六进制色（色板全部走变量）`, outside ? outside.join(',') : '');
}
ok(STYLES.every(st => palettes[st].size >= 8), 'F1 每风格色板 ≥8 色', STYLES.map(s => `${s}:${palettes[s].size}`).join(' '));
for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
  const inter = [...palettes[STYLES[i]]].filter(c => palettes[STYLES[j]].has(c));
  ok(inter.length <= 2, `F3 色板互斥 ${STYLES[i]}∩${STYLES[j]} ≤2 色`, '交集: ' + (inter.join(',') || '∅'));
}
let inlineStyleHits = [];
for (const f of htmls) if (/style="/.test(htmlSrc(f)) || /#[0-9a-f]{6}/i.test(htmlSrc(f).replace(/href="[^"]*"/g, ''))) inlineStyleHits.push(relative(OUT, f));
ok(inlineStyleHits.length === 0, 'F4 HTML 结构层零内联样式零颜色值', inlineStyleHits.join(';'));

/* ---------- G. fixture 诚实声明（copy 条款） ---------- */
const footOk = htmls.every(f => htmlSrc(f).includes('设计样例'));
ok(footOk, 'G 每页脚注声明内容为虚构样例（不把 fixture 呈现为真实）');

/* ---------- H. 结构/可访问性 ---------- */
let hOk = true, hDetail = '';
for (const f of htmls) {
  const src = htmlSrc(f);
  const h1 = (src.match(/<h1[ >]/g) || []).length;
  const nav = (src.match(/aria-current="page"/g) || []).length;
  if (h1 !== 1 || nav !== 1 || !src.includes('lang="zh-CN"') || !/<meta name="description" content=".+">/.test(src) || !/<title>.+<\/title>/.test(src)) {
    hOk = false; hDetail += `${relative(OUT, f)}(h1=${h1},current=${nav}) `;
  }
}
ok(hOk, 'H 每页单 h1 / 单 aria-current / lang / title / meta description');

/* ---------- I. 打包限制 ---------- */
const totalBytes = files.reduce((s, f) => s + statSync(f).size, 0);
const maxFile = Math.max(...files.map(f => statSync(f).size));
ok(files.length === 15, 'I1 文件数 15（3 风格 × (4 页 + 1 CSS)）', `${files.length} files`);
ok(totalBytes < 50 * 1024 * 1024 && maxFile < 50 * 1024 * 1024, 'I2 总量与单文件均远低于打包上限', `总 ${totalBytes} B，最大单文件 ${maxFile} B`);

/* ---------- J. 路由语义探针：目录索引关闭 vs SPA fallback ---------- */
function makeServer({ dirIndex, spaFallback }) {
  return createServer((req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    const file = resolve(OUT, '.' + path);
    if (!file.startsWith(OUT)) { res.writeHead(403); res.end(); return; }
    if (path.endsWith('/') && !dirIndex && statOrNothrow(join(file, 'index.html'))) {
      res.writeHead(spaFallback ? 200 : 404, { 'content-type': 'text/html' });
      res.end(spaFallback ? htmlSrc(join(OUT, STYLES[0], 'index.html')) : 'NOT FOUND');
      return;
    }
    if (statOrNothrow(file)) { res.writeHead(200, { 'content-type': guessType(file) }); res.end(htmlSrc(file)); return; }
    if (spaFallback) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(htmlSrc(join(OUT, STYLES[0], 'index.html'))); return; }
    res.writeHead(404); res.end('NOT FOUND');
  });
}
function guessType(f) { return f.endsWith('.css') ? 'text/css' : 'text/html'; }
const noIndex = makeServer({ dirIndex: false, spaFallback: false });
const spa = makeServer({ dirIndex: false, spaFallback: true });
await new Promise(r => noIndex.listen(4317, '127.0.0.1', r));
await new Promise(r => spa.listen(4318, '127.0.0.1', r));
const get = async (port, p) => { const res = await fetch(`http://127.0.0.1:${port}${p}`); return { code: res.status, type: res.headers.get('content-type') || '', body: await res.text() }; };
// J1: 目录索引禁用下，站内全部实际链接必须 200
let allRoutes = [];
for (const st of STYLES) for (const d of PAGEDIRS) allRoutes.push(`/${st}/${d ? d + '/' : ''}index.html`);
allRoutes.push(`/${STYLES[0]}/assets/site.css`);
const probeAll = await Promise.all(allRoutes.map(p => get(4317, p)));
ok(probeAll.every(r => r.code === 200), `J1 标准静态语义(spa:false+目录索引关)下 ${allRoutes.length} 个真实路径全 200`);
const dirUrl = await get(4317, '/acid-gfx/releases/');
ok(dirUrl.code === 404, 'J2 危险实锤：目录 URL /acid-gfx/releases/ 在目录索引禁用时 404（必须显式文件链接）', `code=${dirUrl.code}`);
const missingPath = await get(4317, '/acid-gfx/nope.html');
ok(missingPath.code === 404, 'J3 标准静态站缺失路径 →404（spa:false 语义）', `code=${missingPath.code}`);
const spaMissing = await get(4318, '/acid-gfx/nope.html');
ok(spaMissing.code === 200 && spaMissing.body.includes('把潮水'), 'J4 SPA fallback 对缺失路径返回 200+首页 HTML（文档「200 不证明加载正确」实演）', `code=${spaMissing.code}`);
// J5: python http.server（带目录索引）会掩盖 J2 —— 起 python 对比
const py = spawn('python3', ['-m', 'http.server', '4319', '--bind', '127.0.0.1', '--directory', OUT]);
await new Promise(r => setTimeout(r, 700));
const pyDir = await get(4319, '/acid-gfx/releases/');
ok(pyDir.code === 200, 'J5 本地 python http.server 对 /releases/ 返回 200 —— 本地预览会掩盖生产「目录索引禁用」的 404，验收必须以显式文件链接为准', `code=${pyDir.code}`);
py.kill(); noIndex.close(); spa.close();

/* ---------- 汇总 ---------- */
console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
const bytes = {};
for (const st of STYLES) bytes[st] = walk(join(OUT, st)).reduce((s, f) => s + Buffer.byteLength(readFileSync(f)), 0);
console.log('per-style bytes:', JSON.stringify(bytes), 'total:', files.reduce((s, f) => s + statSync(f).size, 0));
process.exit(fail ? 1 : 0);
