// 20260926-04 sites:sites-building × 多页站点生成器
// 结构层：四个页面模板（所有风格共用，DOM 逐字节一致）
// 主题层：三套独立 CSS（acid-gfx / art-nouveau / dark-academia）
// 目录式多页布局：<style>/index.html, <style>/releases/index.html,
//   <style>/release/index.html, <style>/about/index.html, <style>/assets/site.css
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, '..', 'artifacts', '20260926-04-sites-building-multipage-site');

const RELEASES = [
  { id: 'YZ-001', no: 1, title: '远山若有似无', en: 'Hills, Almost', artist: '邱野', year: 2019, tag: '民谣', note: '录于滇西北一间改造成排练室的旧粮仓，人声里留有木门轴的声音。' },
  { id: 'YZ-002', no: 2, title: '夜航西飞', en: 'Westward by Night', artist: '林听', year: 2021, tag: '氛围', note: '三架合成器、一台磁带机，与一份 1947 年的航线图。' },
  { id: 'YZ-003', no: 3, title: '蒸汽花园', en: 'Steam Garden', artist: '无看三重奏', year: 2022, tag: '爵士', note: '钢琴、贝斯与一支录错了线路的萨克斯，一次「事故」式的现场。' },
  { id: 'YZ-004', no: 4, title: '信号雪', en: 'Signal Snow', artist: '骆沨', year: 2023, tag: '电子', note: '短波电台底噪采样集，冬夜里从天线接收到的白色噪音。' },
  { id: 'YZ-005', no: 5, title: '旧海报', en: 'Old Posters', artist: '丘小路', year: 2024, tag: '民谣', note: '关于拆迁广告与童年海报的九首歌，木吉他为主，几乎无鼓。' },
  { id: 'YZ-006', no: 6, title: '潮汐图鉴', en: 'A Tide Atlas', artist: '林听', year: 2025, tag: '氛围', featured: true, note: '按 2024 年某海湾的实测潮汐表写作八段，每张唱片附手绘潮位折线海报。' },
];

const TRACKS = [
  { n: 1, title: '高潮线以上', sec: 312 },
  { n: 2, title: '退潮的贝', sec: 248 },
  { n: 3, title: '灯塔间歇', sec: 366 },
  { n: 4, title: '盐与铁', sec: 291 },
  { n: 5, title: '无人AIS', sec: 402 },
  { n: 6, title: '海带森林', sec: 275 },
  { n: 7, title: '午夜潮位 0.4m', sec: 339 },
  { n: 8, title: '回流', sec: 258 },
];

const NAV = [
  { key: 'home', label: '首页', zh: 'Home' },
  { key: 'releases', label: '全部唱片', zh: 'Catalog' },
  { key: 'release', label: '本季新声', zh: 'New Release' },
  { key: 'about', label: '关于厂牌', zh: 'About' },
];

// 显式文件链接（目录式多页条款：不假设 /releases/ 能解析到 index.html）
const LINKS = {
  home: { depth: 0 },
  releases: { depth: 1 },
  release: { depth: 1 },
  about: { depth: 1 },
};
function navHref(from, to) {
  const base = from === 'home' ? '' : '../';
  return to === 'home' ? `${base}index.html` : `${base}${to}/index.html`;
}

function header(active) {
  return `<header class="site-head">
  <a class="brand" href="${navHref(active, 'home')}"><span class="brand-mark">泽</span><span class="brand-name">云泽唱片<em>YUNZE RECORDS</em></span></a>
  <nav aria-label="主导航">
    <ul>
      ${NAV.map(n => `      <li>${n.key === active
        ? `<a href="${navHref(active, n.key)}" aria-current="page">${n.label}<span class="nav-en">${n.zh}</span></a>`
        : `<a href="${navHref(active, n.key)}">${n.label}<span class="nav-en">${n.zh}</span></a>`}</li>`).join('\n')}
    </ul>
  </nav>
</header>`;
}

const FOOTER = `  <footer class="site-foot">
    <p>云泽唱片 · 独立民谣与氛围音乐厂牌 · 目录 2019—2025</p>
    <p class="foot-note">本站为虚构演示内容，所有唱片、艺人与数据均为设计样例，不代表任何真实发行。</p>
    <p><a href="mailto:hello@example.com">hello@example.com</a> · 城市一隅 · 潮位站旁</p>
  </footer>`;

