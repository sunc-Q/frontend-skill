/* 纯函数层的账目断言：期望值用「另一套算法」独立算一遍（逐席累加 / 手算常数），
   不是把源码里的公式抄一次。跑法：node scripts/pricing-check.mjs */
import {
  ADD_ONS,
  bracketDetail,
  buildQuote,
  CANOPY_MIN_SEATS,
  CANOPY_UNIT,
  cheapestTier,
  clampSeats,
  convert,
  formatMoney,
  GROVE_BRACKETS,
  listMonthly,
  monthlyFor,
  nextBracketAt,
  seatsWithinBudget,
  TIERS,
  tierMonthly,
  tierOf,
} from '../src/lib/pricing.ts';

let pass = 0;
const fails = [];

function ok(name, cond, extra = '') {
  if (cond) pass += 1;
  else fails.push(name + (extra === '' ? '' : ' — ' + extra));
}

function eq(name, actual, expected) {
  ok(name, actual === expected, 'got ' + JSON.stringify(actual) + ' want ' + JSON.stringify(expected));
}

/** 独立实现：逐席累加的林木月价（源码用的是区间批量乘法）。 */
function bruteGrove(seats) {
  let total = 0;
  for (let i = 1; i <= seats; i += 1) {
    const bracket = GROVE_BRACKETS.find((b) => i >= b.from && i <= b.to);
    total += bracket === undefined ? 0 : bracket.unit;
  }
  return total;
}

/* ---------- 阶梯单价 ---------- */
eq('林木 1 席', tierMonthly('grove', 1), 39);
eq('林木 5 席 = 5×39', tierMonthly('grove', 5), 195);
eq('林木 6 席 = 195+29', tierMonthly('grove', 6), 224);
eq('林木 20 席 = 195+15×29', tierMonthly('grove', 20), 630);
eq('林木 21 席 = 630+22', tierMonthly('grove', 21), 652);
eq('林木 50 席 = 630+30×22', tierMonthly('grove', 50), 1290);
eq('林木 51 席 = 1290+17', tierMonthly('grove', 51), 1307);
eq('林木 100 席 = 1290+50×17', tierMonthly('grove', 100), 2140);

for (const n of [1, 3, 5, 6, 19, 20, 21, 49, 50, 51, 77, 100]) {
  eq('区间批量乘法 == 逐席累加 @' + n, tierMonthly('grove', n), bruteGrove(n));
}

eq('冠层 10 席按 20 席计', tierMonthly('canopy', 10), CANOPY_MIN_SEATS * CANOPY_UNIT);
eq('冠层 30 席按 30 席计', tierMonthly('canopy', 30), 30 * CANOPY_UNIT);
eq('苗木恒为 0', tierMonthly('seed', 3), 0);

/* ---------- 席位钳制 ---------- */
eq('苗木上限 3', clampSeats('seed', 9), 3);
eq('冠层不下限席位（改由最低计费量兜住）', clampSeats('canopy', 1), 1);
eq('非法输入回落 1', clampSeats('grove', Number.NaN), 1);
eq('小数向下取整', clampSeats('grove', 8.9), 8);

/* ---------- 增值模块 ---------- */
eq('冠层已含 SSO 与审计，不额外计价', listMonthly('canopy', 20, ['sso', 'audit']), 20 * CANOPY_UNIT);
eq('林木选了 SSO 也不计价（该档不允许）', listMonthly('grove', 10, ['sso']), tierMonthly('grove', 10));
eq('林木 storage 只加 120', listMonthly('grove', 10, ['storage']), tierMonthly('grove', 10) + 120);
eq('林木 priority 按席位', listMonthly('grove', 10, ['priority']), tierMonthly('grove', 10) + 10 * 5);
eq('冠层 4 席 storage 仍按 20 席的套餐价 + flat 120', listMonthly('canopy', 4, ['storage']), 20 * CANOPY_UNIT + 120);
eq('冠层 30 席 priority 按 30 席', listMonthly('canopy', 30, ['priority']), 30 * CANOPY_UNIT + 30 * 5);
eq('苗木任何模块都不计价', listMonthly('seed', 3, ['storage', 'priority', 'api']), 0);

/* ---------- 账单不变式：明细行之和 === charged ---------- */
const scenarios = [];
for (const tier of TIERS) {
  for (const seats of [1, 4, 5, 12, 20, 33, 60, 100]) {
    for (const period of ['monthly', 'annual']) {
      for (const currency of ['CNY', 'USD']) {
        for (const addOns of [[], ['storage'], ['storage', 'priority'], ['storage', 'priority', 'api'], ['sso', 'audit']]) {
          scenarios.push({ tier: tier.id, seats, period, currency, addOns });
        }
      }
    }
  }
}
ok('场景数量 >= 400', scenarios.length >= 400, String(scenarios.length));

