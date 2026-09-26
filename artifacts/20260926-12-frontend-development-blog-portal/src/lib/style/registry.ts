import type { Density } from '~types/post';

export type StyleId = 'topo-tactical' | 'clay-stop' | 'vinyl-crate';

export interface StyleTokens {
  id: StyleId;
  name: string;
  desc: string;
  /** every colour the page may use; structural CSS is only allowed to reference these */
  color: Record<string, string>;
  radius: string;
  borderWidth: string;
  /** the one mechanism this style uses to separate surfaces */
  separation: 'ruled-grid' | 'offset-shadow' | 'cut-groove';
  surfaceImage: string;
  rowShadow: string;
  cardShadow: string;
  fontUi: string;
  fontNum: string;
  headTransform: 'none' | 'uppercase';
  labelTransform: 'none' | 'uppercase';
  tracking: string;
  headingSize: string;
  bodySize: string;
  rowHeight: Record<Density, number>;
  /** how a "hot" row is marked — again a different mechanism per style */
  hotMark: 'left-bar' | 'badge-lift' | 'label-invert';
}

const SANS = `-apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif`;
const SERIF = `'Iowan Old Style', 'Songti SC', Georgia, 'Times New Roman', serif`;
const ROUNDED = `'Arial Rounded MT Bold', 'Chalkboard SE', 'PingFang SC', 'Hiragino Sans GB', sans-serif`;
const CONDENSED = `'Avenir Next Condensed', 'Helvetica Neue Condensed', 'PingFang SC', Impact, sans-serif`;
const MONO = `ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Courier New', monospace`;

export const STYLES: Record<StyleId, StyleTokens> = {
  'topo-tactical': {
    id: 'topo-tactical',
    name: '等高线战术图',
    desc: '卡其底 + 正交细网 + 军械绿主色 + 标记红，全直角、全大写等宽标签、行首十字准星',
    color: {
      bg: '#d9d5c0',
      paper: '#e9e6d3',
      paperAlt: '#e2ddc6',
      text: '#232619',
      muted: '#565a46',
      primary: '#3f4a2c',
      onPrimary: '#f0eee0',
      hot: '#b4452a',
      line: '#8d8c76',
      grid: '#c6c3aa',
      ok: '#5b7a3a',
      warn: '#8a6d1f',
      star: '#7a5a22',
    },
    radius: '0px',
    borderWidth: '1px',
    separation: 'ruled-grid',
    surfaceImage:
      'repeating-linear-gradient(0deg, var(--c-grid) 0 1px, transparent 1px 24px), repeating-linear-gradient(90deg, var(--c-grid) 0 1px, transparent 1px 24px)',
    rowShadow: 'none',
    cardShadow: 'none',
    fontUi: SANS,
    fontNum: MONO,
    headTransform: 'uppercase',
    labelTransform: 'uppercase',
    tracking: '0.08em',
    headingSize: '26px',
    bodySize: '15px',
    rowHeight: { comfortable: 66, compact: 40 },
    hotMark: 'left-bar',
  },
  'clay-stop': {
    id: 'clay-stop',
    name: '黏土定格动画',
    desc: '奶油陶土底 + 粗可可描边 + 26px 大圆角 + 硬偏移投影，零渐变零网格、圆润字形',
    color: {
      bg: '#f3e7d8',
      paper: '#fff8ef',
      paperAlt: '#f8ecdb',
      text: '#3d2a22',
      muted: '#7b5c4b',
      primary: '#c4693f',
      onPrimary: '#fff4e8',
      hot: '#d94f6b',
      line: '#3d2a22',
      grid: '#e6d5c0',
      ok: '#6f9368',
      warn: '#e0a83a',
      star: '#b8342c',
    },
    radius: '26px',
    borderWidth: '2.5px',
    separation: 'offset-shadow',
    surfaceImage: 'none',
    rowShadow: '5px 5px 0 var(--c-line)',
    cardShadow: '8px 8px 0 var(--c-line)',
    fontUi: ROUNDED,
    fontNum: SERIF,
    headTransform: 'none',
    labelTransform: 'none',
    tracking: '0em',
    headingSize: '30px',
    bodySize: '16px',
    rowHeight: { comfortable: 78, compact: 52 },
    hotMark: 'badge-lift',
  },
  'vinyl-crate': {
    id: 'vinyl-crate',
    name: '黑胶唱片架',
    desc: '深咖唱片箱底 + 奶油标签 + 琥珀高光，同心沟槽纹理、窄体大写字重、标签反白',
    color: {
      bg: '#191310',
      paper: '#241b16',
      paperAlt: '#2e231c',
      text: '#f2e7d6',
      muted: '#a3907c',
      primary: '#e0913a',
      onPrimary: '#1f1712',
      hot: '#c8502f',
      line: '#54402f',
      grid: '#3a2b21',
      ok: '#8fae76',
      warn: '#d7b45a',
      star: '#d7b45a',
    },
    radius: '2px',
    borderWidth: '1px',
    separation: 'cut-groove',
    surfaceImage: 'repeating-radial-gradient(circle at 108% -8%, var(--c-grid) 0 1px, transparent 1px 7px)',
    rowShadow: 'none',
    cardShadow: '0 0 0 1px var(--c-line)',
    fontUi: CONDENSED,
    fontNum: MONO,
    headTransform: 'uppercase',
    labelTransform: 'uppercase',
    tracking: '0.14em',
    headingSize: '28px',
    bodySize: '15px',
    rowHeight: { comfortable: 72, compact: 44 },
    hotMark: 'label-invert',
  },
};