function shell({ page, dir, title, desc, body }) {
  const cssHref = dir === '' ? 'assets/site.css' : '../assets/site.css';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${desc}">
<title>${title}</title>
<link rel="stylesheet" href="${cssHref}">
</head>
<body class="page-${page}">
${header(page)}
<main>
${body}
</main>
${FOOTER}
</body>
</html>
`;
}

/* ---------------- 页面 1：首页 ---------------- */
const homeBody = `<section class="hero">
    <p class="hero-kicker">EST. 2019 · 独立发行</p>
    <h1>把潮水<em>录</em>进唱片里</h1>
    <p class="hero-lede">云泽唱片是一家只做民谣与氛围音乐的微型厂牌。六张唱片，四位常驻艺人，一张按实测潮位表写作的高潮线。我们相信唱片是可以摸到的天气预报。</p>
    <p class="hero-cta">
      <a class="btn btn-primary" href="${navHref('home', 'releases')}">翻阅全目录（6 张）</a>
      <a class="btn btn-ghost" href="${navHref('home', 'release')}">听本季新声《潮汐图鉴》</a>
    </p>
  </section>

  <section class="latest" aria-labelledby="latest-h">
    <h2 id="latest-h">最近三张</h2>
    <ul class="card-row">
      <li class="card">
        <p class="card-no">YZ-006 · 2025</p>
        <h3>潮汐图鉴 <span class="card-en">A Tide Atlas</span></h3>
        <p class="card-artist">林听</p>
        <p class="card-blurb">按 2024 年某海湾的实测潮汐表写作八段，每张唱片附手绘潮位折线海报。</p>
        <a class="card-link" href="${navHref('home', 'release')}">进入唱片页 →</a>
      </li>
      <li class="card">
        <p class="card-no">YZ-005 · 2024</p>
        <h3>旧海报 <span class="card-en">Old Posters</span></h3>
        <p class="card-artist">丘小路</p>
        <p class="card-blurb">关于拆迁广告与童年海报的九首歌，木吉他为主，几乎无鼓。</p>
        <a class="card-link" href="${navHref('home', 'releases')}">在目录中查看 →</a>
      </li>
      <li class="card">
        <p class="card-no">YZ-004 · 2023</p>
        <h3>信号雪 <span class="card-en">Signal Snow</span></h3>
        <p class="card-artist">骆沨</p>
        <p class="card-blurb">短波电台底噪采样集，冬夜里从天线接收到的白色噪音。</p>
        <a class="card-link" href="${navHref('home', 'releases')}">在目录中查看 →</a>
      </li>
    </ul>
  </section>

  <section class="strip" aria-label="厂牌速写">
    <dl class="stat">
      <div><dt>6</dt><dd>张目录唱片</dd></div>
      <div><dt>4</dt><dd>位常驻艺人</dd></div>
      <div><dt>2019</dt><dd>年第一声部</dd></div>
      <div><dt>1</dt><dd>间临潮位站的录音室</dd></div>
    </dl>
  </section>

  <section class="teaser">
    <h2>为什么是「云泽」</h2>
    <p>厂牌名字取自一块地图上已经消失的湖。我们所有录音都发生在有水的附近：粮仓外的水渠、码头、退潮后的滩涂。如果你想了解一间小厂牌如何决定一张唱片的封面纸，<a href="${navHref('home', 'about')}">去关于页看</a>。</p>
  </section>`;

/* ---------------- 页面 2：全部唱片（JS 筛选 + 排序） ---------------- */
const releasesBody = `<section class="list-head">
    <h1>全部唱片</h1>
    <p class="list-sub">目录按编号排列，2019—2025 共六张。可用流派筛选，或按年份切换排序。</p>
  </section>

  <section class="toolbar" aria-label="目录筛选">
    <div class="filters" role="group" aria-label="按流派筛选">
      <button type="button" class="chip is-on" data-tag="全部" aria-pressed="true">全部</button>
      <button type="button" class="chip" data-tag="民谣" aria-pressed="false">民谣</button>
      <button type="button" class="chip" data-tag="氛围" aria-pressed="false">氛围</button>
      <button type="button" class="chip" data-tag="爵士" aria-pressed="false">爵士</button>
      <button type="button" class="chip" data-tag="电子" aria-pressed="false">电子</button>
    </div>
    <p class="toolbar-side">
      <button type="button" id="sortBtn" class="chip chip-sort" aria-pressed="false">按年份：旧→新</button>
      <output id="count" class="count" role="status" aria-live="polite"></output>
    </p>
  </section>

  <section>
    <ul id="catalog" class="grid" aria-label="唱片列表"></ul>
  </section>

  <p class="back-home"><a href="${navHref('releases', 'home')}">← 回到首页</a></p>`;

const releasesScript = `<script>
(function () {
  'use strict';
  /*PURE-BEGIN*/
  const RELEASES = ${JSON.stringify(RELEASES, null, 2).replace(/\n/g, '\n  ')};
  function applyFilters(list, tag, newestFirst) {
    const rows = tag === '全部' ? list.slice() : list.filter(r => r.tag === tag);
    rows.sort((a, b) => newestFirst ? b.year - a.year || a.no - b.no : a.year - b.year || a.no - b.no);
    return rows;
  }
  function render(rows) {
    if (rows.length === 0) {
      return '<li class="empty">该流派下暂无唱片，试试「全部」。</li>';
    }
    return rows.map(r => {
      const link = r.featured
        ? '<a class="card-link" href="../release/index.html">进入唱片页 →</a>'
        : '<span class="card-dim">唱片页制作中</span>';
      return '<li class="card">' +
        '<p class="card-no">' + r.id + ' · ' + r.year + ' · ' + r.tag + '</p>' +
        '<h3>' + r.title + ' <span class="card-en">' + r.en + '</span></h3>' +
        '<p class="card-artist">' + r.artist + '</p>' +
        '<p class="card-blurb">' + r.note + '</p>' + link + '</li>';
    }).join('\\n');
  }
  /*PURE-END*/
  let tag = '全部', newestFirst = false;
  const catalog = document.getElementById('catalog');
  const count = document.getElementById('count');
  const sortBtn = document.getElementById('sortBtn');
  function paint() {
    const rows = applyFilters(RELEASES, tag, newestFirst);
    catalog.innerHTML = render(rows);
    count.value = '共 ' + rows.length + ' 张' + (tag === '全部' ? '' : ' · ' + tag);
  }
  document.querySelectorAll('.filters .chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filters .chip').forEach(b => {
        b.classList.toggle('is-on', b === btn);
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      tag = btn.dataset.tag;
      paint();
    });
  });
  sortBtn.addEventListener('click', () => {
    newestFirst = !newestFirst;
    sortBtn.setAttribute('aria-pressed', String(newestFirst));
    sortBtn.textContent = newestFirst ? '按年份：新→旧' : '按年份：旧→新';
    paint();
  });
  paint();
})();
</script>`;

/* ---------------- 页面 3：唱片详情 ---------------- */
const featured = RELEASES[5];
const releaseBody = `<section class="album">
    <div class="cover" aria-hidden="true"><span class="cover-mark">潮</span><span class="cover-line"></span></div>
    <div class="album-info">
      <p class="card-no">${featured.id} · ${featured.year} · ${featured.tag}</p>
      <h1>潮汐图鉴 <span class="card-en">A Tide Atlas</span></h1>
      <p class="album-artist">林听 <span>Lin Ting</span></p>
      <p class="album-note">${featured.note}</p>
      <p class="fixture-note">本站为静态演示：曲目与时长为设计样例，页面不托管音频。</p>
    </div>
  </section>

  <section class="tracks" aria-labelledby="tracks-h">
    <h2 id="tracks-h">曲目 <output id="total" class="total" role="status"></output></h2>
    <ol id="tracklist"></ol>
  </section>

  <section class="credits">
    <h2>制作信息</h2>
    <dl>
      <div><dt>录制</dt><dd>潮位站旁一间改作录音室的值守房，2024-11 — 2025-03</dd></div>
      <div><dt>混音 / 母带</dt><dd>骆沨</dd></div>
      <div><dt>封面与潮位折线</dt><dd>丘小路（手绘后转矢量）</dd></div>
      <div><dt>唱片用纸</dt><dd>未漂白灰卡，四色单面，随盒附 1:1 潮位海报</dd></div>
    </dl>
  </section>

  <nav class="adjacent" aria-label="相邻唱片">
    <a href="${navHref('release', 'releases')}">← 返回全目录（上一张：YZ-005 旧海报）</a>
    <a href="${navHref('release', 'about')}">了解这张唱片的诞生地 →</a>
  </nav>`;

const releaseScript = `<script>
(function () {
  'use strict';
  /*PURE-BEGIN*/
  const TRACKS = ${JSON.stringify(TRACKS, null, 2).replace(/\n/g, '\n  ')};
  function totalSec(list) { return list.reduce((s, t) => s + t.sec, 0); }
  function fmt(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }
  function renderTracks(list) {
    return list.map(t =>
      '<li><span class="tn">' + t.n + '</span><span class="tt">' + t.title +
      '</span><span class="td">' + fmt(t.sec) + '</span></li>').join('\\n');
  }
  /*PURE-END*/
  document.getElementById('tracklist').innerHTML = renderTracks(TRACKS);
  document.getElementById('total').value = '8 段 · 总长 ' + fmt(totalSec(TRACKS));
})();
</script>`;

/* ---------------- 页面 4：关于 ---------------- */
const aboutBody = `<section class="about-head">
    <h1>关于云泽</h1>
    <p class="lede">一间借潮水工作的微型厂牌。没有发行团队，四个人，一间值守房，和一台总是进沙子的磁带机。</p>
  </section>

  <section class="timeline" aria-labelledby="tl-h">
    <h2 id="tl-h">六年年表</h2>
    <ol>
      <li><p class="tl-year">2019</p><p>邱野把粮仓录音寄给「一个做唱片的陌生人」，那封邮件成了 YZ-001《远山若有似无》。厂牌得名于一块地图上已消失的湖。</p></li>
      <li><p class="tl-year">2021</p><p>林听加入，《夜航西飞》确立了「一张唱片一种天气」的路线：录制前先看一个月的天气预报。</p></li>
      <li><p class="tl-year">2022</p><p>无看三重奏的现场母带几乎在搬运途中被雨毁掉；那次的「事故声」保留在《蒸汽花园》第三轨。</p></li>
      <li><p class="tl-year">2023</p><p>骆沨的短波采样集《信号雪》第一次使用未漂白灰卡纸盒，成本高了 11%，我们决定以后都用它。</p></li>
      <li><p class="tl-year">2024</p><p>值守房成为常驻录音点。潮位站的旧记录本成了《潮汐图鉴》的作曲素材。</p></li>
      <li><p class="tl-year">2025</p><p>《潮汐图鉴》发行，随盒附手绘潮位折线海报。目录达到六张，本站即为它的线上橱窗。</p></li>
    </ol>
  </section>

  <section class="team" aria-labelledby="team-h">
    <h2 id="team-h">四个人</h2>
    <ul class="team-row">
      <li class="member"><p class="avatar" aria-hidden="true">邱</p><h3>邱野</h3><p>创始人 / 录音。负责「先在附近找水」这一步。</p></li>
      <li class="member"><p class="avatar" aria-hidden="true">听</p><h3>林听</h3><p>艺人（YZ-002 / YZ-006）。看天气写曲子。</p></li>
      <li class="member"><p class="avatar" aria-hidden="true">沨</p><h3>骆沨</h3><p>混音 / 母带 / 短波天线修理。</p></li>
      <li class="member"><p class="avatar" aria-hidden="true">路</p><h3>丘小路</h3><p>设计。所有封面纸的选择都是她做的。</p></li>
    </ul>
  </section>

  <section class="contact">
    <h2>来信</h2>
    <p>demo 投递、唱片购买与合作，请写一封信到 <a href="mailto:hello@example.com">hello@example.com</a>。我们每周五开箱一次，回信可能需要两个潮汐周期。</p>
    <p class="back-home"><a href="${navHref('about', 'home')}">← 回到首页</a> · <a href="${navHref('about', 'releases')}">看全目录</a></p>
  </section>`;

/* ---------------- 主题层：三套 CSS ---------------- */
const CSS_ACID = `/* 主题层 · 酸性平面 acid-gfx：黑底 + 酸绿/品红高饱和，锐角与斜切，等宽标签 */
:root{
  --bg:#0b0b10; --ink:#eaf0d8; --acid:#c8ff2f; --mag:#ff37c8; --cyan:#57e6ff;
  --card:#121219; --line:#2a2a38; --dim:#8a8a9e; --black:#000; --plum:#2a0f3d;
  --font-body:"Helvetica Neue","PingFang SC","Microsoft YaHei",sans-serif;
  --font-mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:var(--font-body);line-height:1.7;
  background-image:radial-gradient(60rem 40rem at 110% -10%,rgba(200,255,47,.09),transparent 60%),
  radial-gradient(50rem 30rem at -10% 30%,rgba(255,55,200,.08),transparent 60%)}
