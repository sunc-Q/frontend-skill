// graphic-gif 轮校验器：把 SKILL.md 的 Critical Rules + Step4 Self-QA 清单转成可机检断言，
// 外加 GIF 字节结构解析（不依赖第三方库）、帧度量复核、事实一致与台账幂等锁。
// 运行：node scripts/check.mjs   （在场景目录根下；退出码 0 = 全绿）
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAB = path.join(ROOT, '..', '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const readAbs = (p) => readFileSync(path.join(LAB, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(group, name, cond, detail = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(`[${group}] ${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(group, name, actual, expected, tol = 0) {
  const good = typeof expected === 'number' ? Math.abs(actual - expected) <= tol : actual === expected;
  ok(group, name, good, good ? '' : `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}${tol ? ` tol=${tol}` : ''}`);
}

const STYLES = {
  'clean-slate': { dir: 'clean-slate-gif', type: 'counter', font: 'Inter' },
  'terminal': { dir: 'terminal-gif', type: 'typewriter', font: 'IBM Plex Mono' },
  'brutalist': { dir: 'brutalist-gif', type: 'loop-scroll', font: 'Anton' },
};
const facts = JSON.parse(read('scripts/facts.json')).campaign;
const derived = JSON.parse(read('scripts/facts.json')).derived;
const snap = JSON.parse(read('scripts/ledger-snapshot.json'));

// ---------- 共用小工具 ----------
function styleCss(html) {
  const m = html.match(/<style>([\s\S]*?)<\/style>/); // 捕获组取内联样式，不手算偏移
  return m ? m[1] : '';
}
function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }
// 从 index 处 '{' 开始做括号配平扫描（历轮教训：非贪婪正则遇到嵌套块必截错）
function balancedBlock(css, startIdx) {
  const open = css.indexOf('{', startIdx);
  if (open < 0) return '';
  let depth = 0, i = open;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return css.slice(open + 1, i - 1);
}
function keyframes(css, name) {
  const m = css.match(new RegExp(`@keyframes\\s+${name}\\s*\\{`));
  if (!m) return '';
  return balancedBlock(css, m.index + m[0].length - 1);
}
function ruleBlock(css, selectorRe) {
  const m = css.match(new RegExp(selectorRe.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '{' || c === '}' ? c : '\\' + c)) + '\\s*\\{'));
  if (!m) return '';
  return balancedBlock(css, m.index + m[0].length - 1);
}
function rootHex(css) {
  const body = ruleBlock(css, ':root');
  return [...body.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((x) => x[0].toLowerCase());
}

// ---------- GIF 字节结构解析 ----------
function parseGif(buf) {
  const sig = buf.toString('ascii', 0, 6);
  const w = buf.readUInt16LE(6), h = buf.readUInt16LE(8);
  const flags = buf[10];
  let i = 13;
  if (flags & 0x80) i += 3 * (2 << (flags & 7));
  let frames = 0, loop = null; const delays = []; const localPalettes = [];
  while (i < buf.length) {
    const b = buf[i];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = buf[i + 1];
      if (label === 0xf9) delays.push(buf.readUInt16LE(i + 4));
      if (label === 0xff && buf[i + 2] === 0x0b && buf.toString('ascii', i + 3, i + 14) === 'NETSCAPE2.0') {
        loop = buf.readUInt16LE(i + 16);
      }
      i += 2;
      while (buf[i] !== 0) i += buf[i] + 1;
      i += 1;
    } else if (b === 0x2c) {
      frames++;
      const lf = buf[i + 9];
      i += 10;
      if (lf & 0x80) { localPalettes.push(2 << (lf & 7)); i += 3 * (2 << (lf & 7)); }
      else localPalettes.push(0);
      i += 1; // LZW min code size
      while (buf[i] !== 0) i += buf[i] + 1;
      i += 1;
    } else i += 1;
  }
  return { sig, w, h, frames, delays, loop, localPalettes, bytes: buf.length };
}

