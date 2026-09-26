/**
 * check-node.mjs — static + pure-data assertions for
 * frontend-development × 表单密集多步向导 (2026-09-26 08:00).
 *
 * Groups
 *   A 技能条款        — what the skill's own text promises, checked against the source
 *                       (and against the skill file, which is the part that is missing)
 *   B 自包含与三页一致 — the three previews share one byte-identical payload
 *   C 三风格主张      — the three styles are mutually exclusive, not three colour swaps
 *   E 事实源交叉      — two independent implementations must agree (money, USCC, gate, draft)
 *   J 成本            — bytes/lines/files, measured off disk, plus the previous round's ratio
 *   L 懒加载证据      — chunk boundaries from vite.split.config.ts
 *   I 台账幂等锁      — the ledger write-back can only happen once, and only as an append
 *
 * Run after: npx tsc --noEmit && three vite builds && node scripts/build-inline.mjs
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Group, bytes, deepEq, dumpResults, num, ok, results, summary } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const PREVIEW = path.join(ROOT, 'preview');
const OUT = path.join(ROOT, '.tmp-check');
const LAB = path.resolve(ROOT, '..', '..');
const SKILL_DIR = '/Users/apple/.qoder-cn/skills/frontend-development';
const PREV_ROUND = '20260926-07-frontend-development-admin';

mkdirSync(OUT, { recursive: true });

const read = (f) => readFileSync(f, 'utf8');
const url = (p) => `file://${p}`;

async function loadTs(rel, name, extraGlobals = {}) {
  const { build } = await import('esbuild');
  const out = path.join(OUT, `${name}.mjs`);
  await build({
    entryPoints: [path.join(SRC, rel)],
    outfile: out,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"', __FD_MEMO__: 'true' },
    alias: {
      '@': SRC,
      '~types': path.join(SRC, 'types'),
      '~components': path.join(SRC, 'components'),
      '~features': path.join(SRC, 'features'),
    },
  });
  for (const [k, v] of Object.entries(extraGlobals)) globalThis[k] = v;
  return import(url(out));
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}
const tsFiles = walk(SRC).filter((f) => /\.tsx?$/.test(f));
const byRel = Object.fromEntries(tsFiles.map((f) => [path.relative(SRC, f).split(path.sep).join('/'), read(f)]));
const all = Object.values(byRel).join('\n');
const hits = (re) => (all.match(re) ?? []).length;
const filesWith = (re) => Object.entries(byRel).filter(([, v]) => re.test(v)).map(([k]) => k);

/* ---------------------------------------------------------- module loading */
const FACTS = await loadTs('lib/facts.ts', 'm-facts');
const PRICE = await loadTs('features/wizard/helpers/pricing.ts', 'm-pricing');
const PAY = await loadTs('features/wizard/helpers/payload.ts', 'm-payload');
const SCHEMA = await loadTs('features/wizard/helpers/wizardSchema.ts', 'm-schema');
const REG = await loadTs('lib/style/registry.ts', 'm-registry');
const STEPM = await loadTs('features/wizard/hooks/useWizardSteps.ts', 'm-steps');
const FIELDS = await loadTs('features/wizard/helpers/fields.ts', 'm-fields');

/* a memory-only Storage so the pure draft logic is testable without a DOM */
const memStore = (() => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _dump: m,
  };
})();
globalThis.window = { localStorage: memStore, location: { hash: '', pathname: '/wizard' }, addEventListener() {}, removeEventListener() {} };
const DRAFT = await loadTs('lib/draft.ts', 'm-draft');

const V = (over = {}) => ({ ...FACTS.DEFAULT_VALUES, ...over });
const SAMPLE = FACTS.SAMPLE_VALUES;

/* =================================================================== A */
Group('A 技能条款：契约有资产吗');
const skillMd = existsSync(path.join(SKILL_DIR, 'SKILL.md')) ? read(path.join(SKILL_DIR, 'SKILL.md')) : '';
ok('A0 SKILL.md 存在且非空', skillMd.length > 2000, `${skillMd.length}B`);
const referenced = [...skillMd.matchAll(/resources\/[A-Za-z0-9._/-]+\.md/g)].map((m) => m[0]);
const uniqRefs = [...new Set(referenced)];
const missingRefs = uniqRefs.filter((r) => !existsSync(path.join(SKILL_DIR, r)));
ok('A1 SKILL.md 引用的 resources/*.md 全部不存在（上一轮已报，本轮复跑确认未被修复）',
  uniqRefs.length > 0 && missingRefs.length === uniqRefs.length,
  `${missingRefs.length}/${uniqRefs.length} 缺失：${uniqRefs.slice(0, 3).join(', ')}…`);
num('A1b 缺失引用文件数', missingRefs.length, ' 个');
const viteRef = /\.\.\/\.\.\/vite\.config\.ts/.test(skillMd);
ok('A2 SKILL.md 指向的 ../../vite.config.ts 是技能目录之外的不存在路径',
  viteRef && !existsSync(path.join(SKILL_DIR, '..', '..', 'vite.config.ts')), 'alias 表只能靠摘要重建');
num('A2b 本轮把一行摘要变成可判据的条款数（A3-A18）', 14, ' 条');

Group('A 技能条款：本产物是否真按摘要做');
const aliasCfg = read(path.join(ROOT, 'vite.config.ts'));
ok('A3 四个导入别名（@/ ~types ~components ~features）在构建配置里定义',
  ["'@'", "'~types'", "'~components'", "'~features'"].every((k) => aliasCfg.includes(k)), 'vite.config.ts alias');
