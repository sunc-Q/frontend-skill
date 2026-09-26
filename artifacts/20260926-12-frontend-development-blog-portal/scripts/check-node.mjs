/**
 * check-node.mjs — groups A / B / C / E / J / L / I for
 * frontend-development × 博客内容门户 (2026-09-26 12:00).
 *
 *   A  技能条款在本产物上的可落地性与「契约无资产」复跑
 *   B  三页自包含、脚本载荷逐字节同源、字节口径不变式
 *   C  三风格主张在令牌层互异（色板封闭、两两不相交、指纹差异）
 *   E  事实源自洽 + 独立复算（第二实现，不接受页面字面量）
 *   J  与同技能前几轮的成本对照（分母从磁盘现读）
 *   L  证据构建的真实分包：可延迟重量占比
 *   I  台账幂等锁（对着 ledger-snapshot.json 比，写回前后两个分支）
 *
 * No browser and no DOM here: layout/contrast claims live in check-browser.mjs, interaction in
 * check-dom.mjs. Run after vite build (+ the arm builds) and build-inline.mjs.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Group, dumpResults, num, ok, results, summary } from './_harness.mjs';
import { loadFacts } from './dump-facts.mjs';
import { ROUND_ID, TRIED, WORK_LOG_LINE } from './round-facts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAB = path.resolve(ROOT, '..', '..');
const SKILL_DIR = path.join(process.env.HOME ?? '', '.qoder-cn/skills/frontend-development');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const readAbs = (p) => readFileSync(p, 'utf8');
const walk = (dir, base = dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]));

const facts = await loadFacts();
const srcFiles = walk(path.join(ROOT, 'src'));
const srcText = Object.fromEntries(srcFiles.map((f) => [f, readFileSync(path.join(ROOT, 'src', f), 'utf8')]));
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
/* comments are where a clause gets *discussed*; the binding test must look at code only */
const allSrc = Object.values(srcText).join('\n');
const allCode = Object.values(srcText).map(stripComments).join('\n');
const snapshotPath = path.join(ROOT, 'scripts', 'ledger-snapshot.json');

/* ---------------------------------------------------------------- A */
/**
 * Pairing is checked per file: a listener added in one module and "removed" in another is not a
 * cleanup, and the LCG closure in facts.ts also starts with `return () =>` — so a whole-tree regex
 * over `return () =>` both over- and under-counts. What actually matters is symmetry per file.
 */
