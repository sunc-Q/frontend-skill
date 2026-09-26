// 三风格取证：同一份 DOM + 同一份 JS，只换 CSS —— 逐页签抓计算样式快照后做互斥性与同构性断言。
// 用法：node scripts/style-evidence.mjs <页面基址> <输出目录> [主题...]
//   SPA：       node scripts/style-evidence.mjs http://127.0.0.1:18902 evidence velvet nautical typewriter
// 单文件预览：  node scripts/style-evidence.mjs 'http://127.0.0.1:18193/{theme}.html?theme={theme}' /tmp/prev velvet nautical typewriter
//
// 为什么要走遍 6 个页签：只在默认页签上比样式，等于只证明了四分之一张皮。
// 类覆盖断言要拿到全站真实用到的 class 全集，否则会漏掉「某主题没写 .stub 规则」这类
// 只在核销台才暴露的缺口（漏写规则时元素掉回默认值，差异统计照样充足）。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { openSession } from './headless.mjs';

const base = process.argv[2];
const outDir = process.argv[3];
const themes = process.argv.slice(4);
if (!base || !outDir || themes.length === 0) {
  console.error('用法: node style-evidence.mjs <页面基址> <输出目录> [主题...]');
  process.exit(2);
}

const TABS = ['overview', 'events', 'sell', 'gate', 'refund', 'ledger'];
// 每个页签「内容真的落地」的判据：选择器 + 最少条数。
// 出票页没有表格（票档是下拉项），所以不能一刀切用 .table tbody tr，否则这条门永远打不开。
const READY = {
  overview: ['document.querySelectorAll(".table tbody tr").length', 1],
  events: ['document.querySelectorAll(".table tbody tr").length', 8],
  sell: ['document.querySelectorAll(".select option").length', 1],
  gate: ['document.querySelectorAll(".table tbody tr").length', 1],
  refund: ['document.querySelectorAll(".table tbody tr").length', 1],
  ledger: ['document.querySelectorAll(".table tbody tr").length', 1],
};
const probeSrc = (await readFile(new URL('./style-probe.js', import.meta.url), 'utf8')).trim().replace(/;$/, '');
const cssSrc = await Promise.all(
  themes.map(async (t) => [t, await readFile(new URL(`../web/src/styles/theme-${t}.css`, import.meta.url), 'utf8')]),
);

await mkdir(outDir, { recursive: true });
const sess = await openSession({ port: Number(process.env.CDP_PORT || 19831), profileDir: `${outDir}/chrome-profile` });
const fails = [];
function ok(name, cond, detail) {
  if (cond === true) {
    console.log(`PASS ${name}${detail !== undefined && detail !== '' ? '  ' + detail : ''}`);
    return;
  }
  fails.push(name);
  console.log(`FAIL ${name}${detail !== undefined && detail !== '' ? '  ' + detail : ''}`);
}

