import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'preview/admin-business.html';
const html = readFileSync(file, 'utf8');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' :: ' + String(extra) : '')); }
}

const errs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errs.push(String(e.message)));
vc.on('error', (m) => errs.push('console.error: ' + String(m)));

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://local.test/' });
const w = dom.window;
const d = w.document;

const tick = (n = 2) => new Promise((res) => { let i = 0; const step = () => (i++ < n ? w.requestAnimationFrame(step) : res()); w.requestAnimationFrame(step); });

await tick(3);

const txt = (el) => (el ? el.textContent : null);
const lastToast = () => { const a = d.querySelectorAll('.toast'); return a.length ? a[a.length - 1] : null; };

// ---- 首屏结构 ----
ok('bundle 挂载成功', !!d.querySelector('.shell'), errs.join('|'));
const kpis = [...d.querySelectorAll('.kpi-value')].map((e) => e.textContent);
ok('总览 4 个 KPI', kpis.length === 4, kpis.join(','));
ok('趋势柱 14 根', d.querySelectorAll('.barchart .bar').length === 14);
ok('热门榜 5 行', d.querySelectorAll('.toplist li').length === 5);
ok('事件 8 条', d.querySelectorAll('.events li').length === 8);
ok('侧栏 4 个导航', d.querySelectorAll('.nav-btn').length === 4);
const EXPECT = { business: '风格：商务白', mono: '风格：单色暗', win95: '风格：95 桌面' };
const themeId = (file.match(/admin-(\w+)\.html/) ?? ['', 'business'])[1];
ok('data-theme 与文件一致', d.documentElement.getAttribute('data-theme') === themeId, d.documentElement.getAttribute('data-theme'));
ok('主题徽标文案正确', txt(d.querySelector('.theme-badge')) === EXPECT[themeId], txt(d.querySelector('.theme-badge')));

// ---- KPI 与明细一致性（数据诚信）----
const totalLinks = Number(kpis[3].replace(/,/g, ''));

// ---- 切到短链管理 ----
const nav = [...d.querySelectorAll('.nav-btn')];
nav[1].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await tick(3);
let rows = () => [...d.querySelectorAll('.table tbody tr.row')];
ok('短链表渲染 60 行', rows().length === 60, rows().length);
ok('分区切换不卸载：总览面板仍在 DOM', d.querySelectorAll('.barchart .bar').length === 14);

// ---- 搜索过滤 ----
const input = d.querySelector('.search input');
const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set;
setter.call(input, 'spring');
input.dispatchEvent(new w.Event('input', { bubbles: true }));
await tick(6);
const noteTxt = () => txt(d.querySelector('.toolbar-note'));
ok('搜索 spring 命中 4 条', /^4 条/.test(noteTxt() ?? ''), noteTxt());
const allMatch = rows().every((r) => r.textContent.toLowerCase().includes('spring'));
ok('搜索结果全部含 spring', allMatch);

// ---- 状态筛选 ----
setter.call(input, '');
input.dispatchEvent(new w.Event('input', { bubbles: true }));
await tick(4);
const seg = [...d.querySelectorAll('.seg-btn')];
seg[2].dispatchEvent(new w.MouseEvent('click', { bubbles: true })); // 停用
await tick(4);
const pausedOnly = rows().every((r) => txt(r.querySelector('.pill')) === '已停用');
ok('「停用」筛选后仅显示已停用', pausedOnly && rows().length > 0, rows().length);
seg[1].dispatchEvent(new w.MouseEvent('click', { bubbles: true })); // 活跃
await tick(4);
ok('「活跃」筛选后仅显示活跃', rows().every((r) => txt(r.querySelector('.pill')) === '活跃'));
seg[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true })); // 全部
await tick(4);

// ---- 排序 ----
const sortBtns = [...d.querySelectorAll('.seg-btn')].slice(3);
sortBtns[2].dispatchEvent(new w.MouseEvent('click', { bubbles: true })); // 按短链码
await tick(4);
const slugs = rows().map((r) => txt(r.querySelector('.mono')));
const sortedAsc = [...slugs].sort((a, b) => a.localeCompare(b));
ok('按短链码升序生效', JSON.stringify(slugs) === JSON.stringify(sortedAsc), slugs.slice(0, 3).join(','));
sortBtns[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true })); // 按点击
await tick(4);
const clicks = rows().map((r) => Number(txt(r.querySelector('.num')).replace(/,/g, '')));
ok('按点击降序生效', clicks.every((v, i) => i === 0 || clicks[i - 1] >= v), clicks.slice(0, 3).join(','));
const sum = clicks.reduce((a, b) => a + b, 0);
const noteNum = Number((noteTxt().match(/合计 ([\d,]+)/) ?? ['', '0'])[1].replace(/,/g, ''));
ok('工具栏合计点击 = 行求和', noteNum === sum, sum + ' vs ' + noteNum);
ok('短链总数与数据源一致', clicks.length === totalLinks, totalLinks);

// ---- 展开明细 ----
const r0 = () => rows()[0];
r0().dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await tick(4);
ok('点击行展开明细', d.querySelectorAll('.table tbody tr.detail').length === 1);
ok('明细含创建者统计', /同创建者短链数/.test(txt(d.querySelector('.detail-grid')) ?? ''));
r0().dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await tick(4);
ok('再次点击收起明细', d.querySelectorAll('.table tbody tr.detail').length === 0);