main{max-width:1060px;margin:0 auto;padding:0 24px}
a{color:var(--acid);text-decoration:none}
.site-head{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;
  max-width:1060px;margin:0 auto;padding:18px 24px;border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:12px;color:var(--ink)}
.brand-mark{width:42px;height:42px;display:grid;place-items:center;font-weight:800;font-size:20px;
  background:var(--acid);color:var(--black);clip-path:polygon(0 0,100% 0,100% 72%,72% 100%,0 100%)}
.brand-name{font-weight:700;letter-spacing:.06em}
.brand-name em{display:block;font-style:normal;font-family:var(--font-mono);font-size:10px;color:var(--mag);letter-spacing:.3em}
.site-head nav ul{display:flex;gap:6px;list-style:none;flex-wrap:wrap}
.site-head nav a{display:block;padding:8px 14px;font-family:var(--font-mono);font-size:13px;color:var(--ink);border:1px solid transparent}
.site-head nav a:hover{border-color:var(--acid)}
.site-head nav a[aria-current]{background:var(--ink);color:var(--black)}
.nav-en{display:none}
.hero{padding:96px 0 72px}
.hero-kicker{font-family:var(--font-mono);color:var(--mag);letter-spacing:.35em;font-size:12px}
h1{font-size:clamp(44px,8vw,86px);line-height:1.04;letter-spacing:-.02em;margin:18px 0 26px;font-weight:800;
  text-transform:none}