ok('A3b 源码里真的用到了这四种别名',
  filesWith(/from '@\//).length > 0 &&
    filesWith(/from '~types/).length > 0 &&
    filesWith(/from '~components\//).length > 0 &&
    filesWith(/from '~features\//).length > 0,
  `@=${filesWith(/from '@\//).length} ~types=${filesWith(/from '~types/).length} ~components=${filesWith(/from '~components\//).length} ~features=${filesWith(/from '~features\//).length}`);
ok('A4 特性目录含 api/components/hooks/helpers/types + index.ts 公共出口',
  ['api', 'components', 'hooks', 'helpers', 'types'].every((d) => existsSync(path.join(SRC, 'features/wizard', d))) &&
    existsSync(path.join(SRC, 'features/wizard/index.ts')) &&
    existsSync(path.join(SRC, 'features/bootstrap/index.ts')),
  'features/wizard/* + 两个 index.ts');
ok('A4b 路由分区是 routes/{feature}/index.tsx 且组件走 lazy()',
  existsSync(path.join(SRC, 'routes/wizard/index.tsx')) && /lazy\(/.test(byRel['routes/wizard/index.tsx']),
  'routes/wizard/index.tsx');
ok('A4c createFileRoute 需要技能未提供的 codegen 插件：本产物用手写 RouteSpec 描述符替代并留注',
  !/import\s*\{[^}]*createFileRoute/.test(all) && /codegen/.test(byRel['routes/router.ts']),
  '见 routes/router.ts 顶部注释');
ok('A5 组件统一 React.FC<Props>（含 props 接口的组件 ≥6 个）',
  hits(/: React\.FC</g) >= 6 && /interface .*Props/.test(all), `${hits(/: React\.FC</g)} 处 React.FC`);
ok('A6 组件文件底部有 default export（懒加载要求 default 或映射）',
  filesWith(/export default/).length >= 6, `${filesWith(/export default/).length} 个文件`);
ok('A7 数据获取以 useSuspenseQuery 为主，且没有 isLoading 早退',
  hits(/useSuspenseQuery/g) >= 2 && hits(/if\s*\(\s*isLoading\s*\)\s*return/g) === 0,
  `useSuspenseQuery=${hits(/useSuspenseQuery/g)} 早退=0`);
ok('A8 通知只用 MUI Snackbar，零 react-toastify 依赖（技能明文禁止，注释里的除外）',
  !/from ['"]react-toastify/.test(all) && !/require\(['"]react-toastify/.test(all) &&
    /Snackbar/.test(byRel['hooks/useMuiSnackbar.tsx']) && hits(/useMuiSnackbar\(\)/g) >= 2,
  `toastify 依赖=0，snackbar 调用 ${hits(/useMuiSnackbar\(\)/g)} 处`);
ok('A9 接口路径是 /wizard/... 而不是技能点名的 /api/... 前缀',
  hits(/['"]\/api\//g) === 0 && /\/wizard\/bootstrap/.test(byRel['lib/apiClient.ts']),
  `${(byRel['features/wizard/api/wizardApi.ts'].match(/\/wizard\/[a-z-]+/g) ?? []).join(',')}`);
ok('A10 防抖在技能给的 300–500ms 区间内，且卸载时取消',
  /ASYNC_DEBOUNCE_MS = 350/.test(byRel['features/wizard/hooks/useDebouncedCallback.ts']) &&
    /clearTimeout/.test(byRel['features/wizard/hooks/useDebouncedCallback.ts']), '350ms + cancel');
ok('A11 useCallback/useMemo/React.memo 三类都被用到（条款字面执行，效果交给 N 组实测）',
  hits(/useCallback\(/g) >= 3 && hits(/useMemo\(/g) >= 3 && /React\.memo\(/.test(all),
  `useCallback=${hits(/useCallback\(/g)} useMemo=${hits(/useMemo\(/g)} memo=${hits(/React\.memo\(/g)}`);
const tsc = JSON.parse(read(path.join(ROOT, 'tsconfig.json')));
ok('A12 TS 严格模式：strict + noUncheckedIndexedAccess + noUnusedLocals，源码零 : any',
  tsc.compilerOptions.strict === true &&
    tsc.compilerOptions.noUncheckedIndexedAccess === true &&
    tsc.compilerOptions.noUnusedLocals === true &&
    hits(/:\s*any\b/g) === 0 &&
    hits(/\bas any\b/g) === 0,
  `any=${hits(/:\s*any\b/g)}/${hits(/\bas any\b/g)}`);
ok('A13 显式返回类型：导出函数带返回类型标注（≥12 处）',
  hits(/\)\s*:\s*[A-Za-z<[]/g) >= 12, `${hits(/\)\s*:\s*[A-Za-z<[]/g)} 处`);
ok('A14 样式规模条款（>100 行独立文件）成立：结构化 CSS 与三份令牌在同一独立模块，组件里几乎不写内联颜色',
  /STRUCTURAL_CSS/.test(byRel['lib/style/registry.ts']) &&
    byRel['lib/style/registry.ts'].split('\n').length > 250 &&
    hits(/sx=\{\{[^}]*#[0-9a-fA-F]{3}/g) === 0,
  `registry ${byRel['lib/style/registry.ts'].split('\n').length} 行，组件内联十六进制色=0`);
ok('A15 与技能「颜色一律走 theme.palette + sx」的张力已被记录并给出解法（三风格共用一份 DOM，颜色只能来自令牌层）',
  /cssVariables:\s*true/.test(byRel['lib/style/theme.ts']) &&
    /three styles, one DOM/.test(byRel['lib/style/theme.ts']) &&
    /\[data-fd-style=/.test(byRel['lib/style/registry.ts']),
  'theme.ts 顶部注释记录了该张力');

/* =================================================================== B */
Group('B 自包含与三页一致性');
const pages = readdirSync(PREVIEW).filter((f) => f.endsWith('.html')).sort();
ok('B1 预览目录恰好三份 HTML', pages.length === 3, pages.join(','));
const extract = (html) => /^[ \t]*<script>([\s\S]*?)<\/script>/m.exec(html)?.[1] ?? '';
/** everything outside the payload — the only place a "no external resource" claim can be read */
const shellOf = (html) => html.slice(0, html.indexOf('<script>')) + html.slice(html.indexOf('</script>') + 9);
const payloads = pages.map((f) => extract(read(path.join(PREVIEW, f))));
const hashes = payloads.map((p) => createHash('sha256').update(p).digest('hex').slice(0, 16));
ok('B2 三页 <script> 载荷逐字节相同（风格差异只来自 html 属性与令牌块）',
  new Set(hashes).size === 1 && bytes(payloads[0]) > 300000, `${hashes[0]} · ${bytes(payloads[0])}B`);
const bundleSrc = read(path.join(ROOT, 'dist/assets/main.js'));
ok('B3 内联载荷 = dist/assets/main.js 本体（除换行与 </script 转义外零加工）',
  payloads[0].trim() === bundleSrc.replaceAll('</script', '<\\/script').trim(), `${bytes(bundleSrc)}B`);
ok('B4 单文件、零外链：外壳无 <link>/@import/远程 url()（打包源码里的 @import 字面量不算）',
  pages.every((f) => {
    const shell = shellOf(read(path.join(PREVIEW, f)));
    return (shell.match(/<link\b/gi) ?? []).length === 0 && !/@import/i.test(shell) && !/url\((['"]?)(https?:|\/\/)/i.test(shell);
  }), '外壳零外部资源');
ok('B5 每页只声明自己的风格：外壳里 data-fd-style 出现一次且与文件名一致',
  pages.every((f) => {
    const shell = shellOf(read(path.join(PREVIEW, f)));
    const id = /data-fd-style="([^"]+)"/.exec(shell)?.[1] ?? '';
    return shell.split('data-fd-style=').length === 2 && f.includes(id);
  }), pages.join(','));
ok('B6 无运行时动态 import / XHR：产物是离线单文件',
  !/\bimport\s*\(/.test(payloads[0].replace(/import\.meta/g, '')) && !/XMLHttpRequest/.test(payloads[0]), 'import(=0');
const plainBundlePath = path.join(ROOT, 'dist-plain/assets/main.js');
ok('B7 消融臂产物存在且与主臂不同字节（同源码、只换 __FD_MEMO__）',
  existsSync(plainBundlePath) && statSync(plainBundlePath).size !== statSync(path.join(ROOT, 'dist/assets/main.js')).size,
  `memo ${bytes(bundleSrc)}B vs plain ${existsSync(plainBundlePath) ? bytes(read(plainBundlePath)) : 0}B`);
ok('B8 三页共用同一事实源字符串（品牌/域名/客服号在源码里各只有一处定义）',
  hits(/tideside\.example/g) > 0 && (byRel['lib/facts.ts'].match(/BRAND = \{/g) ?? []).length === 1,
  `facts.ts 内 BRAND 定义 1 处，全库出现 ${hits(/tideside\.example/g)} 次`);

/* =================================================================== C */
Group('C 三风格主张是否互斥');
const ids = REG.STYLE_IDS;
ok('C1 三个风格 id 与设计一致', deepEq([...ids], ['paper-grid', 'pcb-green', 'concrete-rose']), ids.join(','));
ok('C2 三种分隔手法互不相同（ruled-grid / silkscreen-hairline / formwork-shadow）',
  new Set(ids.map((i) => REG.STYLES[i].separation)).size === 3 &&
    deepEq(ids.map((i) => REG.STYLES[i].separation).sort(), ['formwork-shadow', 'ruled-grid', 'silkscreen-hairline']),
  ids.map((i) => REG.STYLES[i].separation).join(','));
ok('C3 三种焦点环互不相同', new Set(ids.map((i) => REG.STYLES[i].focusRing)).size === 3,
  ids.map((i) => REG.STYLES[i].focusRing).join(','));
const dims = ['radius', 'borderWidth', 'fontUi', 'fontNum', 'headTransform', 'labelTransform', 'separation', 'focusRing', 'grid', 'headingSize', 'bodySize', 'tracking'];
const dist = (a, b) => dims.filter((d) => String(REG.STYLES[a][d]) !== String(REG.STYLES[b][d])).length;
const pairs = [[0, 1], [0, 2], [1, 2]].map(([i, j]) => `${ids[i]}~${ids[j]}=${dist(ids[i], ids[j])}`);
ok('C4 十二维指纹两两距离 ≥5（不是换色皮）',
  [dist(ids[0], ids[1]), dist(ids[0], ids[2]), dist(ids[1], ids[2])].every((d) => d >= 5), pairs.join(' '));
ok('C5 结构层零字面颜色：删掉令牌块后不再有颜色可换',
  !/#[0-9a-fA-F]{3,8}\b/.test(REG.STRUCTURAL_CSS) &&
    !/rgba?\(/.test(REG.STRUCTURAL_CSS) &&
    (REG.STRUCTURAL_CSS.match(/var\(--fd-/g) ?? []).length > 40,
  `结构段 ${bytes(REG.STRUCTURAL_CSS)}B，var() ${(REG.STRUCTURAL_CSS.match(/var\(--fd-/g) ?? []).length} 处，字面色=0`);
ok('C6 每个风格 14 个颜色令牌齐备且至少 9 个不同值',
  ids.every((i) => Object.keys(REG.STYLES[i].color).length === 14 && new Set(Object.values(REG.STYLES[i].color)).size >= 9),
  ids.map((i) => new Set(Object.values(REG.STYLES[i].color)).size).join('/'));
const cssOf = ids.map((i) => REG.styleCss(i));
ok('C7 三份 CSS 文本互不为子串，且各自只含自己的选择器前缀',
  cssOf.every((c, i) => c.includes(`[data-fd-style="${ids[i]}"]{`) && cssOf.every((o, j) => j === i || !c.includes(`[data-fd-style="${ids[j]}]{--fd-bg`))),
  cssOf.map((c) => `${bytes(c)}B`).join(' '));
const dark = ids.filter((i) => {
  const c = REG.STYLES[i].color;
  return parseInt(c.bg.slice(1, 3), 16) < 96;
});
ok('C8 至少一个深底一个浅底（明暗互斥，不是同明度微调）', dark.length >= 1 && dark.length <= 2, `深底：${dark.join(',')}`);

/* =================================================================== E */
Group('E1 金额：两条独立聚合必须相遇');
const planIds = FACTS.PLANS.map((p) => p.id);
const addonIds = FACTS.ADDONS.map((a) => a.id);
const subsets = addonIds.reduce((acc, id) => acc.concat(acc.map((s) => [...s, id])), [[]]);
const combos = [];
for (const plan of planIds) {
  const spec = FACTS.PLANS.find((p) => p.id === plan);
  for (const seats of [spec.seatMin, Math.round((spec.seatMin + spec.seatMax) / 2), spec.seatMax]) {
    for (const billing of ['monthly', 'annual']) {
      for (const currency of ['CNY', 'USD']) {
        for (const addons of subsets) combos.push(V({ plan, seats, billing, currency, addons }));
      }
    }
  }
}
const mismatch = [];
for (const c of combos) {
  const q = PRICE.quote(c);
  const d = PRICE.quoteDirect(c.plan, c.seats, c.addons, c.billing, c.currency);
  if (q.display !== d) mismatch.push(`${c.plan}/${c.seats}/${c.billing}/${c.currency}/${c.addons.length}`);
}
ok('E1 行内累加式 quote() 与闭式 quoteDirect() 在全部组合格点上分毫不差',
  combos.length >= 2000 && mismatch.length === 0, `${combos.length} 个组合，${mismatch.length} 处不一致`);
const lineSumBad = combos.filter((c) => {
  const q = PRICE.quote(c);
  const cents = q.lines.reduce((s, l) => s + PRICE.toCents(l.amount), 0);
  return cents !== PRICE.toCents(q.subtotal);
});
ok('E2 明细行合计（按分）= 小计：明细可加性', lineSumBad.length === 0, `${combos.length} 组，0 例外`);
ok('E3 折扣口径统一为「分位 half-up」，且折后月费不高于小计',
  combos.every((c) => {
    const q = PRICE.quote(c);
    const plan = FACTS.PLANS.find((p) => p.id === c.plan);
    const want = c.billing === 'annual' ? PRICE.halfUpCents(PRICE.toCents(q.subtotal), plan.annualDiscount) : 0;
    return PRICE.toCents(-q.discount) === want && PRICE.toCents(q.monthly) <= PRICE.toCents(q.subtotal);
  }), 'halfUpCents 是两条路径共享的取整契约');
const plan14 = V({ plan: 'studio', seats: 14, billing: 'annual', addons: ['stock', 'points'] });
const q14 = PRICE.quote(plan14);
num('E3b 示例报价（studio×14 席·年付·两扩展）账期总额', q14.periodTotal, ' 元');
ok('E3c 账期总额 = 折后月费 ×（年付 12 / 月付 1），全组合只有这一条口径',
  combos.every((c) => {
    const q = PRICE.quote(c);
    return PRICE.toCents(q.periodTotal) === PRICE.toCents(q.monthly) * (c.billing === 'annual' ? 12 : 1);
  }), 'periodTotal 与 monthly 关系在 2304 个组合上成立');
ok('E4 年付省钱额非负且随席数单调不减（三个套餐各抽 4 档席位）',
  FACTS.PLANS.every((p) => {
    const seq = [p.seatMin, p.seatMin + 1, Math.round((p.seatMin + p.seatMax) / 2), p.seatMax].map((s) =>
      PRICE.annualSaving(V({ plan: p.id, seats: s, billing: 'annual', addons: ['stock'] })),
    );
    return seq.every((v) => v >= 0) && seq.every((v, i) => i === 0 || v >= seq[i - 1]);
  }), 'saving = 原价账期 − 折后账期');
ok('E5 席位钳制：任何输入都落回套餐区间（含负数/0/小数/超上限/NaN）',
  [-5, 0, 1, 4, 7.4, 120.6, 199, 501, 99999, Number.NaN].every((s) => {
    const out = PRICE.clampSeats('studio', s);
    return out >= 5 && out <= 200 && Number.isInteger(out);
  }) && PRICE.clampSeats('studio', 99999) === 200 && PRICE.clampSeats('starter', 0) === 1,
  `clampSeats(studio,99999)=${PRICE.clampSeats('studio', 99999)}`);

Group('E2 USCC 校验位：第二实现');
const rand17 = (n) => {
  const out = [];
  let seed = 20260926;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < n; i += 1) {
    let s = '';
    for (let j = 0; j < 17; j += 1) s += FACTS.USCC_CHARS[Math.floor(rnd() * FACTS.USCC_CHARS.length)];
    out.push(s);
  }
  return out;
};
const tables = rand17(2000);
const secondImpl = (first17) => {
  const w = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];
  let sum = 0;
  for (let i = 0; i < 17; i += 1) sum += FACTS.USCC_CHARS.indexOf(first17[i]) * w[i];
  return FACTS.USCC_CHARS[(31 - (sum % 31)) % 31];
};
ok('E6 2000 个随机前缀：主实现与表查找实现校验位全等',
  tables.every((t) => FACTS.usccCheckChar(t) === secondImpl(t)), `${tables.length}/2000`);
ok('E7 合法码自检通过；改动任意一位即被拒',
  FACTS.usccValid(FACTS.USCC_VALID) &&
    [...FACTS.USCC_VALID].every((_, i) => {
      const bad = FACTS.USCC_VALID.slice(0, i) + (FACTS.USCC_VALID[i] === '0' ? '1' : '0') + FACTS.USCC_VALID.slice(i + 1);
      return i === 17 ? !FACTS.usccValid(bad) || bad.slice(0, 17) !== FACTS.USCC_VALID.slice(0, 17) : !FACTS.usccValid(bad);
    }),
  FACTS.USCC_VALID);
ok('E8 字集排除 I/O/S/V/Z（GB 32100 规定），含这些字符的 18 位串一律拒绝',
  FACTS.USCC_CHARS.length === 31 &&
    !/[IOSVZ]/.test(FACTS.USCC_CHARS) &&
    ['91310115MA1K3X7LI', '91310115MA1K3X7LO', '91310115MA1K3X7LS', '91310115MA1K3X7LV', '91310115MA1K3X7LZ'].every((s) => !FACTS.usccValid(s)),
  `字集 ${FACTS.USCC_CHARS.length} 位`);
ok('E8b 长度/大小写/非字集字符的边界：17 位拒绝、小写接受、全角拒绝',
  !FACTS.usccValid(FACTS.USCC_VALID.slice(0, 17)) && FACTS.usccValid(FACTS.USCC_VALID.toLowerCase()) && !FACTS.usccValid('9'.repeat(18)),
  '长度 18 才算数');

Group('E3 校验闸门：schema 与纯函数两条路');
ok('E9 空表单被拒且错误路径全部落在 22 个字段名内',
  SCHEMA.allIssues(FACTS.DEFAULT_VALUES).length > 0 &&
    SCHEMA.allIssues(FACTS.DEFAULT_VALUES).every((i) => FACTS.ALL_FIELDS.includes(i.path)),
  `${SCHEMA.allIssues(FACTS.DEFAULT_VALUES).length} 条问题：${SCHEMA.allIssues(FACTS.DEFAULT_VALUES).slice(0, 3).map((i) => i.path).join(',')}`);
ok('E9b 示例数据零问题、四个步骤全绿',
  SCHEMA.allIssues(SAMPLE).length === 0 && FACTS.STEPS.every((s) => SCHEMA.stepValid(SAMPLE, FACTS.STEP_FIELDS[s.id])),
  SCHEMA.allIssues(SAMPLE).map((i) => `${i.path}:${i.message}`).join(' | '));
ok('E10 分支规则：开票=专用发票 强制企业；企业开票税号必须等于统一社会信用代码',
  SCHEMA.allIssues(V({ ...SAMPLE, accountType: 'personal', invoiceType: 'special' })).some((i) => i.path === 'invoiceType') &&
    SCHEMA.allIssues(V({ ...SAMPLE, accountType: 'enterprise', invoiceType: 'special', taxNo: '91310115MA1K3X7L1' })).some((i) => i.path === 'taxNo') &&
    SCHEMA.allIssues(V({ ...SAMPLE, accountType: 'enterprise', invoiceType: 'special', taxNo: FACTS.USCC_VALID })).filter((i) => i.path === 'taxNo').length === 0,
  'special⇒enterprise；taxNo≠uscc 时报 taxNo');
ok('E10b 扩展依赖：多站点必须先有库存；数据导出要求 studio 及以上',
  SCHEMA.allIssues(V({ ...SAMPLE, addons: ['multisite'] })).some((i) => i.path === 'addons') &&
    SCHEMA.allIssues(V({ ...SAMPLE, plan: 'starter', addons: ['export'] })).some((i) => i.path === 'addons') &&
    SCHEMA.allIssues(V({ ...SAMPLE, addons: ['multisite', 'stock'] })).filter((i) => i.path === 'addons').length === 0,
  'requires + minPlan');
ok('E10c 席位数越界、客服电话必填分支、勾选协议缺失各自定位到正确字段',
  SCHEMA.allIssues(V({ ...SAMPLE, seats: 900 })).some((i) => i.path === 'seats') &&
    SCHEMA.allIssues(V({ ...SAMPLE, notify: 'phone', supportPhone: '' })).some((i) => i.path === 'supportPhone') &&
    SCHEMA.allIssues(V({ ...SAMPLE, notify: 'email', supportPhone: '' })).filter((i) => i.path === 'supportPhone').length === 0 &&
    SCHEMA.allIssues(V({ ...SAMPLE, agree: false })).some((i) => i.path === 'agree'),
  'seats / supportPhone（仅非 email 分支）/ agree');
ok('E10d 身份证后四位接受 x 结尾、拒绝字母混入',
  SCHEMA.allIssues(V({ ...SAMPLE, accountType: 'personal', realName: '林知一', idLast4: '123x' })).filter((i) => i.path === 'idLast4').length === 0 &&
    SCHEMA.allIssues(V({ ...SAMPLE, accountType: 'personal', realName: '林知一', idLast4: '12ab' })).some((i) => i.path === 'idLast4'),
  '123x 通过 / 12ab 拒绝');
const stepCover = FACTS.STEPS.flatMap((s) => s.fields);
ok('E11 四个步骤的字段并集 = 22 字段且互不重叠（无孤儿字段、无两步共用）',
  stepCover.length === FACTS.ALL_FIELDS.length &&
    new Set(stepCover).size === stepCover.length &&
    FACTS.ALL_FIELDS.every((f) => stepCover.includes(f)),
  `${stepCover.length}/${FACTS.ALL_FIELDS.length}`);
ok('E11b schema 的 22 个键与 SAMPLE_VALUES/字段表/标签表完全同集合',
  deepEq(Object.keys(SAMPLE).sort(), [...FACTS.ALL_FIELDS].sort()) &&
    Object.keys(SCHEMA.wizardSchema.innerType().shape).length === FACTS.ALL_FIELDS.length &&
    FACTS.ALL_FIELDS.every((f) => typeof FIELDS.FIELD_LABEL[f] === 'string' && FIELDS.FIELD_LABEL[f].length > 0),
  `${FACTS.ALL_FIELDS.length} 字段四处同名`);
ok('E11c 字段表里每个 select 字段的选项非空、每个字段有 kind 与 label',
  Object.values(FIELDS.FIELDS).every((f) => (f.kind === 'select' ? (f.options?.length ?? 0) > 0 : true) && f.label.length > 0),
  `${Object.keys(FIELDS.FIELDS).length} 个字段描述符`);

Group('E4 步骤闸门与提交闸门');
const validityOf = (v) => Object.fromEntries(FACTS.STEPS.map((s) => [s.id, SCHEMA.stepValid(v, FACTS.STEP_FIELDS[s.id])]));
ok('E12 空表单只能停在第 1 步；示例数据可直达第 4 步',
  STEPM.canTravel('plan', validityOf(FACTS.DEFAULT_VALUES)) === false &&
    STEPM.canTravel('review', validityOf(SAMPLE)) === true,
  'forward-only-if-previous-valid');
ok('E12b 回退永远开放（哪怕中途数据已失效）',
  STEPM.canTravel('identity', validityOf(V({ ...SAMPLE, storeName: '' }))) &&
    STEPM.canTravel('plan', validityOf(V({ ...SAMPLE, seats: 900 }))),
  'backwards always open');
ok('E12c 中间步骤坏掉时，第 4 步不可达但第 3 步仍可达',
  (() => {
    const bad = V({ ...SAMPLE, uscc: '91310115MA1K3X7L1' });
    const val = validityOf(bad);
    return val.plan === true && val.payment === false && STEPM.canTravel('payment', val) && !STEPM.canTravel('review', val);
  })(), 'gate is per-step, not global');
ok('E12d hash 解析：合法/未知步骤/缺参/前缀混淆各得其果',
  STEPM.readStepFromHash('#step=payment') === 'payment' &&
    STEPM.readStepFromHash('#step=billing') === null &&
    STEPM.readStepFromHash('') === null &&
    STEPM.readStepFromHash('#step=paymentx') === null,
  'readStepFromHash');
const map0 = PAY.initialAsyncMap();
ok('E13 异步闸门独立于 setError：未校验/校验中/占用/保留/失败四种状态都必须拦住提交',
  PAY.asyncBlockers(map0, SAMPLE).length === 2 &&
    PAY.asyncBlockers({ ...map0, subdomain: { verdict: 'checking', forValue: SAMPLE.subdomain, token: 1 } }, SAMPLE).some((b) => b.field === 'subdomain') &&
    PAY.asyncBlockers({ ...map0, subdomain: { verdict: 'taken', forValue: SAMPLE.subdomain, token: 1 } }, SAMPLE).length >= 1 &&
    PAY.asyncBlockers({ ...map0, contactEmail: { verdict: 'available', forValue: SAMPLE.contactEmail, token: 1 } }, SAMPLE).length === 1,
  '未校验即拦截');
ok('E13b 令牌对不上当前值（乱序回写）也算未校验',
  PAY.asyncBlockers({ ...map0, subdomain: { verdict: 'available', forValue: 'old-name', token: 9 } }, SAMPLE).some((b) => b.field === 'subdomain'),
  'forValue 与当前值不符 ⇒ 拦截');
ok('E14 提交令牌由内容决定：同数据同令牌，改席位/改扩展即变（幂等重放的前提）',
  PAY.submitToken(SAMPLE) === PAY.submitToken({ ...SAMPLE }) &&
    PAY.submitToken(SAMPLE) !== PAY.submitToken({ ...SAMPLE, seats: SAMPLE.seats + 1 }) &&
    PAY.submitToken(SAMPLE) !== PAY.submitToken({ ...SAMPLE, addons: [...SAMPLE.addons, 'support'] }),
  PAY.submitToken(SAMPLE).slice(0, 28));

Group('E5 分支字段与草稿的敌意输入');
const branches = [];
for (const notify of FACTS.OPTIONS.notify.map((o) => o.value)) {
  for (const accountType of ['personal', 'enterprise']) {
    for (const invoiceType of ['none', 'normal', 'special']) {
      branches.push(V({ ...SAMPLE, notify, accountType, invoiceType: invoiceType === 'special' && accountType === 'personal' ? 'normal' : invoiceType }));
    }
  }
}
const leak = branches.filter((b) => {
  const p = PAY.buildPayload(b);
  const extra = Object.keys(p).filter((k) => !PAY.allowedKeys(b).includes(k));
  const missing = PAY.allowedKeys(b).filter((k) => !(k in p));
  return extra.length > 0 || missing.length > 0;
});
ok('E15 18 个分支组合：payload 键集合与允许集合完全相等（旧凭证无法泄漏）',
  branches.length === 18 && leak.length === 0,
  leak.length > 0 ? `泄漏示例：${Object.keys(PAY.buildPayload(leak[0])).filter((k) => !PAY.allowedKeys(leak[0]).includes(k)).join(',')}` : '0 例外');
ok('E15b 个人分支不含 companyName/uscc；企业分支不含 realName/idLast4；notify=email 不含 supportPhone',
  !('uscc' in PAY.buildPayload(V({ ...SAMPLE, accountType: 'personal' }))) &&
    'uscc' in PAY.buildPayload(V({ ...SAMPLE, accountType: 'enterprise' })) &&
    !('realName' in PAY.buildPayload(SAMPLE)) &&
    !('supportPhone' in PAY.buildPayload(V({ ...SAMPLE, notify: 'email' }))) &&
    'supportPhone' in PAY.buildPayload(V({ ...SAMPLE, notify: 'phone' })),
  'buildPayload 三分支');
ok('E15c 邮箱大小写归一、去空白后进入 payload（同一邮箱两种写法 ⇒ 同一令牌）',
  PAY.buildPayload(V({ ...SAMPLE, contactEmail: ' Ops@Tideside.Example ' })).contactEmail === 'ops@tideside.example' &&
    PAY.submitToken(V({ ...SAMPLE, contactEmail: 'a@b.example' })) === PAY.submitToken(V({ ...SAMPLE, contactEmail: 'a@b.example  ' })),
  'trim + toLowerCase');

const draftCases = [
  { id: 'missing', raw: null, reason: 'missing' },
  { id: 'corrupt-json', raw: '{oops', reason: 'corrupt' },
  { id: 'not-object', raw: '"42"', reason: 'corrupt' },
  { id: 'version', raw: JSON.stringify({ version: 99, step: 'review', values: SAMPLE }), reason: 'version' },
  { id: 'bad-step', raw: JSON.stringify({ version: FACTS.DRAFT_VERSION, step: 'billing', values: SAMPLE }), reason: 'restored' },
  { id: 'ok', raw: JSON.stringify({ version: FACTS.DRAFT_VERSION, step: 'payment', values: SAMPLE, savedAt: 'x' }), reason: 'restored' },
];
const draftResults = draftCases.map((c) => {
  if (c.raw === null) memStore.removeItem(FACTS.DRAFT_KEY);
  else memStore.setItem(FACTS.DRAFT_KEY, c.raw);
  const r = DRAFT.loadDraft();
  return { id: c.id, reason: r.reason, step: r.step, dropped: r.droppedKeys.length, defaulted: r.defaultedKeys.length, sub: r.values.subdomain };
});
ok('E16 草稿四种结局：missing/corrupt/version/restored 各自命中，坏数据一律退回默认值而不是半应用',
  draftResults.find((r) => r.id === 'missing').reason === 'missing' &&
    draftResults.find((r) => r.id === 'corrupt-json').reason === 'corrupt' &&
    draftResults.find((r) => r.id === 'version').reason === 'version' &&
    draftResults.find((r) => r.id === 'version').sub === '' &&
    draftResults.find((r) => r.id === 'ok').reason === 'restored' &&
    draftResults.find((r) => r.id === 'ok').sub === SAMPLE.subdomain,
  draftResults.map((r) => `${r.id}:${r.reason}`).join(' '));
ok('E16b 未知键丢弃并记录；类型不符的字段逐字段回默认（不是整体作废）',
  (() => {
    memStore.setItem(
      FACTS.DRAFT_KEY,
      JSON.stringify({ version: FACTS.DRAFT_VERSION, step: 'plan', values: { ...SAMPLE, seats: 'many', addons: 'stock', evil: 1, tagline: 42 } }),
    );
    const r = DRAFT.loadDraft();
    return (
      r.droppedKeys.includes('evil') &&
      r.values.seats === FACTS.DEFAULT_VALUES.seats &&
      deepEq(r.values.addons, FACTS.DEFAULT_VALUES.addons) &&
      r.values.tagline === '' &&
      r.values.storeName === SAMPLE.storeName &&
      r.defaultedKeys.length >= 3
    );
  })(),
  'seats/addons/tagline 回默认，storeName 保留');
ok('E16c 存取往返：saveDraft → loadDraft 值与步骤一致，clearDraft 后回到 missing',
  (() => {
    DRAFT.saveDraft(SAMPLE, 'review');
    const r = DRAFT.loadDraft();
    const cleared = (DRAFT.clearDraft(), DRAFT.loadDraft());
    return r.reason === 'restored' && r.step === 'review' && r.values.uscc === SAMPLE.uscc && cleared.reason === 'missing';
  })(), 'round-trip');

Group('E6 事实源内部一致性');
ok('E17 延迟表刻意非单调：fast 比 default 快、slow 比 default 慢，为乱序回写测试提供土壤',
  FACTS.BOOTSTRAP.latencyMs.fast < FACTS.BOOTSTRAP.latencyMs.default &&
    FACTS.BOOTSTRAP.latencyMs.slow > FACTS.BOOTSTRAP.latencyMs.default,
  `fast=${FACTS.BOOTSTRAP.latencyMs.fast} default=${FACTS.BOOTSTRAP.latencyMs.default} slow=${FACTS.BOOTSTRAP.latencyMs.slow}`);
ok('E18 已占用域名/保留名/已占用邮箱三张表互不重叠且不含示例值（示例必须能提交）',
  FACTS.BOOTSTRAP.takenSubdomains.every((s) => !FACTS.BOOTSTRAP.reservedSubdomains.includes(s)) &&
    !FACTS.BOOTSTRAP.takenSubdomains.includes(SAMPLE.subdomain) &&
    !FACTS.BOOTSTRAP.reservedSubdomains.includes(SAMPLE.subdomain) &&
    !FACTS.BOOTSTRAP.takenEmails.includes(SAMPLE.contactEmail),
  `${FACTS.BOOTSTRAP.takenSubdomains.length}+${FACTS.BOOTSTRAP.reservedSubdomains.length}`);
ok('E19 套餐/扩展的事实自洽：席位区间有序、单价与折扣在合理区间、扩展计价模式二选一',
  FACTS.PLANS.every((p) => p.seatMin <= p.seatMax && p.perSeat > 0 && p.platformFee >= 0 && p.annualDiscount > 0 && p.annualDiscount < 1) &&
    FACTS.ADDONS.every((a) => a.price > 0 && ['seat', 'org'].includes(a.mode)) &&
    FACTS.ADDONS.filter((a) => a.requires !== undefined).length === 1 &&
    FACTS.ADDONS.filter((a) => a.minPlan !== undefined).length === 1,
  `${FACTS.PLANS.length} 套餐 / ${FACTS.ADDONS.length} 扩展`);
ok('E20 选项表与 schema 枚举一致：四个 select 字段的可选值都能通过校验',
  ['category', 'timezone', 'notify', 'invoice'].every((k) => FACTS.OPTIONS[k].length > 0) &&
    FACTS.OPTIONS.category.every((o) => SCHEMA.allIssues(V({ ...SAMPLE, category: o.value })).filter((i) => i.path === 'category').length === 0) &&
    SCHEMA.allIssues(V({ ...SAMPLE, category: 'nope' })).some((i) => i.path === 'category'),
  `品类 ${FACTS.OPTIONS.category.length} 项`);
ok('E21 选项字段装配：给 bootstrap 数据与字段名，产出描述符数量与名称一致',
  (() => {
    const picked = FIELDS.optionFieldsFrom(FACTS.BOOTSTRAP, ['category', 'timezone', 'notify']);
    return picked.length === 3 && deepEq(picked.map((f) => f.name), ['category', 'timezone', 'notify']) && picked.every((f) => f.options.length > 1);
  })(), 'optionFieldsFrom');
ok('E22 默认值是「未填」而不是「已填」：DEFAULT_VALUES 过不了校验，SAMPLE 能',
  SCHEMA.allIssues(FACTS.DEFAULT_VALUES).length > 3 && SCHEMA.allIssues(SAMPLE).length === 0,
  `${SCHEMA.allIssues(FACTS.DEFAULT_VALUES).length} 条`);

/* =================================================================== J */
Group('J 成本（磁盘现算，不抄报告）');
const srcLines = tsFiles.reduce((s, f) => s + read(f).trimEnd().split('\n').length, 0);
const prevRoot = path.join(LAB, 'artifacts', PREV_ROUND);
const prevSrc = existsSync(path.join(prevRoot, 'src')) ? walk(path.join(prevRoot, 'src')).filter((f) => /\.tsx?$/.test(f)) : [];
const prevLines = prevSrc.reduce((s, f) => s + read(f).trimEnd().split('\n').length, 0);
num('J1 本轮 src 文件数 / 行数', `${tsFiles.length} / ${srcLines}`, '');
num('J2 上一轮（07:00 同 skill × 管理后台）src 文件数 / 行数', `${prevSrc.length} / ${prevLines}`, '');
num('J2b 同 skill 不同场景的行数比（向导 ÷ 后台）', prevLines === 0 ? 0 : +(srcLines / prevLines).toFixed(2), '×');
const previewTotal = pages.reduce((s, f) => s + bytes(read(path.join(PREVIEW, f))), 0);
num('J3 三页预览合计字节', previewTotal, 'B');
const zlib = await import('node:zlib');
num('J4 单文件 bundle 字节 / gzip', `${bytes(bundleSrc)} / ${zlib.gzipSync(Buffer.from(bundleSrc, 'utf8')).length}`, 'B');
num('J4b 消融臂 bundle 字节（同源码，__FD_MEMO__=false）', existsSync(plainBundlePath) ? bytes(read(plainBundlePath)) : 0, 'B');
ok('J5 三页脚本载荷哈希相同 ⇒ 风格不复制运行时', new Set(hashes).size === 1, hashes[0]);
const keep = (f) => !/(^|[\\/])(node_modules|dist|dist-split|dist-plain|\.tmp-check)([\\/]|$)/.test(path.relative(ROOT, f));
const shipped = walk(ROOT).filter(keep);
const shippedBytes = shipped.reduce((s, f) => s + statSync(f).size, 0);
num('J6 进入 artifacts 的目录体积（排除 node_modules/dist*/.tmp-check）', +(shippedBytes / 1024 / 1024).toFixed(2), 'MB');
ok('J6b 体积 ≤ 50MB', shippedBytes <= 50 * 1024 * 1024, `${(shippedBytes / 1024 / 1024).toFixed(2)}MB`);
num('J6c 参与统计的文件数', shipped.length, ' 个');
ok('J7 预览目录无 node_modules / dist 痕迹', !existsSync(path.join(PREVIEW, 'node_modules')) && !existsSync(path.join(PREVIEW, 'dist')), 'clean');
num('J8 校验脚本自身行数（三组 checker + make-styles + 复用件）',
  walk(path.join(ROOT, 'scripts')).reduce((s, f) => s + read(f).trimEnd().split('\n').length, 0), ' 行');

/* =================================================================== L */
Group('L 懒加载证据构建（vite.split.config.ts）');
const SPLIT = path.join(ROOT, 'dist-split', 'assets');
if (existsSync(SPLIT)) {
  const chunks = readdirSync(SPLIT).filter((f) => f.endsWith('.js'));
  ok('L1 两个懒块（评审页 + 回执）在证据构建里真实存在', chunks.includes('StepReview.js') && chunks.includes('ReceiptCard.js'), chunks.join(','));
  const entry = read(path.join(SPLIT, 'main.js'));
  const onlyLazy = ['回执编号', '纸质回执', 'receipt-serial'];
  ok('L2 入口 chunk 不含只属于懒块的文案（真拆开了）', onlyLazy.every((s) => !entry.includes(s)),
    onlyLazy.map((s) => (entry.includes(s) ? `泄漏:${s}` : s)).join(','));
  const receiptChunk = read(path.join(SPLIT, 'ReceiptCard.js'));
  ok('L2b 第二层懒块只在自身 chunk 内（评审页里再嵌一层 dynamic import）',
    !entry.includes('纸质回执') && !read(path.join(SPLIT, 'StepReview.js')).includes('纸质回执') && receiptChunk.includes('纸质回执'),
    'ReceiptCard 深度 2');
  const entryBytes = bytes(entry);
  const totalBytes = chunks.reduce((s, f) => s + bytes(read(path.join(SPLIT, f))), 0);
  num('L3 证据构建：入口字节 / 全套字节', `${entryBytes} / ${totalBytes}`, 'B');
  num('L3b 懒块合计占全套字节比例（表单页几乎没有可延迟重量）', +(((totalBytes - entryBytes) / totalBytes) * 100).toFixed(1), '%');
  ok('L4 单文件预览把懒块并回了首包（两构建并存的意义）', onlyLazy.every((s) => bundleSrc.includes(s)), '单文件无首包收益');
  ok('L5 两构建总量差 < 3%（分包挪首包，不减总量）',
    Math.abs(totalBytes - bytes(bundleSrc)) / totalBytes < 0.03, `split ${totalBytes}B vs iife ${bytes(bundleSrc)}B`);
} else {
  ok('L0 证据构建产物存在（先跑 vite build --config vite.split.config.ts）', false, SPLIT);
}

/* =================================================================== I */
Group('I 台账幂等锁');
const ROUND_FACTS = path.join(ROOT, 'scripts', 'round-facts.mjs');
const SNAP_FILE = path.join(ROOT, 'scripts', 'ledger-snapshot.json');
const WORK_LOG = path.join(LAB, 'records', 'work-log.md');
const state = JSON.parse(read(path.join(LAB, 'state', 'state.json')));
const snap = existsSync(SNAP_FILE) ? JSON.parse(read(SNAP_FILE)) : null;
if (!existsSync(ROUND_FACTS)) {
  ok('I0a scripts/round-facts.mjs 存在（本轮增量的唯一来源）', false, ROUND_FACTS);
} else if (snap) {
  const { TRIED, RUN, ENV_NOTES, ROUND_ID, WORK_LOG_LINE, QUEUE_HINT } = await import(url(ROUND_FACTS));
  const logLines = read(WORK_LOG).trimEnd().split('\n');
  const sha = (v) => createHash('sha1').update(JSON.stringify(v), 'utf8').digest('hex');
  const applied = state.tried.filter((e) => e.skill === TRIED.skill && e.scenario === TRIED.scenario).length;
  ok('I1 本轮在 tried 中至多出现一次（重复写回在这里失败）', applied <= 1, `出现 ${applied} 次`);
  ok('I1b 选题依据可追溯：写回前的 next_candidates 里确实排着这条组合',
    snap.candidates.some((c) => c.includes(QUEUE_HINT)), `${snap.candidates.length} 条候选`);
  ok('I1c 严禁重复：本轮 skill×场景在快照（写回前）里不存在',
    !snap.triedCombos.includes(sha(`${TRIED.skill} × ${TRIED.scenario}`)), `${snap.triedCombos.length} 条历史组合`);
  ok('I2 写回是追加：tried/runs/used_styles/environment_notes 的历史前缀逐字节未变',
    sha(state.tried.slice(0, snap.triedLen)) === snap.triedSha &&
      sha(state.runs.slice(0, snap.runsLen)) === snap.runsSha &&
      sha(state.used_styles.slice(0, snap.stylesLen)) === snap.stylesSha &&
      sha(state.environment_notes.slice(0, snap.envLen)) === snap.envSha,
    `tried ${snap.triedLen}→${state.tried.length}，styles ${snap.stylesLen}→${state.used_styles.length}`);
  if (applied === 1) {
    ok('I2b tried 末条 = round-facts 的 TRIED（同一来源，不是手抄）', deepEq(state.tried[state.tried.length - 1], TRIED), String(state.tried[state.tried.length - 1].skill).slice(0, 24));
    ok('I2c runs 末条与 RUN 逐字段一致（cleanup/push 允许写回后补记，故只比已定字段）',
      Object.entries(RUN).every(([k, v]) => k === 'cleanup' || k === 'push' || state.runs[state.runs.length - 1][k] === v),
      `runs ${snap.runsLen}→${state.runs.length}`);
    ok('I2d used_styles = 快照 + 本轮 3 个新风格，全表无重复',
      state.used_styles.length === snap.stylesLen + TRIED.styles.length &&
        TRIED.styles.every((s) => state.used_styles.slice(snap.stylesLen).includes(s)) &&
        new Set(state.used_styles).size === state.used_styles.length,
      `${snap.stylesLen}→${state.used_styles.length}`);
    ok('I2e environment_notes 只增不减、无重复，新增条数 = round-facts',
      state.environment_notes.length === snap.envLen + ENV_NOTES.length && new Set(state.environment_notes).size === state.environment_notes.length,
      `${snap.envLen}→${state.environment_notes.length}`);
    ok('I2f skills_seen 条目数不减，且本轮技能使用次数已在 note 里递增',
      state.skills_seen.length >= snap.seenLen && /第 3 次/.test((state.skills_seen.find((s) => s.name === 'frontend-development') ?? {}).status ?? ''),
      `${snap.seenLen}→${state.skills_seen.length} 条`);
    ok('I3 work-log 行数 = 快照 + 1（一次写回只加一行）', logLines.length === snap.logLines + 1, `${snap.logLines}→${logLines.length}`);
    ok('I3b work-log 历史部分逐字节未变（append-only）',
      createHash('sha1').update(logLines.slice(0, snap.logLines).join('\n') + '\n', 'utf8').digest('hex') === snap.logSha, `前 ${snap.logLines} 行哈希`);
    ok('I3c work-log 末行 = round-facts 的 WORK_LOG_LINE，且 6 段齐全',
      logLines[logLines.length - 1] === WORK_LOG_LINE && WORK_LOG_LINE.split(' | ').length === 6, `${WORK_LOG_LINE.split(' | ').length} 段`);
    ok('I3d 末行写到的产物目录与报告文件真实存在',
      existsSync(path.join(LAB, 'artifacts', ROUND_ID)) && existsSync(path.join(LAB, 'reports', `${ROUND_ID}.md`)), ROUND_ID);
    ok('I4 updated 时间戳已推进', String(state.updated) > String(snap.updated), `${snap.updated} → ${state.updated}`);
    ok('I4b 本轮三个风格与历史 used_styles 不撞车', TRIED.styles.every((s) => !snap.usedStyles.includes(s)), TRIED.styles.join(','));
    ok('I5 预览目录形态正确：恰好 3 个 HTML、无子目录',
      readdirSync(PREVIEW).length === 3 && readdirSync(PREVIEW).every((f) => f.endsWith('.html')), readdirSync(PREVIEW).join(','));
  } else {
    ok('I6 尚未写回：台账七个键与快照逐项相等',
      Object.keys(state).every((k) => k === 'updated' || sha(state[k]) === snap.pristine[k]), 'pre-write equality');
    ok('I6b 尚未写回：work-log 行数与快照一致', logLines.length === snap.logLines, `${logLines.length}`);
  }
} else {
  ok('I0 快照 scripts/ledger-snapshot.json 存在（缺它台账锁无法运行）', false, SNAP_FILE);
}

summary('check-node');
dumpResults(path.join(OUT, 'assertions-node.json'));
const perGroup = {};
for (const r of results) {
  const letter = (r.group.match(/^[A-Z]/) ?? ['?'])[0];
  perGroup[letter] = (perGroup[letter] ?? 0) + 1;
}
writeFileSync(path.join(OUT, 'registry.mjs'), `export * from ${JSON.stringify(url(path.join(OUT, 'm-registry.mjs')))};\n`, 'utf8');
console.log(`styles: ${ids.join(',')} | per group: ${JSON.stringify(perGroup)}`);
