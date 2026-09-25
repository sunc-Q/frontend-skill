/* jsdom 交互断言：三个页面各跑一遍同一套用例（同一份 JS，只换 CSS）。
   本机 IDE 浏览器面板不可见时无法用真实浏览器验证交互，故交互一律走这里。 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const PAGES = [
  ['wabi', '侘寂留白'],
  ['construct', '构成主义'],
  ['memphis', '孟菲斯'],
];

let total = 0;
const failures = [];

function ok(cond, label) {
  total += 1;
  if (!cond) failures.push(label);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(id, label, seedStorage) {
  const html = readFileSync(join(root, 'preview', `landing-${id}.html`), 'utf8');
  const noise = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => noise.push(String(e && e.message)));
  vc.on('error', (m) => noise.push(String(m)));

  const beforeParse = (win) => {
    const list = [];
    win.__io = list;
    win.IntersectionObserver = class {
      constructor(cb) {
        this.cb = cb;
        this.targets = [];
        list.push(this);
      }
      observe(el) {
        this.targets.push(el);
        this.cb([{ target: el, isIntersecting: true, intersectionRatio: 0.6 }], this);
      }
      unobserve(el) {
        this.targets = this.targets.filter((t) => t !== el);
      }
      disconnect() {
        this.targets = [];
      }
    };
    const calls = [];
    win.__scrollCalls = calls;
    Object.defineProperty(win, 'scrollY', { value: 0, writable: true, configurable: true });
    win.scrollTo = (o) => {
      calls.push(o);
      if (o && typeof o.top === 'number') {
        Object.defineProperty(win, 'scrollY', { value: o.top, writable: true, configurable: true });
      }
    };
    if (seedStorage !== undefined) win.localStorage.setItem('shiguang.landing.v1', JSON.stringify(seedStorage));
  };

  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', beforeParse, virtualConsole: vc });
  const win = dom.window;
  const doc = win.document;
  const tick = async (n = 3) => {
    for (let i = 0; i < n; i += 1) await new Promise((r) => win.requestAnimationFrame(() => r(null)));
    await sleep(0);
  };
  await tick();

  const q = (s) => doc.querySelector(s);
  const qa = (s) => Array.from(doc.querySelectorAll(s));
  const clickEl = (el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  const typeIn = (el, v) => {
    const set = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
    set.call(el, v);
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
  };
  const tag = `[${id}]`;

  /* ---------- 挂载与结构 ---------- */
  ok(qa('#root *').length > 200, tag + ' 已挂载（DOM 节点数充足）');
  ok(q('.page').getAttribute('data-theme-key') === id, tag + ' 主题键取自 html[data-theme]');
  ok(q('[data-theme-badge]').textContent === label, tag + ' 顶栏风格徽章 = ' + label);
  ok(q('[data-theme-name]').textContent === label, tag + ' 页脚风格名一致');
  for (const s of ['hero', 'features', 'how', 'wall-demo', 'voices', 'faq', 'cta']) {
    ok(q('#' + s) !== null, tag + ' 分区存在 #' + s);
  }
  ok(qa('.card[data-feature]').length === 3, tag + ' 能力卡 3 张');
  ok(qa('.step[data-step]').length === 3, tag + ' 步骤 3 段');
  ok(qa('.stat').length === 4, tag + ' 统计 4 项');
  ok(qa('.voice').length === 3, tag + ' 使用者 3 条');

  /* ---------- 相册墙：数据一致性 + 筛选 ---------- */
  const cellsAll = qa('.wall .cell');
  ok(cellsAll.length === 168, tag + ' 整理前 168 格');
  const chipN = Object.fromEntries(qa('.chip[data-filter]').map((c) => [c.getAttribute('data-filter'), Number(c.querySelector('.chip-n').textContent)]));
  ok(chipN.all === 168 && chipN.person + chipN.event + chipN.blur + chipN.screenshot === 168, tag + ' 分类计数配平（Map 单遍历）');
  const actual = { person: 0, event: 0, blur: 0, screenshot: 0 };
  for (const c of cellsAll) actual[c.getAttribute('data-kind')] += 1;
  ok(JSON.stringify(actual) === JSON.stringify({ person: chipN.person, event: chipN.event, blur: chipN.blur, screenshot: chipN.screenshot }), tag + ' 计数与真实格子一致');

  const kept = Number((q('.wall-note').textContent.match(/值得留 (\d+) 张/) ?? ['', '0'])[1]);
  ok(kept > 0 && kept < 168, tag + ' 保留数 0<' + kept + '<168');
  ok(q('[data-renders-hint]') !== null, tag + ' 渲染次数对读者可见');
  ok(Number(q('[data-renders]').getAttribute('data-renders')) === 1, tag + ' 网格首帧只渲染 1 次');

  clickEl(q('.chip[data-filter="blur"]'));
  await tick();
  const blurred = qa('.wall .cell');
  ok(blurred.length === chipN.blur && blurred.every((c) => c.getAttribute('data-kind') === 'blur'), tag + ' 筛选「模糊」只剩该分类 ' + chipN.blur + ' 格');
  ok(q('.chip[data-filter="blur"]').className.includes('chip--on'), tag + ' 选中的筛选有状态类');
  clickEl(q('.chip[data-filter="all"]'));
  await tick();
  ok(qa('.wall .cell').length === 168, tag + ' 取消筛选回到 168 格');

  const beforeParent = Number(q('[data-renders]').getAttribute('data-renders'));
  clickEl(q('[data-parent-tick]'));
  await tick();
  ok(q('[data-tick]').textContent === '1', tag + ' 父组件状态已变（重渲染发生）');
  ok(Number(q('[data-renders]').getAttribute('data-renders')) === beforeParent, tag + ' props 未变时 memo 挡住了网格重渲染');

  clickEl(q('.seg-b[data-view="sorted"]'));
  await tick(4);
  ok(q('.wall') === null && q('[data-albums]') !== null, tag + ' 切到整理后：网格换成相册卡');
  ok(qa('.album').length === 4, tag + ' 相册卡 4 个');
  ok(
    qa('.album').every((a) => {
      const key = { 人物: 'person', 事件: 'event', 模糊待清理: 'blur', 截图归档: 'screenshot' }[a.getAttribute('data-album')];
      return Number(a.querySelector('.album-n').textContent) === chipN[key];
    }),
    tag + ' 相册数量与分类计数一一对应',
  );
  ok(qa('.chip[data-filter]').every((c) => c.disabled === true), tag + ' 整理后筛选按钮被禁用');
  ok(Number(q('[data-renders]').getAttribute('data-renders')) === beforeParent + 1, tag + ' 切视图只多渲染 1 次');
  ok(q('[data-pending]').getAttribute('data-pending') === 'false', tag + ' transition 结束后 pending 归位');
  clickEl(q('.seg-b[data-view="raw"]'));
  await tick(4);
  ok(qa('.wall .cell').length === 168, tag + ' 切回整理前仍是 168 格');

  /* ---------- 使用者标签筛选（派生 state，无 effect） ---------- */
  clickEl(q('.chip[data-voice-tag="职业"]'));
  await tick();
  const vs = qa('.voice');
  ok(vs.length === 1 && vs[0].getAttribute('data-voice') === 'b', tag + ' 按标签只剩 1 位职业使用者');
  clickEl(q('.chip[data-voice-tag="all"]'));
  await tick();
  ok(qa('.voice').length === 3, tag + ' 恢复全部使用者');

  /* ---------- 问答：搜索 + 折叠 ---------- */
  const search = q('[data-faq-search]');
  typeIn(search, '格式');
  await tick(6);
  const hits = qa('.faq');
  ok(Number(q('[data-faq-count]').textContent) === hits.length && hits.length > 0 && hits.length < 5, tag + ' 搜索命中数与列表一致（' + hits.length + '）');
  ok(hits.every((f) => f.textContent.includes('格式')), tag + ' 命中项文本都含关键词');
  ok(q('[data-stale]').getAttribute('data-stale') === 'false', tag + ' deferred 值已追平输入');
  typeIn(search, '不存在的词');
  await tick(6);
  ok(qa('.faq').length === 0 && q('.empty') !== null, tag + ' 无命中时显示空态而非空白');
  typeIn(search, '');
  await tick(6);
  ok(qa('.faq').length === 5, tag + ' 清空搜索恢复 5 条');
  const first = qa('.faq')[0];
  clickEl(first.querySelector('.faq-q'));
  await tick();
  ok(first.className.includes('faq--on') && first.querySelector('.faq-q').getAttribute('aria-expanded') === 'true', tag + ' 点开第一条');
  clickEl(qa('.faq')[1].querySelector('.faq-q'));
  await tick();
  ok(qa('.faq--on').length === 1 && qa('.faq')[1].className.includes('faq--on'), tag + ' 手风琴只保留一条展开（函数式更新）');
  clickEl(qa('.faq')[1].querySelector('.faq-q'));
  await tick();
  ok(qa('.faq--on').length === 0, tag + ' 再点收起');

  /* ---------- 定价与表单 ---------- */
  ok(qa('[data-badge]').length === 1 && q('[data-plan="pro"]').querySelector('[data-badge]') !== null, tag + ' 只有一个推荐标记且在摄影师版上');
  clickEl(q('[data-plan="pro"] input[type="radio"]'));
  await tick();
  ok(q('[data-plan="pro"]').getAttribute('data-selected') === 'true', tag + ' 选中摄影师版');
  ok(q('[data-plan="solo"]').getAttribute('data-selected') === 'false', tag + ' 个人版取消选中');
  clickEl(q('[data-platform="win"] input[type="radio"]'));
  await tick();
  ok(q('[data-platform="win"]').className.includes('platform--on'), tag + ' 平台切到 Windows');

  const email = q('[data-email]');
  ok(q('[data-restored]').getAttribute('data-restored') === (seedStorage ? 'true' : 'false'), tag + ' 恢复标记正确');
  typeIn(email, 'abc');
  await tick();
  ok(q('[data-email-ok]').getAttribute('data-email-ok') === 'false', tag + ' 非法邮箱被识别');
  q('[data-form]').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  ok(qa('.toast').length === 1 && qa('.toast').pop().textContent.includes('格式'), tag + ' 非法邮箱：只提示不提交');
  ok(q('[data-submit]').disabled === false, tag + ' 未进入 sending 状态');

  typeIn(email, '');
  q('[data-form]').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  ok(qa('.toast').pop().textContent.includes('先填一个邮箱'), tag + ' 空邮箱提示单独文案');

  typeIn(email, seedStorage ? seedStorage.email : 'xiaguang@example.com');
  await tick();
  ok(q('[data-email-ok]').getAttribute('data-email-ok') === 'true', tag + ' 合法邮箱通过');
  ok(q('[data-dirty]').getAttribute('data-dirty') === 'true', tag + ' 有未保存改动');
  clickEl(q('[data-persist]'));
  await tick();
  ok(q('[data-dirty]').getAttribute('data-dirty') === 'false', tag + ' 保存后脏标记归零');
  const stored = JSON.parse(win.localStorage.getItem('shiguang.landing.v1'));
  ok(stored.v === 1 && stored.plan === 'pro' && stored.platform === 'win' && stored.email.includes('@'), tag + ' localStorage 里是带版本号的 schema');

  q('[data-form]').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  ok(q('[data-submit]').disabled === true, tag + ' 提交中按钮禁用（防重复提交）');
  await sleep(600);
  await tick();
  ok(q('[data-submit]').textContent.includes('已记录'), tag + ' 提交完成态');
  ok(qa('.toast').pop().textContent.includes('本地演示'), tag + ' 明确告知未发出请求');

  /* ---------- 顶栏交互 ---------- */
  const spy = win.__io[0];
  ok(spy !== undefined && win.__io.length === 2, tag + ' 只有滚动监听 + reveal 两个 observer，元素自身不挂监听');
  spy.cb([{ target: doc.getElementById('voices'), isIntersecting: true, intersectionRatio: 0.9 }], spy);
  await tick();
  ok(q('.nav-link[data-spy="voices"]').className.includes('nav-link--on'), tag + ' 滚动监听把高亮切到「使用者」');
  clickEl(q('.nav-link[data-spy="faq"]'));
  await tick();
  ok(q('.nav-link[data-spy="faq"]').className.includes('nav-link--on'), tag + ' 点击导航立即高亮');
  ok(win.__scrollCalls.length > 0, tag + ' 点击导航触发平滑滚动');
  const ctaCalls = win.__scrollCalls.length;
  clickEl(q('.btn[data-cta="hero-primary"]'));
  await tick();
  ok(win.__scrollCalls.length === ctaCalls + 1, tag + ' 主 CTA 滚动到定价区');

  win.scrollY = 240;
  win.dispatchEvent(new win.Event('scroll'));
  await tick();
  ok(q('.nav').className.includes('nav--lift'), tag + ' 越过阈值后顶栏加投影（passive 监听）');
  win.scrollY = 3;
  win.dispatchEvent(new win.Event('scroll'));
  await tick();
  ok(!q('.nav').className.includes('nav--lift'), tag + ' 回到顶部时状态回落（不重复 setState）');

  /* ---------- 指针瞬态值 ---------- */
  const visual = q('[data-visual]');
  visual.dispatchEvent(new win.MouseEvent('mousemove', { bubbles: true, clientX: 120, clientY: 80 }));
  await tick(3);
  ok((visual.style.getPropertyValue('--px') + '').endsWith('%'), tag + ' 指针 x 写进 --px（无 React 状态更新）');
  ok((visual.style.getPropertyValue('--py') + '').endsWith('%'), tag + ' 指针 y 写进 --py');

  /* ---------- 三方脚本延后 ---------- */
  await sleep(950);
  ok(win.__sgAnalytics !== undefined && win.__sgAnalytics.ready === true, tag + ' 统计桩在空闲后才注入');

  /* ---------- reveal ---------- */
  ok(qa('[data-reveal]').every((e) => e.className.includes('is-in')), tag + ' 进场动画由单个 observer 打标');

  const bad = noise.filter((m) => !/Could not parse CSS|Error: Not implemented/i.test(m));
  ok(bad.length === 0, tag + ' 无运行时错误' + (bad.length ? '：' + bad.slice(0, 2).join(' | ') : ''));

  dom.window.close();
}

const SEED = { v: 1, plan: 'team', platform: 'win', email: 'laomo@example.org' };

for (const [id, label] of PAGES) {
  await run(id, label, undefined);
}
/* 恢复路径只验一次：带上已有 localStorage 重新加载 */
await run('wabi', '侘寂留白', SEED);

console.log('断言 ' + total + ' 项，失败 ' + failures.length + ' 项');
for (const f of failures) console.log('  ✗ ' + f);
process.exit(failures.length === 0 ? 0 : 1);