// ---- 两步删除 ----
const before = rows().length;
const delBtn = [...r0().querySelectorAll('.row-actions .btn')].find((b) => txt(b) === '删除');
delBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await tick(5);
const pendingRow = r0();
ok('第一步：进入待确认态', pendingRow.getAttribute('data-pending') === '1', pendingRow.getAttribute('data-pending'));
const danger = d.querySelector('.btn--danger');
ok('第一步：出现红色确认按钮', !!danger, [...pendingRow.querySelectorAll('.btn')].map(txt).join(','));
if (danger) {
  danger.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await tick(5);
  ok('第二步：行被删除', rows().length === before - 1, rows().length + ' vs ' + before);
}
// 4 秒自动取消
const del2 = [...r0().querySelectorAll('.row-actions .btn')].find((b) => txt(b) === '删除');
del2.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await tick(3);
ok('再次进入待确认态', r0().getAttribute('data-pending') === '1');
await new Promise((res) => setTimeout(res, 4300));
await tick(3);
ok('4 秒后自动退回普通态', r0().getAttribute('data-pending') === '0' && !d.querySelector('.btn--danger'));

// ---- 停用/启用 ----
const toggle = [...r0().querySelectorAll('.row-actions .btn')].find((b) => txt(b) === '启用' || txt(b) === '停用');
const pillBefore = txt(r0().querySelector('.pill'));
toggle.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await tick(5);
ok('停用/启用切换生效', txt(r0().querySelector('.pill')) !== pillBefore, pillBefore + ' -> ' + txt(r0().querySelector('.pill')));
ok('操作触发 toast', !!lastToast(), txt(lastToast()));

// ---- API 密钥 ----
[...d.querySelectorAll('.nav-btn')][2].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await tick(4);
const keyRows = [...d.querySelectorAll('.table tbody tr')].filter((r) => /bcn_/.test(txt(r) ?? ''));
ok('密钥表 5 行', keyRows.length === 5, keyRows.length);
const masked = txt(keyRows[0].querySelector('.mono'));
ok('密钥默认脱敏显示', masked.includes('•') && !/[0-9a-f]{20}/.test(masked), masked);
const reveal = [...keyRows[0].querySelectorAll('.btn')].find((b) => txt(b) === '显示');
reveal.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await tick(4);
const revealed = txt([...d.querySelectorAll('.table tbody tr')].filter((r) => /bcn_[0-9a-f]{28}/.test(txt(r) ?? ''))[0]?.querySelector('.mono'));
ok('点击显示后出现明文密钥', /[0-9a-f]{28}/.test(revealed ?? ''), revealed);
ok('密钥行有 scope 标签', keyRows[0].querySelectorAll('.scope').length >= 1);

// ---- 服务设置表单 ----
[...d.querySelectorAll('.nav-btn')][3].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await tick(4);
const fields = [...d.querySelectorAll('.form .field')];
ok('设置表单 3 个输入项', fields.length === 3, fields.length);
const domainInput = fields[1].querySelector('input');
setter.call(domainInput, 'not a domain!!');
domainInput.dispatchEvent(new w.Event('input', { bubbles: true }));
await tick(4);
const save = [...d.querySelectorAll('.form .btn')].find((b) => txt(b) === '保存设置');
save.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await tick(5);
ok('非法域名被拦截并报错', !!d.querySelector('.field--bad'), txt(d.querySelector('.field em')));
ok('校验失败时 toast 提示错误数', /处错误/.test(txt(lastToast()) ?? ''), txt(lastToast()));
setter.call(domainInput, 'bcn.example');
domainInput.dispatchEvent(new w.Event('input', { bubbles: true }));
await tick(4);
save.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await tick(5);
ok('修正后可保存', /设置已保存|仅在本次会话/.test(txt(lastToast()) ?? ''), txt(lastToast()));
ok('保存后脏值标记消失', /已与服务配置同步/.test(txt(d.querySelector('.form .panel-sub')) ?? ''), txt(d.querySelector('.form .panel-sub')));

const nameInput = fields[0].querySelector('input');
setter.call(nameInput, '');
nameInput.dispatchEvent(new w.Event('input', { bubbles: true }));
await tick(4);
ok('清空必填项标记脏值', /有未保存修改/.test(txt(d.querySelector('.form .panel-sub')) ?? ''), txt(d.querySelector('.form .panel-sub')));
setter.call(nameInput, 'Beacon 信标短链');
nameInput.dispatchEvent(new w.Event('input', { bubbles: true }));
await tick(4);
setter.call(fields[2].querySelector('input'), '999');
fields[2].querySelector('input').dispatchEvent(new w.Event('input', { bubbles: true }));
await tick(4);
save.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await tick(5);
ok('越界每页条数被拦截', /5–50/.test(txt(fields[2].querySelector('em')) ?? ''), txt(fields[2].querySelector('em')));

// ---- 三主题差异（CSS 变量）----
console.log('--- diagnostics ---');
console.log('errors:', errs.length === 0 ? 'none' : errs.slice(0, 4).join('\n'));
console.log('RESULT pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
