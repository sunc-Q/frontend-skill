#!/usr/bin/env node
// 变异卡：给绿了 100/100 的断言卡配"獠牙"——每条卡都注入一个已知缺陷，断言它必须被抓到。
// 只有全绿的断言遇到变异仍全绿，才算真的有效。变异只在内存里做，不落盘、不碰产物。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { makeCard } from './_harness.mjs';
import { render, STYLES, stats, cells, truncations, filledBlocks, eighths, charClass, wideRuns, WIDE_FIX } from '../src/render.mjs';

const ROUND = join(dirname(fileURLToPath(import.meta.url)), '..');
const facts = JSON.parse(readFileSync(join(ROUND, 'facts.json'), 'utf8'));
const out = makeCard('mutate');
const clone = () => structuredClone(facts);
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 12);

/* 汇总表行：从渲染文本里取某条泳道的整行 */
const rowOf = (text, needle) => text.split('\n').find((l) => l.startsWith('|') && l.includes(needle)) || '';
const barOf = (line) => {
  const cell = (line.slice(1, -1).split('|')[5] || '').replace(/^\s/, '').replace(/\s+$/, '');
  const m = cell.match(/(\d{1,3})%$/);
  return m ? { bar: cell.slice(0, m.index).replace(/\s$/, ''), pct: +m[1] } : null;
};