h1 em{font-style:normal;color:var(--acid)}
.hero-lede{max-width:56ch;color:var(--dim);font-size:17px}
.hero-cta{margin-top:34px;display:flex;gap:14px;flex-wrap:wrap}
.btn{display:inline-block;padding:14px 26px;font-family:var(--font-mono);font-size:14px;
  clip-path:polygon(10px 0,100% 0,calc(100% - 10px) 100%,0 100%)}
.btn-primary{background:var(--acid);color:var(--black);font-weight:700}
.btn-ghost{border:1px solid var(--mag);color:var(--mag)}
h2{font-family:var(--font-mono);font-size:14px;letter-spacing:.3em;color:var(--cyan);margin:64px 0 24px}
.card-row,.grid,.team-row{list-style:none;display:grid;gap:18px}
.card-row{grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.grid{grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
.card{background:var(--card);border:1px solid var(--line);padding:22px;position:relative;
  transform:skewY(-.6deg);transition:border-color .15s}
.card:nth-child(2n){transform:skewY(.6deg)}
.card:hover{border-color:var(--acid)}
.card-no{font-family:var(--font-mono);font-size:11px;color:var(--mag);letter-spacing:.14em}
.card h3{font-size:21px;margin:8px 0 4px}
.card-en{font-family:var(--font-mono);font-size:11px;color:var(--dim);font-weight:400}
.card-artist{color:var(--cyan);font-size:14px}
.card-blurb{color:var(--dim);font-size:14px;margin:10px 0 14px}
.card-link{font-family:var(--font-mono);font-size:12px}
.card-dim{font-family:var(--font-mono);font-size:12px;color:var(--dim)}
.stat{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);margin:8px 0}
.stat>div{background:var(--card);padding:22px}
.stat dt{font-family:var(--font-mono);font-size:38px;color:var(--acid);font-weight:700}
.stat dd{color:var(--dim);font-size:13px}
.teaser p{max-width:62ch;color:var(--dim)}
.list-head h1,.about-head h1{font-size:clamp(36px,6vw,64px);margin:0 0 12px}
.list-head,.about-head{padding:56px 0 8px}
.list-sub,.lede{color:var(--dim);max-width:60ch}
.toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin:22px 0 30px}
.chip{font-family:var(--font-mono);font-size:13px;padding:9px 16px;background:transparent;color:var(--ink);
  border:1px solid var(--line);cursor:pointer;clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%)}
.chip:hover{border-color:var(--acid)}
.chip.is-on{background:var(--acid);color:var(--black);border-color:var(--acid);font-weight:700}
.toolbar-side{display:flex;gap:12px;align-items:center}
.count{font-family:var(--font-mono);color:var(--cyan);font-size:13px}
.empty{color:var(--dim);font-family:var(--font-mono);padding:40px 0}
.album{display:grid;grid-template-columns:320px 1fr;gap:36px;padding:64px 0 24px;align-items:start}
.cover{aspect-ratio:1;background:linear-gradient(150deg,var(--mag) 0%,var(--plum) 45%,var(--bg) 46%),var(--card);
  border:1px solid var(--acid);display:grid;place-items:center;position:relative}
