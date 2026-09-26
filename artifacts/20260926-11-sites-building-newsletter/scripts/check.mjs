import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(ROOT, '..');
const LAB = path.join(DIR, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8');
const bytes = (s) => Buffer.byteLength(s, 'utf8');

const results = [];
let failed = 0;
function ok(group, id, pass, detail) {
  results.push({ group, id, pass, detail: detail || '' });
  if (!pass) { failed++; console.log('FAIL [' + group + '] ' + id + ' :: ' + (detail || '')); }
}

const SKINS = ['airmail', 'botanical', 'funk'];
const appSrc = read(path.join(DIR, 'src', 'app.js'));
const baseSrc = read(path.join(DIR, 'src', 'base.css'));

const pages = {};
for (const s of SKINS) {
  const html = read(path.join(DIR, s + '.html'));
  const styleM = html.match(/<style>([\s\S]*?)<\/style>/);
  const scriptM = html.match(/^[ \t]*<script>([\s\S]*?)<\/script>/m);
  const bodyM = html.match(/<body[^>]*>([\s\S]*?)\n<script>/);
  pages[s] = {
    html,
    bytes: bytes(html),
    style: styleM ? styleM[1] : null,
    script: scriptM ? scriptM[1] : null,
    bodyRegion: bodyM ? bodyM[1] : null,
  };
}

/* ---------- A 自包含与结构一致 ---------- */
for (const s of SKINS) {
  const p = pages[s];
  ok('A', s + '/singleStyle', (p.html.match(/<style>/g) || []).length === 1);
  ok('A', s + '/hasInlineScript', !!p.script);
  ok('A', s + '/noLinkTag', !/<link\b/i.test(p.html));
  ok('A', s + '/noSrcAttr', !/<[a-z]+[^>]*\ssrc=/i.test(p.html));
  ok('A', s + '/scriptEqualsSrcByteForByte', p.script === appSrc.replace(/<\/script/gi, '<\\/script'),
    'inline=' + bytes(p.script || '') + 'B src=' + bytes(appSrc) + 'B');
}
const norm = (s) => pages[s].bodyRegion.replace(/<body[^>]*>/, '').replace('data-skin="' + s + '"', '');
ok('A', 'bodyIdentical_across3', pages['airmail'].bodyRegion &&
  norm2('airmail') === norm2('botanical') && norm2('botanical') === norm2('funk'));
function norm2(s) { return pages[s].bodyRegion.replace(/(<body[^>]*)>/, '$1>').trim(); }
ok('A', 'scriptIdentical_across3',
  pages['airmail'].script === pages['botanical'].script && pages['botanical'].script === pages['funk'].script);
ok('A', 'structureLayerZeroHex', !/#[0-9a-fA-F]{3,8}\b/.test(baseSrc));

/* ---------- B 视觉主张：色板封闭 / 零交集 / 对比度 ---------- */
function rootVars(css) {
  const m = css.match(/:root\s*\{([\s\S]*?)\}/);
  const raw = {};
  const vars = {};
  if (!m) return vars;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|var\(--[\w-]+\))\s*;/);
    if (kv) raw[kv[1]] = kv[2].toLowerCase();
  }
  const resolve = (name) => {
    let v = raw[name];
    while (v && v.startsWith('var(')) {
      const ref = v.match(/var\(--([\w-]+)\)/);
      v = ref ? raw[ref[1]] : undefined;
    }
    return v;
  };
  for (const k of Object.keys(raw)) {
    const r = resolve(k);
    if (r && r.startsWith('#')) vars[k] = r;
  }
  return vars;
}
function hexInsideRootOnly(css) {
  return css.replace(/:root\s*\{[\s\S]*?\}/g, '').match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g);
}
function lum(hex) {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const c = [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
const palettes = {};
for (const s of SKINS) {
  const p = pages[s];
  palettes[s] = rootVars(p.style);
  const strays = hexInsideRootOnly(p.style);
  ok('B', s + '/hexOnlyInRoot', !strays, strays ? strays.slice(0, 5).join(',') : '');
}
for (let i = 0; i < SKINS.length; i++) {
  for (let j = i + 1; j < SKINS.length; j++) {
    const a = Object.values(palettes[SKINS[i]]), b = Object.values(palettes[SKINS[j]]);
    const inter = a.filter((x) => b.includes(x));
    ok('B', 'paletteZeroIntersect/' + SKINS[i] + '-' + SKINS[j], inter.length === 0, inter.join(','));
  }
}
for (const s of SKINS) {
  const v = palettes[s];
  const deep = v.deep || v.accent2;
  const okc = v.ok || v.accent2;
  const btnBg = v['btn-bg'] || v.accent;
  const checks = [
    ['ink/paper>=7', ratio(v.ink, v.paper), 7],
    ['mark/paper>=4.5', ratio(v.mark, v.paper), 4.5],
    ['mark/bg>=4.5', ratio(v.mark, v.bg), 4.5],
    ['deep/paper>=4.5', ratio(deep, v.paper), 4.5],
    ['deep/bg>=4.5', ratio(deep, v.bg), 4.5],
    ['okc/bg>=4.5', ratio(okc, v.bg), 4.5],
    ['btnInk/btnBg>=4.5', ratio(v['btn-ink'] || v.paper, btnBg), 4.5],
  ];
  for (const [name, got, need] of checks) {
    ok('B', s + '/contrast/' + name, got >= need - 1e-9, got.toFixed(2) + ' vs 需 ' + need);
  }
}

/* ---------- 指纹互异 ---------- */
const fp = {};
for (const s of SKINS) {
  const css = pages[s].style;
  fp[s] = {
    radius: (css.match(/--radius:\s*([^;]+);/) || [])[1],
    display: (css.match(/--font-display:\s*'([^']+)'/) || [])[1],
    body: (css.match(/--font-body:\s*'([^']+)'/) || [])[1],
    repeating: /repeating-linear-gradient/.test(css),
    rotate: /transform:\s*rotate\(/.test(css),
    textShadow: /text-shadow:/.test(css),
    generatedText: /content:\s*"[^"]*[^\x00-\x7F][^"]*"/.test(css),
    dashed: /dashed/.test(css),
    double: /double/.test(css),
    pill: /border-radius:\s*999px/.test(css),
    hardShadowBtn: /box-shadow:\s*4px 4px 0/.test(css),
  };
}
for (let i = 0; i < SKINS.length; i++) {
  for (let j = i + 1; j < SKINS.length; j++) {
    const a = fp[SKINS[i]], b = fp[SKINS[j]];
    let d = 0;
    for (const k of Object.keys(a)) if (String(a[k]) !== String(b[k])) d++;
    ok('B', 'fingerprintDiff/' + SKINS[i] + '-' + SKINS[j] + '>=5', d >= 5, '差异 ' + d + '/11');
  }
}
console.log('fingerprints:', JSON.stringify(fp));

/* ---------- C 无障碍与结构 ---------- */
for (const s of SKINS) {
  const h = pages[s].html;
  const ids = [...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  ok('C', s + '/zeroDuplicateIds', new Set(ids).size === ids.length,
    ids.filter((x, i) => ids.indexOf(x) !== i).join(','));
  ok('C', s + '/labelForEmail', /<label[^>]*for="email"/.test(h));
  ok('C', s + '/inputTypedAttrs', /type="email"/.test(h) && /autocomplete="email"/.test(h) && /inputmode="email"/.test(h));
  ok('C', s + '/buttonTypeSubmit', /<button[^>]*type="submit"/.test(h));
  ok('C', s + '/statusLiveRegion', /role="status"/.test(h) && /aria-live="polite"/.test(h));
  ok('C', s + '/langCharsetViewport', /<html lang="zh-CN">/.test(h) && /charset="utf-8"/.test(h) && /name="viewport"/.test(h));
  ok('C', s + '/titleAndDescription', /<title>[^<]{6,}<\/title>/.test(h) && /name="description"/.test(h));
  const sections = [...h.matchAll(/<section\b[^>]*>/g)].length;
  const labelled = [...h.matchAll(/<section\b[^>]*aria-labelledby=/g)].length;
  ok('C', s + '/sectionsLabelled', sections > 0 && sections === labelled, sections + '/' + labelled);
  ok('C', s + '/detailsCount8', (h.match(/<details/g) || []).length === 8);
  // slot 目标恰好一次（06:00 教训）
  for (const target of ['sub-form', 'email', 'sub-status', 'sub-btn']) {
    ok('C', s + '/slotOnce/' + target, ids.filter((x) => x === target).length === 1);
  }
}

/* ---------- D 表单行为（vm 桩 DOM，无 jsdom） ---------- */
function runForm(scriptText) {
  const mk = () => ({
    value: '', textContent: '', className: '', attrs: {}, listeners: {}, disabled: false,
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, fn) { this.listeners[t] = fn; },
    focus() { this.focused = true; },
    reset() { this.valueCleared = (this.value = ''); },
  });
  const els = { 'sub-form': mk(), 'email': mk(), 'sub-status': mk(), 'sub-btn': mk() };
  els['email'].value = '';
  const form = els['sub-form'];
  form.reset = function () { els['email'].value = ''; };
  const sandbox = {
    document: {
      getElementById: (id) => els[id],
    },
  };
  sandbox.document.getElementById('sub-form').addEventListener = function (t, fn) { form.listeners[t] = fn; };
  vm.runInNewContext(scriptText, sandbox);
  function submit(val) {
    els['email'].value = val;
    const ev = { preventDefault() { this.prevented = true; } };
    form.listeners.submit(ev);
    return { status: els['sub-status'].textContent, cls: els['sub-status'].className, invalid: els['email'].getAttribute('aria-invalid'), prevented: ev.prevented, cleared: els['email'].value };
  }
  return submit;
}
for (const s of SKINS) {
  const submit = runForm(pages[s].script);
  let r = submit('');
  ok('D', s + '/emptyBlocked', r.status.includes('请填写') && r.cls.includes('error') && r.invalid === 'true', r.status);
  r = submit('not-an-email');
  ok('D', s + '/invalidFormat', r.status.includes('格式') && r.invalid === 'true', r.status);
  r = submit('a@mailinator.com');
  ok('D', s + '/blockedDomain', r.status.includes('一次性') && r.cls.includes('error'), r.status);
  r = submit('  X@Example.COM ');
  ok('D', s + '/successNormalizes', r.status.includes('已把 x@example.com') && r.cls.includes('ok') && r.invalid === undefined, r.status);
  ok('D', s + '/successResetsInput', r.cleared === '', 'value after=' + JSON.stringify(r.cleared));
  ok('D', s + '/successStatesDemo', r.status.includes('演示') && r.status.includes('未真实发送'), r.status);
  r = submit('x@example.com');
  ok('D', s + '/duplicateIsInfo', r.status.includes('已经订阅过') && r.cls.includes('info'), r.status);
  r = submit('y@example.com');
  ok('D', s + '/secondAddressWorks', r.cls.includes('ok') && r.status.includes('y@example.com'), r.status);
  r = submit('x@tempmail.cn');
  ok('D', s + '/blockedSecondDomain', r.status.includes('tempmail.cn'), r.status);
}

/* ---------- E 事实一致性（期刊日期算术，不口算） ---------- */
function facts(bodyHtml) {
  const latestM = bodyHtml.match(/#47<\/span><\/h2>[\s\S]*?<p class="issue-date">(\d{4}-\d{2}-\d{2})</);
  const latest = latestM[1];
  const rows = [...bodyHtml.matchAll(/#(\d+)<\/span> (\d{4}-\d{2}-\d{2})/g)].map((m) => ({ n: +m[1], d: m[2] }));
  const foot = bodyHtml.match(/第 1 期始于 (\d{4}-\d{2}-\d{2}) · 至今共 (\d+) 期/);
  const count = bodyHtml.match(/<strong class="count">([\d,]+)<\/strong>/)[1];
  const freq = /每周四 07:00 发出/.test(bodyHtml);
  return { latest, rows, footStart: foot[1], footIssues: +foot[2], count, freq };
}
const dayMs = 86400000;
const D = (str) => Date.UTC(+str.slice(0, 4), +str.slice(5, 7) - 1, +str.slice(8, 10));
for (const s of SKINS) {
  const f = facts(pages[s].bodyRegion);
  ok('E', s + '/weeklyThursdayCadence', f.freq);
  const all = [{ n: 47, d: f.latest }, ...f.rows];
  ok('E', s + '/issueNumbersContiguous', all.every((r, i) => r.n === 47 - i), all.map((r) => r.n).join(','));
  let stepOk = true, thuOk = true;
  for (const r of all) {
    if (new Date(D(r.d)).getUTCDay() !== 4) thuu: { thuOk = false; }
  }
  for (let i = 1; i < all.length; i++) if (D(all[i - 1].d) - D(all[i].d) !== 7 * dayMs) stepOk = false;
  ok('E', s + '/everyIssueIsThursday', thuOk);
  ok('E', s + '/sevenDaySpacing', stepOk);
  const computedFirst = new Date(D(f.latest) - 46 * 7 * dayMs).toISOString().slice(0, 10);
  ok('E', s + '/firstIssueMatchesFooter', f.footStart === computedFirst, 'footer=' + f.footStart + ' 推算=' + computedFirst);
  ok('E', s + '/footerCount47', f.footIssues === 47 && all.length === 6);
  ok('E', s + '/subscriberCountFormatted', f.count === '3,842');
}
ok('E', 'factsIdenticalAcrossSkins',
  pages['airmail'].bodyRegion === pages['botanical'].bodyRegion.replace(/x/, 'x') &&
  norm2('airmail') === norm2('funk'), '');

/* ---------- F 反膨胀张力（技能条款在表单核心场景的边界） ---------- */
for (const s of SKINS) {
  const h = pages[s].html;
  ok('F', s + '/noNetApis', !/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(h.replace(/未真实发送|发送数据/g, '')));
  ok('F', s + '/singleFormNoAction', (h.match(/<form/g) || []).length === 1 && !/action=/.test(h));
  ok('F', s + '/demoLabelled', /示例站点/.test(h) && /虚构/.test(h));
  ok('F', s + '/subscribeIsFirstSection', /<main[^>]*>\s*<section class="subscribe"/.test(h.replace(/\n/g, ' ').replace(/\s+/g, ' ')) || /<main class="wrap">\s*<section class="subscribe"/.test(h));
}

/* ---------- G 台账幂等（快照 + 增量 == 现值） ---------- */
const snap = JSON.parse(read(path.join(ROOT, 'ledger-snapshot.json')));
const state = JSON.parse(read(path.join(LAB, 'state', 'state.json')));
const WRITTEN = state.runs[state.runs.length - 1].time === '2026-09-26T11:00+08:00';
if (WRITTEN) {
  ok('G', 'triedAppended', state.tried.length === snap.tried_len + 1, state.tried.length + ' vs ' + (snap.tried_len + 1));
  ok('G', 'runsAppended', state.runs.length === snap.runs_len + 1);
  ok('G', 'stylesAppended', state.used_styles.length === snap.used_styles_len + snap.styles_count_this_round);
  const tail = state.used_styles.slice(-snap.styles_count_this_round);
  ok('G', 'stylesTailMatchesSnapshot', JSON.stringify(tail) === JSON.stringify(snap.this_round_styles), tail.join(','));
} else {
  ok('G', 'preWritebackBaseline',
    state.tried.length === snap.tried_len && state.runs.length === snap.runs_len &&
    state.used_styles.length === snap.used_styles_len,
    'tried=' + state.tried.length + ' runs=' + state.runs.length + ' styles=' + state.used_styles.length);
}
ok('G', 'noStyleCollisionWithHistory',
  snap.this_round_styles.every((x) => !state.used_styles.slice(0, snap.used_styles_len).includes(x)));
const comboIn = state.tried.some((t) => t.skill.startsWith('sites:sites-building') && t.scenario.includes('邮件型订阅') &&
  JSON.stringify(t.styles) === JSON.stringify(snap.this_round_styles));
if (WRITTEN) ok('G', 'comboAppendedWithStyles', comboIn);
else ok('G', 'comboUntried', !comboIn);

/* ---------- H 溢出静态防线 ---------- */
for (const s of SKINS) {
  const css = pages[s].style;
  const badRepeat = [...css.matchAll(/repeat\(([^)]*)\)/g)].filter((m) => !/minmax\(0/.test(m[1]));
  ok('H', s + '/repeatHasMinmax0', badRepeat.length === 0, badRepeat.map((m) => m[1]).join('|'));
  const bigW = [...css.matchAll(/(?:^|[\s{;])width:\s*(\d{3,})px/g)].map((m) => +m[1]).filter((w) => w >= 500);
  ok('H', s + '/noFixedWidth500plus', bigW.length === 0, bigW.join(','));
  ok('H', s + '/noNowrap', !/white-space:\s*nowrap/.test(css));
  ok('H', s + '/inputMinWidthZero', /min-width:\s*0/.test(css));
}

/* ---------- I 对照入口 ---------- */
const entry = read(path.join(DIR, 'styles.html'));
for (const s of SKINS) {
  ok('I', 'entryLinks/' + s, entry.includes('./' + s + '.html'));
  const m = entry.match(new RegExp('([\\d,]+) 字节[^<]*' + s));
  const nums = [...entry.matchAll(/class="size">([\d,]+) 字节/g)].map((x) => +x[1].replace(/,/g, ''));
  ok('I', 'entryBytePrintsActual/' + s, nums.includes(pages[s].bytes),
    '页面实际 ' + pages[s].bytes + 'B，入口列出 ' + nums.join('/'));
}
ok('I', 'entryBytesIncludeAllThree',
  [pages.airmail.bytes, pages.botanical.bytes, pages.funk.bytes].every((b) => entry.includes(b.toLocaleString('en-US'))));

/* ---------- 汇总 ---------- */
const total = results.length;
for (const s of SKINS) console.log('bytes[' + s + ']=' + pages[s].bytes);
console.log('mode=' + (WRITTEN ? '已写回' : '写回前') + '  assertions=' + total + '  failed=' + failed);
fs.writeFileSync(path.join(ROOT, 'check-result.json'), JSON.stringify({ time: new Date().toISOString(), mode: WRITTEN ? 'post' : 'pre', total, failed, results }, null, 1));
process.exit(failed ? 1 : 0);