/* ---------- M1 值变异：把一条已完成任务改成阻塞，数字与条必须同步变 ---------- */
{
  const base = render('matrix', facts);
  const m = clone();
  const lane = m.lanes.find((l) => l.key === 'health');
  const target = lane.tasks.find((t) => t.status === 'done');
  target.status = 'blocked';
  const after = render('matrix', m);
  const b0 = barOf(rowOf(base, '自检 HEALTH')), b1 = barOf(rowOf(after, '自检 HEALTH'));
  out.ok('M1a', '改一个任务的状态 → 该泳道 pct 现算下降', b1.pct < b0.pct, `${b0.pct}% -> ${b1.pct}%`);
  out.ok('M1b', '数字变了就必须可见：matrix 十格条若被量化吞掉，dense 八分度条要动', (() => {
    const d0 = barOf(rowOf(render('dense', facts), '自检 HEALTH')), d1 = barOf(rowOf(render('dense', m), '自检 HEALTH'));
    const matrixMoved = b0.bar !== b1.bar;
    return matrixMoved || (d0.bar !== d1.bar && cells(d0.bar) === 10 && cells(d1.bar) === 10);
  })(), `matrix ${b0.bar} -> ${b1.bar}`);
  out.ok('M1e', '记录十格条的分辨率死区（本轮真实存在：pct 变 8 点而条不动）', b0.bar === b1.bar && b0.pct !== b1.pct, `${b0.pct}% 与 ${b1.pct}% 都画成 ${b0.bar}`);
  const bl0 = rowOf(base, '合计'), bl1 = rowOf(after, '合计');
  out.ok('M1c', '合计行跟着动（顶层不是手抄）', bl0 !== bl1, `${bl0.slice(-16)} -> ${bl1.slice(-16)}`);
  // 局部化（结构口径）：未受影响的泳道，其汇总行 + 待办区块必须逐字节不变
  const blockOf = (text, name) => {
    const lines = text.split('\n');
    const i = lines.findIndex((l) => l.startsWith('####') && l.includes(name));
    if (i < 0) return null;
    let j = i + 1;
    while (j < lines.length && !/^#{2,4} /.test(lines[j])) j++;
    return lines.slice(i, j).join('\n');
  };
  const untouched = facts.lanes.filter((l) => l.key !== 'health').map((l) => {
    const same = rowOf(base, l.name) === rowOf(after, l.name) && blockOf(base, l.name) === blockOf(after, l.name);
    return { name: l.name, same, block: blockOf(base, l.name) !== null };
  });
  out.ok('M1d', '变异波及面 = 被改泳道 + 合计行（其余泳道的行与区块逐字节不动）',
    untouched.length === facts.lanes.length - 1 && untouched.every((u) => u.same && u.block),
    untouched.map((u) => `${u.name.replace(/\s.*/, '')}=${u.same && u.block ? 'ok' : 'CHANGED'}`).join(' '));
}

/* ---------- M2 结构变异：加一条任务，条数/表行数/TOTAL 三处一起长 ---------- */
{
  const base = render('matrix', facts);
  const m = clone();
  const lane = m.lanes.find((l) => l.key === 'trace');
  lane.tasks.push({ id: 'T99', label: '注入的假任务 · injected', label_ascii: 'T99-injected', status: 'todo', note: 'mutation' });
  const after = render('matrix', m);
  out.ok('M2a', '任务表多出一行且新 id 可见', (after.match(/\| T99 \|/g) || []).length === (base.match(/\| T99 \|/g) || []).length + 1, `T99 出现 ${after.split('\n').filter((l) => l.includes('| T99 |')).length} 行`);
  const r0 = rowOf(base, '留痕 TRACE'), r1 = rowOf(after, '留痕 TRACE');
  out.ok('M2b', 'TRACE 行 total +1、pct 重算', +r0.split('|')[3] + 1 === +r1.split('|')[3] && barOf(r0).pct !== barOf(r1).pct || +r0.split('|')[3] + 1 === +r1.split('|')[3], `${r0.split('|')[3].trim()}/${barOf(r0).pct}% -> ${r1.split('|')[3].trim()}/${barOf(r1).pct}%`);
  for (const k of Object.keys(STYLES)) {
    const t = render(k, m);
    const rowBars = t.split('\n').filter((l) => l.startsWith('|') && /% \|$/.test(l)).map(barOf).filter(Boolean);
    out.ok(`M2c-${k}`, `${k} 结构变异后汇总表仍每条 10 列（不变量不依赖本轮数据形状）`,
      rowBars.length >= 6 && rowBars.every((b) => cells(b.bar) === 10),
      `${rowBars.length} 条，宽度集合 ${[...new Set(rowBars.map((b) => cells(b.bar)))].join(',')}`);
  }
}

/* ---------- M3 语义变异：跨风格污染（把 A 风格的条字母表套到 B 风格的判据上） ---------- */
{
  const fam = { matrix: '▓░', dense: '█▏▎▍▌▋▊▉▒', teletype: '#.' };
  const runsOf = (k) => render(k, facts).split('\n').flatMap((l) => (l.match(new RegExp(`[${fam[k]}]{4,}`, 'g')) || []));
  const denseRuns = runsOf('dense');
  out.ok('M3a', 'dense 自己的条 100% 落在 dense 字母表内（封闭判据在真数据上成立）',
    denseRuns.length >= 6 && denseRuns.every((r) => [...r].every((c) => fam.dense.includes(c))), `${denseRuns.length} 处条`);
  const foreign = [...runsOf('matrix'), ...runsOf('teletype')];
  out.ok('M3b', '另两风格的条按 dense 字母表判为异类（换风格渲染会被 B2 型判据抓住）',
    foreign.length > 0 && foreign.every((r) => ![...r].every((c) => fam.dense.includes(c))), `外来条 ${foreign.length} 处，例 ${foreign[0] || ''}`);
  out.ok('M3c', '三套条字母表两两不相交（互斥判据不会因写法漂移而自洽）',
    [...fam.matrix].every((c) => !fam.dense.includes(c) && !fam.teletype.includes(c)) && [...fam.dense].every((c) => !fam.teletype.includes(c)),
    [fam.matrix, fam.dense, fam.teletype].join(' | '));
}

/* ---------- M4 陈旧检测：state.json 变了而 facts 没重跑 ---------- */
{
  const liveRaw = readFileSync(join(ROUND, '..', '..', 'state', 'state.json'));
  out.ok('M4a', '新鲜读数：facts 记录的 sha1 == 现读字节 sha1', facts.ledger.state_sha1 === sha1(liveRaw), facts.ledger.state_sha1);
  const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(liveRaw.toString('utf8')), tried: [...JSON.parse(liveRaw.toString('utf8')).tried, { skill: 'x' }] }));
  out.ok('M4b', '台账多一条时 sha1 立刻对不上（陈旧看板会被 D6 拦下）', sha1(tampered) !== facts.ledger.state_sha1, sha1(tampered));
}

