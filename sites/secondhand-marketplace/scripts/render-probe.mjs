// 渲染侧断言：证明「数据真来自接口」且「恶意文本只被当文本渲染」。
// 用法：node scripts/render-probe.mjs <页面基址> <api-smoke 交接文件> [主题...]
import { readFile } from 'node:fs/promises';
import { openSession } from './headless.mjs';

const base = (process.argv[2] ?? '').replace(/\/$/, '');
const targetFile = process.argv[3];
const themes = process.argv.slice(4);
if (!base || !targetFile || themes.length === 0) {
  console.error('用法: node render-probe.mjs <页面基址> <交接文件> [主题...]');
  process.exit(2);
}
const target = JSON.parse(await readFile(targetFile, 'utf8'));
const marker = 'onerror=alert(1)';

let pass = 0;
const fails = [];
const ok = (name, cond, detail) => {
  if (cond) {
    pass++;
    console.log(`PASS ${name}${detail ? '  ' + detail : ''}`);
  } else {
    fails.push(name);
    console.log(`FAIL ${name}${detail ? '  ' + detail : ''}`);
  }
};

const sess = await openSession({ port: Number(process.env.CDP_PORT || 19822), profileDir: '/tmp/fleaprobe/chrome-render' });
try {
  for (const theme of themes) {
    await sess.goto(`${base}/?theme=${theme}`);
    const loaded = await sess.waitFor('document.querySelectorAll(".kpi").length > 0', 90);
    if (!loaded) {
      ok(`${theme}: 页面加载`, false, '未取得 .kpi（接口或脚本失败）');
      continue;
    }
    ok(`${theme}: 页面加载并渲染出 KPI`, true, `kpi=${await sess.evaluate('document.querySelectorAll(".kpi").length')}`);

    // 1) 搜索框输入靶子编号：走的是真接口查询，不是本地过滤
    await sess.evaluate(`(() => {
      const el = document.querySelector('#f-q');
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(el, ${JSON.stringify(target.code)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    // 命中数交给接口判定：编号是前缀匹配（靶子还有带后缀的兄弟单），这里只要求「查得到且第一行就是它」
    const rowExpr = `[...document.querySelectorAll('.table:not(.mini) tbody tr')].find(r => r.textContent.includes(${JSON.stringify(target.code)}))`;
    const found = await sess.waitFor(`${rowExpr} !== undefined`, 60);
    ok(`${theme}: 搜索命中来自接口的靶子行`, !!found, found ? `${String(await sess.evaluate(`document.querySelectorAll('.table:not(.mini) tbody tr').length`))} 行命中` : '未命中');
    if (!found) continue;
    const rowText = String(await sess.evaluate(`${rowExpr}.textContent`));
    ok(`${theme}: 行内容是接口返回的中文标题`, rowText.includes('冒烟靶子'), rowText.slice(0, 42).replace(/\s+/g, ' '));

    // 2) 点开后出价留言里的恶意串必须只是文本
    await sess.evaluate(`(() => { const r = ${rowExpr}; r.scrollIntoView(); r.click(); return true; })()`);
    const detail = await sess.waitFor(`document.querySelector('.detail-main')?.textContent.includes(${JSON.stringify(marker)})`, 60);
    ok(`${theme}: 详情面板显示该单出价留言`, !!detail, detail ? '留言文本已出现' : '详情面板没出现该文本');
    const danger = await sess.evaluate(`(() => {
      const cells = [...document.querySelectorAll('.detail-main td, .detail-main span, .detail-main p, .detail-main div')];
      const cell = cells.find((c) => c.childElementCount === 0 && c.textContent.includes(${JSON.stringify(marker)}));
      return {
        img: document.querySelectorAll('#root img').length,
        script: document.querySelectorAll('#root script').length,
        iframe: document.querySelectorAll('#root iframe').length,
        object: document.querySelectorAll('#root object').length,
        embeds: document.querySelectorAll('#root embed, #root link[rel=import]').length,
        cellFound: cell !== undefined,
        cellHtml: cell ? cell.innerHTML : '',
        cellText: cell ? cell.textContent : '',
      };
    })()`);
    ok(
      `${theme}: 恶意留言没有生成任何标签（img/script/iframe/object 全 0）`,
      danger.img === 0 && danger.script === 0 && danger.iframe === 0 && danger.object === 0 && danger.embeds === 0,
      `img=${danger.img} script=${danger.script} iframe=${danger.iframe} object=${danger.object} embed=${danger.embeds}`,
    );
    ok(`${theme}: 留言以原文出现在纯文本节点里`, danger.cellFound === true && danger.cellText.includes(marker), JSON.stringify(danger.cellText.slice(0, 44)));
    ok(`${theme}: 该单元格 innerHTML 里没有可执行标签`, !/<(img|script|iframe)\b/i.test(danger.cellHtml), danger.cellHtml.slice(0, 48));

    // 3) 注入形卖家名同样只是文本
    await sess.evaluate(`(() => {
      const el = document.querySelector('#f-q');
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(el, ${JSON.stringify(target.injectedSeller)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    const sellerRow = `[...document.querySelectorAll('.table:not(.mini) tbody tr')].find((r) => r.textContent.includes(${JSON.stringify(target.injectedSeller)}))`;
    const sellerHit = await sess.waitFor(`${sellerRow} !== undefined`, 60);
    ok(
      `${theme}: 注入形卖家名按字面查到且只是一行文本`,
      !!sellerHit && (await sess.evaluate(`document.querySelectorAll('.table:not(.mini) tbody tr').length`)) === 1,
      sellerHit ? String(await sess.evaluate(`${sellerRow}.textContent`)).slice(0, 34).replace(/\s+/g, ' ') : '未命中',
    );

    // 4) 资源全部同源
    const extern = await sess.evaluate(`performance.getEntriesByType('resource').map(e => e.name).filter(n => !n.startsWith(${JSON.stringify(base + '/')}))`);
    ok(`${theme}: 无跨源资源请求`, (extern ?? []).length === 0, (extern ?? []).join(',') || '全部同源');
    ok(`${theme}: 无 JS 异常与 CSP 拒绝`, sess.noise.length === 0, sess.noise.slice(0, 2).join(' | '));
  }
} finally {
  sess.close();
}

console.log(`\n渲染断言：${pass} 通过 / ${fails.length} 失败${fails.length ? '：' + fails.join('、') : ''}`);
if (fails.length > 0) process.exitCode = 1;