try {
  const all = {};
  for (const theme of themes) {
    const url = base.includes('{theme}') ? base.replaceAll('{theme}', theme) : `${base}/?theme=${theme}`;
    await sess.goto(url);
    const ready = await sess.waitFor('document.querySelectorAll(".kpi").length > 0', 90);
    if (!ready) throw new Error(`${theme}: 页面没渲染出 .kpi（接口或脚本失败）`);
    all[theme] = {};
    for (let i = 0; i < TABS.length; i++) {
      // 用真实 click 走组件的状态机，而不是直接改 class——否则测的就不是页面自己的行为。
      await sess.evaluate(`document.querySelectorAll('.tab')[${i}].click(); 1`);
      const switched = await sess.waitFor(`document.querySelectorAll('.tab')[${i}].classList.contains('is-on')`, 40);
      if (!switched) throw new Error(`${theme}/${TABS[i]}: 页签没切过去`);
      // 等「内容真的落进来并且连续两次采样一致」。只等页签 class 会变的话，
      // 探针会在 useAsync 还没回来时抢跑——那时长确实一样（都是空的），断言就白做了。
      const [readyExpr, readyMin] = READY[TABS[i] ?? 'overview'];
      const settled = await sess.evaluate(`(async () => {
        const snap = () => [document.querySelectorAll('#root *').length,
          document.querySelectorAll('.table tbody tr').length,
          (${readyExpr}),
          (document.querySelector('.panel') || {}).textContent?.length ?? 0].join(':');
        let prev = snap();
        for (let k = 0; k < 80; k++) {
          await new Promise((r) => setTimeout(r, 120));
          const cur = snap();
          if (cur === prev && Number(cur.split(':')[2]) >= ${readyMin}) return cur;
          prev = cur;
        }
        return null;
      })()`);
      if (settled === null || settled === undefined) {
        throw new Error(`${theme}/${TABS[i]}: 数据没落进来（就绪计数始终 < ${readyMin} 或持续抖动）`);
      }
      const p = await sess.evaluate(`(${probeSrc})()`);
      if (p === null || typeof p !== 'object') throw new Error(`${theme}/${TABS[i]}: 探针没返回对象`);
      if (p.theme !== theme) throw new Error(`${theme}/${TABS[i]}: data-theme 实得 ${String(p.theme)}`);
      all[theme][TABS[i]] = p;
      await writeFile(`${outDir}/probe-${theme}-${TABS[i]}.json`, JSON.stringify(p, null, 2) + '\n');
    }
    await sess.evaluate(`document.querySelectorAll('.tab')[0].click(); 1`);
    await sess.waitFor('document.querySelectorAll(".kpi").length > 0', 40);
    const shot = await sess.conn.send('Page.captureScreenshot', { format: 'png' });
    if (typeof shot?.data === 'string') {
      await writeFile(`${outDir}/shot-${theme}.png`, Buffer.from(shot.data, 'base64'));
    } else {
      throw new Error(`${theme}: 截图没拿到数据`);
    }
  }

  // 1) DOM 同构：每个页签上，三种主题的 tagName+class 序列必须完全一致
  for (const tab of TABS) {
    const sigs = themes.map((t) => `${t}=${String(all[t][tab].isoHash)}:${String(all[t][tab].isoLen)}/on${String(all[t][tab].onCount)}`);
    ok(
      `DOM同构/${tab}`,
      new Set(themes.map((t) => `${String(all[t][tab].isoHash)}:${String(all[t][tab].isoLen)}`)).size === 1 &&
        new Set(themes.map((t) => String(all[t][tab].onCount)).values()).size === 1,
      sigs.join(' '),
    );
  }

  // 2) 数据同构：同接口同渲染，视觉之外的东西一律不许漂移
  const shape = (t, tab) =>
    [all[t][tab].rowCount, all[t][tab].kpiCount, all[t][tab].tabCount, all[t][tab].chipCount, all[t][tab].firstRow, all[t][tab].kpiText, all[t][tab].identity, all[t][tab].footText.slice(0, 12)].join('/');
  for (const tab of TABS) {
    ok(`数据同构/${tab}`, new Set(themes.map((t) => shape(t, tab))).size === 1, themes.map((t) => `${t}:${shape(t, tab)}`).join(' '));
  }

  // 3) 零外链 + 无接口报错 + 无 JS 异常
  const ext = themes.flatMap((t) => TABS.flatMap((tab) => (all[t][tab].external ?? []).map((u) => `${t}/${tab}:${u}`)));
  ok('零外链资源', ext.length === 0, ext.join(' '));
  const errs = themes.flatMap((t) => TABS.flatMap((tab) => (all[t][tab].errs ?? []).map((e) => `${t}/${tab}:${e}`)));
  ok('页面无 .err 提示', errs.length === 0, errs.join(' | '));
  const injected = themes.filter((t) => Number(all[t].overview.styleBytes) < 2000);
  ok('主题 CSS 真的注入了 <style>', injected.length === 0, injected.join(',') || themes.map((t) => `${t}:${all[t].overview.styleBytes}B`).join(' '));
  ok('无 JS 异常与控制台报错', sess.noise.length === 0, sess.noise.slice(0, 3).join(' | '));

  // 4) 两两 ≥3 项计算样式差异；并且差异必须在多个页签上都成立（皮要整体换，不是只换头部）
  const GROUPS = ['bodyBg', 'shell', 'topbar', 'tabOn', 'kpi', 'value', 'btn', 'th', 'badge', 'hint'];
  const flat = (p) => {
    const out = [];
    for (const g of GROUPS) {
      const val = p?.[g];
      if (val === null || val === undefined) continue;
      for (const [k, v] of Object.entries(val)) out.push(`${g}.${k}=${String(v)}`);
    }
    return out;
  };
  for (const t of themes) {
    const f = new Set(flat(all[t].overview));
    ok(`自比反证/${t}`, f.size >= 30, `${f.size} 项属性（少于 30 说明探针取空了）`);
    for (const tab of TABS) {
      const g = new Set(flat(all[t][tab]));
      ok(`自比一致/${t}/${tab}`, [...g].every((x) => typeof x === 'string'), `${g.size} 项属性`);
    }
  }
  for (let i = 0; i < themes.length; i++) {
    for (let j = i + 1; j < themes.length; j++) {
      const a = themes[i] ?? '';
      const b = themes[j] ?? '';
      let minDiff = Infinity;
      let where = '';
      for (const tab of TABS) {
        const fa = new Map(flat(all[a][tab]).map((s) => [s.slice(0, s.indexOf('=')), s]));
        const fb = new Map(flat(all[b][tab]).map((s) => [s.slice(0, s.indexOf('=')), s]));
        const diff = [...fa.keys()].filter((k) => fb.has(k) && fa.get(k) !== fb.get(k));
        if (diff.length < minDiff) {
          minDiff = diff.length;
          where = tab;
        }
      }
      ok(`两两差异≥3（最弱页签 ${where}）：${a}×${b}`, minDiff >= 3, `最少 ${minDiff} 项`);
      const fa = new Map(flat(all[a].overview).map((s) => [s.slice(0, s.indexOf('=')), s]));
      const fb = new Map(flat(all[b].overview).map((s) => [s.slice(0, s.indexOf('=')), s]));
      const diff = [...fa.keys()].filter((k) => fb.has(k) && fa.get(k) !== fb.get(k));
      console.log(`     ${a}×${b} 差异示例：${diff.slice(0, 5).map((k) => fa.get(k) + ' ↔ ' + fb.get(k)).join('  |  ')}`);
    }
  }

  // 5) 类覆盖：全站真实用到的每个 class，三份 CSS 里都必须出现过
  const perTheme = themes.map((t) => [...new Set(TABS.flatMap((tab) => all[t][tab].classes ?? []))].sort().join(','));
  ok('class 全集同构', new Set(perTheme).size === 1, `${perTheme[0]?.split(',').length ?? 0} 个 class`);
  const used = [...new Set(themes.flatMap((t) => TABS.flatMap((tab) => all[t][tab].classes ?? [])))].sort();
  ok('页面有 class 可测', used.length > 40, used.length + ' 个');
  for (const [theme, css] of cssSrc) {
    const missing = used.filter((c) => !new RegExp('\\.' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])').test(css));
    ok(`CSS 全覆盖：${theme}`, missing.length === 0, missing.join(',') || `${used.length} 类全部命中`);
  }
  await writeFile(`${outDir}/class-universe.json`, JSON.stringify(used, null, 2) + '\n');

  console.log(fails.length === 0 ? '\n三风格取证全部通过' : `\n三风格取证失败 ${fails.length} 条：${fails.join(', ')}`);
  process.exitCode = fails.length === 0 ? 0 : 1;
} finally {
  sess.close();
}