.cover-mark{font-size:88px;font-weight:800;color:var(--acid);mix-blend-mode:screen}
.cover-line{position:absolute;left:8%;right:8%;bottom:18%;height:2px;background:var(--cyan);transform:rotate(-7deg)}
.album-info h1{margin:6px 0 10px}
.album-artist{color:var(--cyan);font-family:var(--font-mono)}
.album-note{color:var(--dim);margin-top:14px;max-width:52ch}
.fixture-note{margin-top:22px;font-family:var(--font-mono);font-size:12px;color:var(--mag);border:1px dashed var(--mag);padding:8px 12px;display:inline-block}
.tracks ol{list-style:none;border-top:1px solid var(--line)}
.tracks li{display:flex;gap:16px;padding:12px 4px;border-bottom:1px solid var(--line);font-family:var(--font-mono);font-size:14px}
.tracks li:hover{background:rgba(200,255,47,.05)}
.tn{color:var(--mag);width:2.2em}
.tt{flex:1}
.td{color:var(--cyan)}
.total{font-family:var(--font-mono);color:var(--acid);margin-left:16px;letter-spacing:.06em}
.credits dl{display:grid;grid-template-columns:160px 1fr;gap:6px 24px;max-width:72ch}
.credits dt{font-family:var(--font-mono);color:var(--cyan);font-size:13px}
.credits dd{color:var(--ink)}
.adjacent{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:64px 0;padding-top:24px;border-top:1px solid var(--line);font-family:var(--font-mono);font-size:13px}
.timeline ol{list-style:none;border-left:2px solid var(--acid);margin-left:6px;padding-left:26px}
.timeline li{margin-bottom:26px;position:relative}
.timeline li::before{content:"";position:absolute;left:-33px;top:.55em;width:12px;height:12px;background:var(--mag);clip-path:polygon(0 0,100% 50%,0 100%)}
.tl-year{font-family:var(--font-mono);color:var(--acid);font-size:18px;font-weight:700}
.timeline li p:last-child{color:var(--dim);max-width:62ch}
.member{background:var(--card);border:1px solid var(--line);padding:20px}
.avatar{width:52px;height:52px;display:grid;place-items:center;background:var(--mag);color:var(--black);font-weight:800;font-size:20px;clip-path:polygon(0 0,100% 0,100% 72%,72% 100%,0 100%);margin-bottom:12px}
.member h3{font-size:17px}
.member p{color:var(--dim);font-size:14px}
.contact p{max-width:62ch;color:var(--dim)}
.contact a{color:var(--acid)}
.back-home{margin:56px 0;font-family:var(--font-mono);font-size:13px}
.site-foot{max-width:1060px;margin:64px auto 0;padding:26px 24px;border-top:1px solid var(--line);font-family:var(--font-mono);font-size:12px;color:var(--dim)}
.foot-note{color:var(--mag);margin:6px 0}
@media(max-width:720px){.album{grid-template-columns:1fr}.credits dl{grid-template-columns:1fr}.hero{padding:64px 0 48px}}
`;

const CSS_NOUVEAU = `/* 主题层 · 新艺术 art-nouveau：奶油纸底，墨绿描金，拱形与曲线边框，衬线大字 */
:root{
  --bg:#f4ecd9; --paper:#faf4e4; --ink:#1d3a2c; --gold:#a8792a; --blush:#c88d72;
  --line:#cdb98c; --soft:#5d7a64; --frame:#e7d6ac;
  --font-display:Georgia,"Songti SC","Times New Roman",serif;
  --font-body:"Songti SC",Georgia,serif;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:var(--font-body);line-height:1.9;
  background-image:radial-gradient(48rem 30rem at 95% -5%,rgba(168,121,42,.10),transparent 65%),
  radial-gradient(40rem 30rem at -5% 100%,rgba(93,122,100,.12),transparent 60%)}
main{max-width:1020px;margin:0 auto;padding:0 28px}
a{color:var(--gold);text-decoration:none}
a:hover{text-decoration:underline;text-underline-offset:4px}
.site-head{max-width:1020px;margin:0 auto;padding:26px 28px 18px;
  border-bottom:1px double var(--gold);display:flex;justify-content:space-between;align-items:flex-end;gap:18px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:14px;color:var(--ink)}
.brand-mark{width:46px;height:46px;display:grid;place-items:center;font-family:var(--font-display);font-size:22px;
  color:var(--paper);background:var(--ink);border-radius:50% 50% 50% 8px}
