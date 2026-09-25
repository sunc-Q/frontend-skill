// 21:00 轮校验脚本（零依赖，node 直接跑）
// 断言组：A 语法 / B 零外链 / C drafter 规则符合性 / D 三风格互异 / E 标注层开关契约
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const pages = ['blueprint-light.html', 'drafting-dark.html', 'spec-sheet.html'];

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}${extra ? '  ' + extra : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${extra ? '  ' + extra : ''}`);
  }
}

const docs = {};
for (const p of pages) docs[p] = fs.readFileSync(path.join(root, p), 'utf8');

function inlineScript(html) {
  // 允许缩进：本页 <script> 前有空格；仍要求行首（只可能有空白）以免误匹配串里的字面量
  const m = /^[ \t]*<script>([\s\S]*?)<\/script>/m.exec(html);
  return m ? m[1] : null;
}

// ---------- A. 内联脚本语法 ----------
for (const p of pages) {
  const js = inlineScript(docs[p]);
  ok(`A/${p} 存在内联脚本`, js !== null);
  if (js === null) continue;
  let syntaxOk = true;
  let err = '';
  try {
    new vm.Script(js);
  } catch (e) {
    syntaxOk = false;
    err = String(e.message).slice(0, 80);
  }
  ok(`A/${p} 内联脚本语法有效`, syntaxOk, err);
}

// ---------- B. 零外链（标签级 + URL 级） ----------
const externalish = /(src|href)\s*=\s*["'](https?:)?\/\//i;
for (const p of pages) {
  const html = docs[p];
  const tags = html.match(/<(link|script|img|iframe|source|video|audio)\b[^>]*>/gi) || [];
  const bad = tags.filter((t) => externalish.test(t));
  ok(`B/${p} 资源标签零外部引用`, bad.length === 0, bad.length ? bad[0].slice(0, 90) : `(${tags.length} 个标签已查)`);
  ok(`B/${p} 无 @import / url(http`, !/@import/i.test(html) && !/url\(["']?https?:/i.test(html));
  ok(`B/${p} 文档自包含（<!DOCTYPE + </html>）`, /^<!DOCTYPE html>/i.test(html.trim()) && /<\/html>\s*$/i.test(html));
}

// ---------- C. drafter 规则符合性 ----------
for (const p of pages) {
  const html = docs[p];
  const styleBlock = (html.match(/<style>([\s\S]*?)<\/style>/i) || [])[1] || '';
  const noShadow = !/box-shadow\s*:/i.test(styleBlock);
  const noGrad = !/linear-gradient|radial-gradient|conic-gradient/i.test(styleBlock);
  const noBlur = !/backdrop-filter|filter\s*:\s*blur/i.test(styleBlock);
  const radiusOnButton = /\.toolbar button[^{]*\{[^}]*border-radius/i.test(styleBlock);
  const uses1to2px = /(1px|2px)\s+solid/.test(styleBlock);
  const systemFonts = /system-ui/.test(styleBlock) && /'SF Mono'|Monaco|Consolas/.test(styleBlock);
  ok(`C/${p} 无阴影`, noShadow);
  ok(`C/${p} 无渐变`, noGrad);
  ok(`C/${p} 无模糊/玻璃`, noBlur);
  ok(`C/${p} 按钮无圆角`, !radiusOnButton);
  ok(`C/${p} 使用 1–2px 实线描边`, uses1to2px);
  ok(`C/${p} 仅系统字体栈（无衬线 + 等宽）`, systemFonts);
  ok(`C/${p} 存在 :root 色板令牌块`, /:root\s*\{[\s\S]*--c-border/.test(styleBlock));
  const hexes = new Set((styleBlock.match(/#[0-9a-fA-F]{3,6}/g) || []).map((s) => s.toLowerCase()));
  const accentLike = [...hexes].filter((h) => /b4453a|d67d5a/.test(h));
  ok(`C/${p} 语义色不超过 1 类`, accentLike.length <= 1, `语义色 ${accentLike.join(',') || '无'}`);
}

// ---------- D. 三风格互异 ----------
function rootTokens(html) {
  const s = (html.match(/<style>([\s\S]*?)<\/style>/i) || [])[1] || '';
  const r = (s.match(/:root\s*\{([\s\S]*?)\}/) || [])[1] || '';
  const o = {};
  for (const m of r.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) o[m[1]] = m[2].trim();
  return o;
}
const t = {};
for (const p of pages) t[p] = rootTokens(docs[p]);

const bgs = new Set(pages.map((p) => t[p]['c-bg']));
ok('D 三页 --c-bg 互不相同', bgs.size === 3, [...bgs].join(' | '));
const borders = new Set(pages.map((p) => t[p]['c-border']));
ok('D 三页 --c-border 互不相同', borders.size === 3, [...borders].join(' | '));
const mains = new Set(pages.map((p) => t[p]['c-text-main']));
ok('D 三页主文本色互不相同', mains.size === 3, [...mains].join(' | '));

// 版式模式互异：A=横向 flex 六联阶段条，B=左栏 sticky 索引 + 右内容，C=三栏印刷网格
const aFlow = /display:\s*flex/.test(docs['blueprint-light.html']) && /\.stage \+ \.stage::before/.test(docs['blueprint-light.html']);
const bRail = /position:\s*sticky/.test(docs['drafting-dark.html']) && /grid-template-columns:\s*218px 1fr/.test(docs['drafting-dark.html']);
const cCols = /grid-template-columns:\s*1fr 1fr 1fr/.test(docs['spec-sheet.html']) && /@media print/.test(docs['spec-sheet.html']);
ok('D 21-A 用横向阶段条 + 箭头连接件', aFlow);
ok('D 21-B 用吸顶左索引栏 + 双列骨架', bRail);
ok('D 21-C 用三栏印刷网格 + 打印规则', cCols);

// 信息架构互异：各页独有的结构标记
ok('D 独有结构：A 六格 flow / B 时间线 / C ASCII 图 + 签署条',
  /\.tl-track/.test(docs['drafting-dark.html']) &&
  /<pre class="art">/.test(docs['spec-sheet.html']) &&
  /\.sheet-head/.test(docs['spec-sheet.html']) &&
  !/\.sheet-head/.test(docs['blueprint-light.html']) &&
  !/\.tl-track/.test(docs['blueprint-light.html']));

// 同一交互契约（标注开关）在三页都成立
for (const p of pages) {
  const js = inlineScript(docs[p]) || '';
  ok(`D/${p} 共享标注开关契约`, js.includes("data-annot") && js.includes("aria-pressed"));
  ok(`D/${p} 标注基态默认隐藏且不塌主布局`, /\.annotation\s*\{\s*display:\s*none|\.rev\s*\{\s*display:\s*none/.test(docs[p]));
}

// ---------- E. 体积与外链文案 ----------
let total = 0;
for (const p of pages) {
  const bytes = fs.readFileSync(path.join(root, p)).length;
  total += bytes;
  ok(`E/${p} 单页 < 200KB`, bytes < 200 * 1024, `${bytes} 字节`);
}
ok('E 三页合计 < 50MB', total < 50 * 1024 * 1024, `合计 ${total} 字节`);

// ---------- F. 内容同题（三风格必须讲同一张图，不能各说各话） ----------
const phases = ['读记忆', '选题', '构建', '校验', '收尾', '推送'];
const gates = ['G1', 'G2', 'G3', 'G4'];
for (const p of pages) {
  const html = docs[p];
  const missP = phases.filter((k) => !html.includes(k));
  ok(`F/${p} 覆盖六阶段`, missP.length === 0, missP.length ? `缺 ${missP.join(',')}` : '');
  // 别名映射必须覆盖每个键：曾把 G4 映射成 'G4' 自身，导致 21-A（编号 B1..B4）恒判 3/4
  const alias = { G1: 'B1', G2: 'B2', G3: 'B3', G4: 'B4' };
  const hitG = gates.filter((k) => html.includes(k) || html.includes(alias[k]));
  ok(`F/${p} 覆盖四道去重闸`, hitG.length === 4, `命中 ${hitG.length}/4`);
  ok(`F/${p} 含环境约束（SSH / npmmirror 至少其一）`, html.includes('SSH') || html.includes('npmmirror'));
  ok(`F/${p} 含体积上限条款`, html.includes('50MB') || html.includes('50 MB'));
}

// ---------- G. 页面里抄写的台账数字必须与开工快照互查 ----------
// 教训：这类数字手抄必错（首稿把 environment_notes 写成 31、next_candidates 写成 9，实际 38 / 10）。
// 快照优先于「读盘反推」：反推要写死本轮新增几条，台账之后每被补记一次就失真 ——
// 本轮就发生过（收尾后追加了 1 条环境注，-5 立刻变 -6）。故以 ledger-snapshot.json 为唯一口径。
const lab = path.join(root, '..', '..', 'state', 'state.json');
const snap = path.join(here, 'ledger-snapshot.json');
if (fs.existsSync(snap)) {
  const pre = JSON.parse(fs.readFileSync(snap, 'utf8'));
  const claimed = (html) => {
    const o = {};
    for (const m of html.matchAll(/class="mono">(\w+)\[\]<\/td>[\s\S]*?class="num">(\d+)/g)) o[m[1]] = +m[2];
    return o;
  };
  const c = claimed(docs['blueprint-light.html']);
  for (const k of ['tried', 'used_styles', 'skills_seen', 'environment_notes', 'runs', 'next_candidates']) {
    ok(`G 21-A ${k} 与开工快照一致`, c[k] === pre[k], `页面 ${c[k]} / 快照 ${pre[k]}`);
  }
  ok('G 21-B 声称的已用风格数与开工快照一致', docs['drafting-dark.html'].includes(String(pre.used_styles) + ' 项已占用'), `快照 ${pre.used_styles}`);
  if (fs.existsSync(lab)) {
    const st = JSON.parse(fs.readFileSync(lab, 'utf8'));
    const thisRun = (st.tried || []).find((x) => String(x.skill).startsWith('drafter') && x.time === '2026-09-25T21:00+08:00');
    ok('G 台账已记入本轮组合（drafter × 架构说明页）', !!thisRun);
    ok('G 台账本轮新增 3 个风格', !!thisRun && thisRun.styles.length === 3, thisRun ? thisRun.styles.join(' / ') : '');
    ok('G 台账规模只增不减', (st.tried || []).length > pre.tried && (st.used_styles || []).length > pre.used_styles,
      `tried ${(st.tried || []).length} / styles ${(st.used_styles || []).length}`);
  } else {
    ok('G 找不到 state/state.json，台账回写未验证', false, lab);
  }
} else {
  ok('G 缺少开工快照 scripts/ledger-snapshot.json，抄写数字无法互查', false);
}

console.log(`\n断言 ${pass} 通过 / ${fail} 失败 / 共 ${pass + fail}`);
process.exit(fail ? 1 : 0);