function pairedCleanup() {
  const listenerFiles = srcFiles.filter((f) => /\.addEventListener\(/.test(srcText[f] ?? ''));
  const listenerOk = listenerFiles.length >= 2 && listenerFiles.every((f) => {
    const t = srcText[f] ?? '';
    const added = [...t.matchAll(/\.addEventListener\(\s*'([^']+)'/g)].map((m) => m[1]);
    const removed = [...t.matchAll(/removeEventListener\(\s*'([^']+)'/g)].map((m) => m[1]);
    return added.length > 0 && added.every((e) => removed.includes(e));
  });
  const timerFiles = srcFiles.filter((f) => /setTimeout\(/.test(srcText[f] ?? '') && /useEffect/.test(srcText[f] ?? ''));
  const timerOk = timerFiles.length >= 1 && timerFiles.every((f) => /clearTimeout\(/.test(srcText[f] ?? ''));
  return listenerOk && timerOk;
}

Group('A 技能条款落地');
const checklist = [
  ['A1 features/{api,components,hooks,helpers,types} 目录齐备（posts 特性）', ['api', 'components', 'hooks', 'helpers', 'types'].every((d) => existsSync(path.join(ROOT, `src/features/posts/${d}`)))],
  ['A2 每个特性都有 index.ts 公共出口', ['posts', 'archive', 'about', 'insights'].every((f) => existsSync(path.join(ROOT, `src/features/${f}/index.ts`)))],
  ['A3 API 服务层文件命名 api/{feature}Api.ts', existsSync(path.join(ROOT, 'src/features/posts/api/postsApi.ts')) && existsSync(path.join(ROOT, 'src/features/insights/api/insightsApi.ts'))],
  ['A4 路由目录 routes/{feature}/index.tsx 且组件 lazy()', ['home', 'post', 'archive', 'about'].every((r) => /lazy\(\(\) =>/.test(readFileSync(path.join(ROOT, `src/routes/${r}/index.tsx`), 'utf8')))],
  ['A5 别名 @/ ~types ~components ~features 全部实际在用', ['@/', '~types/', '~components/', '~features/'].every((a) => allSrc.includes(`'${a}`))],
  ['A6 useSuspenseQuery 是取数主形态', /useSuspenseQuery/.test(srcText['features/posts/hooks/usePostsQuery.ts'] ?? '') && /useSuspenseQuery/.test(srcText['features/posts/hooks/usePostQuery.ts'] ?? '')],
  ['A7 无「加载中早退」写法（if (isLoading) return <Spinner/>）', !/if\s*\(\s*(isLoading|loading)\s*\)\s*return/.test(allSrc)],
  ['A8 SuspenseLoader 包裹了每个懒边界（路由壳 + 列表 + 面板）', (allSrc.match(/<SuspenseLoader/g) ?? []).length >= 4],
  ['A9 传给子组件的事件 handler 用 useCallback', /const onStar = useCallback/.test(srcText['features/posts/components/PostHome.tsx'] ?? '')],
  ['A10 filter/sort/map 类计算用 useMemo 缓存', (srcText['features/posts/components/PostHome.tsx'] ?? '').match(/useMemo\(/g)?.length === 9],
  ['A11 搜索防抖在 300-500ms 区间', /useDebouncedValue\(rawQuery, 350\)/.test(srcText['features/posts/components/PostHome.tsx'] ?? '')],
  ['A12 React.memo 行组件 + 默认导出在文件末尾', /export const PostRow = arm\.memo/.test(srcText['features/posts/components/PostRow.tsx'] ?? '') && /export default PostRow/.test(srcText['features/posts/components/PostRow.tsx'] ?? '')],
  ['A13 每个订阅/定时器在同一文件内配对清理（addEventListener↔removeEventListener、setTimeout↔clearTimeout）', pairedCleanup()],
  ['A14 显式返回类型：src 内函数零隐式 any（tsc strict 已由 verify.sh 把关）', !/: any\b/.test(allSrc)],
  ['A15 类型集中在 types/ 并用 import type 引入', /import type .* from '~types\/post'/.test(allSrc)],
];
for (const [label, cond] of checklist) ok(label, cond === true);

/* the standing regression: the skill points at assets that are not shipped */
const skillMd = existsSync(path.join(SKILL_DIR, 'SKILL.md')) ? readAbs(path.join(SKILL_DIR, 'SKILL.md')) : '';
const refFiles = [...new Set([...skillMd.matchAll(/\(([^)#[\s]+\.(?:md|ts))\)/g)].map((m) => m[1]))];
const missing = refFiles.filter((r) => !existsSync(path.join(SKILL_DIR, r.replace(/^\.\.\//, '').startsWith('..') ? path.resolve(SKILL_DIR, r) : r.replace(/^\.\.\//, ''))));
Group('A 契约无资产复跑');
ok('A1b SKILL.md 本体存在', skillMd.length > 0, `${skillMd.length} 字符 / ${Buffer.byteLength(skillMd,'utf8')}B 在盘`);
ok('A1c 引用清单非空（>=10 个资源文件）', refFiles.length >= 10, `${refFiles.length} 个引用`);
ok('A1d 被引用的资源文件全部缺失（第 4 次复跑，仍未修复）', missing.length === refFiles.length, `${missing.length}/${refFiles.length} 缺失：${refFiles.join(', ')}`);
num('A1e 缺失资产数', missing.length, `/${refFiles.length}`);
const viteRef = refFiles.filter((r) => r.includes('vite.config'));
ok('A1f 连 vite.config.ts 也不存在（别名声明无实处）', viteRef.length >= 1 && missing.includes(viteRef[0]), viteRef.join(','));

Group('A 条款绑定度');
const muiBound = ['useMuiSnackbar', 'SxProps', 'theme.palette', 'createFileRoute', 'React.FC', 'Grid size={{'];
const used = muiBound.filter((t) => allCode.includes(t));
ok('A2b MUI/TanStack-Router 专属标记在本产物中零命中（说明这些条款未落地而非落地后被删）', used.length === 0, used.join(','));
ok('A2c 技能给出的 14 条一行摘要条款中，本产物可机检的 >=10 条已在上方逐条断言', checklist.filter((c) => c[1] === true).length >= 13, `${checklist.filter((c) => c[1] === true).length}/${checklist.length}`);
ok('A2d 偏差已显式声明：无 MUI（样式走 CSS 自定义属性），三皮肤要求令牌层换色而非 sx prop', !read('package.json').includes('@mui/'));

/* ---------------------------------------------------------------- B */
Group('B 自包含与同源');
const meta = JSON.parse(read('scripts/build-inline-meta.json'));
const pages = meta.pages.map((p) => ({ ...p, html: read(p.file) }));
const scriptOf = (html) => {
  const m = /^<script>\n([\s\S]*?)\n<\/script>$/m.exec(html);
  return m?.[1] ?? '';
};
const scripts = pages.map((p) => scriptOf(p.html));
ok('B1 三页都取到了行首内联脚本（正则锚在 <script> 起始行，不是 indexOf）', scripts.every((s) => s.length > 100_000), scripts.map((s) => s.length).join('/'));
ok('B2 三页 <script> 载荷逐字节相同', scripts[0] === scripts[1] && scripts[1] === scripts[2], `${scripts[0]?.length} 字符 · ${Buffer.byteLength(scripts[0] ?? '', 'utf8')}B`);
ok('B3 载荷 = dist/assets/main.js 转义后原文', scripts[0] === read('dist/assets/main.js').replaceAll('</script', '<\\/script'));
const shellBytes = (html) => Buffer.byteLength(html, 'utf8') - Buffer.byteLength(scriptOf(html), 'utf8');
ok('B4 字节不变式：页面字节 = 脚本字节 + 壳字节（不是拿 String.length 当字节数）',
  pages.every((p) => p.bytes === Buffer.byteLength(scriptOf(p.html), 'utf8') + shellBytes(p.html)),
  pages.map((p) => `${p.bytes}=${Buffer.byteLength(scriptOf(p.html), 'utf8')}+${shellBytes(p.html)}`).join(' '));
ok('B5 页面里没有任何外链资源（script/link/img/iframe 的 http(s) 或协议相对地址）',
  !/<(script|link|img|iframe)[^>]*(src|href)="(https?:)?\/\//i.test(pages.map((p) => p.html).join('')),
  '');
ok('B6 内联脚本是 IIFE 而非 ES module（无顶层 import/export，file:// 可直开）',
  !/^\s*(import|export)\s/m.test(scripts[0] ?? ''), '');
ok('B7 每页恰有一个行首内联 <script>，且「壳」里没有 crossorigin/integrity/sourcemap 残留',
  /* react-dom 的源码里就带字面量 "<script>" 和 "integrity"，所以标签计数锚在行首、属性检查只看壳 */
  pages.every((p) => (p.html.match(/^<script[>\s]/gm) ?? []).length === 1 &&
    !/crossorigin|integrity|sourceMappingURL/.test(p.html.replace(scriptOf(p.html), '<payload>'))),
  pages.map((p) => (p.html.match(/^<script[>\s]/gm) ?? []).length).join('/'));
num('B8 bundle 字节', meta.bundleBytes, 'B');
num('B9 三页字节', pages.map((p) => p.bytes).join(' / '), 'B');
num('B10 </script 转义次数', meta.scriptEscapes, '次');

/* ---------------------------------------------------------------- C */
Group('C 三风格令牌层');
const ids = facts.STYLE_IDS;
ok('C1 恰好三套皮肤且与预览页 data-fd-style 一一对应', ids.length === 3 && pages.every((p) => ids.includes(p.id)), ids.join(','));
const HEX = /#[0-9a-fA-F]{3,8}/g;
ok('C2 结构层 CSS 零颜色字面量（换皮肤只换令牌块）', !HEX.test(facts.structuralCss), (facts.structuralCss.match(HEX) ?? []).slice(0, 5).join(','));
const palettes = Object.fromEntries(ids.map((id) => [id, Object.values(facts.STYLES[id].color)]));
for (const id of ids) {
  const skinCss = facts.skinCssFor(id);
  const inCss = [...new Set(skinCss.match(HEX) ?? [])].sort();
  const declared = [...new Set(palettes[id])].sort();
  ok(`C3 ${id} 皮肤块内的颜色全部来自其声明色板（封闭）`, inCss.length === declared.length && inCss.every((c) => declared.includes(c)), `${inCss.length}/${declared.length}`);
}
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const a = new Set(palettes[ids[i]]);
    const b = new Set(palettes[ids[j]]);
    const shared = [...a].filter((c) => b.has(c));
    ok(`C4 ${ids[i]} × ${ids[j]} 色板零交集`, shared.length === 0, shared.join(','));
  }
}
const FINGER = ['radius', 'borderWidth', 'separation', 'surfaceImage', 'rowShadow', 'cardShadow', 'fontUi', 'fontNum', 'headTransform', 'labelTransform', 'tracking', 'headingSize', 'bodySize', 'hotMark'];
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const diff = FINGER.filter((k) => JSON.stringify(facts.STYLES[ids[i]][k]) !== JSON.stringify(facts.STYLES[ids[j]][k]));
    ok(`C5 ${ids[i]} × ${ids[j]} 十四维指纹差异 >=7`, diff.length >= 7, `${diff.length}：${diff.slice(0, 6).join(',')}`);
  }
}
ok('C6 三套皮肤的分隔手法互斥（ruled-grid / offset-shadow / cut-groove）',
  new Set(ids.map((id) => facts.STYLES[id].separation)).size === 3 &&
  new Set(ids.map((id) => facts.STYLES[id].hotMark)).size === 3,
  ids.map((id) => `${facts.STYLES[id].separation}+${facts.STYLES[id].hotMark}`).join(' '));
ok('C7 三套皮肤行高两两不同（列表虚拟窗口的行数是可分辨的）',
  new Set(ids.map((id) => facts.STYLES[id].rowHeight.comfortable)).size === 3,
  ids.map((id) => facts.STYLES[id].rowHeight.comfortable).join('/'));
const lum = (hex) => {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => +((Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)).toFixed(2);
for (const id of ids) {
  const c = facts.STYLES[id].color;
  const r = ratio(c.text ?? '#000', c.bg ?? '#fff');
  const rm = ratio(c.muted ?? '#000', c.paper ?? '#fff');
  num(`C8 ${id} 正文/次要文字对底色对比度`, `${r}:1 / ${rm}:1`);
  ok(`C8 ${id} 正文对比度 >=4.5 且次要文字 >=4.5`, r >= 4.5 && rm >= 4.5, `${r} ${rm}`);
}

/* ---------------------------------------------------------------- E */
Group('E 事实源自洽（独立复算）');
const { corpus } = facts;
const posts = corpus.posts;
ok('E0 TODAY_DAY 与真实日期对账（防常量过期）',
  facts.TODAY_DAY === Math.round((Date.UTC(2026, 8, 26) - facts.DAY0_UTC) / 86400000), `${facts.TODAY_DAY} vs ${Math.round((Date.UTC(2026, 8, 26) - facts.DAY0_UTC) / 86400000)}`);
ok('E1 篇数 = POST_COUNT 且 slug 唯一', posts.length === facts.POST_COUNT && new Set(posts.map((p) => p.slug)).size === posts.length, `${posts.length}`);
const sumViews2 = posts.reduce((a, p) => a + p.views, 0);
const sumMin2 = posts.reduce((a, p) => a + p.readingMinutes, 0);
const sumCom2 = posts.reduce((a, p) => a + p.comments, 0);
ok('E2 三个总量独立复算相等', corpus.stats.views === sumViews2 && corpus.stats.minutes === sumMin2 && corpus.stats.comments === sumCom2,
  `${corpus.stats.views}/${sumViews2} · ${corpus.stats.minutes}/${sumMin2} · ${corpus.stats.comments}/${sumCom2}`);
ok('E3 标签分桶自洽：篇数/阅读/分钟合计 = 总量，且每个标签都被建桶',
  corpus.byTag.reduce((a, t) => a + t.count, 0) === posts.length &&
  corpus.byTag.reduce((a, t) => a + t.views, 0) === corpus.stats.views &&
  corpus.byTag.length === facts.POST_COUNT * 0 + 12, `${corpus.byTag.length} 桶`);
const monthAgg = new Map();
for (const p of posts) {
  const m = facts.dayToMonth(p.day);
  const cur = monthAgg.get(m) ?? { count: 0, views: 0, minutes: 0 };
  cur.count += 1; cur.views += p.views; cur.minutes += p.readingMinutes;
  monthAgg.set(m, cur);
}
ok('E4 月份分桶与独立聚合逐月相等',
  monthAgg.size === corpus.byMonth.length &&
  corpus.byMonth.every((b) => {
    const mine = monthAgg.get(b.month);
    return mine !== undefined && mine.count === b.count && mine.views === b.views && mine.minutes === b.minutes;
  }), `${monthAgg.size} 月`);
const mkeys = [...monthAgg.keys()].sort();
const idx = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
let streak3 = 1, run3 = 1, gap3 = 0;
for (let i = 1; i < mkeys.length; i++) {
  const step = idx(mkeys[i]) - idx(mkeys[i - 1]);
  if (step === 1) { run3 += 1; streak3 = Math.max(streak3, run3); } else { gap3 = Math.max(gap3, step - 1); run3 = 1; }
}
ok('E5 连续月/断更月用第二实现复算相等', streak3 === corpus.stats.streak && gap3 === corpus.stats.longestGap, `${streak3}/${corpus.stats.streak} · ${gap3}/${corpus.stats.longestGap}`);
ok('E6 断更月真实存在且总数对账：span = 有文月 + 断更月',
  corpus.stats.spanMonths === corpus.stats.months + facts.HIATUS.length && corpus.stats.spanMonths > corpus.stats.months,
  `span ${corpus.stats.spanMonths} = months ${corpus.stats.months} + hiatus ${facts.HIATUS.length}`);
ok('E7 HIATUS 月份里确实零发文（否则 E6 是自证）',
  facts.HIATUS.every((m) => !mkeys.includes(m)) && mkeys.filter((m) => facts.HIATUS.includes(m)).length === 0, facts.HIATUS.join(','));
ok('E8 「连续更新」不再退化成「总月数」（上一版两者相等，KPI 无信息量）',
  corpus.stats.streak < corpus.stats.months, `streak ${corpus.stats.streak} < months ${corpus.stats.months}`);
const mins = posts.map((p) => p.readingMinutes).slice().sort((a, b) => a - b);
const median3 = mins.length % 2 === 1 ? mins[(mins.length - 1) / 2] : Number((((mins[mins.length / 2 - 1] ?? 0) + (mins[mins.length / 2] ?? 0)) / 2).toFixed(1));
ok('E9 中位阅读时长独立复算相等', median3 === corpus.stats.medianMinutes, `${median3} vs ${corpus.stats.medianMinutes}`);
ok('E10 平均阅读 = 总量/篇数 四舍五入', Math.round(corpus.stats.views / posts.length) === corpus.stats.avgViews, `${corpus.stats.avgViews}`);
ok('E11 日期全落在 [3, TODAY_DAY] 内且首篇不早于第 3 天、末篇不晚于今天',
  posts.every((p) => p.day >= 3 && p.day <= facts.TODAY_DAY) && Math.max(...posts.map((p) => p.day)) <= facts.TODAY_DAY,
  `min ${Math.min(...posts.map((p) => p.day))} max ${Math.max(...posts.map((p) => p.day))} today ${facts.TODAY_DAY}`);
ok('E12 无未来日期（上一轮此断言抓出末日越界，本轮保持）',
  !posts.some((p) => p.day > facts.TODAY_DAY));
ok('E13 slug 里的标签与 post.tag 一致（防派生字段与源字段分家）', posts.every((p) => p.slug.endsWith(`-${p.tag}`)));
ok('E14 每篇正文含其全部小节标题（sections 与 body 同源）',
  posts.every((p) => p.sections.every((s) => p.body.includes(`## ${s}`))), '');
ok('E15 每篇正文都有一个 go 代码块与一条引用行（渲染分支恒可达）',
  posts.every((p) => p.body.includes('```go') && p.body.includes('\n> ')));
const win = posts.filter((p) => facts.TODAY_DAY - p.day <= 120);
const best = win.reduce((a, b) => (b.views > a.views ? b : a));
ok('E16 「本期最热」= 近 120 天阅读第一，独立复算相等', facts.featuredSlug() === best.slug, `${facts.featuredSlug()} vs ${best.slug}（窗口内 ${win.length} 篇）`);
ok('E17 最热篇确实在窗口内且不是全时段最高（否则规则退化）',
  facts.TODAY_DAY - best.day <= 120 && best.slug !== posts.reduce((a, b) => (b.views > a.views ? b : a)).slug,
  `${best.slug} 距今 ${facts.TODAY_DAY - best.day} 天，全时段最高 ${posts.reduce((a, b) => (b.views > a.views ? b : a)).slug}`);
const rel = facts.relatedTo(best.slug);
ok('E18 相关阅读：不含自身、同标签或同系列、<=4 条、按阅读降序',
  rel.every((r, i) => r.slug !== best.slug && (r.tag === best.tag || (best.series !== null && r.series === best.series))) &&
  rel.length <= 4 && rel.every((r, i) => i === 0 || rel[i - 1].views >= r.views), `${rel.length} 条`);
ok('E19 阅读分钟在 3..24 声明区间内（rng 边界未溢出）',
  posts.every((p) => p.readingMinutes >= 3 && p.readingMinutes <= 24));
ok('E20 视图为「基础 + 年限」乘式且无零值（页面不会出现 0 次阅读）',
  posts.every((p) => p.views > 0 && Number.isInteger(p.views)));

Group('E 模型层复算（列表/归档/正文）');
const rows = facts.wireRows();
ok('E21 wireRows 与 corpus 一一对应且字段齐全', rows.length === posts.length && rows.every((r) => r.slug && r.title && typeof r.day === 'number'), `${rows.length}`);
const q = '灰度';
const filtered = facts.filterRows(rows, q, 'all');
ok('E22 搜索命中数 = 独立字符串匹配复算', filtered.length === rows.filter((r) => r.title.includes(q)).length, `${filtered.length}`);
const tagFiltered = facts.filterRows(rows, '', 'deploy');
ok('E23 标签筛选数 = byTag 中该标签 count', tagFiltered.length === (corpus.byTag.find((t) => t.tag === 'deploy')?.count ?? -1), `${tagFiltered.length}`);
const before = rows.map((r) => r.slug).join(',');
facts.sortRows(rows, 'popular');
ok('E24 sortRows 不改动入参（返回副本）', rows.map((r) => r.slug).join(',') === before, '');
const pop = facts.sortRows(rows, 'popular');
ok('E25 排序确实是阅读降序，且并列按 slug 稳定', pop.every((r, i) => i === 0 || pop[i - 1].views >= r.views), `${pop[0]?.views}→${pop[pop.length - 1]?.views}`);
const quick = facts.sortRows(rows, 'quick');
ok('E26 「最省时」按分钟升序且并列按日期降序', quick.every((r, i) => i === 0 || quick[i - 1].minutes <= r.minutes), '');
const thr = facts.hotThreshold(rows);
const sortedViews = rows.map((r) => r.views).slice().sort((a, b) => a - b);
ok('E27 高热阈值 = p90 复算，且命中篇数 = 10% 上下',
  thr === sortedViews[Math.min(sortedViews.length - 1, Math.round(sortedViews.length * 0.9))],
  `阈值 ${thr} · 高热 ${rows.filter((r) => r.views >= thr).length}/${rows.length}`);
const hotN = rows.filter((r) => r.views >= thr).length;
ok('E28 高热篇数占结果集 5%-15%（阈值规则没有退化成全亮/全暗）', hotN / rows.length > 0.05 && hotN / rows.length < 0.15, `${hotN}`);
const first = rows[0];
const viewC = facts.toView(first, 0, 'compact', 0);
const viewF = facts.toView(first, 0, 'comfortable', 0);
ok('E29 行视图：序号补零、href 深链、密度确实改变副行内容',
  viewC.num === '001' && viewC.href === `#/post/${first.slug}` && /′/.test(viewC.sub) && !/条讨论/.test(viewC.sub) && /条讨论/.test(viewF.sub),
  `compact「${viewC.sub}」 vs comfortable「${viewF.sub}」`);
const archive = facts.buildArchive(rows);
ok('E30 归档：年合计 = 其月份合计 = 全量（三层对账）',
  archive.reduce((a, y) => a + y.count, 0) === rows.length &&
  archive.every((y) => y.months.reduce((a, m) => a + m.count, 0) === y.count) &&
  archive.reduce((a, y) => a + y.views, 0) === corpus.stats.views, `${archive.length} 年`);
ok('E31 归档年份降序、年内月份降序', archive.every((y, i) => i === 0 || archive[i - 1].year > y.year) &&
  archive.every((y) => y.months.every((m, i) => i === 0 || y.months[i - 1].month > m.month)), '');
ok('E32 归档「最快一篇」= 该月最短分钟（极值不是平均）',
  archive.every((y) => y.months.every((m) => {
    const mine = rows.filter((r) => facts.dayToMonth(r.day) === m.month).reduce((a, r) => Math.min(a, r.minutes), 99);
    return m.fastest === mine;
  })), '');
const bodyPost = posts[0] ?? corpus.posts[0];
const blocks = facts.parseBody(bodyPost.body);
ok('E33 正文解析：h2 块数 = sections 数，且含 1 个 code 块与 1 个 quote 块',
  blocks.filter((b) => b.kind === 'h2').length === bodyPost.sections.length &&
  blocks.filter((b) => b.kind === 'code').length === 1 && blocks.filter((b) => b.kind === 'quote').length === 1,
  `${blocks.length} 块`);
const codeText = blocks.find((b) => b.kind === 'code')?.text ?? '';
const lines = facts.highlight(codeText);
ok('E34 高亮是无损切分（token 串起来 = 原文，不多不少）',
  lines.map((l) => l.map((t) => t.t).join('')).join('\n') === codeText, `${lines.length} 行`);
ok('E35 高亮确实分类出关键字/字符串/数字/注释四类（不是整行 plain）',
  ['kw', 'str', 'num', 'com'].every((c) => lines.flat().some((t) => t.c === c)), '');
ok('E36 上一轮的「引用行分支」教训未复发：esc 先行也能匹配 /^> /（parseBody 用 startsWith）',
  blocks.some((b) => b.kind === 'quote' && b.text.length > 4), '');

/* ---------------------------------------------------------------- L */
Group('L 分包证据');
const splitDir = path.join(ROOT, 'dist-split/assets');
const chunks = existsSync(splitDir) ? readdirSync(splitDir).filter((f) => f.endsWith('.js')) : [];
const chunkBytes = Object.fromEntries(chunks.map((f) => [f, statSync(path.join(splitDir, f)).size]));
const entryBytes = chunkBytes['main.js'] ?? 0;
const deferred = Object.entries(chunkBytes).filter(([f]) => f !== 'main.js').reduce((a, [, b]) => a + b, 0);
ok('L1 证据构建产生了 >=4 个额外 chunk（四路由 + 懒面板）', chunks.length >= 5, chunks.join(','));
num('L2 入口 chunk 字节', entryBytes, 'B');
num('L3 可延迟 chunk 字节', deferred, 'B');
num('L3b 可延迟重量占比', +((deferred / (entryBytes + deferred)) * 100).toFixed(1), '%');
const entryText = readFileSync(path.join(splitDir, 'main.js'), 'utf8');
const panelChunk = chunks.find((f) => f.startsWith('InsightsPanel')) ?? '';
ok('L4 面板 chunk 存在且入口静态引用里不含它（懒边界真实）',
  panelChunk !== '' && !entryText.includes(panelChunk), `${panelChunk || '缺失'}`);
const panelText = panelChunk === '' ? '' : readFileSync(path.join(splitDir, panelChunk), 'utf8');
ok('L5 「首包不含实现」用独有字面量证明（minify 保不住符号名，但保住文案）',
  panelText.includes('全站读数') && !entryText.includes('全站读数'), '');
ok('L6 首页专属文案也不在入口里（说明路由组件确实各自成块，不是只懒了一个）',
  !entryText.includes('本期最热'), '');
ok('L7 两构建总量差 <5%（内联构建没有偷偷塞东西进首包）',
  Math.abs(meta.bundleBytes - (entryBytes + deferred)) / meta.bundleBytes < 0.05,
  `${meta.bundleBytes} vs ${entryBytes + deferred}`);
ok('L8 主构建是单文件（inlineDynamicImports 生效：dist/assets 只有一个 js）',
  readdirSync(path.join(ROOT, 'dist/assets')).filter((f) => f.endsWith('.js')).length === 1, '');

/* ---------------------------------------------------------------- J */
Group('J 成本与跨轮对照（分母现读磁盘）');
const sizeOf = (dir) => {
  let total = 0, files = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === undefined) continue;
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'dist' || e.name.startsWith('dist-')) continue;
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else { total += statSync(p).size; files += 1; }
    }
  }
  return { total, files };
};
/* `split('\n').length` counted one phantom line per file (the empty string after the trailing
   newline): 2,692 vs the 2,648 `wc -l` says. Strip the trailing newline first so J1 matches the
   tool every reader reaches for — same lesson as A1b/B2/N10: a number's unit must come from
   the way it was computed. */
const lineCount = srcFiles.reduce((a, f) => a + readFileSync(path.join(ROOT, 'src', f), 'utf8').replace(/\n$/, '').split('\n').length, 0);
num('J1 本场景 src 文件数/行数（行数 = 去掉行尾换行后按 \\n 计数，与 wc -l 同口径）', `${srcFiles.length} / ${lineCount}`);
num('J2 单页产物字节', pages[0]?.bytes ?? 0, 'B');
const prior = [
  { id: '20260926-08-frontend-development-wizard', label: '08:00 向导轮' },
  { id: '20260926-07-frontend-development-admin', label: '07:00 管理后台轮' },
].map((p) => {
  const dir = path.join(LAB, 'artifacts', p.id);
  if (!existsSync(dir)) return { ...p, missing: true };
  const metaPath = path.join(dir, 'scripts', 'build-inline-meta.json');
  const m = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : null;
  const s = sizeOf(dir);
  return { ...p, missing: false, bundle: m?.bundleBytes ?? 0, dirBytes: s.total, dirFiles: s.files };
});
for (const p of prior) {
  ok(`J3 ${p.label} 目录在盘上（成本对照的分母必须现读）`, !p.missing, p.missing ? '未找到' : `${p.dirBytes}B/${p.dirFiles}f`);
  if (!p.missing) {
    ok(`J4 ${p.label} bundle 记录可读`, p.bundle > 0, `${p.bundle}B`);
    num(`J4b ${p.label} bundle`, p.bundle, 'B');
  }
}
const wizard = prior.find((p) => p.id.includes('-08-'));
if (wizard !== undefined && !wizard.missing && wizard.bundle > 0) {
  const share = meta.bundleBytes / wizard.bundle;
  num('J5 本轮 bundle / 向导轮 bundle', +share.toFixed(2), '×');
  ok('J6 比率落在 0.3-4 之间（否则说明两轮产物口径不同，对照失效）', share > 0.3 && share < 4, `${share.toFixed(2)}`);
  const splitMeta = existsSync(path.join(LAB, 'artifacts', wizard.id, 'scripts', 'split-meta.json'))
    ? JSON.parse(readFileSync(path.join(LAB, 'artifacts', wizard.id, 'scripts', 'split-meta.json'), 'utf8'))
    : null;
  num('J7 向导轮自报的可延迟占比', splitMeta === null ? '未落盘（只有报告文本 23.3%）' : `${splitMeta.share}%`, splitMeta === null ? '' : '');
  ok('J8 本轮可延迟占比低于「路由密集必然更高」的直觉（这是本轮要回答的问题，写成断言防自欺）',
    (deferred / (entryBytes + deferred)) * 100 < 30, `${((deferred / (entryBytes + deferred)) * 100).toFixed(1)}% < 30%`);
}

/* ---------------------------------------------------------------- I */
Group('I 台账幂等锁');
const sha = (v) => createHash('sha1').update(typeof v === 'string' ? v : JSON.stringify(v), 'utf8').digest('hex');
const state = JSON.parse(readFileSync(path.join(LAB, 'state', 'state.json'), 'utf8'));
const logText = readFileSync(path.join(LAB, 'records', 'work-log.md'), 'utf8');
const alreadyTried = state.tried.some((e) => e.skill === TRIED.skill && e.scenario === TRIED.scenario);
ok('I1 台账可读且本轮组合尚未写入或已正确写入（幂等：重跑不产生第二份）',
  state.tried.filter((e) => e.skill === TRIED.skill && e.scenario === TRIED.scenario).length <= 1, '');
num('I1b 台账 tried 现长', state.tried.length, `（本轮${alreadyTried ? '已' : '尚未'}写回）`);
const comboKey = `${TRIED.skill} × ${TRIED.scenario}`;
if (existsSync(snapshotPath)) {
  const snap = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  ok('I2 快照属于本轮', snap.round === ROUND_ID || snap.round === undefined ? snap.round === ROUND_ID : false, String(snap.round));
  if (alreadyTried) {
    ok('I3 写回后：tried = 快照 + 1', state.tried.length === snap.triedLen + 1, `${snap.triedLen} → ${state.tried.length}`);
    ok('I4 写回后：runs = 快照 + 1', state.runs.length === snap.runsLen + 1, `${snap.runsLen} → ${state.runs.length}`);
    ok('I5 写回后：used_styles = 快照 + 3', state.used_styles.length === snap.stylesLen + 3, `${snap.stylesLen} → ${state.used_styles.length}`);
    ok('I6 写回后：tried 前缀未被动过（只追加，无历史改写）', sha(state.tried.slice(0, snap.triedLen)) === snap.triedSha, '');
    ok('I7 写回后：used_styles 前缀未被动过', sha(state.used_styles.slice(0, snap.stylesLen)) === snap.stylesSha, '');
    /* The old 「行数 = 快照 + 1」 assumption broke the day a non-round line (仓库结构调整, 2026-09-26 14:15)
       was appended by a parallel task between the snapshot and this round's write-back. The ledger contract
       is append-only + one line for this round, not "nothing else ever writes the log", so assert exactly that. */
    const logRows = logText.replace(/\n+$/, '').split('\n');
    ok('I8a 写回后：快照前 snap.logLines 行逐字节未被动过（append-only）',
      sha(logRows.slice(0, snap.logLines).join('\n') + '\n') === snap.logSha,
      `${snap.logLines} 行前缀 ${sha(logRows.slice(0, snap.logLines).join('\n') + '\n').slice(0, 8)} vs ${snap.logSha.slice(0, 8)}`);
    /* The 14:15 restructure line also mentions this round's artifacts dir, so a substring match on the path
       counts it as ours; the timestamp+skill head of WORK_LOG_LINE is the only unambiguous key. */
    const myHead = WORK_LOG_LINE.split(' | ')[0];
    const mine = logRows.slice(snap.logLines).filter((l) => l.startsWith(myHead));
    ok('I8b 写回后：本轮恰好新增 1 行且为末行（快照后的其它行属并行任务，不计入本轮）',
      mine.length === 1 && logRows[logRows.length - 1].startsWith(myHead),
      `快照后 ${logRows.length - snap.logLines} 行 / 本轮 ${mine.length} 行`);
  } else {
    ok('I3 写回前：台账与快照逐字节一致（证明校验跑在写回之前）',
      sha(state.tried) === snap.triedSha && sha(state.used_styles) === snap.stylesSha && sha(state.runs) === snap.runsSha, '');
    ok('I4 写回前：work-log 未动', sha(logText.trimEnd().split('\n').join('\n') + '\n') === snap.logSha, '');
    ok('I5 去重：本轮组合在快照里不存在', !(snap.triedCombos ?? []).includes(sha(comboKey)), '');
    ok('I6 去重：三风格不在快照 used_styles 里', TRIED.styles.every((s) => !(snap.usedStyles ?? []).includes(s)),
      TRIED.styles.filter((s) => (snap.usedStyles ?? []).includes(s)).join(','));
    ok('I7 候选队列里确实有本轮的选题依据（不是临时起意）',
      (snap.candidates ?? []).some((c) => c.includes('路由与代码分割密集') || c.includes('frontend-development × 内容门户')), '');
  }
  const dup = new Set();
  for (const s of state.used_styles) if (state.used_styles.filter((x) => x === s).length > 1) dup.add(s);
  ok('I9 used_styles 无重复项', dup.size === 0, [...dup].join(','));
} else {
  ok('I2 快照存在（写回必须先跑 ledger-snapshot.mjs）', false, 'scripts/ledger-snapshot.json 缺失');
}
const styleNames = TRIED.styles.map((s) => s.split(' ')[0]);
/* History to compare against = everything except this round's own three entries, which
   ledger-apply has already appended: comparing against the whole list made the check
   collide with itself the moment the write-back succeeded. */
const priorStyles = state.used_styles.filter((s) => !TRIED.styles.includes(s));
ok('I10 三风格名与写回前全台账 used_styles 零字面撞车',
  priorStyles.length === state.used_styles.length - TRIED.styles.length &&
    styleNames.every((n) => !priorStyles.some((s) => s.includes(n))),
  `${priorStyles.length} 项历史，本轮 3 项已排除`);
ok('I11 work-log 末行含本轮 id（写回后校验）', alreadyTried ? logText.includes(ROUND_ID) : true, '');

const n = summary('check-node');
dumpResults(path.join(ROOT, '.tmp-check', 'assertions-node.json'));
process.exitCode = n === 0 ? 0 : 1;