/* ---------- M5 钳制通例：换一个数据形状，满格仍只属于真·全完成 ---------- */
{
  const cases = [[100, 100, 0], [199, 200, 0], [9, 10, 0], [22, 23, 0], [1, 1, 0], [0, 5, 0]];
  out.ok('M5a', '任何 done<total 的组合都不会画满格（技能原公式在 199/200 会给 100%→满）', cases.every(([d, t]) => {
    const pct = t === 0 ? 0 : Math.round((d / t) * 100);
    return d === t ? filledBlocks(pct, d, t) === 10 : filledBlocks(pct, d, t) <= 9 && Math.round(pct / 10) <= 10;
  }), cases.map(([d, t]) => `${d}/${t}→${filledBlocks(Math.round(d / t * 100), d, t)}格`).join(' '));
  out.ok('M5b', '原公式在 199/200 上确实过度声明（证明这不是本轮数据的特例修补）', (() => {
    const pct = Math.round((199 / 200) * 100);
    return Math.round(pct / 10) === 10 && filledBlocks(pct, 199, 200) === 9 && pct === 100;
  })(), 'naive=10 clamped=9');
  out.ok('M5c', 'dense 八分度同理钳到 79/80', (() => {
    const pct = Math.round((199 / 200) * 100);
    return eighths(pct, 199, 200) === 79 && eighths(100, 200, 200) === 80;
  })(), `e(199/200)=${eighths(100, 199, 200)} e(200/200)=${eighths(100, 200, 200)}`);
}

/* ---------- M6 截断记账：超宽文案必须被记下来而不是悄悄吞掉 ---------- */
{
  const m = clone();
  m.lanes[0].subtitle = '非常非常长的泳道说明'.repeat(12);
  render('matrix', m);
  out.ok('M6a', '超预算文案触发 truncations（B4 的零截断断言因此有约束力）', truncations.length > 0, `truncations=${truncations.length} ${JSON.stringify(truncations[0] || {}).slice(0, 60)}`);
  render('matrix', facts);
  out.eq('M6b', '干净数据回到零截断（变异已撤销）', truncations.length, 0);
}

/* ---------- M7 退化输入：空泳道不得产出 NaN / undefined ---------- */
{
  const m = clone();
  m.lanes.push({ key: 'empty', name: '空白 EMPTY', name_ascii: 'EMPTY', subtitle: '空泳道', subtitle_ascii: 'empty lane', emoji: '⬜', tasks: [] });
  for (const k of Object.keys(STYLES)) {
    const t = render(k, m);
    out.ok(`M7-${k}`, `${k} 在空泳道下不出现 NaN/undefined/Infinity`, !/NaN|undefined|Infinity/.test(t), stats([]).pct + '% pct=' + JSON.stringify(stats([])));
  }
}

/* ---------- M8 语义变异：台账缺 time 时时间线不得渲染出 "ined" ---------- */
{
  const m = clone();
  m.milestones[3] = { ...m.milestones[3], tag: String(undefined).slice(11, 16), date: String(undefined).slice(5, 10) };
  const t = render('matrix', m);
  const line = t.split('\n').find((l) => l.startsWith('  ●') || l.includes('ined')) || '';
  out.ok('M8a', '注入坏时间后，产物里会出现可辨识的破绽（生成器不掩盖 undefined）', /undefined|ined/.test(t), line.slice(0, 40));
  const clean = render('matrix', facts);
  const tlFence = (clean.match(/```[a-z]*\n([\s\S]*?)```/g) || []).find((b) => /●|○/.test(b)) || '';
  out.ok('M8b', '真实 facts 的时间线没有这类破绽（timeOf 回填生效）', !/undefined|NaN|ined/.test(tlFence), tlFence.split('\n')[2] || '');
}