export const STYLE_IDS = Object.keys(STYLES) as StyleId[];

export function readStyleId(): StyleId {
  const attr = document.documentElement.getAttribute('data-fd-style');
  return attr === 'clay-stop' || attr === 'vinyl-crate' || attr === 'topo-tactical' ? attr : 'topo-tactical';
}

function tokenBlock(t: StyleTokens): string {
  const vars = Object.entries(t.color).map(([k, v]) => `--c-${k}: ${v};`);
  const geometry = [
    `--radius: ${t.radius};`,
    `--bw: ${t.borderWidth};`,
    `--font-ui: ${t.fontUi};`,
    `--font-num: ${t.fontNum};`,
    `--head-transform: ${t.headTransform};`,
    `--label-transform: ${t.labelTransform};`,
    `--tracking: ${t.tracking};`,
    `--h-size: ${t.headingSize};`,
    `--body: ${t.bodySize};`,
    `--row-comfortable: ${t.rowHeight.comfortable}px;`,
    `--row-compact: ${t.rowHeight.compact}px;`,
    `--surface-img: ${t.surfaceImage};`,
    `--row-shadow: ${t.rowShadow};`,
    `--card-shadow: ${t.cardShadow};`,
    `--separation: ${t.separation};`,
    `--hot-mark: ${t.hotMark};`,
  ];
  return `[data-fd-style="${t.id}"] {\n${[...vars, ...geometry].join('\n')}\n}`;
}

/**
 * Structural CSS. It contains no colour literal at all — every hue has to come from a token,
 * which is what lets assertion C5 prove "swap the skin, keep the DOM" instead of trusting it.
 */