let sumBad = 0;
let monthlyBad = 0;
let savedBad = 0;
let negBad = 0;
let monotonousBad = 0;
for (const sc of scenarios) {
  const q = buildQuote(sc);
  const sum = q.lines.reduce((acc, l) => acc + l.amount, 0);
  if (sum !== q.charged) sumBad += 1;
  if (q.period === 'monthly' && q.charged !== q.monthlyTotal) monthlyBad += 1;
  if (q.period === 'annual' && q.listMonthly * 12 - q.charged !== q.saved) savedBad += 1;
  for (const l of q.lines) {
    if (l.key === 'discount' ? l.amount > 0 : l.amount < 0) negBad += 1;
  }
  if (sc.tier === 'grove' && sc.seats < 100) {
    const next = buildQuote({ ...sc, seats: sc.seats + 1 });
    if (next.charged < q.charged) monotonousBad += 1;
  }
}
eq('明细之和 === charged（全场景）', sumBad, 0);
eq('月付：charged === monthlyTotal', monthlyBad, 0);
eq('年付：省额 === 折前年价 − 本单', savedBad, 0);
eq('折扣行为负、其余行为非负', negBad, 0);
eq('林木档加一席不会变便宜（金额单调不减）', monotonousBad, 0);

/* ---------- 折扣与币种 ---------- */
const g10 = buildQuote({ tier: 'grove', seats: 10, period: 'annual', currency: 'CNY', addOns: [] });
eq('林木 10 席折前', g10.listMonthly, 340);
eq('林木 10 席年付每月', g10.monthlyTotal, 272);
eq('林木 10 席一次支付', g10.charged, 3264);
eq('年付明细含折扣行', g10.lines.some((l) => l.key === 'discount'), true);
eq('月付明细不含折扣行', buildQuote({ tier: 'grove', seats: 10, period: 'monthly', currency: 'CNY', addOns: [] }).lines.some((l) => l.key === 'discount'), false);

const c40 = buildQuote({ tier: 'canopy', seats: 40, period: 'annual', currency: 'CNY', addOns: [] });
eq('冠层 40 席折前', c40.listMonthly, 40 * CANOPY_UNIT);
eq('冠层年付折扣 25%', c40.discountRate, 0.25);
eq('冠层 40 席一次支付', c40.charged, Math.round(40 * CANOPY_UNIT * 0.75 * 12));

const usd = buildQuote({ tier: 'grove', seats: 10, period: 'annual', currency: 'USD', addOns: [] });
ok('USD 取整到 0.5', Math.abs(usd.charged * 2 - Math.round(usd.charged * 2)) < 1e-9, String(usd.charged));
eq('USD 明细行数与 CNY 相同', usd.lines.length, g10.lines.length);
ok('USD 金额 < CNY 金额', usd.charged < g10.charged);
eq('免费档任何币种都是 0', buildQuote({ tier: 'seed', seats: 3, period: 'annual', currency: 'USD', addOns: ['storage'] }).charged, 0);

/* ---------- 展示字符串 ---------- */
eq('阶梯文本 8 席', bracketDetail(8), '1-5 席 ¥39 · 6-8 席 ¥29');
eq('阶梯文本 21 席', bracketDetail(21), '1-5 席 ¥39 · 6-20 席 ¥29 · 21-21 席 ¥22');
eq('下一阶梯 8→21', nextBracketAt(8), 21);
eq('下一阶梯 20→21', nextBracketAt(20), 21);
eq('最低阶梯无下一档', nextBracketAt(60), null);
eq('预算 300 买 8 席', seatsWithinBudget(300), 8);
eq('预算 0 买 0 席', seatsWithinBudget(0), 0);
eq('预算 195 正好 5 席', seatsWithinBudget(195), 5);
eq('预算 630 正好 20 席', seatsWithinBudget(630), 20);
eq('最便宜一档永远是苗木', cheapestTier(100, ['api']).tier, 'seed');
eq('折前口径不看折扣', cheapestTier(100, ['api']).monthly, listMonthly('seed', 3, []));
eq('货币符号 CNY', formatMoney('CNY', 1234), '¥1,234');
eq('货币符号 USD 整数不带小数', formatMoney('USD', 1234), '$1,234');
eq('货币符号 USD 半元带两位', formatMoney('USD', 1234.5), '$1,234.50');
eq('convert 只做换算与取整', convert('CNY', 340.4), 340);
eq('monthlyFor 与 buildQuote 同源', monthlyFor('grove', 10, [], 'annual', 'CNY'), g10.monthlyTotal);
eq('monthlyFor 含模块', monthlyFor('grove', 10, ['storage'], 'monthly', 'CNY'), buildQuote({ tier: 'grove', seats: 10, period: 'monthly', currency: 'CNY', addOns: ['storage'] }).monthlyTotal);

/* ---------- 配置自洽（防止价目表与文案打架） ---------- */
for (const tier of TIERS) {
  const cfg = tierOf(tier.id);
  for (const id of cfg.allowedAddOns) {
    ok(cfg.name + ' 允许的模块确实允许它: ' + id, ADD_ONS.some((a) => a.id === id && a.availableOn.includes(tier.id)));
  }
  for (const id of cfg.includedAddOns) {
    ok(cfg.name + ' 已含的模块不该同时可勾选: ' + id, !cfg.allowedAddOns.includes(id));
    ok(cfg.name + ' 已含模块的可选档含它: ' + id, ADD_ONS.some((a) => a.id === id && a.availableOn.includes(tier.id)));
  }
  ok(cfg.name + ' 折扣在 0~0.4 之间', cfg.annualDiscount >= 0 && cfg.annualDiscount <= 0.4);
  ok(cfg.name + ' 高亮条目非空', cfg.highlights.length > 0);
}

console.log('pricing-check: ' + pass + ' 通过 / ' + (pass + fails.length) + ' 断言');
if (fails.length > 0) {
  console.log('失败：');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
