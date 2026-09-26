// 三风格验证：用本机 Chrome 无头（CDP over WebSocket，零依赖）逐主题抓计算样式快照，
// 再断言「同 DOM + 只换 CSS」。browser-use 面板在本机经常 15s 超时，所以取证走这条稳定路径。
// 用法：node scripts/style-verify.mjs <页面基址> <输出目录> [主题...]
//   SPA：      node scripts/style-verify.mjs http://127.0.0.1:18080 /tmp/out transit tag vinyl
//   单文件预览：node scripts/style-verify.mjs 'http://127.0.0.1:18193/{theme}.html?theme={theme}' /tmp/out transit tag vinyl
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { openSession } from './headless.mjs';

const base = process.argv[2];
const outDir = process.argv[3];
const themes = process.argv.slice(4);
if (!base || !outDir || themes.length === 0) {
  console.error('用法: node style-verify.mjs <页面基址> <输出目录> [主题...]');
  process.exit(2);
}

const probeSrc = (await readFile(new URL('./style-probe.js', import.meta.url), 'utf8')).trim().replace(/;$/, '');
const cssSrc = await Promise.all(
  themes.map(async (t) => [t, await readFile(new URL(`../web/src/styles/theme-${t}.css`, import.meta.url), 'utf8')]),
);

await mkdir(outDir, { recursive: true });
const sess = await openSession({ port: Number(process.env.CDP_PORT || 19821), profileDir: `${outDir}/chrome-profile` });
try {
  const conn = sess.conn;
  const probes = {};
  for (const theme of themes) {
    // 基址里出现 {theme} 时按模板拼（单文件预览是 <theme>.html），否则按 SPA 的 ?theme= 查询参数
    const url = base.includes('{theme}') ? base.replaceAll('{theme}', theme) : `${base}/?theme=${theme}`;
    await sess.goto(url);
    // 等内容真正出现：以 KPI 数字为落地标记
    const ready = await sess.waitFor('document.querySelectorAll(".kpi").length > 0', 90);
    if (!ready) throw new Error(`${theme}: 页面未渲染出 .kpi（接口或脚本失败）`);
    const value = await conn.evaluate(`(${probeSrc})()`);
    if (value === null || typeof value !== 'object') throw new Error(`${theme}: 探针未返回对象`);
    if (value.theme !== theme) throw new Error(`${theme}: data-theme 实得 ${String(value.theme)}`);
    probes[theme] = value;
    await writeFile(`${outDir}/probe-${theme}.json`, JSON.stringify(value, null, 2) + '\n');
  }

  const fails = [];
  const ok = (name, cond, detail) => {
    if (cond) console.log(`PASS ${name}${detail ? '  ' + detail : ''}`);
    else {
      fails.push(name);
      console.log(`FAIL ${name}${detail ? '  ' + detail : ''}`);
    }
  };

  // 1) DOM 同构：同 DOM + 同 JS，只有 CSS 不同
  const hashes = themes.map((t) => `${t}=${probes[t]?.domHash}/len${probes[t]?.domLen}`);
  ok(
    'DOM同构',
    new Set(themes.map((t) => `${probes[t]?.domHash}:${probes[t]?.domLen}`)).size === 1,
    hashes.join(' '),
  );
  // 2) 数据侧同构（同接口同渲染）
  const shape = (t) => `${probes[t]?.rowCount}/${probes[t]?.kpiCount}/${probes[t]?.chipCount}/${probes[t]?.firstRow}/${probes[t]?.kpiText}`;
  ok('渲染数据同构', new Set(themes.map(shape)).size === 1, themes.map((t) => `${t}:${shape(t)}`).join(' '));
  // 3) 零外链
  const ext = themes.flatMap((t) => (probes[t]?.external ?? []).map((u) => `${t}:${u}`));
  ok('零外链', ext.length === 0, ext.join(' '));
  // 4) 页面无错误提示
  const errs = themes.flatMap((t) => (probes[t]?.errs ?? []).map((e) => `${t}:${e}`));
  ok('无.err', errs.length === 0, errs.join(' | '));

  // 5) 两两 ≥3 项计算样式差异（字体/背景/间距/圆角等）
  //    只统计样式分组，theme/rowCount/domHash 这些元数据不算「视觉差异」。
  const STYLE_GROUPS = new Set(['htmlBg', 'shell', 'kpi', 'value', 'btn', 'th', 'badge', 'lede']);
  const flat = (p) => {
    const out = [];
    for (const [group, val] of Object.entries(p)) {
      if (!STYLE_GROUPS.has(group)) continue;
      if (val === null || typeof val !== 'object') out.push(`${group}=${String(val)}`);
      else for (const [k, v] of Object.entries(val)) out.push(`${group}.${k}=${String(v)}`);
    }
    return out;
  };
  for (let i = 0; i < themes.length; i++) {
    // 反证：同一主题自比必须 0 差异，否则这个计数器本身在瞎报（变异校验）
    const self = flat(probes[themes[i] ?? '']);
    const selfDiff = self.filter((s) => !new Set(flat(probes[themes[i] ?? ''])).has(s));
    ok(`自比反证：${themes[i]}`, selfDiff.length === 0, self.length + ' 项样式属性');
    for (let j = i + 1; j < themes.length; j++) {
      const a = themes[i];
      const b = themes[j];
      const fa = new Map(flat(probes[a]).map((s) => [s.slice(0, s.indexOf('=')), s]));
      const fb = new Map(flat(probes[b]).map((s) => [s.slice(0, s.indexOf('=')), s]));
      const diff = [...fa.keys()].filter((k) => fb.has(k) && fa.get(k) !== fb.get(k));
      ok(`两两差异≥3：${a}×${b}`, diff.length >= 3, `差异${diff.length}项 例：${diff.slice(0, 4).map((k) => fa.get(k)).join(' / ')}`);
    }
  }

  // 6) 类覆盖：页面真实用到的每个 class 都必须在三份 CSS 里都出现过
  const classSets = themes.map((t) => [...(probes[t]?.classes ?? [])].join(','));
  ok('class 集合同构', new Set(classSets).size === 1, `${classSets[0]?.split(',').length ?? 0} 个 class`);
  const used = [...new Set(themes.flatMap((t) => probes[t]?.classes ?? []))];
  ok('页面有 class 可测', used.length > 20, used.length + ' 个');
  for (const [theme, css] of cssSrc) {
    const missing = used.filter((c) => !new RegExp('\\.' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])').test(css));
    ok(`CSS全覆盖：${theme}`, missing.length === 0, missing.join(',') || `${used.length} 类全部命中`);
  }

  console.log(fails.length === 0 ? '\n三风格验证通过' : `\n三风格验证失败：${fails.join(', ')}`);
  process.exitCode = fails.length === 0 ? 0 : 1;
  ok('无 JS 异常与控制台报错', sess.noise.length === 0, sess.noise.slice(0, 2).join(' | '));
} finally {
  sess.close();
}