const STRUCTURAL_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html { color-scheme: light dark; }
body { margin: 0; background: var(--surface-img), var(--c-bg); color: var(--c-text); font: 400 var(--body)/1.65 var(--font-ui); letter-spacing: var(--tracking); }
a { color: inherit; text-decoration: none; }
button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; letter-spacing: inherit; }
input, select { font: inherit; color: inherit; }
.shell { max-width: min(1180px, 100% - 2rem); margin: 0 auto; padding: 1.25rem 0 3rem; }
.masthead { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 1rem; padding-bottom: .75rem; border-bottom: var(--bw) solid var(--c-line); }
.brand { display: flex; align-items: center; gap: .7rem; margin-right: auto; }
.mark { width: 34px; height: 34px; flex: 0 0 auto; border: var(--bw) solid var(--c-primary); background: var(--c-paper); position: relative; border-radius: var(--radius); }
.mark::after { content: ""; position: absolute; inset: 26%; background: var(--c-primary); border-radius: inherit; }
.site { margin: 0; font-size: var(--h-size); line-height: 1.1; text-transform: var(--head-transform); font-weight: 700; }
.tagline { margin: .1rem 0 0; font-size: calc(var(--body) - 2px); color: var(--c-muted); text-transform: var(--label-transform); letter-spacing: var(--tracking); }
.nav { display: flex; gap: .35rem; }
.nav a { padding: .3rem .6rem; border: var(--bw) solid transparent; border-radius: var(--radius); color: var(--c-muted); text-transform: var(--label-transform); font-size: calc(var(--body) - 1px); }
.nav a[aria-current="page"] { color: var(--c-text); border-color: var(--c-line); background: var(--c-paper); }
.search { display: flex; align-items: center; gap: .45rem; margin-bottom: .55rem; }
.search label { font-size: calc(var(--body) - 3px); color: var(--c-muted); text-transform: var(--label-transform); }
.search input { min-width: 0; width: 14ch; padding: .32rem .5rem; background: var(--c-paper); border: var(--bw) solid var(--c-line); border-radius: var(--radius); }
.search input:focus-visible { outline: 2px solid var(--c-primary); outline-offset: 2px; }
.state { font-size: calc(var(--body) - 3px); color: var(--c-muted); font-family: var(--font-num); min-width: 9ch; }
.stats { display: flex; flex-wrap: wrap; gap: .5rem; margin: 1rem 0; }
.stat { flex: 1 1 8.5rem; padding: .5rem .65rem; background: var(--c-paper); border: var(--bw) solid var(--c-line); border-radius: var(--radius); box-shadow: var(--card-shadow); }
.stat dt { margin: 0; font-size: calc(var(--body) - 3px); color: var(--c-muted); text-transform: var(--label-transform); }
.stat dd { margin: .15rem 0 0; font-family: var(--font-num); font-size: calc(var(--body) + 8px); line-height: 1.1; }
.main { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 19rem); gap: 1rem; align-items: start; }
.hero { padding: .9rem 1rem; margin-bottom: 1rem; background: var(--c-paper); border: var(--bw) solid var(--c-line); border-radius: var(--radius); box-shadow: var(--card-shadow); }
.kicker { margin: 0 0 .25rem; font-size: calc(var(--body) - 3px); color: var(--c-hot); text-transform: var(--label-transform); font-family: var(--font-num); }
.hero h2 { margin: 0; font-size: calc(var(--h-size) + 2px); line-height: 1.25; text-transform: var(--head-transform); }
.hero .summary { margin: .4rem 0 .7rem; color: var(--c-muted); }
.hero .actions { display: flex; gap: .5rem; flex-wrap: wrap; }
.btn { padding: .34rem .7rem; border: var(--bw) solid var(--c-primary); border-radius: var(--radius); background: var(--c-primary); color: var(--c-onPrimary); text-transform: var(--label-transform); font-size: calc(var(--body) - 1px); }
.btn.ghost { background: transparent; color: var(--c-text); border-color: var(--c-line); }
.btn[aria-pressed="true"] { border-color: var(--c-star); color: var(--c-star); }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: .45rem; margin-bottom: .5rem; }
.chip { padding: .22rem .55rem; border: var(--bw) solid var(--c-line); border-radius: var(--radius); font-size: calc(var(--body) - 2px); color: var(--c-muted); background: var(--c-paperAlt); }
.chip[aria-pressed="true"] { background: var(--c-primary); color: var(--c-onPrimary); border-color: var(--c-primary); }
.count { margin-left: auto; font-family: var(--font-num); font-size: calc(var(--body) - 2px); color: var(--c-muted); }
.list-head, .row { display: grid; grid-template-columns: 4.2ch minmax(0, 1fr) 7ch 9ch 5ch 2.4ch; gap: .6rem; align-items: center; }
.list-head { padding: .3rem .7rem; border-bottom: var(--bw) solid var(--c-line); font-size: calc(var(--body) - 3px); color: var(--c-muted); text-transform: var(--label-transform); background: var(--c-paperAlt); }
.vport { overflow-y: auto; max-height: 560px; border: var(--bw) solid var(--c-line); border-radius: var(--radius); background: var(--c-paper); }
.vinner { position: relative; }
.row { position: relative; height: 100%; padding: 0 .7rem; border-bottom: var(--bw) solid var(--c-line); background-image: var(--surface-img); box-shadow: var(--row-shadow); }
.row[data-hot="true"][data-hotmark="left-bar"]::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--c-hot); }
.row[data-hot="true"][data-hotmark="badge-lift"] .tag { transform: translateY(-2px) rotate(-3deg); background: var(--c-hot); color: var(--c-onPrimary); }
.row[data-hot="true"][data-hotmark="label-invert"] .tag { background: var(--c-hot); color: var(--c-text); }
.num { font-family: var(--font-num); font-size: calc(var(--body) - 3px); color: var(--c-muted); }
.titles { min-width: 0; }
.titles .t { display: block; overflow: hidden; text-overflow: ellipsis; }
.titles .s { display: block; font-size: calc(var(--body) - 3px); color: var(--c-muted); }
.tag { justify-self: start; padding: .05rem .4rem; border: var(--bw) solid var(--c-line); border-radius: var(--radius); font-size: calc(var(--body) - 3px); text-transform: var(--label-transform); }
.when, .views, .mins { font-family: var(--font-num); font-size: calc(var(--body) - 2px); color: var(--c-muted); text-align: right; }
.star { font-size: calc(var(--body) + 2px); color: var(--c-muted); }
.star[aria-pressed="true"] { color: var(--c-star); }
.empty { padding: 1.2rem; text-align: center; color: var(--c-muted); border: var(--bw) dashed var(--c-line); border-radius: var(--radius); }
.side { display: grid; gap: .8rem; position: sticky; top: .75rem; }
.panel { padding: .6rem .7rem; background: var(--c-paper); border: var(--bw) solid var(--c-line); border-radius: var(--radius); box-shadow: var(--card-shadow); }
.panel h2 { margin: 0 0 .4rem; font-size: calc(var(--body) + 2px); text-transform: var(--head-transform); }
.panel table { width: 100%; border-collapse: collapse; font-size: calc(var(--body) - 2px); }
.panel th, .panel td { padding: .12rem .2rem; text-align: left; border-bottom: 1px dotted var(--c-line); }
.panel th:nth-child(n+2), .panel td:nth-child(n+2) { text-align: right; font-family: var(--font-num); }
.panel caption { caption-side: bottom; font-size: calc(var(--body) - 4px); color: var(--c-muted); text-align: left; padding-top: .3rem; }
.datatable { width: 100%; border-collapse: collapse; font-size: calc(var(--body) - 1px); background: var(--c-paper); border: var(--bw) solid var(--c-line); border-radius: var(--radius); }
.datatable caption { caption-side: top; text-align: left; padding: .3rem .5rem; font-size: calc(var(--body) - 3px); color: var(--c-muted); text-transform: var(--label-transform); }
.datatable th, .datatable td { padding: .22rem .5rem; border-bottom: 1px dotted var(--c-line); text-align: left; }
.datatable tbody tr:nth-child(even) { background: var(--c-paperAlt); }
.datatable thead th:nth-child(n+2), .datatable td:nth-child(n+2) { text-align: right; font-family: var(--font-num); }
.skel { border: var(--bw) dashed var(--c-line); border-radius: var(--radius); background: var(--c-paperAlt); }
.skel.pulse { animation: fd-pulse 1.1s ease-in-out infinite; }
@keyframes fd-pulse { 0%, 100% { opacity: .55; } 50% { opacity: .95; } }
@media (prefers-reduced-motion: reduce) { .skel.pulse { animation: none; } }
.post { padding: .9rem 0; }
.post .bar { height: 3px; background: var(--c-hot); width: 0%; }
.post h1 { margin: .3rem 0 .2rem; font-size: calc(var(--h-size) + 6px); line-height: 1.2; text-transform: var(--head-transform); }
.post .meta { margin: 0 0 .8rem; font-family: var(--font-num); font-size: calc(var(--body) - 2px); color: var(--c-muted); }
.cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 15rem); gap: 1rem; align-items: start; }
.prose h2, .prose h3 { margin: 1.1rem 0 .35rem; text-transform: var(--head-transform); }
.prose p { margin: .35rem 0; }
.prose blockquote { margin: .7rem 0; padding: .3rem .7rem; border-left: 3px solid var(--c-hot); background: var(--c-paperAlt); color: var(--c-muted); font-size: calc(var(--body) - 1px); }
.prose pre { margin: .7rem 0; padding: .6rem .7rem; overflow-x: auto; background: var(--c-paperAlt); border: var(--bw) solid var(--c-line); border-radius: var(--radius); font-family: var(--font-num); font-size: calc(var(--body) - 2px); }
.tok-kw { color: var(--c-hot); font-weight: 700; }
.tok-str { color: var(--c-ok); }
.tok-num { color: var(--c-warn); }
.tok-com { color: var(--c-muted); font-style: italic; }
.toc { margin: 0; padding-left: 1.1rem; font-size: calc(var(--body) - 2px); color: var(--c-muted); }
.prevnext { display: flex; gap: .6rem; flex-wrap: wrap; margin-top: 1rem; }
.foot { margin-top: 1.4rem; padding-top: .7rem; border-top: var(--bw) solid var(--c-line); font-size: calc(var(--body) - 3px); color: var(--c-muted); }
.demo { display: inline-block; margin-top: .3rem; padding: .1rem .4rem; border: 1px dotted var(--c-line); border-radius: var(--radius); }
@media (max-width: 60rem) { .main, .cols { grid-template-columns: minmax(0, 1fr); } .side { position: static; } }
`.trim();

/** One skin + the shared structural sheet. The skin is the only place a colour may appear. */
export function styleCss(id: StyleId): string {
  return `${tokenBlock(STYLES[id])}\n\n${STRUCTURAL_CSS}`;
}

let injected = false;

export function injectStyleCss(): void {
  if (injected) return;
  injected = true;
  const tag = document.createElement('style');
  tag.id = 'fd-style-css';
  tag.textContent = styleCss(readStyleId());
  document.head.appendChild(tag);
}

export const structuralCss = STRUCTURAL_CSS;
export const skinCssFor = (id: StyleId): string => tokenBlock(STYLES[id]);
