/* 零框架实现：一个 IIFE（build.mjs 把 content/svc/storage/app 串进同一个闭包）。
   三条自设纪律，全部有对应断言：
   1. 数据只经 textContent / createElementNS 落 DOM，不用 innerHTML 拼用户输入（XSS 面为零）。
   2. 卡片/表格行「建一次、之后只复排不重建」（这是 vanilla 下 rerender-memo 的等价物，可机检）。
   3. 正则与静态常量提升到模块层，不在事件回调里重建。 */
const KEY = 'soundisle.prefs.v1';
const PHONE_RE = /^1[3-9]\d{9}$/;
const NAME_RE = /^[\p{L}\p{M}\s·•-]{2,20}$/u;
const VOTE_ID_RE = /^a\d\d$/;
const TIER_IDS = ['day', 'full', 'vip'];

function readPrefs() {
  const fallback = { voted: [], tier: 'day' };
  let raw = null;
  try { raw = window.localStorage.getItem(KEY); } catch (e) { return fallback; }
  if (!raw) return fallback;
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (e) { return fallback; }
  if (!parsed || typeof parsed !== 'object' || parsed.v !== 1 || !parsed.data || typeof parsed.data !== 'object') return fallback;
  return sanitizePrefs(parsed.data);
}
function sanitizePrefs(d) {
  const voted = Array.isArray(d.voted) ? d.voted.filter(function (x) { return typeof x === 'string' && VOTE_ID_RE.test(x); }) : [];
  const tier = typeof d.tier === 'string' && TIER_IDS.indexOf(d.tier) >= 0 ? d.tier : 'day';
  return { voted: voted, tier: tier };
}
function writePrefs(patch, prefs) {
  const next = sanitizePrefs(Object.assign({}, prefs, patch));
  try { window.localStorage.setItem(KEY, JSON.stringify({ v: 1, data: next })); } catch (e) { /* 存储不可用时保持内存视图 */ }
  return next;
}

const nf = new Intl.NumberFormat('en-US');
function pad2(n) { return n < 10 ? '0' + n : String(n); }