/* ---------- M9 反手抄：把某个数字硬写进渲染层，扫描器要能看见 ---------- */
{
  const fake = "const x = '看板 62% 完成'; const y = padL('89%', 4);";
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const hits = (strip(fake).match(/(?<![\w.(])\d{1,3}\s*%/g) || []).filter((x) => !/^(100|0)%$/.test(x));
  out.ok('M9a', 'E1 型扫描对注入的手抄百分比有反应', hits.length === 2, hits.join(' '));
  out.eq('M9b', '真实源码里扫描结果为 0', (() => {
    const src = strip(readFileSync(join(ROUND, 'src', 'render.mjs'), 'utf8') + readFileSync(join(ROUND, 'scripts', 'build.mjs'), 'utf8') + readFileSync(join(ROUND, 'scripts', 'facts.mjs'), 'utf8'));
    return (src.match(/(?<![\w.(])\d{1,3}\s*%/g) || []).filter((x) => !/^(100|0)%$/.test(x)).length;
  })(), 0);
}

/* ---------- M10 结构变异：宽字符校正层拆一处，Node 侧判据必须报错 ---------- */
{
  const mdOf = (k) => readFileSync(join(ROUND, STYLES[k].file), 'utf8');
  const htmlOf = (k) => readFileSync(join(ROUND, 'preview', `${k}.html`), 'utf8');
  const unesc = (s) => s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  const body = (h) => (h.match(/<code id="board">([\s\S]*?)<\/code>/) || [])[1] || '\x00';
  const spans = (h) => [...h.matchAll(/<span class="fx-([a-z]+)">((?:(?!<\/span>)[\s\S])*)<\/span>/g)]
    .map((m) => ({ cls: m[1], text: unesc(m[2]) }));
  const V = {
    // B7：剥掉 span 后必须逐字节回原 md
    b7: (h, md) => body(h).replace(/<span class="fx-[a-z]+">/g, '').replace(/<\/span>/g, '')
      .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&') === md,
    // B7b：每个 span 只能装它声明那一类字符
    b7b: (h) => spans(h).every((sp) => [...sp.text].every((ch) => charClass(ch) === sp.cls)),
    // B7c：span 组数 == md 里的连续宽字符段数
    b7c: (h, md) => spans(h).length === wideRuns(md).filter(([c]) => c !== 't').length,
    // B13：有宽字符才有校正脚本，二者必须同进同退
    b13: (h, md) => /<script>/.test(h) === wideRuns(md).some(([c]) => c !== 't'),
  };
  const md = mdOf('matrix'), html = htmlOf('matrix');
  out.ok('M10a', '真实产物四项判据全过（正对照：校验器没把合法产物判死）',
    V.b7(html, md) && V.b7b(html) && V.b7c(html, md) && V.b13(html, md),
    `spans=${spans(html).length} 脚本=${/<script>/.test(html)}`);
  const arms = [
    ['拆掉校正脚本', md, html.replace(/<script>[\s\S]*?<\/script>/, ''), ['b13']],
    ['把一段 CJK 贴成 emoji 标签', md, html.replace(/<span class="fx-cjk">([^<]{1,4})<\/span>/, '<span class="fx-emoji">$1</span>'), ['b7b']],
    ['让 span 越界吃掉条形字符', md, html.replace(/<span class="fx-cjk">([^<]+)<\/span>/, '<span class="fx-cjk">▓$1</span>'), ['b7b', 'b7c']],
    ['把 CJK 挪出 span（等价于漏包）', md, html.replace(/<span class="fx-cjk">([^<]+)<\/span>/, '$1'), ['b7c']],
    ['给纯 ASCII 的 teletype 也注脚本', mdOf('teletype'), htmlOf('teletype').replace('</body>', '<script>/*x*/</script></body>'), ['b13']],
  ];
  for (const [name, ref, mutated, expect] of arms) {
    const hit = expect.filter((v) => !V[v](mutated, ref));
    out.ok(`M10b·${name}`, `变异「${name}」被判据抓到（${expect.join('/')} 报红）`, hit.length > 0,
      `报红：${hit.join(',') || '无（判据太松）'}`);
  }
}

/* ---------- M11 值变异：校正目标一旦被改宽，与 cells() 的交叉核对必须报错 ---------- */
{
  const probe = { cjk: '项', emoji: '✅', braille: '⣿', shape: '●' };
  const check = (fix) => Object.entries(fix).every(([cls, cols]) => probe[cls] && charClass(probe[cls]) === cls && cells(probe[cls]) === cols);
  out.ok('M11a', '真实 WIDE_FIX 与 cells() 逐项一致（正对照）', check(WIDE_FIX), JSON.stringify(WIDE_FIX));
  out.ok('M11b', '把 cjk 目标改成 1 列即被抓住（预览层与宽度模型不许各说各话）', !check({ ...WIDE_FIX, cjk: 1 }), 'cjk:1 → cells(项)=2 矛盾');
  out.ok('M11c', '新增一个不存在的类（gap）同样被抓住（校正表不能随手扩）', !check({ ...WIDE_FIX, gap: 2 }), 'gap 无对应 charClass 探针');
}

out.done();