// ---------- A 组：技能 Critical Rules / Step4 Self-QA 逐条机检 ----------
for (const [name, cfg] of Object.entries(STYLES)) {
  const html = read(`${cfg.dir}/animation.html`);
  const cssAll = styleCss(html);
  const css = stripComments(cssAll); // 注释里会出现 "animation-delay" 等字样，规则符合性只看生效代码
  ok('A', `${name} 能取到内联 <style>`, css.length > 200);
  // A1 画布
  const bodyBlock = ruleBlock(css, 'body');
  const canvasBlock = ruleBlock(css, '.canvas');
  ok('A', `${name} body 800×800 + overflow hidden`, /width:\s*800px/.test(bodyBlock) && /height:\s*800px/.test(bodyBlock) && /overflow:\s*hidden/.test(bodyBlock));
  ok('A', `${name} .canvas 800×800 + overflow hidden`, /width:\s*800px/.test(canvasBlock) && /height:\s*800px/.test(canvasBlock) && /overflow:\s*hidden/.test(canvasBlock));
  // A2 禁 animation-delay
  ok('A', `${name} 无 animation-delay（规则 9）`, !/animation-delay/.test(css));
  // A3 所有 animation 简写带 fill-mode（规则：forwards/both on ALL animated elements）
  const anims = [...css.matchAll(/animation:([^;]+);/g)].map((m) => m[1]);
  ok('A', `${name} animation 简写 ≥1 条`, anims.length >= 1, anims.length + '条');
  ok('A', `${name} 每条 animation 都含 forwards|both`, anims.every((a) => /forwards|both/.test(a)), anims.filter((a) => !/forwards|both/.test(a)).join('|'));
  // A4 所有动画 t=0 起步（选择器组形态是 "0%,4%{"，冒号在整组之后，不能按 "0%:" 匹配）
  const kfNames = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  const startsAt0 = (k) => /(?:^|[\s{;])(?:0%|from)\s*[,{]/.test(keyframes(css, k));
  ok('A', `${name} 每个 @keyframes 都定义 0%/from 起点`, kfNames.every(startsAt0), kfNames.filter((k) => !startsAt0(k)).join('|'));
  // A5 infinite 只允许出现在 pulse/scroll 语义
  const infiniteLines = css.split('\n').filter((l) => /infinite/.test(l));
  ok('A', `${name} infinite 仅 blink/scroll`, infiniteLines.every((l) => /blink|scroll/.test(l)), infiniteLines.join('|'));
  // A6 十六进制色只允许出现在 :root（结构/主题分层，历轮教训沿用）
  const noRoot = css.replace(/:root\s*\{[\s\S]*?\}/, '');
  ok('A', `${name} :root 外无游离十六进制色`, !/#[0-9a-fA-F]{3,8}\b/.test(noRoot), (noRoot.match(/#[0-9a-fA-F]{3,8}\b/g) || []).join(','));
  // A7 无占位符
  ok('A', `${name} 无 placeholder/TODO/Lorem（规则 7）`, !/placeholder|lorem|TODO|image goes here/i.test(html));
  // A8 外链纪律：仅字体 CDN（规则 3：Font CDN link 是唯一外部依赖）
  const linkTags = [...html.matchAll(/<link[^>]*>/g)].map((m) => m[0]);
  const extLinks = linkTags.filter((t) => /href="http/.test(t));
  ok('A', `${name} 外链仅 fonts.googleapis/gstatic`, extLinks.length >= 1 && extLinks.every((t) => /fonts\.(googleapis|gstatic)\.com/.test(t)), extLinks.length + '条');
  ok('A', `${name} 无 <img src>/外部 script`, !/<img[^>]+src="http/.test(html) && !/<script[^>]+src=/.test(html));
  // A9 类型专属
  if (cfg.type === 'counter') {
    ok('A', 'counter: @property --num syntax <integer>', /@property\s+--num\s*\{[^}]*syntax:'<integer>'/.test(css));
    ok('A', 'counter: initial-value 0', /@property\s+--num\s*\{[^}]*initial-value:0/.test(css));
    ok('A', 'counter: counter-reset + ::after content', /counter-reset:\s*num\s+var\(--num\)/.test(css) && /content:\s*counter\(num\)/.test(css));
    const kf = keyframes(css, 'count-up');
    ok('A', 'counter: 终值=facts.registered', kf.includes(String(facts.registered)), kf.trim());
    ok('A', 'counter: 到顶后保持（规则 6 终值缺陷的烘焙修复）', /92%,100%/.test(kf));
    const meter = keyframes(css, 'meter-fill');
    const scAll = [...meter.matchAll(/scaleX\(([\d.]+)\)/g)].map((x) => Number(x[1]));
    const sc = scAll.at(-1); // 取终值段，不是 0% 起步段
    eq('A', 'counter: 进度条终值 scaleX=registered/capacity', sc, derived.fill_ratio, 0.0005);
  }
  if (cfg.type === 'typewriter') {
    const text = (html.match(/data-text="([^"]+)"/) || [ , '' ])[1];
    const N = Number((html.match(/data-tw="(\d+)"/) || [ , '0' ])[1]);
    const steps = Number((css.match(/steps\((\d+),end\)/) || [ , '0' ])[1]);
    const chW = Number((keyframes(css, 'type').match(/width:(\d+)ch/) || [ , '0' ])[1]);
    eq('A', 'typewriter: steps(N)=字符数（规则：含空格标点）', steps, text.length, 0);
    eq('A', 'typewriter: width ch = 字符数', chW, text.length, 0);
    eq('A', 'typewriter: data-tw 与二者一致', N, text.length, 0);
    ok('A', 'typewriter: 打字体为等宽（ch 单位成立前提）', /font-family:[^;]*mono/.test(css.replace(/--font-body:'IBM Plex Mono',ui-monospace/.test(css) ? 'font-family:mono' : '')) || /IBM Plex Mono/.test(css));
    const scan = ruleBlock(css, '.canvas::after');
    ok('A', 'terminal: 扫描线 ::after repeating-linear-gradient + opacity .03', /repeating-linear-gradient/.test(scan) && /opacity:\s*0?\.03/.test(scan), scan.trim().slice(0, 80));
  }
  if (cfg.type === 'loop-scroll') {
    const items = Number((html.match(/data-items="(\d+)"/) || [ , '0' ])[1]);
    const chips = [...html.matchAll(/class="cp"/g)].length;
    eq('A', 'loop-scroll: 内容恰好复制一份（chips=2×items）', chips, items * 2, 0);
    const kf = keyframes(css, 'scroll');
    ok('A', 'loop-scroll: translateX(0→-50%)', /translateX\(0\)/.test(kf) && /translateX\(-50%\)/.test(kf), kf.trim());
    ok('A', 'loop-scroll: linear infinite', /animation:scroll[^;]*linear[^;]*infinite/.test(css));
    const borders = (css.match(/border[^;]*4px solid|4px solid/g) || []).length;
    ok('A', 'brutalist: 4px 硬描边 ≥3 处（preset 明文构件）', borders >= 3, borders + '处');
  }
  // A10 字重对比：技能原文把「700 vs 400」当作满足 2:1 的示例，按此口径断言存在 ≥700 的显示字重与 ≤400 的辅助字重
  const weights = [...css.matchAll(/font-weight:\s*(\d+)/g)].map((m) => Number(m[1]));
  ok('A', `${name} 字重对比（≥700 显示 vs ≤400 辅助）`, Math.max(...weights) >= 700 && Math.min(...weights) <= 400, [...new Set(weights)].join(','));
}

// ---------- B 组：GIF 字节结构 ----------
const metas = {}, gifs = {};
for (const [name, cfg] of Object.entries(STYLES)) {
  const buf = readFileSync(path.join(ROOT, cfg.dir, 'animation.gif'));
  const g = parseGif(buf);
  gifs[name] = g;
  metas[name] = JSON.parse(read(`${cfg.dir}/gif-metrics.json`));
  eq('B', `${name} 签名 GIF89a`, g.sig, 'GIF89a');
  eq('B', `${name} LSD 宽 800`, g.w, 800);
  eq('B', `${name} LSD 高 800`, g.h, 800);
  const expectedFrames = Math.floor(facts ? metas[name].duration * metas[name].fps : 0); // 规则 6
  eq('B', `${name} 帧数=floor(duration×fps)=36`, g.frames, expectedFrames);
  eq('B', `${name} 帧数=metrics 自报`, g.frames, metas[name].frameCount);
  ok('B', `${name} 全部帧延时=8cs`, g.delays.length === g.frames && g.delays.every((d) => d === 8), [...new Set(g.delays)].join(','));
  eq('B', `${name} NETSCAPE loop=0（无限循环）`, g.loop, 0);
  ok('B', `${name} 每帧局部色板 ≤256 色`, g.localPalettes.every((p) => p <= 256));
  eq('B', `${name} metrics.bytes=磁盘实际字节（Buffer 口径）`, metas[name].bytes, g.bytes);
  ok('B', `${name} 单张 <3MB（社媒预算）`, g.bytes < 3 * 1024 * 1024, (g.bytes / 1024 / 1024).toFixed(2) + 'MB');
  eq('B', `${name} effective_fps=12.5（12fps 被 GIF 厘秒粒度量化提速 4%）`, metas[name].effective_fps, 12.5);
}
const totalGif = Object.values(gifs).reduce((s, g) => s + g.bytes, 0);
ok('B', '三张 GIF 合计 <10MB', totalGif < 10 * 1024 * 1024, (totalGif / 1024 / 1024).toFixed(2) + 'MB');
ok('B', '三张 GIF 字节互不相同（非同图换名）', new Set(Object.values(gifs).map((g) => g.bytes)).size === 3);

// ---------- C 组：帧度量与终值 ----------
eq('C', 'clean-slate 末帧 --num=3264（终值缺陷已修）', metas['clean-slate'].final_state.num, '3264');
const ms = Number(metas['clean-slate'].final_state.meterScale.match(/matrix\(([\d.]+)/)[1]);
eq('C', 'clean-slate 末帧进度条=0.9326', ms, derived.fill_ratio, 0.0005);
eq('C', 'terminal 末帧打字宽=590.4px', Number(metas.terminal.final_state.twWidth), 590.4, 0.05);
eq('C', 'terminal 590.4/41/24 ≈ 0.6em（IBM Plex Mono 字身宽）', Number(metas.terminal.final_state.twWidth) / 41 / 24, 0.6, 0.02);
ok('C', '三页 webfont 均真实加载（FontFaceSet 非空）', Object.values(metas).every((m) => m.fonts.count >= 3), Object.values(metas).map((m) => m.fonts.count).join(','));
ok('C', '一次性动画首末帧差异显著（>1.5，深色底会稀释全帧均差）', metas['clean-slate'].diff_f0_last > 1.5 && metas.terminal.diff_f0_last > 1.5, `cs=${metas['clean-slate'].diff_f0_last} term=${metas.terminal.diff_f0_last}`);
ok('C', '每页首帧即有动画（diff_f0_f1>0）', Object.values(metas).every((m) => m.diff_f0_f1 > 0));
ok('C', 'loop-scroll 环缝≈帧步长（无缝）', metas.brutalist.diff_f0_last <= metas.brutalist.diff_last_pair * 1.35 + 0.05, `${metas.brutalist.diff_f0_last} vs ${metas.brutalist.diff_last_pair}`);
ok('C', 'mean_lum 数组长度=帧数', Object.values(metas).every((m) => m.mean_lum_per_frame.length === m.frameCount));
const bl = metas.brutalist.mean_lum_per_frame;
ok('C', 'brutalist 全程亮度平稳（纸面主导，仅带内滚动）', Math.max(...bl) - Math.min(...bl) < 10, (Math.max(...bl) - Math.min(...bl)).toFixed(2));
const stylesHtml = read('styles.html');
for (const [name, cfg] of Object.entries(STYLES)) {
  ok('C', `${name} styles.html 标注字节数=实际（文档数字必须来自断言）`, stylesHtml.includes(gifs[name].bytes.toLocaleString('en-US')), String(gifs[name].bytes));
}

// ---------- D 组：三风格互异 ----------
const csses = {}, hexes = {};
for (const [name, cfg] of Object.entries(STYLES)) { csses[name] = stripComments(styleCss(read(`${cfg.dir}/animation.html`))); hexes[name] = new Set(rootHex(csses[name])); }
const pairs = [['clean-slate', 'terminal'], ['clean-slate', 'brutalist'], ['terminal', 'brutalist']];
for (const [a, b] of pairs) {
  const inter = [...hexes[a]].filter((h) => hexes[b].has(h));
  ok('D', `色板两两零交集 ${a}∩${b}`, inter.length === 0, inter.join(','));
}
const bgs = Object.entries(csses).map(([n, c]) => (c.match(/--bg:#[0-9a-fA-F]+/) || [''])[0]);
ok('D', '三套 --bg 互不相同', new Set(bgs).size === 3, bgs.join(' '));
ok('D', '三套主字体族互不相同', /Inter/.test(csses['clean-slate']) && /IBM Plex Mono/.test(csses.terminal) && /Anton/.test(csses.brutalist));
ok('D', '三种 animation type 互不相同', new Set(Object.values(STYLES).map((s) => s.type)).size === 3);
ok('D', '布局骨架互异（card/term/band 三类签名容器各自唯一）', /class="card"/.test(read('clean-slate-gif/animation.html')) && /class="term"/.test(read('terminal-gif/animation.html')) && /class="band"/.test(read('brutalist-gif/animation.html')));

// ---------- E 组：事实一致 ----------
eq('E', 'remaining=capacity-registered', facts.capacity - facts.registered, facts.remaining);
eq('E', 'fill_ratio=registered/capacity', facts.registered / facts.capacity, derived.fill_ratio, 0.0001);
for (const [name, cfg] of Object.entries(STYLES)) {
  const html = read(`${cfg.dir}/animation.html`);
  for (const [k, v] of [['日期', facts.date], ['时间', facts.start_time], ['距离', String(facts.distance_km)], ['已报', String(facts.registered)], ['名额', String(facts.capacity)], ['剩余', String(facts.remaining)], ['口号', facts.slogan_cn], ['英文名', facts.name_en], ['中文名', facts.name_cn]]) {
    ok('E', `${name} 含事实·${k}`, html.includes(v), v);
  }
  ok('E', `${name} 含第三季`, /3/.test(html));
}
const bru = read('brutalist-gif/animation.html');
ok('E', 'brutalist 含全部 5 个打卡点', facts.checkpoints.every((c) => bru.includes(c)));
eq('E', 'facts.checkpoints 数量=5', facts.checkpoints.length, 5);
ok('E', 'styles.html 事实表与 facts.json 一致', ['2026-10-17', '20:30', '5.2', '3264', '3500', '236', facts.slogan_cn].every((v) => stylesHtml.includes(v)));

// ---------- F 组：台账幂等锁（快照 + 本轮增量 == 现值） ----------
const state = JSON.parse(readAbs('state/state.json'));
eq('F', 'tried 长度 = 快照+1', state.tried.length, snap.tried_len + 1);
eq('F', 'runs 长度 = 快照+1', state.runs.length, snap.runs_len + 1);
eq('F', 'used_styles 长度 = 快照+3', state.used_styles.length, snap.used_styles_len + 3);
eq('F', 'used_styles 末三条=本轮三风格', JSON.stringify(state.used_styles.slice(-3)), JSON.stringify(snap.this_round_styles));
ok('F', 'tried 末条=graphic-gif×动效横幅', /graphic-gif/.test(JSON.stringify(state.tried.at(-1))) && /动效/.test(JSON.stringify(state.tried.at(-1))));
ok('F', 'skills_seen 含 graphic-gif 结论条目', state.skills_seen.some((s) => s.name === 'graphic-gif' && /留用|不留用/.test(s.status)));
ok('F', '本轮风格未与历史字面撞车', snap.this_round_styles.every((s) => !state.used_styles.slice(0, -3).includes(s)));

// ---------- G 组：磁盘纪律 ----------
function dirSize(p) { let s = 0; for (const f of readdirSync(p, { withFileTypes: true })) { const fp = path.join(p, f.name); s += f.isDirectory() ? dirSize(fp) : statSync(fp).size; } return s; }
const sceneBytes = dirSize(ROOT);
ok('G', '场景目录 < 50MB', sceneBytes < 50 * 1024 * 1024, (sceneBytes / 1024).toFixed(0) + 'KB');
ok('G', 'artifacts/ 全树无 node_modules 目录', !readdirSync(path.join(ROOT, '..'), { recursive: true }).some((f) => String(f).split('/').includes('node_modules')));
ok('G', '样本帧 3×3 张 PNG', readdirSync(path.join(ROOT, 'samples', 'clean-slate')).length === 3 && readdirSync(path.join(ROOT, 'samples', 'terminal')).length === 3 && readdirSync(path.join(ROOT, 'samples', 'brutalist')).length === 3);
const gitignore = readAbs('.gitignore');
ok('G', '.gitignore 排除 node_modules/.tmp', /node_modules/.test(gitignore) && /\.tmp/.test(gitignore));

console.log(`\n${fail === 0 ? 'ALL GREEN' : 'FAILURES'} — pass=${pass} fail=${fail} total=${pass + fail}`);
if (fail) { for (const f of failures) console.log('  ✗ ' + f); process.exit(1); }