function startApp() {
  const doc = document;
  const svc = createSvc();
  const prefs0 = readPrefs();
  const stats = { cardsBuilt: 0, rowsBuilt: 0, postersBuilt: 0, reorders: 0, noticesLoads: 0, loopIterations: 0, voteFlash: 0, scrollTicks: 0 };
  window.__lab = { svc: svc, stats: stats, prefs: prefs0, state: null, timers: [] };

  /* ---------- 工具 ---------- */
  function el(tag, cls, text) {
    const n = doc.createElement(tag);
    if (cls) n.setAttribute('class', cls);
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function slot(id) { return doc.getElementById(id); }
  function fmtTokens(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    return {
      d: Math.floor(total / 86400),
      h: Math.floor(total / 3600) % 24,
      m: Math.floor(total / 60) % 60,
      s: total % 60,
    };
  }

  /* ---------- HERO：倒计时 + 3 KPI + 开票进度 ---------- */
  const heroState = { signed: 0, left: 0 };
  const cdNode = { d: slot('cd-d'), h: slot('cd-h'), m: slot('cd-m'), s: slot('cd-s') };
  function paintHero() {
    slot('kpi-signed').textContent = nf.format(heroState.signed);
    slot('kpi-left').textContent = nf.format(heroState.left);
    const sold = svc.state.summary.capacity - heroState.left;    const pct = Math.min(100, Math.max(0, (sold / svc.state.summary.capacity) * 100));
    slot('progress-fill').style.setProperty('--pct', pct.toFixed(2) + '%');
    slot('progress-text').textContent = '已出 ' + nf.format(sold) + ' 张 / 容量 ' + nf.format(svc.state.summary.capacity) + '（' + pct.toFixed(1) + '%）';
    slot('kpi-partners').textContent = nf.format(svc.state.summary.brandPartners);
  }
  /* 双时钟：一律以 svc.serverNow() 为准（页面本地 Date.now() 不参与），
     历轮踩过「两个时钟口径差 8 小时」的坑，这里配 G/H 组断言钉住。 */
  function tickCountdown() {
    const t = fmtTokens(EVENT.startsAt - svc.serverNow());
    cdNode.d.textContent = String(t.d);
    cdNode.h.textContent = pad2(t.h);
    cdNode.m.textContent = pad2(t.m);
    cdNode.s.textContent = pad2(t.s);
    window.__lab.lastCountdown = t;
  }
  stats.timers = [setInterval(tickCountdown, 1000)];

  /* ---------- LINEUP：12 卡建一次 + 复排 + 乐观投票 ---------- */
  const lineupWrap = slot('lineup-grid');
  const cards = {};
  function buildCard(a) {
    stats.cardsBuilt += 1;
    const card = el('article', 'artist');
    card.setAttribute('data-id', a.id);
    const rank = el('span', 'rank');
    const head = el('div', 'a-head');
    head.append(el('h3', 'a-name', a.name), el('p', 'a-en', a.enName + ' · ' + a.city));
    const meta = el('p', 'a-meta');
    meta.append(el('span', 'genre', a.genre));
    if (a.headliner) meta.append(el('span', 'hl', '头牌'));
    const voteBtn = el('button', 'vote');
    voteBtn.setAttribute('type', 'button');
    const votes = el('b', 'votes', nf.format(a.votes));
    voteBtn.append(doc.createTextNode('投票 '), votes);
    voteBtn.addEventListener('click', function () { castVote(a.id, votes, voteBtn); });
    card.append(rank, head, meta, voteBtn);
    cards[a.id] = { node: card, votes: votes, genre: meta.querySelector('.genre'), hl: meta.querySelector('.hl') };
    return card;
  }
  function paintRanks(order) {
    for (let i = 0; i < order.length; i++) {
      const c = cards[order[i].id];
      if (c) c.node.querySelector('.rank').textContent = pad2(i + 1);
    }
  }
  let sortMode = 'votes';
  function applySort(next) {
    sortMode = next;
    const list = svc.state.artists.slice();
    if (next === 'votes') {
      list.sort(function (p, q) { return q.votes - p.votes || (p.id < q.id ? -1 : 1); });
    } else {
      list.sort(function (p, q) { return p.id < q.id ? -1 : 1; });
    }
    /* 复排而非重建：appendChild 移动既有节点（boot 前卡片尚未建好，跳过即空列表） */
    for (let i = 0; i < list.length; i++) {
      const c = cards[list[i].id];
      if (!c) continue;
      lineupWrap.appendChild(c.node);
      stats.reorders += 1;
    }
    paintRanks(list);
    slot('sort-hint').textContent = next === 'votes' ? '按人气（票数）降序 · 平票按官宣编号' : '按官宣顺序（编号 a01→a12）';
    doc.querySelectorAll('#sort-box .seg button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-sort') === next ? 'true' : 'false');
    });
  }
  function castVote(id, votesNode, btn) {
    const before = Number(votesNode.textContent.replace(/,/g, ''));
    votesNode.textContent = nf.format(before + 1);
    stats.voteFlash += 1;
    btn.disabled = true;
    svc.vote(id).then(function (ok) {
      votesNode.textContent = nf.format(ok.votes);
      prefs = writePrefs({ voted: prefs.voted.concat([id]) }, prefs);
      window.__lab.prefs = prefs;
      btn.classList.add('voted');
      btn.disabled = false;
    }).catch(function (err) {
      votesNode.textContent = nf.format(before);
      btn.disabled = false;
      showStatus('notice', '投票未计入：' + err.message);
    });
  }

  /* ---------- SCHEDULE：Map 单循环分组 + 公告延后载入 ---------- */
  const scheduleWrap = slot('schedule-list');
  let scheduleData = [];
  let dayFilter = 'all';
  let stageFilter = 'all';
  let noticesLoaded = null;
  function renderSchedule() {
    scheduleWrap.textContent = '';
    const byStage = new Map();
    let shown = 0;
    for (let i = 0; i < scheduleData.length; i++) {
      stats.loopIterations += 1;
      const s = scheduleData[i];
      if (dayFilter !== 'all' && s.day !== dayFilter) continue;
      if (stageFilter !== 'all' && s.stage !== stageFilter) continue;
      shown += 1;
      if (!byStage.has(s.stage)) byStage.set(s.stage, []);
      byStage.get(s.stage).push(s);
    }
    STAGES.forEach(function (st) {
      const rows = byStage.get(st.id);
      if (!rows || !rows.length) return;
      rows.sort(function (p, q) { return p.start < q.start ? -1 : 1; });
      const block = el('div', 'stage-block');
      block.setAttribute('data-stage', st.id);
      block.append(el('h4', 'stage-name', st.name));
      const table = el('table', 'sessions');
      const thead = el('thead');
      const trh = el('tr');
      ['时间', '演出', '阵容', '标签'].forEach(function (t) { trh.append(el('th', null, t)); });
      thead.append(trh);
      const tbody = el('tbody');
      rows.forEach(function (r) {
        stats.rowsBuilt += 1;
        const tr = el('tr');
        tr.setAttribute('data-id', r.id);
        const tdTime = el('td', 't');
        tdTime.append(el('b', null, r.start), el('span', 'to', '–' + r.end));
        tr.append(tdTime, el('td', 'title', r.title), el('td', 'act', r.artist), el('td', 'tag', r.tag));
        tbody.append(tr);
      });
      table.append(thead, tbody);
      block.append(table);
      scheduleWrap.append(block);
    });
    slot('sched-count').textContent = shown === scheduleData.length
      ? '全部 ' + shown + ' 场'
      : '筛选出 ' + shown + ' / ' + scheduleData.length + ' 场';
    if (shown === 0) scheduleWrap.append(el('p', 'empty', '该组合下没有场次：换一个日期或舞台试试。'));
  }

  /* ---------- 公告 tab：点开才取数（defer），取到后复用（dedup） ---------- */
  function loadNotices(host) {
    if (noticesLoaded) { paintNotices(host, noticesLoaded); return; }
    stats.noticesLoads += 1;
    host.textContent = '';
    host.append(el('p', 'loading', '正在载入公告…'));
    svc.notices().then(function (list) {
      noticesLoaded = list;
      paintNotices(host, list);
    }).catch(function () {
      host.textContent = '';
      host.append(el('p', 'error', '公告载入失败，可稍后重试'));
    });
  }
  function paintNotices(host, list) {
    host.textContent = '';
    list.forEach(function (n) {
      const item = el('div', 'notice');
      item.setAttribute('data-kind', n.kind);
      item.append(el('h5', null, n.title), el('p', null, n.body));
      host.append(item);
    });
  }

  /* ---------- REGISTER：三档票 + VIP 分支 + 乐观落单 + 回滚 ---------- */
  let prefs = prefs0;
  let qty = 2;
  let tier = EVENT.tiers.some(function (t) { return t.id === prefs.tier; }) ? prefs.tier : 'day';
  let vip = { left: null, loading: false };
  let lock = false;

  const tierBox = slot('tier-box');
  EVENT.tiers.forEach(function (t) {
    const b = el('button', 'tier');
    b.setAttribute('type', 'button');
    b.setAttribute('data-tier', t.id);
    b.append(el('b', 't-name', t.name), el('span', 't-price', '¥' + t.price), el('span', 't-note', t.note));
    b.addEventListener('click', function () { pickTier(t.id); });
    tierBox.append(b);
  });
  function paintRegister() {
    const unit = EVENT.tiers.filter(function (t) { return t.id === tier; })[0] || EVENT.tiers[0];
    doc.querySelectorAll('#tier-box .tier').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-tier') === tier ? 'true' : 'false');
    });
    slot('qty-out').textContent = String(qty);
    slot('reg-unit').textContent = unit.name + ' ¥' + unit.price;
    slot('reg-total').textContent = '¥' + nf.format(unit.price * qty);
    const vipBox = slot('vip-box');
    if (tier !== 'vip') {
      vip = { left: null, loading: false };
      vipBox.setAttribute('hidden', '');
    } else {
      vipBox.removeAttribute('hidden');
      if (vip.loading) vipBox.textContent = '前区余量查询中…';
      else if (vip.left !== null) vipBox.textContent = '前区平台余量 ' + vip.left + ' 席（含专属通道与休息区）';
    }
    paintHero();
  }
  function ensureVip() {
    if (tier !== 'vip' || vip.left !== null || vip.loading) return;
    vip = { left: null, loading: true };
    paintRegister();
    svc.vipLeft().then(function (v) {
      vip = { left: v.left, loading: false };
      paintRegister();
    }).catch(function () {
      vip = { left: null, loading: false };
      slot('vip-box').textContent = '前区库存查询失败，可稍后再试';
    });
  }
  function pickTier(next) {
    tier = next;
    prefs = writePrefs({ tier: next }, prefs);
    window.__lab.prefs = prefs;
    ensureVip();
    paintRegister();
  }
  const nameIn = slot('in-name');
  const phoneIn = slot('in-phone');
  slot('qty-minus').addEventListener('click', function () { qty = Math.max(1, qty - 1); paintRegister(); });
  slot('qty-plus').addEventListener('click', function () { qty = Math.min(8, qty + 1); paintRegister(); });

  function showStatus(kind, text) {
    const box = slot('reg-status');
    box.setAttribute('data-kind', kind);
    box.textContent = text;
  }
  function submit() {
    if (lock) return;
    const name = (nameIn.value || '').trim();
    if (!NAME_RE.test(name)) { showStatus('error', '请填写 2-20 位真实姓名（报名表将用于入场核验）'); return; }
    const phone = (phoneIn.value || '').trim();
    if (!PHONE_RE.test(phone)) { showStatus('error', '手机号格式不正确：需 11 位、1 开头'); return; }
    const unit = EVENT.tiers.filter(function (t) { return t.id === tier; })[0];
    const total = unit.price * qty;
    lock = true;
    slot('btn-submit').disabled = true;
    const snapshot = Object.assign({}, svc.state.summary);
    heroState.signed = svc.state.summary.signedCount + qty;
    heroState.left = Math.max(0, svc.state.summary.ticketsLeft - qty);
    paintHero();
    showStatus('pending', '正在提交报名…');
    svc.register({ name: name, phone: phone, qty: qty, tier: tier }).then(function (ok) {
      heroState.signed = ok.signedCount;
      heroState.left = ok.ticketsLeft;
      paintHero();
      showStatus('ok', '报名成功 · 单号 ' + ok.registrationId + ' · ' + unit.name + ' ×' + qty + ' · 应付 ¥' + nf.format(total));
      slot('poster-hint').textContent = '单号 ' + ok.registrationId + '：可生成纪念票根。';
      window.__lab.lastOrder = { id: ok.registrationId, total: total, qty: qty, tier: tier };
    }).catch(function (err) {
      svc.state.summary = snapshot;
      heroState.signed = snapshot.signedCount;
      heroState.left = snapshot.ticketsLeft;
      paintHero();
      showStatus('error', err.message + '（已回滚至 ' + nf.format(snapshot.signedCount) + ' 人）');
    }).then(function () {
      lock = false;
      slot('btn-submit').disabled = false;
    });
  }
  slot('btn-submit').addEventListener('click', submit);

  /* ---------- POSTER：点击才建 SVG（零框架下的按需渲染） ---------- */
  slot('btn-poster').addEventListener('click', function () {
    const host = slot('poster-host');
    stats.postersBuilt += 1;
    host.textContent = '';
    host.append(buildPoster(window.__lab.lastOrder || null));
    slot('btn-poster').textContent = '重新生成票根';
  });
  function buildPoster(order) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 640 260');
    svg.setAttribute('width', '640');
    svg.setAttribute('height', '260');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '声浪岛纪念票根');
    function s(tag, attrs, text) {
      const n = doc.createElementNS(NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      if (text !== undefined) n.textContent = text;
      return n;
    }
    const id = order ? order.id : 'R-待报名';
    const g = s('g', {});
    g.append(
      s('rect', { x: 0, y: 0, width: 640, height: 260, class: 'p-bg' }),
      s('path', { d: 'M440 0 L440 260', class: 'p-cut' }),
      s('circle', { cx: 440, cy: 24, r: 10, class: 'p-hole' }),
      s('circle', { cx: 440, cy: 236, r: 10, class: 'p-hole' })
    );
    g.append(s('text', { x: 34, y: 62, class: 'p-title' }, EVENT.name));
    g.append(s('text', { x: 34, y: 92, class: 'p-sub' }, EVENT.enName + ' · ' + EVENT.city));
    g.append(s('text', { x: 34, y: 148, class: 'p-label' }, 'NO.'));
    g.append(s('text', { x: 78, y: 148, class: 'p-value' }, id));
    g.append(s('text', { x: 34, y: 186, class: 'p-label' }, '日期'));
    g.append(s('text', { x: 78, y: 186, class: 'p-value' }, EVENT.days.map(function (d) { return d.label; }).join(' / ')));
    g.append(s('text', { x: 34, y: 224, class: 'p-label' }, '票档'));
    g.append(s('text', { x: 78, y: 224, class: 'p-value' }, order ? order.tier + ' ×' + order.qty : '—'));
    g.append(s('text', { x: 474, y: 62, class: 'p-stub' }, '存根'));
    g.append(s('text', { x: 474, y: 108, class: 'p-amount' }, order ? '¥' + nf.format(order.total) : '¥—'));
    g.append(s('text', { x: 474, y: 142, class: 'p-mini' }, '凭此根登船'));
    for (let i = 0; i < 28; i++) {
      g.append(s('rect', { x: 474 + i * 5, y: 176, width: (i % 3) + 1, height: 46, class: 'p-bar' }));
    }
    svg.append(g);
    return svg;
  }

  /* ---------- 滚动进度（passive） ---------- */
  const bar = slot('scroll-bar');
  window.addEventListener('scroll', function () {
    stats.scrollTicks += 1;
    const max = doc.documentElement.scrollHeight - window.innerHeight;
    const y = window.scrollY || doc.documentElement.scrollTop || 0;
    bar.style.setProperty('--sw', (max > 0 ? Math.min(100, (y / max) * 100) : 0).toFixed(2) + '%');
  }, { passive: true });

  /* ---------- 控件绑定 ---------- */
  doc.querySelectorAll('#sort-box .seg button').forEach(function (b) {
    b.addEventListener('click', function () { applySort(b.getAttribute('data-sort')); });
  });
  doc.querySelectorAll('.day-tab').forEach(function (b) {
    b.addEventListener('click', function () {
      dayFilter = b.getAttribute('data-day');
      doc.querySelectorAll('.day-tab').forEach(function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
      renderSchedule();
    });
  });
  slot('sel-stage').addEventListener('change', function (e) {
    stageFilter = e.target.value;
    renderSchedule();
  });
  slot('tab-notices').addEventListener('click', function () {
    slot('sched-pane').setAttribute('hidden', '');
    slot('notice-pane').removeAttribute('hidden');
    doc.querySelectorAll('.pane-tab').forEach(function (b) { b.setAttribute('aria-selected', b.id === 'tab-notices' ? 'true' : 'false'); });
    loadNotices(slot('notice-host'));
  });
  slot('tab-sched').addEventListener('click', function () {
    slot('notice-pane').setAttribute('hidden', '');
    slot('sched-pane').removeAttribute('hidden');
    doc.querySelectorAll('.pane-tab').forEach(function (b) { b.setAttribute('aria-selected', b.id === 'tab-sched' ? 'true' : 'false'); });
  });
  slot('btn-clear').addEventListener('click', function () {
    try { window.localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ }
    prefs = { voted: [], tier: 'day' };
    window.__lab.prefs = prefs;
    Object.keys(cards).forEach(function (k) { cards[k].node.querySelector('.vote').classList.remove('voted'); });
    showStatus('idle', '本机偏好已清空（票档回到单日通票，已投记录清除）');
  });

  /* ---------- 启动：一次 boot，分段填充 ---------- */
  slot('lineup-grid').append(el('p', 'loading', '阵容载入中…'));
  applySort('votes');
  slot('reg-status').setAttribute('data-kind', 'idle');
  slot('reg-status').textContent = '填写姓名与手机号即可完成报名，余票会随提交即时变化。';
  svc.boot().then(function (boot) {
    svc.state.summary = boot.summary;
    svc.state.artists = boot.artists;
    scheduleData = boot.schedule;
    heroState.signed = boot.summary.signedCount;
    heroState.left = boot.summary.ticketsLeft;
    lineupWrap.textContent = '';
    const list = boot.artists.slice().sort(function (p, q) { return q.votes - p.votes || (p.id < q.id ? -1 : 1); });
    list.forEach(function (a) { lineupWrap.append(buildCard(a)); });
    paintRanks(list);
    prefs.voted.forEach(function (id) {
      if (cards[id]) {
        const b = cards[id].node.querySelector('.vote');
        b.classList.add('voted');
        b.textContent = '';
        const votes = el('b', 'votes', nf.format(svc.state.artists.filter(function (x) { return x.id === id; })[0].votes));
        b.append(doc.createTextNode('已投 '), votes);
        cards[id].votes = votes;
      }
    });
    tickCountdown();
    renderSchedule();
    paintRegister();
    ensureVip();
    slot('boot-flag').textContent = 'ready';
    window.__lab.ready = true;
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startApp);
else startApp();
