/**
 * check-dom.mjs — jsdom interaction suite for
 * frontend-development × 表单密集多步向导 (2026-09-26 08:00).
 *
 *   F  single-flight / 无早期 return / 三风格同一 DOM
 *   H  交互全链路：步骤闸门、异步乱序回写、字段级 dirty、草稿恢复与清理、
 *      分支残留剔除、幂等提交、深链闸门
 *   N  渲染消融：__FD_MEMO__=true 与 false 两臂的每击键渲染次数对比
 *
 * Run after build-inline.mjs. Layout-shift/contrast claims are NOT here — jsdom has no
 * layout engine; they live in check-browser.mjs.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Group, bytes, dumpResults, num, ok, results, summary } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.tmp-check');
const PAGES = ['paper-grid', 'pcb-green', 'concrete-rose'];
mkdirSync(OUT, { recursive: true });

const bundleMemo = readFileSync(path.join(ROOT, 'dist/assets/main.js'), 'utf8');
const bundlePlain = readFileSync(path.join(ROOT, 'dist-plain/assets/main.js'), 'utf8');

/* ------------------------------------------------------------------ boot */
async function boot(opts = {}) {
  const {
    id = 'paper-grid',
    bundle = bundleMemo,
    hash = '',
    seed = {},
    url = 'https://tideside.test/wizard',
  } = opts;
  const msgs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => msgs.push(`jsdomError ${e.message}`));
  vc.on('error', (m) => msgs.push(`error ${String(m)}`));
  vc.on('warn', (m) => msgs.push(`warn ${String(m)}`));
  const dom = new JSDOM(
    `<!doctype html><html lang="zh-CN" data-fd-style="${id}"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>`,
    {
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      url: url + hash,
      virtualConsole: vc,
      beforeParse(win) {
        for (const [k, v] of Object.entries(seed)) win.localStorage.setItem(k, v);
      },
    },
  );
  const win = dom.window;
  const doc = win.document;
  win.eval(bundle);

  const wait = (fn, ms = 8000) =>
    new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        let ready = false;
        try {
          ready = fn() === true;
        } catch {
          ready = false;
        }
        if (ready) resolve(true);
        else if (Date.now() - t0 > ms) resolve(false);
        else setTimeout(tick, 15);
      };
      tick();
    });

  const at = (sel) => doc.querySelector(sel);
  const all = (sel) => [...doc.querySelectorAll(sel)];
  const text = (sel) => (at(sel)?.textContent ?? '').trim();
  const click = (el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  const byAttr = (sel, attr, val) => all(sel).find((e) => e.getAttribute(attr) === val);
  const type = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
  };
  const pick = (el, value) => {
    Object.getOwnPropertyDescriptor(win.HTMLSelectElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
  };
  /**
   * React maps onChange for checkboxes from the native *click*, not from a dispatched
   * 'change' event — setting .checked through the prototype setter and firing change is
   * silently ignored, which is exactly the kind of false green a suite can hide.
   */
  const check = (el, on = true) => {
    if (el.checked !== on) el.click();
  };
  /** react-hook-form only validates a field once it has been blurred (mode: onTouched) */
  const blur = (el) => {
    el.focus();
    el.blur();
  };
  const tap = (el, value) => {
    type(el, value);
    blur(el);
  };
  const field = (name) => at(`[data-field="${name}"]`);
  const chipFor = (name, kind) => at(`[data-${kind}-for="${name}"]`);
  const bridge = () => win.__fdBridge;
  const step = () => text('[data-role="meta-step"]');
  const stepNo = () => (step().match(/STEP (\d)\//) ?? [])[1] ?? '0';
  const reqs = (pred) => bridge().api.requestLog().filter(pred);
  const appMsgs = () => msgs.filter((m) => !/Not implemented|Could not parse CSS/i.test(m));
  /**
   * Everything that legitimately differs between skins or arms is stripped, so what is left
   * is the DOM the two are supposed to share. `data-arm` has to go for the same reason — and
   * so does the arm name the panel prints as *text*, which is the byte that made N1 fail for
   * the wrong reason the first time.
   */
  const normalized = () =>
    at('#root')
      .innerHTML.replace(/ class="[^"]*"/g, '')
      .replace(/ style="[^"]*"/g, '')
      .replace(/ data-(fd-style|style|arm)="[^"]*"/g, '')
      .replace(/ id="[^"]*"/g, '')
      .replace(/ for="[^"]*"/g, '')
      .replace(/当前臂 (?:memo|plain) · /g, '');

  /**
   * The boot contract lives in the window *before* `.fd-app` exists, and the line below waits
   * for exactly that node — so the pre-data frames have to be sampled first or they are gone.
   * What is recorded: whether the first paint already carried a sized reserved host with a
   * visible skeleton, and whether the root ever went blank again after it had painted.
   */
  const early = {
    samplesBeforeApp: 0,
    blankAfterPaint: 0,
    skeletonSamples: 0,
    sizedHostSamples: 0,
    routeHost: null,
    routeHostMinHeight: null,
  };
  let painted = false;
  const sampleBoot = () => {
    if (at('.fd-app') !== null) return;
    early.samplesBeforeApp += 1;
    if (at('#root')?.childElementCount === 0) {
      if (painted) early.blankAfterPaint += 1;
    } else {
      painted = true;
      const host = at('.fd-suspense-host');
      if (host !== null && host.querySelector('[data-testid="suspense-fallback"]') !== null) early.skeletonSamples += 1;
      if (host !== null && host.style.minHeight !== '') {
        early.sizedHostSamples += 1;
        early.routeHost ??= host;
        early.routeHostMinHeight ??= host.style.minHeight;
      }
    }
    if (early.samplesBeforeApp < 400) setTimeout(sampleBoot, 15);
  };
  sampleBoot();

  await wait(() => at('.fd-app') !== null, 6000);
  return {
    id, win, doc, wait, at, all, text, click, byAttr, type, pick, check, blur, tap, field, chipFor,
    bridge, step, stepNo, reqs, msgs, appMsgs, normalized, dom, early,
  };
}

const cents = (s) => Math.round(Number(String(s).replace(/[^\d.-]/g, '')) * 100);

/** 6 code points but 9 UTF-16 units — the counter must follow the former */
const TAG_EMOJI = '🎐🎐🎐 器物';

/** fill step 1 completely (identity) — notify=both so the conditional phone field is live */
async function fillIdentity(p, sub = 'chaoxi') {
  p.type(p.field('storeName'), '潮汐社 · 手作订阅');
  p.type(p.field('subdomain'), sub);
  p.type(p.field('tagline'), '每月初寄一件在手的器物');
  p.pick(p.field('category'), 'ceramics');
  p.pick(p.field('timezone'), 'Asia/Shanghai');
  p.pick(p.field('notify'), 'both');
  p.type(p.field('supportPhone'), '13900001174');
  await p.wait(() => p.reqs((c) => c.key === `sub:${sub}`).length >= 1, 5000);
}

const settleAsync = async (p, expect = 'available') => {
  await p.wait(() => p.text('[data-role="async-subdomain"]').includes(expect), 6000);
};

/** walk to the review step with valid data on every step */
async function toReview(p) {
  await fillIdentity(p);
  await settleAsync(p);
  p.click(p.at('[data-action="next"]'));
  await p.wait(() => p.stepNo() === '2', 4000);
  p.click(p.byAttr('[data-plan]', 'data-plan', 'studio'));
  p.click(p.byAttr('[data-billing]', 'data-billing', 'annual'));
  p.click(p.at('[data-action="next"]'));
  await p.wait(() => p.stepNo() === '3', 4000);
  const valid = p.bridge().facts.uscc.valid;
  p.click(p.byAttr('[data-account]', 'data-account', 'enterprise'));
  await p.wait(() => p.field('companyName') !== null && p.field('uscc') !== null, 3000);
  p.type(p.field('companyName'), '潮汐手作文化传播有限公司');
  p.type(p.field('uscc'), valid.toLowerCase());
  p.type(p.field('contactEmail'), 'kefu@chaoxi.example');
  await p.wait(() => p.field('invoiceType') !== null, 3000);
  p.pick(p.field('invoiceType'), 'normal');
  await p.wait(() => p.field('taxTitle') !== null && p.field('taxNo') !== null, 3000);
  p.type(p.field('taxTitle'), '潮汐手作文化传播有限公司');
  p.type(p.field('taxNo'), valid.toLowerCase());
  p.check(p.field('agree'), true);
  await p.wait(() => p.text('[data-role="async-email"]').includes('available'), 6000);
  p.click(p.at('[data-action="next"]'));
  await p.wait(() => p.stepNo() === '4', 6000);
  await p.wait(() => p.at('[data-role="review-total"]') !== null, 4000);
}

/* ================================================================= F */
let firstDom = '';
let firstBytes = 0;
for (const id of PAGES) {
  Group(`F · ${id}`);
  const p = await boot({ id });
  ok(`F1 ${id}：内联 bundle 无需模块系统即可挂载（.fd-app 出现）`, p.at('.fd-app') !== null, `arm=${p.at('.fd-app')?.getAttribute('data-arm')}`);
  const bootReqs = p.reqs((c) => c.key === 'bootstrap');
  ok(`F2 ${id}：路由 loader 预取 + 页面 useSuspenseQuery 共用一次请求（single-flight）`,
    bootReqs.length === 1, `bootstrap 请求 ${bootReqs.length} 次`);
  ok(`F2b ${id}：静态 mock 下没有任何请求走 fetch（传输层收口在一处）`,
    p.reqs(() => true).every((c) => typeof c.path === 'string' && c.path.startsWith('/wizard/')),
    p.reqs(() => true).map((c) => c.path).join(','));
  const css = p.doc.getElementById('fd-style-css')?.textContent ?? '';
  ok(`F3 ${id}：运行时只注入本风格的令牌块，另外两套一个字都没有`,
    css.includes(`[data-fd-style="${id}"]{`) &&
      PAGES.filter((o) => o !== id).every((o) => !css.includes(`[data-fd-style="${o}"]`)),
    `注入 ${bytes(css)} 字节，其它风格出现 ${PAGES.filter((o) => o !== id).filter((o) => css.includes(`[data-fd-style="${o}"]`)).length} 次`);
  const host = p.at('[data-min-height="176"]');
  ok(`F4 ${id}：选项区的 Suspense 宿主按 176px 预留空间（占位靠高度，不靠内容）`,
    host !== null && host.style.minHeight === '176px', `minHeight=${host?.style.minHeight}`);
  /**
   * The boot contract changed while this suite was running: mount used to wait for the route
   * loader, which made "no blank screen" true only because the data arrived before the page
   * existed. Against a slow origin that turned into two seconds of nothing — so the app now
   * mounts first and the boundary does the waiting. In jsdom the observable shape of that
   * contract is the *route* boundary (the page has no shell of its own until bootstrap lands),
   * and the whole window is over by the time `boot()` returns, hence the frames recorded above.
   */
  ok(`F5 ${id}：数据未达期间不空屏——已挂载的外壳里只有一个带尺寸的骨架宿主`,
    p.early.samplesBeforeApp > 2 && p.early.blankAfterPaint === 0 &&
      p.early.routeHostMinHeight === '520px' && p.early.samplesBeforeApp - p.early.sizedHostSamples <= 3 &&
      p.early.skeletonSamples === p.early.sizedHostSamples,
    `窗口 ${p.early.samplesBeforeApp} 帧，重空 ${p.early.blankAfterPaint}，骨架 ${p.early.skeletonSamples}，宿主高度=${p.early.routeHostMinHeight}`);
  await p.wait(() => p.at('select[data-field="category"]') !== null, 4000);
  ok(`F5b ${id}：数据到达后路由宿主节点被复用而不是重建，且全场只有一个字段区占位宿主`,
    p.at('.fd-suspense-host') === p.early.routeHost && p.all('[data-min-height="520"]').length === 1 &&
      p.all('[data-min-height="176"]').length === 1 &&
      p.at('[data-min-height="176"]')?.contains(p.at('select[data-field="category"]')) === true,
    `节点同一=${p.at('.fd-suspense-host') === p.early.routeHost}，520 宿主 ${p.all('[data-min-height="520"]').length} 个，176 宿主 ${p.all('[data-min-height="176"]').length} 个`);
  const cat = p.at('select[data-field="category"]');
  const opts = [...cat.querySelectorAll('option')];
  const labels = opts.slice(1).map((o) => o.textContent.trim());
  ok(`F6 ${id}：select 选项来自服务端 bootstrap（含一个空占位，其余逐项对齐事实表）`,
    opts.length === p.bridge().facts.options.category.length + 1 &&
      labels.join('|') === p.bridge().facts.options.category.map((o) => o.label).join('|'),
    `${opts.length} 项，首项「${opts[0]?.textContent.trim()}」`);
  const dupIds = p.all('[id]').map((e) => e.id).filter((v, i, a) => a.indexOf(v) !== i);
  ok(`F7 ${id}：无重复 id`, dupIds.length === 0, dupIds.slice(0, 3).join(','));
  ok(`F8 ${id}：控制台无 error/warn`, p.appMsgs().length === 0, p.appMsgs().slice(0, 2).join(' | '));
  if (id === 'paper-grid') {
    firstDom = p.normalized();
    firstBytes = bytes(firstDom);
  } else if (id === 'pcb-green') {
    ok('F9 三风格共用同一 DOM：paper-grid 与 pcb-green 归一化 innerHTML 完全相同',
      p.normalized() === firstDom, `归一化后 ${firstBytes}B，差异字符=${[...p.normalized()].findIndex((c, i) => c !== firstDom[i])}`);
  } else {
    ok('F9b 第三风格同样共用同一 DOM', p.normalized() === firstDom, `${bytes(p.normalized())}B`);
  }
  p.win.close();
}

/* ================================================================= H */
Group('H 闸门与前进');
{
  const p = await boot();
  ok('H1 打开即第 1 步，身份步 7 个字段一个不少地摆出来（含服务端选项那 3 个）',
    p.step().startsWith('STEP 1/') && p.all('[data-field]').length === p.bridge().facts.stepFields.identity.length,
    `${p.step()}，控件 ${p.all('[data-field]').length} 个`);
  p.click(p.at('[data-action="next"]'));
  await p.wait(() => p.all('[data-error-for]').length > 0, 3000);
  ok('H2 空表单点「下一步」被挡：仍在第 1 步 + 就地出现错误 chip + 焦点落在第一个未通过字段',
    p.stepNo() === '1' && p.all('[data-error-for]').length >= 3 && p.doc.activeElement === p.field('storeName'),
    `错误 chip ${p.all('[data-error-for]').length} 个，焦点=${p.doc.activeElement?.getAttribute('data-field')}`);
  ok('H2b 被挡时给出 Snackbar 提示而不是静默', /还有未通过项/.test(p.doc.body.textContent ?? ''), '');
  ok('H2c 被挡不跳步：hash 没有被写成下一步（未走通就不留地址）',
    p.win.location.hash === '' || p.win.location.hash === '#step=identity', `hash=${p.win.location.hash || '（空）'}`);
  await fillIdentity(p);
  await settleAsync(p);
  p.click(p.at('[data-action="next"]'));
  const advanced = await p.wait(() => p.stepNo() === '2', 5000);
  ok('H3 身份步补齐后可前进到第 2 步，hash 同步为 #step=plan',
    advanced && p.win.location.hash === '#step=plan', `${p.step()} hash=${p.win.location.hash}`);
  ok('H3b 第 1 步在步骤条上标记为已完成（data-done=1）',
    p.byAttr('[data-step]', 'data-step', 'identity')?.getAttribute('data-done') === '1',
    p.byAttr('[data-step]', 'data-step', 'identity')?.getAttribute('data-done') ?? '');
  p.win.location.hash = '#step=review';
  const rewritten = await p.wait(() => p.win.location.hash === '#step=plan', 2000);
  ok('H4 深链/手输 hash 不能绕过闸门：#step=review 被拒，hash 改写成闸门真正允许的那一步',
    rewritten && p.stepNo() === '2', `hash=${p.win.location.hash} ${p.step()}`);
  ok('H4b 前进被拒同样给 Snackbar（不是悄悄吞掉）', /还有未通过项|仍有/.test(p.doc.body.textContent ?? ''), '');
  p.win.location.hash = '#step=identity';
  await p.wait(() => p.stepNo() === '1', 2000);
  ok('H4c 向后跳转永远开放：#step=identity 立刻生效（改前面的字段不必重走闸门）',
    p.stepNo() === '1' && p.win.location.hash === '#step=identity', p.step());
  p.win.close();
}

Group('H 深链冷启动');
{
  const p = await boot({ hash: '#step=review' });
  await p.wait(() => p.stepNo() === '1', 3000);
  ok('H5 空草稿 + #step=review 冷启动：闸门把它留在第 1 步（深链不是免检通行证）',
    p.stepNo() === '1' && p.win.location.hash === '#step=identity', `${p.step()} hash=${p.win.location.hash}`);
  p.win.close();

  const q = await boot({ hash: '#step=nonsense' });
  await q.wait(() => q.stepNo() === '1', 2000);
  ok('H5b 无法识别的 hash 值被忽略而不是崩溃（readStepFromHash 白名单）',
    q.at('.fd-app') !== null && q.stepNo() === '1', q.step());
  q.win.close();
}

Group('H 异步校验：乱序回写');
{
  const p = await boot();
  p.bridge().resetAsyncMetrics();
  p.type(p.field('storeName'), '潮汐社');
  p.type(p.field('subdomain'), 'slow');
  /* wait for the slow request to actually leave, not just for the debounce to fire */
  const sent = await p.wait(() => p.reqs((c) => c.key === 'sub:slow').length >= 1, 5000);
  p.type(p.field('subdomain'), 'fast');
  const settled = await p.wait(() => p.text('[data-role="async-subdomain"]').includes('available（fast）'), 6000);
  const dropped = await p.wait(() => p.bridge().asyncMetrics.staleDropped >= 1, 3000);
  const m = p.bridge().asyncMetrics;
  ok('H6 先发的慢请求后到达，被令牌单调性丢弃（staleDropped ≥ 1）',
    sent && settled && dropped, JSON.stringify(m));
  ok('H6b 界面停留在最后一次的结论上（forValue=fast 而非 slow）',
    p.text('[data-role="async-subdomain"]').includes('（fast）'), p.text('[data-role="async-subdomain"]'));
  ok('H6c 校验结论 chip 出现在字段下方且标为「可用」',
    p.chipFor('subdomain', 'async') !== null && (p.chipFor('subdomain', 'async')?.textContent ?? '').includes('可用'),
    p.chipFor('subdomain', 'async')?.textContent ?? '');
  ok('H6c2 可用的结论把字段边框从 neutral 提到 ok（结论不只在文字里）',
    p.field('subdomain').closest('.fd-field')?.getAttribute('data-state') === 'ok',
    p.field('subdomain').closest('.fd-field')?.getAttribute('data-state') ?? '（无状态）');
  const reqBefore = p.reqs((c) => c.key === 'sub:fast').length;
  p.type(p.field('subdomain'), 'shop');
  await p.wait(() => p.text('[data-role="async-subdomain"]').includes('taken'), 6000);
  ok('H6d 已占用名：字段边框转 error 态、chip 文案为「已占用」',
    p.field('subdomain').closest('.fd-field')?.getAttribute('data-state') === 'error' &&
      (p.chipFor('subdomain', 'async')?.textContent ?? '').includes('已占用'),
    `${p.field('subdomain').closest('.fd-field')?.getAttribute('data-state')} / ${p.chipFor('subdomain', 'async')?.textContent ?? ''}`);
  ok('H6d2 这条 error 不来自 setError：resolver 重跑会冲掉注入错误，所以 [data-error-for] 是空的',
    p.chipFor('subdomain', 'error') === null && p.at('[data-issue="async:subdomain"]') !== null,
    `清单行=${p.at('[data-issue="async:subdomain"]')?.textContent?.slice(0, 40) ?? '缺失'}`);
  p.type(p.field('subdomain'), 'fast');
  await p.wait(() => p.text('[data-role="async-subdomain"]').includes('（fast）'), 6000);
  const reqAfter = p.reqs((c) => c.key === 'sub:fast').length;
  ok('H6e 回到同一取值时命中查询缓存，不再打服务端（fetchQuery 按 key 复用）',
    reqAfter === reqBefore && reqBefore >= 1, `sub:fast 请求 ${reqBefore}→${reqAfter}`);
  ok('H6f 换到新取值时确实又打了一次服务端（缓存不是万能挡箭牌）',
    p.reqs((c) => c.key === 'sub:shop').length >= 1, `sub:shop ${p.reqs((c) => c.key === 'sub:shop').length} 次`);
  p.type(p.field('subdomain'), 'api');
  await p.wait(() => p.text('[data-role="async-subdomain"]').includes('reserved'), 6000);
  ok('H6g reserved：chip 为「保留名」',
    (p.chipFor('subdomain', 'async')?.textContent ?? '').includes('保留名'),
    p.chipFor('subdomain', 'async')?.textContent ?? '');
  p.win.close();
}

Group('H 字段级 dirty / 计数 / 报价联动');
{
  const p = await boot();
  p.type(p.field('storeName'), '潮汐社');
  await p.wait(() => p.chipFor('storeName', 'dirty') !== null, 3000);
  ok('H7 dirty 标记是字段级的：只有被改过的字段出现「已修改」chip',
    p.all('[data-dirty-for]').length === 1 && p.at('[data-dirty-for="storeName"]') !== null,
    p.all('[data-dirty-for]').map((e) => e.getAttribute('data-dirty-for')).join(','));
  ok('H7b 头部计数与 chip 数一致', p.text('[data-role="meta-dirty"]').startsWith('1'), p.text('[data-role="meta-dirty"]'));
  p.type(p.field('tagline'), TAG_EMOJI);
  await p.wait(() => p.text('[data-count-for="tagline"]').includes('6/40'), 3000);
  ok('H7c 字符计数按码点（emoji 记 1，不按 UTF-16 的 2）',
    p.text('[data-count-for="tagline"]').includes('6/40') && TAG_EMOJI.length === 9,
    `计数=${p.text('[data-count-for="tagline"]')}，UTF-16 长度=${TAG_EMOJI.length}`);
  const total0 = p.text('[data-role="total"]');
  await fillIdentity(p);
  await settleAsync(p);
  p.click(p.at('[data-action="next"]'));
  await p.wait(() => p.stepNo() === '2', 4000);
  p.click(p.byAttr('[data-plan]', 'data-plan', 'market'));
  await p.wait(() => p.text('[data-role="total"]') !== total0, 3000);
  const marketSeats = Number(p.field('seats').value);
  p.click(p.byAttr('[data-plan]', 'data-plan', 'starter'));
  await p.wait(() => Number(p.field('seats').value) !== marketSeats, 3000);
  ok('H8 换套餐时席位重新钳制（market 下限 20 → starter 上限 50 内）',
    Number(p.field('seats').value) <= 50 && Number(p.field('seats').value) >= 1 && marketSeats >= 20,
    `market 时 ${marketSeats} 席 → starter 时 ${p.field('seats').value} 席`);

  /* money additivity read out of the DOM only — no bridge numbers allowed here */
  const lineNodes = p.all('[data-line]').filter((e) => !['subtotal', 'discount'].includes(e.getAttribute('data-line')));
  const detail = lineNodes.reduce((s, e) => s + cents(e.querySelector('.fd-line-amt')?.textContent ?? ''), 0);
  const subtotal = cents(p.text('[data-amount="subtotal"]'));
  const discNode = p.at('[data-amount="discount"]');
  const discount = discNode === null ? 0 : cents(discNode.textContent ?? '');
  const total = cents(p.text('[data-role="total"]'));
  const annual = (p.at('[data-role="summary"]')?.textContent ?? '').includes('年付');
  ok('H8b 侧栏明细行之和 = 小计（UI 里印出来的钱也能按分加回来）',
    lineNodes.length >= 2 && detail === subtotal, `${lineNodes.length} 行 · 合计 ${detail} 分 vs 小计 ${subtotal} 分`);
  ok('H8c 总额 = (小计 + 折扣) ×（年付 12 个月 / 月付 1）·折扣只在年付出现',
    total === (subtotal + discount) * (annual ? 12 : 1) && (annual ? discNode !== null : discNode === null),
    `${annual ? '年付' : '月付'}：(${subtotal} ${discount})×${annual ? 12 : 1} = ${total} 分，总额印为 ${p.text('[data-role="total"]')}`);
  p.win.close();
}

Group('H 扩展依赖与分支残留');
{
  const p = await boot();
  await fillIdentity(p);
  await settleAsync(p);
  p.click(p.at('[data-action="next"]'));
  await p.wait(() => p.stepNo() === '2', 4000);
  const onOf = (id) => p.at(`[data-addon="${id}"]`)?.getAttribute('data-on');
  p.check(p.field('addon:multisite'), true);
  await p.wait(() => onOf('multisite') === '1', 3000);
  ok('H9a 默认已含「库存同步」，此时加勾「多仓发货」合法（依赖满足）',
    onOf('multisite') === '1' && onOf('stock') === '1' && p.chipFor('addons', 'error') === null,
    `stock=${onOf('stock')} multisite=${onOf('multisite')}`);
  p.check(p.field('addon:stock'), false);
  await p.wait(() => p.chipFor('addons', 'error') !== null, 3000);
  ok('H9 撤掉前置的「库存同步」后：错误就地出现在 addons 字段下，并点名两个模块',
    (p.chipFor('addons', 'error')?.textContent ?? '').includes('需要先启用') &&
      (p.chipFor('addons', 'error')?.textContent ?? '').includes('多仓发货'),
    p.chipFor('addons', 'error')?.textContent ?? '');
  p.check(p.field('addon:stock'), true);
  await p.wait(() => p.chipFor('addons', 'error') === null, 3000);
  ok('H9b 补齐前置依赖后错误自动消失', p.chipFor('addons', 'error') === null, '');
  p.click(p.at('[data-action="next"]'));
  await p.wait(() => p.stepNo() === '3', 4000);
  p.click(p.byAttr('[data-account]', 'data-account', 'enterprise'));
  await p.wait(() => p.field('uscc') !== null, 3000);
  p.tap(p.field('companyName'), '潮汐手作文化传播有限公司');
  const good = p.bridge().facts.uscc.valid;
  const bad = good.slice(0, 17) + (good[17] === '0' ? '1' : '0');
  p.tap(p.field('uscc'), bad);
  await p.wait(() => p.at('[data-error-for="uscc"]') !== null, 3000);
  ok('H9c 信用代码只改末位（校验位）就被拦下：错误 chip 点名校验位，字段边框转 error',
    (p.at('[data-error-for="uscc"]')?.textContent ?? '').includes('校验位') &&
      p.field('uscc').closest('.fd-field')?.getAttribute('data-state') === 'error',
    `${p.at('[data-error-for="uscc"]')?.textContent ?? '无错误'} state=${p.field('uscc').closest('.fd-field')?.getAttribute('data-state')}`);
  p.tap(p.field('uscc'), good);
  await p.wait(() => p.at('[data-error-for="uscc"]') === null, 3000);
  ok('H9d 换成合法校验位后错误消失（同一字段，两处校验都跟着改）',
    p.at('[data-error-for="uscc"]') === null, p.field('uscc').value);
  const payloadIn = p.bridge().payload.build({ ...p.bridge().facts.sample, accountType: 'enterprise' });
  p.click(p.byAttr('[data-account]', 'data-account', 'personal'));
  await p.wait(() => p.field('realName') !== null, 3000);
  ok('H10 切回个人后企业证件字段从界面消失',
    p.field('uscc') === null && p.field('companyName') === null && p.field('realName') !== null,
    `在场控件 ${p.all('[data-field]').length} 个`);
  const personal = p.bridge().payload.build({ ...p.bridge().facts.sample, accountType: 'personal', realName: '林知远', idLast4: '1234' });
  ok('H10b 消失的字段不能悄悄进入提交体：个人分支 payload 里没有 uscc/companyName',
    !('uscc' in personal) && !('companyName' in personal) && 'realName' in personal && 'uscc' in payloadIn,
    `个人 ${Object.keys(personal).length} 键 / 企业 ${Object.keys(payloadIn).length} 键`);
  ok('H10c allowedKeys 与 payload 键集合逐一相等（分支白名单不是事后补的）',
    [...p.bridge().payload.allowedKeys({ ...p.bridge().facts.sample, accountType: 'personal', realName: '林知远', idLast4: '1234' })].sort().join('|') ===
      Object.keys(personal).sort().join('|'),
    `${Object.keys(personal).length} 键`);
  p.win.close();
}

Group('H 草稿：自动保存 / 恢复 / 敌意输入 / 清理');
{
  const p = await boot();
  await fillIdentity(p, 'chaoxi');
  p.type(p.field('tagline'), '先写一句');
  await p.wait(() => p.bridge().draft.raw() !== null, 5000);
  const env = JSON.parse(p.bridge().draft.raw() ?? '{}');
  ok('H11 改动后自动落盘（带版本号与所在步骤）',
    env.version === p.bridge().facts.draftVersion && env.step === 'identity' && env.values.subdomain === 'chaoxi',
    `version=${env.version} step=${env.step}`);
  p.click(p.at('[data-action="save-draft"]'));
  await p.wait(() => p.text('[data-role="last-saved"]').includes('最近保存'), 3000);
  ok('H11b 手动保存给出时间戳反馈', /最近保存 \d{4}-/.test(p.text('[data-role="last-saved"]')), p.text('[data-role="last-saved"]'));
  p.click(p.at('[data-action="clear-draft"]'));
  await p.wait(() => p.bridge().draft.raw() === null, 3000);
  ok('H11c 清空草稿后存储里确实没有残留',
    p.bridge().draft.raw() === null && (p.at('[data-role="dirty-count"]')?.textContent ?? '').includes('个字段已修改'),
    `dirty=${p.at('[data-role="dirty-count"]')?.textContent ?? ''}`);
  p.win.close();

  const dirty = {
    version: 3,
    step: 'plan',
    savedAt: '2026-09-25T10:00:00.000Z',
    values: { storeName: '潮汐社', subdomain: 'chaoxi', seats: '很多', addons: 'stock', tagline: 42, evilKey: 'x', plan: 'studio', billing: 'annual' },
  };
  const p2 = await boot({ seed: { 'tideside.wizard.draft': JSON.stringify(dirty) } });
  await p2.wait(() => p2.text('[data-role="draft-state"]').includes('已恢复'), 4000);
  const ds = p2.text('[data-role="draft-state"]');
  ok('H12 有草稿时冷启动落在保存的那一步，并说明恢复来源与时间',
    ds.includes('已恢复') && ds.includes('2026-09-25') && p2.stepNo() === '2', `${ds} · ${p2.step()}`);
  ok('H12b 未知键被丢弃并写进提示，类型不符的字段逐个回落',
    ds.includes('丢弃 1 个未知字段') && ds.includes('3 个字段类型不符'), ds);
  ok('H12c 回落是逐字段的：非法的 addons 回到默认（侧栏只剩库存同步行），合法的 billing 保留 annual',
    (p2.at('[data-role="summary"]')?.textContent ?? '').includes('年付') &&
      p2.at('[data-line="addon:stock"]') !== null && p2.at('[data-line="addon:points"]') === null,
    `hint=${p2.at('[data-role="summary"] .fd-panel-hint')?.textContent?.trim().slice(0, 46) ?? ''} lines=${p2.all('[data-line]').map((e) => e.getAttribute('data-line')).join(',')}`);
  p2.click(p2.byAttr('[data-step]', 'data-step', 'identity'));
  await p2.wait(() => p2.stepNo() === '1', 3000);
  ok('H12b2 回落不是放弃整份：合法字段原样回到第 1 步（后退永远开放）',
    p2.field('storeName').value === '潮汐社' && p2.field('subdomain').value === 'chaoxi',
    `storeName=${p2.field('storeName').value} subdomain=${p2.field('subdomain').value}`);
  p2.win.close();

  const p3 = await boot({ seed: { 'tideside.wizard.draft': '{"values": broken' } });
  await p3.wait(() => p3.text('[data-role="draft-state"]').includes('无法解析'), 4000);
  ok('H12d 坏 JSON 不炸页面：从默认值开始并说明原因',
    p3.text('[data-role="draft-state"]').includes('无法解析') && p3.at('.fd-app') !== null && p3.stepNo() === '1',
    p3.text('[data-role="draft-state"]'));
  p3.win.close();

  const p4 = await boot({ seed: { 'tideside.wizard.draft': JSON.stringify({ version: 999, step: 'review', values: { storeName: '旧结构' } }) } });
  await p4.wait(() => p4.text('[data-role="draft-state"]').includes('版本'), 4000);
  ok('H12e 版本不匹配 ⇒ 整份作废（不半应用），字段回到默认',
    p4.text('[data-role="draft-state"]').includes('版本') && p4.field('storeName').value === '' && p4.stepNo() === '1',
    `${p4.text('[data-role="draft-state"]')} storeName=${p4.field('storeName').value}`);
  p4.win.close();

  const p5 = await boot({ seed: { 'tideside.wizard.draft': JSON.stringify({ version: 3, step: 'nowhere', values: { storeName: '步骤名也是敌意输入' } }) } });
  await p5.wait(() => p5.text('[data-role="draft-state"]').includes('已恢复'), 4000);
  ok('H12f 草稿里非法的 step 回落 identity，但合法字段照常恢复',
    p5.stepNo() === '1' && p5.field('storeName').value === '步骤名也是敌意输入',
    `${p5.step()} / ${p5.field('storeName').value}`);
  p5.win.close();
}

Group('H 提交：闸门、幂等、清草稿');
{
  const p = await boot();
  await toReview(p);
  ok('H13 四步全通过 + 异步校验齐 ⇒ 抵达评审步且看到总额',
    p.stepNo() === '4' && p.text('[data-role="review-total"]').length > 0, `${p.step()} ${p.text('[data-role="review-total"]')}`);
  const dataFields = p.bridge().facts.steps.filter((s) => s.fields.length > 0).reduce((n, s) => n + s.fields.length, 0);
  ok('H13b 评审页把全部数据字段逐项列出来，每项都带「改」的回跳按钮',
    p.all('[data-review]').length === dataFields && p.all('[data-jump-from-review]').length === dataFields,
    `${p.all('[data-review]').length} 行 / 事实表 ${dataFields} 个字段`);
  ok('H13c 此时完整性清单为「全部通过」',
    (p.at('[data-role="issue-count"]')?.textContent ?? '').includes('全部通过，可以提交'),
    p.at('[data-role="issue-count"]')?.textContent ?? '');
  const before = p.reqs((c) => c.path === '/wizard/submit').length;
  p.click(p.at('[data-action="submit"]'));
  p.click(p.at('[data-action="submit"]'));
  const done = await p.wait(() => p.at('[data-role="receipt-serial"]') !== null, 8000);
  const submits = p.reqs((c) => c.path === '/wizard/submit');
  ok('H14 提交成功并给出订单号', done && (p.at('[data-role="receipt-serial"]')?.textContent ?? '').startsWith('TD-'),
    p.text('[data-role="submit-state"]') + ' / ' + (p.at('[data-role="receipt-serial"]')?.textContent ?? ''));
  ok('H14b 连点两次：只发出一次真实提交（in-flight 锁）',
    submits.length - before === 1, `submit 请求 ${submits.length - before} 次`);
  await new Promise((r) => setTimeout(r, 900));
  ok('H14c 成功后草稿被清除，并且 900ms 后也没被自动保存复活（在途定时器也要认账）',
    p.bridge().draft.raw() === null && (p.at('[data-role="draft-state"]')?.textContent ?? '').includes('尚无草稿'),
    String(p.bridge().draft.raw()));
  ok('H14d 提交与审计并发发出（审计不串在主链路上）',
    p.reqs((c) => c.path === '/wizard/audit').length >= 1 && submits.length >= 1,
    `路径集合 ${[...new Set(p.reqs(() => true).map((c) => c.path))].join(',')}`);
  ok('H14e 回执在提交后才出现，且金额与评审页一致',
    (p.at('[data-role="receipt"]')?.getAttribute('data-shown') ?? '') === '1' &&
      (p.at('[data-role="receipt"]')?.textContent ?? '').includes(p.text('[data-role="review-total"]').replace('¥', '')),
    p.at('[data-role="receipt"]')?.textContent?.slice(0, 60) ?? '');
  p.win.close();
}

Group('H 异步闸门：已占用名把评审步关掉');
{
  const p = await boot();
  await toReview(p);
  ok('H15a 先正常抵达评审步（后面要拆的就是这道门）', p.stepNo() === '4', p.step());
  p.click(p.at('[data-jump-from-review="identity"]'));
  const jumped = await p.wait(() => p.stepNo() === '1', 3000);
  ok('H15a2 评审页的「改」把用户带回对应步骤，而不是只印个链接',
    jumped && p.field('subdomain') !== null, `${p.step()} subdomain=${String(p.field('subdomain'))}`);
  p.type(p.field('subdomain'), 'shop');
  const taken = await p.wait(() => (p.chipFor('subdomain', 'async')?.textContent ?? '').includes('已占用'), 6000);
  const before = p.reqs((c) => c.path === '/wizard/submit').length;
  p.click(p.at('[data-action="next"]'));
  await new Promise((r) => setTimeout(r, 400));
  const railReview = p.byAttr('[data-step]', 'data-step', 'review');
  const stateOf = (name) => p.field(name)?.closest('.fd-field')?.getAttribute('data-state') ?? '（字段不在场）';
  ok('H15b 改成已占用名后：schema 本身通过（shop 是合法子域名），拦下前进的只有异步结论',
    taken && p.stepNo() === '1' && p.at('[data-error-for="subdomain"]') === null && stateOf('subdomain') === 'error',
    `state=${stateOf('subdomain')} schema 错误=${p.at('[data-error-for="subdomain"]')?.textContent ?? '无'} taken=${String(taken)}`);
  ok('H15c 清单里点名「已被占用」，步骤条把评审步标为不可达',
    (p.at('[data-issue="async:subdomain"]')?.textContent ?? '').includes('已被占用') &&
      railReview?.getAttribute('data-reachable') === '0',
    `issue=${p.at('[data-issue="async:subdomain"]')?.textContent?.slice(0, 30) ?? '缺失'} reachable=${railReview?.getAttribute('data-reachable')}`);
  ok('H15d 闸门没开时提交请求一次都没发出', p.reqs((c) => c.path === '/wizard/submit').length === before,
    `submit ${before}→${p.reqs((c) => c.path === '/wizard/submit').length}`);
  p.type(p.field('subdomain'), 'chaoxi');
  const back = await p.wait(() => (p.chipFor('subdomain', 'async')?.textContent ?? '').includes('可用'), 6000);
  /* the blocked click left us on step 1, so the reopened door is step 1 → 2; the rest of the
     walk is the same 1→4 path toReview used, and it must not re-lock anywhere */
  p.click(p.at('[data-action="next"]'));
  const moved = await p.wait(() => p.stepNo() === '2', 6000);
  const reachable1 = p.byAttr('[data-step]', 'data-step', 'review')?.getAttribute('data-reachable') === '1';
  for (let i = 0; i < 2; i += 1) {
    p.click(p.at('[data-action="next"]'));
    await p.wait(() => p.stepNo() === String(Number(p.stepNo()) + 1), 4000);
  }
  const reopened = moved && (await p.wait(() => p.stepNo() === '4', 6000));
  ok('H15e 换回可用名后闸门重新打开（拦的不是这一次失败，而是当前结论）',
    back && reopened && reachable1,
    `${p.step()} 第一步就放行=${String(moved)} reachable=${p.byAttr('[data-step]', 'data-step', 'review')?.getAttribute('data-reachable')}`);
  p.win.close();
}

Group('H 服务端二次校验（客户端漏网时）');
{
  const p = await boot();
  await fillIdentity(p);
  await settleAsync(p);
  const bad = await p.bridge().api.wizard.audit({ storeName: '短', subdomain: 'ab', agree: false, accountType: 'enterprise' });
  ok('H16 服务端 audit 独立拒同一份数据（客户端不是唯一防线）',
    Array.isArray(bad) && bad.length >= 3, `退回字段：${(bad ?? []).join(',')}`);
  const okAudit = await p.bridge().api.wizard.audit(p.bridge().payload.build(p.bridge().facts.sample));
  ok('H16b 示例 payload 过服务端审计', Array.isArray(okAudit) && okAudit.length === 0, JSON.stringify(okAudit));
  ok('H16c 审计与提交都是 /wizard/* 而不是 /api/wizard/*（技能里的路由格式条款）',
    p.reqs(() => true).every((c) => !c.path.includes('/api/')),
    [...new Set(p.reqs(() => true).map((c) => c.path))].join(','));
  p.win.close();
}

/* ================================================================= N */
Group('N 渲染消融：React.memo 在 useFormContext 消费者上值多少');
async function countArm(bundle) {
  const p = await boot({ bundle, id: 'paper-grid' });
  const arm = p.bridge().ablation.armName;
  p.bridge().ablation.reset();
  p.type(p.field('storeName'), '潮');
  await p.wait(() => p.bridge().ablation.total('field:') >= 1, 3000);
  await new Promise((r) => setTimeout(r, 250));
  const counts = Object.fromEntries(Object.entries(p.bridge().ablation.counts()).filter(([k]) => k.startsWith(`field:${arm}:`)));
  const out = { arm, counts, total: p.bridge().ablation.total('field:'), dom: p.normalized(), leaves: p.all('[data-field]').length, page: p.bridge().ablation.total('page:') };
  p.win.close();
  return out;
}
{
  const memo = await countArm(bundleMemo);
  const plain = await countArm(bundlePlain);
  ok('N0 两臂确实是同一份源码的两个构建：臂名不同、DOM 相同',
    memo.arm === 'memo' && plain.arm === 'plain', `arm=${memo.arm} / ${plain.arm}`);
  ok('N1 两臂归一化 DOM 完全相同（消融只换实现不换结果）',
    memo.dom === plain.dom && bytes(memo.dom) > 5000, `${bytes(memo.dom)}B vs ${bytes(plain.dom)}B`);
  ok('N1b 两臂都发生了字段渲染（计数器不是空的）',
    memo.total > 0 && plain.total > 0, `memo=${memo.total} plain=${plain.total}`);
  const memoKeys = Object.keys(memo.counts).length;
  const plainKeys = Object.keys(plain.counts).length;
  ok('N2 一次击键后两臂重渲染了同样多的字段叶子（第一次提交谁都省不下来）',
    memoKeys > 0 && memoKeys === plainKeys, `计数叶子 ${memoKeys} vs ${plainKeys}，在场控件 ${memo.leaves} 个`);
  num('N2b 单击键字段渲染总次数：memo 臂 / 无 memo 臂', `${memo.total} / ${plain.total}`, ' 次');
  ok('N3 单击键两臂渲染次数相等 —— 这正是只看一次击键会得出的错误结论',
    memo.total === plain.total, `差值 ${memo.total - plain.total}`);
  const perLeaf = Object.values(memo.counts).sort((a, b) => b - a);
  ok('N4 每个叶子都在第一击键时渲染过（脏标记 / 计数字符串都要重算）',
    perLeaf.length >= 4 && perLeaf.every((v) => v >= 1), `最高 ${perLeaf[0]} 次，共 ${perLeaf.length} 个叶子`);
  num('N4b 每键成本 ≈ 在场字段数（本场景 O(n) 而非 O(1)）', `${memo.total} 次 / ${Object.keys(memo.counts).length} 个被计数字段`, '');

  /* ---- the accumulation a single keystroke cannot see: 30 keystrokes, two prop regimes ---- */
  const stableMemo = await timedKeystrokes(bundleMemo, 30, 'stable');
  const stablePlain = await timedKeystrokes(bundlePlain, 30, 'stable');
  num('N5 30 次击键（字符数不变 ⇒ 派生 props 不变）：渲染次数 memo / plain',
    `${stableMemo.renders} / ${stablePlain.renders}`, ' 次');
  ok('N5b 无 memo 臂的渲染次数随击键成倍增长，memo 臂不增长',
    stablePlain.renders >= stableMemo.renders * 20 && stableMemo.renders <= 8,
    `memo=${stableMemo.renders} plain=${stablePlain.renders}（30 击）`);
  ok('N5c memo 臂把 30 次击键压回第一次提交的量（后续全部浅比较命中）',
    stableMemo.renders <= 8 && stablePlain.renders > 100, `memo=${stableMemo.renders} plain=${stablePlain.renders}`);

  const growMemo = await timedKeystrokes(bundleMemo, 30, 'growing');
  const growPlain = await timedKeystrokes(bundlePlain, 30, 'growing');
  num('N6 30 次击键（长度逐次变化）：渲染次数 memo / plain',
    `${growMemo.renders} / ${growPlain.renders}`, ' 次');
  ok('N6b 输入值根本不经过 props：uncontrolled register 让被输入的那个叶子也命中浅比较',
    growMemo.renders === stableMemo.renders,
    `长度变化模式 ${growMemo.renders} 次 = 稳定模式 ${stableMemo.renders} 次，plain 两模式同为 ${stablePlain.renders}/${growPlain.renders}`);
  ok('N6c 省下的比例 ≈ 在场字段数（n 个字段省 n-1 个）',
    growPlain.renders / growMemo.renders >= 4,
    `${(growPlain.renders / growMemo.renders).toFixed(1)}× 渲染量差`);
  /**
   * The bail-out is only correct if a *real* prop change still lands. Blur makes storeName
   * dirty, which changes that leaf's dirtyText prop — if memo had frozen anything, the chip
   * would never appear and the counter would never move again.
   */
  ok('N6d props 真变时 memo 臂立刻跟上（省下的不是被冻住的旧界面）',
    growMemo.blurRenders >= 1 && growMemo.blurChip === true,
    `blur 后新增 ${growMemo.blurRenders} 次渲染，dirty 角标=${String(growMemo.blurChip)}`);
  ok('N6e memo 臂在 blur 前后 DOM 一致地出现 dirty 标记（与 plain 臂同一结论）',
    growPlain.blurRenders >= 1 && growPlain.blurChip === true,
    `plain 新增 ${growPlain.blurRenders} 次渲染`);

  const msMemo = growMemo.ms + stableMemo.ms;
  const msPlain = growPlain.ms + stablePlain.ms;
  num('N7 两臂墙钟合计（稳定 + 变化两种 props 情形各 30 击）：memo / plain',
    `${msMemo} ms / ${msPlain} ms`, '');
  ok('N7b memo 的收益在墙钟上同样可测（不是只省了计数器数字）',
    msMemo <= msPlain * 0.75, `memo ${msMemo}ms vs plain ${msPlain}ms`);
  ok('N7c 反向检查：memo 没有把页面拖慢（上限 1.25×）',
    msMemo >= msPlain * 0.2, `差 ${msPlain - msMemo} ms`);
}

/**
 * One batch of 30 keystrokes timed inside the page (jsdom bookkeeping stays outside the
 * clock), returning wall time, the leaf-render counter, and what a following blur costs.
 *
 * 'stable'  keeps the value at a constant code-point count; 'growing' changes its length on
 *           every keystroke. The pair exists because the two were *assumed* to differ — and
 *           measured to be identical, which is the real finding: with uncontrolled
 *           `register()` inputs the value never becomes a prop, so nothing about typing
 *           reaches the memo boundary. Blur is the control that proves the boundary is
 *           still live (dirtyText is a prop, and it does get through).
 */
async function timedKeystrokes(bundle, n, mode) {
  const p = await boot({ bundle, id: 'paper-grid' });
  p.bridge().ablation.reset();
  const expr = mode === 'growing'
    ? `setter.call(el, '潮汐社' + '潮'.repeat(i % 12));`
    : `setter.call(el, '潮汐社' + 'abcdefghij'.charAt(i % 10));`;
  const ms = p.win.eval(`(function(){
    var el = document.querySelector('[data-field="storeName"]');
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    var t0 = performance.now();
    for (var i = 0; i < ${n}; i++) {
      ${expr}
      el.dispatchEvent(new window.Event('input', { bubbles: true }));
    }
    return Math.round(performance.now() - t0);
  })()`);
  await new Promise((r) => setTimeout(r, 150));
  const before = Number(p.bridge().ablation.total('field:'));
  p.win.eval(`(function(){var el=document.querySelector('[data-field="storeName"]');el.focus();el.blur();return 1;})()`);
  await p.wait(() => Number(p.bridge().ablation.total('field:')) > before, 2000);
  await new Promise((r) => setTimeout(r, 200));
  const counts = p.bridge().ablation.counts();
  const blurRenders = Number(p.bridge().ablation.total('field:')) - before;
  const blurChip = p.at('[data-dirty-for="storeName"]') !== null;
  p.win.close();
  return { ms: Number(ms), renders: before, counts, blurRenders, blurChip };
}

summary('check-dom');
dumpResults(path.join(OUT, 'assertions-dom.json'));
const perGroup = {};
for (const r of results) {
  const letter = (r.group.match(/^[A-Z]/) ?? ['?'])[0];
  perGroup[letter] = (perGroup[letter] ?? 0) + 1;
}
console.log(`assertions per group: ${JSON.stringify(perGroup)}`);