.brand-name{font-family:var(--font-display);font-size:20px;letter-spacing:.12em}
.brand-name em{display:block;font-style:normal;font-size:11px;letter-spacing:.42em;color:var(--gold)}
.site-head nav ul{display:flex;gap:26px;list-style:none;flex-wrap:wrap}
.site-head nav a{font-size:15px;letter-spacing:.14em;color:var(--soft);padding-bottom:4px}
.site-head nav a:hover{color:var(--ink)}
.site-head nav a[aria-current]{color:var(--ink);border-bottom:2px solid var(--gold);text-decoration:none}
.nav-en{display:block;font-size:10px;letter-spacing:.22em;color:var(--gold);text-transform:uppercase}
.hero{padding:92px 0 70px;position:relative}
.hero-kicker{text-align:center;font-size:12px;letter-spacing:.5em;color:var(--gold)}
h1{font-family:var(--font-display);font-size:clamp(40px,6.5vw,68px);text-align:center;line-height:1.2;margin:20px 0 30px;font-weight:400}
h1 em{font-style:normal;position:relative;color:var(--blush)}
h1 em::after{content:"";position:absolute;left:-4%;right:-4%;bottom:6px;height:8px;border-top:1px solid var(--gold);border-radius:50%}
.hero-lede{max-width:56ch;margin:0 auto;text-align:center;color:var(--soft);font-size:16px}
.hero-cta{margin:38px 0 0;display:flex;gap:18px;justify-content:center;flex-wrap:wrap}
.btn{display:inline-block;padding:13px 32px;font-size:15px;letter-spacing:.2em;border-radius:999px 999px 999px 12px}
.btn-primary{background:var(--ink);color:var(--paper)}
.btn-ghost{border:1px solid var(--gold);color:var(--ink)}
h2{font-family:var(--font-display);font-weight:400;font-size:26px;text-align:center;margin:66px 0 10px;letter-spacing:.2em}
h2::after{content:"❦";display:block;text-align:center;color:var(--gold);font-size:16px;margin-top:8px}
.card-row,.grid,.team-row{list-style:none;display:grid;gap:22px;margin-top:30px}
.card-row{grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.grid{grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
.card{background:var(--paper);border:1px solid var(--line);border-radius:140px 12px 12px 12px;padding:26px 22px 20px;position:relative;box-shadow:0 1px 0 var(--frame)}
.card::after{content:"";position:absolute;inset:5px 5px auto auto;width:14px;height:14px;border-right:1px solid var(--gold);border-bottom:1px solid var(--gold)}
.card-no{font-size:12px;letter-spacing:.3em;color:var(--gold);text-align:right}
.card h3{font-family:var(--font-display);font-size:22px;font-weight:400;margin:10px 0 2px}
.card-en{font-size:13px;color:var(--soft);font-style:italic}
.card-artist{color:var(--ink);font-size:14px;letter-spacing:.18em}
.card-blurb{color:var(--soft);font-size:14px;margin:12px 0 14px}
.card-link{font-size:13px;letter-spacing:.14em}
.card-dim{font-size:13px;color:var(--line)}
.stat{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0;border:1px solid var(--line);background:var(--paper);margin:10px 0}
.stat>div{padding:22px;text-align:center;border-right:1px solid var(--line)}
.stat>div:last-child{border-right:none}
.stat dt{font-family:var(--font-display);font-size:36px;color:var(--gold)}
.stat dd{color:var(--soft);font-size:13px;letter-spacing:.2em}
.teaser p{max-width:60ch;margin:0 auto;text-align:center;font-size:16px;color:var(--soft)}
.list-head h1,.about-head h1{margin:0 0 14px}
.list-head,.about-head{padding:64px 0 6px}
.list-sub,.lede{color:var(--soft);text-align:center;max-width:56ch;margin:0 auto}
.toolbar{display:flex;justify-content:space-between;align-items:center;gap:18px;flex-wrap:wrap;margin:28px 0 8px;padding:14px 18px;border:1px solid var(--line);border-radius:999px;background:var(--paper)}
.filters{display:flex;gap:8px;flex-wrap:wrap}
.chip{font-family:var(--font-body);font-size:14px;padding:7px 18px;background:transparent;color:var(--soft);
  border:1px solid transparent;border-radius:999px;cursor:pointer;letter-spacing:.12em}
.chip:hover{color:var(--ink);border-color:var(--gold)}
.chip.is-on{background:var(--ink);color:var(--paper)}
.toolbar-side{display:flex;gap:14px;align-items:center}
.count{color:var(--gold);font-size:13px;letter-spacing:.2em}
.empty{color:var(--soft);padding:44px 0;text-align:center;list-style:none}
.album{display:grid;grid-template-columns:300px 1fr;gap:44px;padding:66px 0 26px;align-items:start}
.cover{aspect-ratio:1;border-radius:150px 150px 14px 14px;background:var(--ink);display:grid;place-items:center;position:relative;box-shadow:0 0 0 1px var(--gold),0 0 0 6px var(--paper),0 0 0 7px var(--line)}
.cover-mark{font-family:var(--font-display);font-size:84px;color:var(--paper)}
.cover-line{position:absolute;left:14%;right:14%;bottom:24%;height:0;border-top:1px solid var(--gold);border-radius:50% 50% 0 0/100% 100% 0 0;transform:scaleY(3)}
.album-info h1{text-align:left;font-size:clamp(34px,5vw,54px)}
.album-artist{color:var(--gold);letter-spacing:.24em;font-size:15px}
.album-artist span{color:var(--soft);font-style:italic;letter-spacing:.06em}
.album-note{color:var(--soft);margin-top:16px;max-width:52ch}
.fixture-note{margin-top:22px;font-size:12px;color:var(--blush);border:1px dashed var(--blush);border-radius:999px;padding:6px 16px;display:inline-block;letter-spacing:.1em}
.tracks ol{list-style:none;border-top:1px double var(--gold);max-width:64ch;margin:0 auto;counter-reset:none}
.tracks li{display:flex;gap:22px;padding:11px 6px;border-bottom:1px solid var(--line);font-size:15px}
.tn{color:var(--gold);width:1.6em;font-family:var(--font-display)}
.tt{flex:1;letter-spacing:.1em}
.td{color:var(--soft)}
.total{color:var(--gold);margin-left:18px;font-size:14px;letter-spacing:.2em}
.credits dl{display:grid;grid-template-columns:170px 1fr;gap:8px 26px;max-width:68ch;margin:0 auto}
.credits dt{color:var(--gold);font-size:14px;letter-spacing:.18em}
.credits dd{color:var(--soft)}
.adjacent{display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap;margin:62px 0;padding-top:22px;border-top:1px double var(--gold);font-size:14px;letter-spacing:.1em}
.timeline ol{list-style:none;max-width:66ch;margin:26px auto 0;position:relative;padding-left:34px}
.timeline ol::before{content:"";position:absolute;left:8px;top:6px;bottom:6px;border-left:1px solid var(--gold)}
.timeline li{margin-bottom:26px;position:relative}
.timeline li::before{content:"";position:absolute;left:-32px;top:.7em;width:11px;height:11px;border:1px solid var(--gold);background:var(--paper);transform:rotate(45deg)}
.tl-year{font-family:var(--font-display);color:var(--gold);font-size:19px;letter-spacing:.2em}
.timeline li p:last-child{color:var(--soft);max-width:60ch}
.team-row{margin-top:26px}
.member{background:var(--paper);border:1px solid var(--line);border-radius:12px 12px 120px 12px;padding:22px;text-align:center}
.avatar{width:58px;height:58px;margin:0 auto 12px;display:grid;place-items:center;font-family:var(--font-display);font-size:24px;background:var(--bg);color:var(--ink);border:1px solid var(--gold);border-radius:50% 50% 50% 10px}
.member h3{font-family:var(--font-display);font-weight:400;font-size:19px}
.member p{color:var(--soft);font-size:14px}
.contact p{max-width:62ch;margin:0 auto;text-align:center;color:var(--soft)}
.back-home{margin:52px 0;text-align:center;font-size:14px;letter-spacing:.14em}
.site-foot{max-width:1020px;margin:70px auto 0;padding:28px;text-align:center;border-top:1px double var(--gold);font-size:13px;color:var(--soft);letter-spacing:.12em}
.foot-note{color:var(--blush);margin:6px 0;font-size:12px}
@media(max-width:720px){.album{grid-template-columns:1fr}.credits dl{grid-template-columns:1fr}.hero{padding:60px 0 44px}}
`;

const CSS_ACADEMIA = `/* 主题层 · 暗学院 dark-academia：深棕底，牛血红与旧纸金，衬线书卷排印与首字下沉 */
:root{
  --bg:#20160f; --panel:#2b1f16; --ink:#d9c8a6; --ox:#7c3626; --brass:#b08d4f;
  --dim:#96805f; --line:#4a3524; --paper:#f2e6cd;
  --font-display:"Times New Roman","Songti SC",Georgia,serif;
  --font-body:Georgia,"Songti SC","Times New Roman",serif;
  --font-mono:ui-monospace,Menlo,Consolas,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:var(--font-body);line-height:1.85;
  background-image:repeating-linear-gradient(0deg,rgba(0,0,0,.16) 0 2px,transparent 2px 5px),
  radial-gradient(46rem 30rem at 85% 0%,rgba(176,141,79,.08),transparent 60%)}
main{max-width:980px;margin:0 auto;padding:0 26px}
a{color:var(--brass);text-decoration:none}
a:hover{text-decoration:underline;text-decoration-color:var(--ox)}
.site-head{max-width:980px;margin:0 auto;padding:24px 26px;display:flex;justify-content:space-between;align-items:center;gap:18px;flex-wrap:wrap;border-bottom:3px double var(--line)}
.brand{display:flex;align-items:center;gap:14px;color:var(--ink)}
.brand-mark{width:44px;height:44px;display:grid;place-items:center;font-family:var(--font-display);font-size:21px;border:1px solid var(--ox);background:var(--panel);color:var(--brass)}
.brand-name{font-family:var(--font-display);font-size:19px;letter-spacing:.1em}
.brand-name em{display:block;font-style:normal;font-size:10px;letter-spacing:.34em;color:var(--dim);font-family:var(--font-mono)}
.site-head nav ul{display:flex;gap:8px;list-style:none;flex-wrap:wrap}
.site-head nav a{font-size:14px;letter-spacing:.12em;padding:6px 12px;color:var(--dim)}
.site-head nav a:hover{color:var(--ink)}
.site-head nav a[aria-current]{color:var(--ink);border-bottom:2px solid var(--ox)}
.nav-en{display:none}
.hero{padding:84px 0 64px;max-width:72ch}
.hero-kicker{font-family:var(--font-mono);font-size:11px;letter-spacing:.34em;color:var(--ox)}
h1{font-family:var(--font-display);font-size:clamp(38px,6vw,62px);font-weight:400;line-height:1.15;margin:16px 0 26px;letter-spacing:.01em}
h1 em{font-style:italic;color:var(--brass)}
.hero-lede{color:var(--dim);font-size:17px}
.hero-lede::first-letter{font-size:1.5em;color:var(--brass)}
.hero-cta{margin-top:32px;display:flex;gap:16px;flex-wrap:wrap}
.btn{display:inline-block;padding:12px 26px;font-size:15px;letter-spacing:.14em;border:1px solid var(--line)}
.btn-primary{background:var(--ox);border-color:var(--ox);color:var(--paper)}
.btn-ghost{color:var(--brass)}
h2{font-family:var(--font-display);font-weight:400;font-size:24px;letter-spacing:.14em;margin:60px 0 22px;color:var(--ink);border-bottom:1px solid var(--line);padding-bottom:8px}
.card-row,.grid,.team-row{list-style:none;display:grid;gap:20px}
.card-row{grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.grid{grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
.card{background:var(--panel);border:1px solid var(--line);padding:24px;box-shadow:inset 0 0 0 4px rgba(176,141,79,.06)}
.card-no{font-family:var(--font-mono);font-size:11px;letter-spacing:.16em;color:var(--ox)}
.card h3{font-family:var(--font-display);font-size:21px;font-weight:400;margin:8px 0 4px}
.card-en{font-size:12px;font-style:italic;color:var(--dim);font-weight:400}
.card-artist{color:var(--brass);font-size:14px;letter-spacing:.16em}
.card-blurb{color:var(--dim);font-size:14.5px;margin:10px 0 14px}
.card-link{font-size:13px;letter-spacing:.1em}
.card-dim{font-size:13px;color:var(--line)}
.stat{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));border:1px solid var(--line);background:var(--panel);margin:8px 0}
.stat>div{padding:22px;text-align:center;border-right:1px solid var(--line)}
.stat>div:last-child{border-right:none}
.stat dt{font-family:var(--font-display);font-size:34px;color:var(--brass)}
.stat dd{color:var(--dim);font-size:13px;letter-spacing:.14em}
.teaser p{max-width:64ch;color:var(--dim);font-size:16.5px;text-indent:2em}
.list-head h1,.about-head h1{margin:0 0 12px}
.list-head,.about-head{padding:58px 0 6px}
.list-sub,.lede{color:var(--dim);max-width:60ch;font-style:italic}
.toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin:24px 0 30px;padding-bottom:14px;border-bottom:1px solid var(--line)}
.filters{display:flex;gap:6px;flex-wrap:wrap}
.chip{font-family:var(--font-body);font-size:14px;padding:7px 16px;background:transparent;color:var(--dim);border:1px solid transparent;cursor:pointer;letter-spacing:.12em}
.chip:hover{border-color:var(--line);color:var(--ink)}
.chip.is-on{background:var(--ox);color:var(--paper)}
.toolbar-side{display:flex;gap:14px;align-items:center}
.count{font-family:var(--font-mono);color:var(--brass);font-size:12.5px;letter-spacing:.1em}
.empty{color:var(--dim);font-style:italic;padding:44px 0;text-align:center}
.album{display:grid;grid-template-columns:300px 1fr;gap:42px;padding:60px 0 24px;align-items:start}
.cover{aspect-ratio:1;background:var(--panel);border:1px solid var(--brass);outline:1px solid var(--line);outline-offset:8px;display:grid;place-items:center;position:relative}
.cover-mark{font-family:var(--font-display);font-size:80px;color:var(--brass)}
.cover-line{position:absolute;left:12%;right:12%;bottom:20%;height:1px;background:var(--ox)}
.album-info h1{text-align:left;font-size:clamp(32px,4.6vw,52px)}
.album-artist{color:var(--brass);letter-spacing:.2em;font-size:15px}
.album-artist span{color:var(--dim);font-style:italic;letter-spacing:.04em}
.album-note{color:var(--dim);margin-top:14px;max-width:52ch}
.fixture-note{margin-top:22px;font-family:var(--font-mono);font-size:11.5px;color:var(--ox);border:1px dashed var(--ox);padding:8px 12px;display:inline-block}
.tracks ol{list-style:none;border-top:1px solid var(--line);max-width:64ch}
.tracks li{display:flex;gap:20px;padding:10px 4px;border-bottom:1px solid rgba(74,53,36,.55);font-size:15px}
.tn{color:var(--ox);width:2em;font-family:var(--font-mono)}
.tt{flex:1;letter-spacing:.06em}
.td{font-family:var(--font-mono);color:var(--dim)}
.total{font-family:var(--font-mono);color:var(--brass);margin-left:16px;font-size:13px}
.credits dl{display:grid;grid-template-columns:170px 1fr;gap:8px 24px;max-width:68ch}
.credits dt{color:var(--ox);font-size:14px;letter-spacing:.12em}
.credits dd{color:var(--dim)}
.adjacent{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:58px 0;padding-top:20px;border-top:3px double var(--line);font-size:14px}
.timeline ol{list-style:none;max-width:66ch;margin:22px 0;counter-reset:yr}
.timeline li{margin-bottom:24px;padding-left:24px;border-left:1px solid var(--line);position:relative}
.timeline li::before{content:"§";position:absolute;left:-9px;top:0;background:var(--bg);color:var(--ox);font-family:var(--font-display)}
.tl-year{font-family:var(--font-display);color:var(--brass);font-size:19px;letter-spacing:.18em}
.timeline li p:last-child{color:var(--dim);max-width:60ch}
.member{background:var(--panel);border:1px solid var(--line);padding:20px}
.avatar{width:54px;height:54px;display:grid;place-items:center;font-family:var(--font-display);font-size:22px;background:var(--ox);color:var(--paper);margin-bottom:10px}
.member h3{font-family:var(--font-display);font-weight:400;font-size:18px}
.member p{color:var(--dim);font-size:14px}
.contact p{max-width:62ch;color:var(--dim);font-size:16px}
.back-home{margin:52px 0;font-size:14px;font-style:italic}
.site-foot{max-width:980px;margin:64px auto 0;padding:26px;border-top:3px double var(--line);font-size:13px;color:var(--dim);text-align:center;letter-spacing:.1em}
.foot-note{color:var(--ox);margin:6px 0;font-size:12px;font-style:italic}
@media(max-width:720px){.album{grid-template-columns:1fr}.credits dl{grid-template-columns:1fr}.hero{padding:58px 0 44px}}
`;

const STYLES = [
  { dir: 'acid-gfx', css: CSS_ACID },
  { dir: 'art-nouveau', css: CSS_NOUVEAU },
  { dir: 'dark-academia', css: CSS_ACADEMIA },
];

const PAGES = [
  { dir: '', file: 'index.html', page: 'home', title: '云泽唱片 YUNZE RECORDS · 把潮水录进唱片里', desc: '虚构独立厂牌云泽唱片的线上橱窗：2019—2025 全部六张唱片目录、本季新声《潮汐图鉴》与厂牌故事。', body: homeBody },
  { dir: 'releases', file: 'index.html', page: 'releases', title: '全部唱片 · 云泽唱片', desc: '云泽唱片全目录：六张民谣与氛围唱片的年份、流派与简介，可按流派筛选、按年份排序。', body: releasesBody + '\n' + releasesScript },
  { dir: 'release', file: 'index.html', page: 'release', title: '潮汐图鉴 YZ-006 · 林听 · 云泽唱片', desc: 'YZ-006《潮汐图鉴》唱片页：八段曲目与总长、制作信息与唱片用纸说明。', body: releaseBody + '\n' + releaseScript },
  { dir: 'about', file: 'index.html', page: 'about', title: '关于云泽 · 云泽唱片', desc: '一间借潮水工作的微型厂牌：六年年表、四位常驻成员与 demo 投递方式。', body: aboutBody },
];

let count = 0;
for (const st of STYLES) {
  mkdirSync(join(OUT, st.dir, 'assets'), { recursive: true });
  writeFileSync(join(OUT, st.dir, 'assets', 'site.css'), st.css);
  count++;
  for (const pg of PAGES) {
    const dir = join(OUT, st.dir, pg.dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, pg.file), shell(pg));
    count++;
  }
}
console.log(`written ${count} files under ${OUT}`);
