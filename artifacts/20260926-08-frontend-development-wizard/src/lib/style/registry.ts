/**
 * Skin layer. One token object per style; the CSS custom properties, the signature
 * decorations and the palette the checks read are all *derived* from that single object,
 * so a colour can never exist in exactly one place (and group C can prove it).
 *
 * Every rule is prefixed with [data-fd-style] so it outranks MUI's single-class output,
 * and the structural block below the token blocks contains no literal hex at all — that
 * is what makes "swap the skin, keep the DOM" checkable (assertion C6).
 */

export type StyleId = 'paper-grid' | 'pcb-green' | 'concrete-rose';

export interface StyleTokens {
  id: StyleId;
  name: string;
  desc: string;
  color: {
    bg: string;
    paper: string;
    paperAlt: string;
    text: string;
    muted: string;
    primary: string;
    onPrimary: string;
    border: string;
    success: string;
    warning: string;
    danger: string;
    focus: string;
    gridLine: string;
    shadow: string;
  };
  radius: string;
  borderWidth: string;
  fontUi: string;
  fontNum: string;
  tracking: string;
  labelTracking: string;
  headTransform: 'none' | 'uppercase';
  labelTransform: 'none' | 'uppercase';
  headingSize: string;
  bodySize: string;
  /** how the style separates surfaces — one of exactly three implemented mechanisms */
  separation: 'ruled-grid' | 'silkscreen-hairline' | 'formwork-shadow';
  focusRing: 'dashed-outline' | 'glow-shadow' | 'hard-offset';
  grid: string;
}

const SANS = `-apple-system, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif`;
const SERIF = `'Iowan Old Style', 'Songti SC', Georgia, 'Times New Roman', serif`;
const MONO = `ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Courier New', monospace`;

export const STYLES: Record<StyleId, StyleTokens> = {
  'paper-grid': {
    id: 'paper-grid',
    name: '方格信笺',
    desc: '5mm 方格纸底纹 + 墨蓝衬线标题 + 小号等宽标签 + 2px 虚线焦点框，零阴影',
    color: {
      bg: '#f2efe6',
      paper: '#fffdf6',
      paperAlt: '#e6e1d3',
      text: '#22314a',
      muted: '#5a6278',
      primary: '#2f4e83',
      onPrimary: '#fbfaf5',
      border: '#b9c2d4',
      success: '#2e6b46',
      warning: '#8a651c',
      danger: '#a4382f',
      focus: '#9a3f8f',
      gridLine: '#dcdfe8',
      shadow: '#00000000',
    },
    radius: '3px',
    borderWidth: '1px',
    fontUi: SERIF,
    fontNum: MONO,
    tracking: '0em',
    labelTracking: '0.14em',
    headTransform: 'none',
    labelTransform: 'uppercase',
    headingSize: '1.9rem',
    bodySize: '0.95rem',
    separation: 'ruled-grid',
    focusRing: 'dashed-outline',
    grid: '22px',
  },
  'pcb-green': {
    id: 'pcb-green',
    name: 'PCB 阻焊绿',
    desc: '深绿阻焊底 + 45° 走线条纹 + 白色丝印等宽字 + 金色焊盘强调，零圆角、发光滑环',
    color: {
      bg: '#0a2419',
      paper: '#0e2f21',
      paperAlt: '#143828',
      text: '#dcefdc',
      muted: '#7fae91',
      primary: '#e8b04b',
      onPrimary: '#082114',
      border: '#2a5c41',
      success: '#7ed99a',
      warning: '#f0c674',
      danger: '#ff6f5e',
      focus: '#6fd3ff',
      gridLine: '#123524',
      shadow: '#00000000',
    },
    radius: '0px',
    borderWidth: '1px',
    fontUi: MONO,
    fontNum: MONO,
    tracking: '0.02em',
    labelTracking: '0.1em',
    headTransform: 'uppercase',
    labelTransform: 'uppercase',
    headingSize: '1.45rem',
    bodySize: '0.86rem',
    separation: 'silkscreen-hairline',
    focusRing: 'glow-shadow',
    grid: '14px',
  },
  'concrete-rose': {
    id: 'concrete-rose',
    name: '清水混凝土玫瑰金',
    desc: '中灰现浇面 + 模板对拉孔 + 900 字重大写标题 + 玫瑰金衬线数字 + 6px 硬投影',
    color: {
      /* the concrete has to stay light enough that a readable 次要文字 still clears 4.5:1 —
         at #b4b2ad the muted tone needed to be near-black to pass, which stopped being 次要 */
      bg: '#c0beb9',
      paper: '#d5d3ce',
      paperAlt: '#b1afaa',
      text: '#1f1c1a',
      muted: '#46423e',
      primary: '#a35a5f',
      onPrimary: '#fff6f4',
      border: '#8e8b85',
      success: '#4d6b52',
      warning: '#8a5a22',
      danger: '#8b2b34',
      focus: '#35506b',
      gridLine: '#d8d6d1',
      shadow: '#8f8d88',
    },
    radius: '0px',
    borderWidth: '1px',
    fontUi: SANS,
    fontNum: SERIF,
    tracking: '-0.01em',
    labelTracking: '0.08em',
    headTransform: 'uppercase',
    labelTransform: 'uppercase',
    headingSize: '2.2rem',
    bodySize: '0.94rem',
    separation: 'formwork-shadow',
    focusRing: 'hard-offset',
    grid: '26px',
  },
};

export const STYLE_IDS: StyleId[] = ['paper-grid', 'pcb-green', 'concrete-rose'];

export function readStyleId(): StyleId {
  const raw = typeof document === 'undefined' ? '' : document.documentElement.getAttribute('data-fd-style') ?? '';
  return STYLE_IDS.includes(raw as StyleId) ? (raw as StyleId) : 'paper-grid';
}

export function paletteOf(id: StyleId): string[] {
  return Object.values(STYLES[id].color).map((c) => c.toLowerCase());
}

export function styleCss(id: StyleId): string {
  const t = STYLES[id];
  const c = t.color;
  const tokens = `[data-fd-style="${id}"]{
--fd-bg:${c.bg};--fd-paper:${c.paper};--fd-paper-alt:${c.paperAlt};--fd-text:${c.text};--fd-muted:${c.muted};
--fd-primary:${c.primary};--fd-on-primary:${c.onPrimary};--fd-border:${c.border};--fd-success:${c.success};
--fd-warning:${c.warning};--fd-danger:${c.danger};--fd-focus:${c.focus};--fd-grid-line:${c.gridLine};--fd-shadow:${c.shadow};
--fd-radius:${t.radius};--fd-border-w:${t.borderWidth};--fd-font-ui:${t.fontUi};--fd-font-num:${t.fontNum};
--fd-tracking:${t.tracking};--fd-label-tracking:${t.labelTracking};--fd-head-transform:${t.headTransform};
--fd-label-transform:${t.labelTransform};--fd-heading-size:${t.headingSize};--fd-body-size:${t.bodySize};--fd-grid:${t.grid};
--fd-separation:${t.separation};--fd-focus-ring:${t.focusRing};
background:var(--fd-bg);color:var(--fd-text);font-family:var(--fd-font-ui);font-size:var(--fd-body-size);letter-spacing:var(--fd-tracking);
}`;
  const signature = `[data-fd-style="${id}"] .fd-app{${
    t.separation === 'ruled-grid'
      ? `background-image:repeating-linear-gradient(0deg,var(--fd-grid-line) 0 1px,transparent 1px var(--fd-grid)),repeating-linear-gradient(90deg,var(--fd-grid-line) 0 1px,transparent 1px var(--fd-grid));`
      : t.separation === 'silkscreen-hairline'
        ? `background-image:repeating-linear-gradient(45deg,var(--fd-grid-line) 0 2px,transparent 2px 9px);`
        : `background-image:radial-gradient(circle at 12px 12px,var(--fd-grid-line) 0 3px,transparent 4px),radial-gradient(circle at calc(100% - 12px) 12px,var(--fd-grid-line) 0 3px,transparent 4px);background-size:100% 100%;`
  }}
[data-fd-style="${id}"] .fd-panel{${
    t.separation === 'formwork-shadow'
      ? `box-shadow:6px 6px 0 var(--fd-shadow);border-top:5px solid var(--fd-border);`
      : t.separation === 'silkscreen-hairline'
        ? `box-shadow:none;border:${t.borderWidth} solid var(--fd-border);`
        : `box-shadow:none;border-bottom:2px solid var(--fd-grid-line);`
  }}
[data-fd-style="${id}"] .fd-field:focus-within{${
    t.focusRing === 'dashed-outline'
      ? `outline:2px dashed var(--fd-focus);outline-offset:3px;`
      : t.focusRing === 'glow-shadow'
        ? `box-shadow:0 0 0 3px var(--fd-focus);`
        : `box-shadow:4px 4px 0 var(--fd-focus);`
  }}`;
  /**
   * Signature last. Both blocks have the same specificity (`[data-fd-style=x] .fd-panel` vs
   * `[data-fd-style] .fd-panel`), so source order is the only tie-breaker — with the signature
   * first, the structural `border:` shorthand silently reset the 5px formwork edge back to
   * 1px, and only a real browser (group D) could see it.
   */
  return `${tokens}\n${STRUCTURAL_CSS}\n${signature}`;
}

/** Shared, skin-free structure. Must not contain a single literal colour. */
export const STRUCTURAL_CSS = `[data-fd-style]{box-sizing:border-box}
[data-fd-style] *,[data-fd-style] *::before,[data-fd-style] *::after{box-sizing:inherit}
[data-fd-style] body{margin:0;background:var(--fd-bg);color:var(--fd-text);font-family:var(--fd-font-ui)}
[data-fd-style] .fd-app{min-height:100vh;padding:26px 20px 40px;background-color:var(--fd-bg)}
[data-fd-style] .fd-shell{max-width:min(100%,1240px);margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,336px);gap:22px}
[data-fd-style] .fd-head{grid-column:1 / -1;display:flex;flex-wrap:wrap;align-items:baseline;gap:14px;padding:16px 18px;border-radius:var(--fd-radius);background:var(--fd-paper);border:var(--fd-border-w) solid var(--fd-border)}
[data-fd-style] .fd-brand{font-size:var(--fd-heading-size);line-height:1.15;margin:0;text-transform:var(--fd-head-transform)}
[data-fd-style] .fd-brand-latin{font-family:var(--fd-font-num);font-size:0.72em;letter-spacing:0.22em;color:var(--fd-muted)}
[data-fd-style] .fd-head-sub{margin:0;color:var(--fd-muted);font-size:0.84rem}
[data-fd-style] .fd-head-meta{margin-left:auto;display:flex;gap:16px;font-family:var(--fd-font-num);font-size:0.78rem;color:var(--fd-muted)}
[data-fd-style] .fd-rail{grid-column:1 / -1;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
[data-fd-style] .fd-rail-item{padding:11px 12px;border:var(--fd-border-w) solid var(--fd-border);border-radius:var(--fd-radius);background:var(--fd-paper);text-align:left;cursor:pointer;font:inherit;color:inherit;display:block}
[data-fd-style] .fd-rail-item[data-current="1"]{border-color:var(--fd-primary);background:var(--fd-paper-alt)}
[data-fd-style] .fd-rail-item[data-done="1"]{border-color:var(--fd-success)}
[data-fd-style] .fd-rail-item[data-bad="1"]{border-color:var(--fd-danger)}
[data-fd-style] .fd-rail-no{font-family:var(--fd-font-num);font-size:0.72rem;color:var(--fd-muted);letter-spacing:var(--fd-label-tracking);text-transform:var(--fd-label-transform)}
[data-fd-style] .fd-rail-title{display:block;font-weight:700;margin-top:3px}
[data-fd-style] .fd-rail-hint{display:block;font-size:0.76rem;color:var(--fd-muted);margin-top:3px}
[data-fd-style] .fd-rail-state{font-family:var(--fd-font-num);font-size:0.72rem}
[data-fd-style] .fd-main{display:flex;flex-direction:column;gap:16px;min-width:0}
[data-fd-style] .fd-side{display:flex;flex-direction:column;gap:16px;min-width:0}
[data-fd-style] .fd-panel{padding:16px;border-radius:var(--fd-radius);background:var(--fd-paper);border:var(--fd-border-w) solid var(--fd-border);min-width:0}
[data-fd-style] .fd-panel-title{margin:0 0 4px;font-size:1.06rem;font-weight:700;text-transform:var(--fd-head-transform)}
[data-fd-style] .fd-panel-hint{margin:0 0 14px;font-size:0.8rem;color:var(--fd-muted)}
[data-fd-style] .fd-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
[data-fd-style] .fd-field{display:flex;flex-direction:column;gap:5px;min-width:0;padding:8px 10px;border-radius:var(--fd-radius);border:var(--fd-border-w) solid transparent}
[data-fd-style] .fd-field[data-wide="1"]{grid-column:1 / -1}
[data-fd-style] .fd-field[data-state="error"]{border-color:var(--fd-danger)}
[data-fd-style] .fd-field[data-state="ok"]{border-color:var(--fd-success)}
[data-fd-style] .fd-field[data-state="pending"]{border-color:var(--fd-warning)}
[data-fd-style] .fd-label{font-family:var(--fd-font-num);font-size:0.7rem;letter-spacing:var(--fd-label-tracking);text-transform:var(--fd-label-transform);color:var(--fd-muted)}
[data-fd-style] .fd-label .fd-required{color:var(--fd-danger)}
[data-fd-style] .fd-chips{display:flex;flex-wrap:wrap;gap:6px;min-height:18px}
[data-fd-style] .fd-chip{font-family:var(--fd-font-num);font-size:0.68rem;padding:1px 6px;border-radius:var(--fd-radius);border:var(--fd-border-w) solid var(--fd-border);color:var(--fd-muted);background:var(--fd-bg)}
[data-fd-style] .fd-chip[data-kind="dirty"]{color:var(--fd-primary);border-color:var(--fd-primary)}
[data-fd-style] .fd-chip[data-kind="error"]{color:var(--fd-danger);border-color:var(--fd-danger)}
[data-fd-style] .fd-chip[data-kind="ok"]{color:var(--fd-success);border-color:var(--fd-success)}
[data-fd-style] .fd-chip[data-kind="pending"]{color:var(--fd-warning);border-color:var(--fd-warning)}
[data-fd-style] .fd-help{font-size:0.76rem;color:var(--fd-muted)}
[data-fd-style] .fd-count{font-family:var(--fd-font-num);font-size:0.72rem;color:var(--fd-muted)}
[data-fd-style] .fd-choices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;grid-column:1 / -1}
[data-fd-style] .fd-choice{padding:12px;border:var(--fd-border-w) solid var(--fd-border);border-radius:var(--fd-radius);background:var(--fd-bg);text-align:left;cursor:pointer;font:inherit;color:inherit;display:block}
[data-fd-style] .fd-choice[data-selected="1"]{border-color:var(--fd-primary);border-width:2px;background:var(--fd-paper-alt)}
[data-fd-style] .fd-choice-name{font-weight:700}
[data-fd-style] .fd-choice-price{font-family:var(--fd-font-num);color:var(--fd-primary);font-size:1.05rem;margin-top:4px}
[data-fd-style] .fd-choice-note{font-size:0.76rem;color:var(--fd-muted);margin-top:4px}
[data-fd-style] .fd-addons{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 14px;grid-column:1 / -1}
[data-fd-style] .fd-addon{display:flex;gap:8px;align-items:baseline;padding:7px 9px;border:var(--fd-border-w) solid var(--fd-border);border-radius:var(--fd-radius)}
[data-fd-style] .fd-addon[data-blocked="1"]{opacity:0.55}
[data-fd-style] .fd-addon-price{margin-left:auto;font-family:var(--fd-font-num);font-size:0.78rem;color:var(--fd-muted)}
[data-fd-style] .fd-seats{display:flex;gap:12px;align-items:center;grid-column:1 / -1}
[data-fd-style] .fd-seats input[type="range"]{flex:1 1 auto;min-width:0}
[data-fd-style] .fd-summary{display:flex;flex-direction:column;gap:6px}
[data-fd-style] .fd-line{display:flex;gap:10px;font-size:0.82rem}
[data-fd-style] .fd-line-amt{margin-left:auto;font-family:var(--fd-font-num)}
[data-fd-style] .fd-total{display:flex;gap:10px;align-items:baseline;margin-top:9px;padding-top:9px;border-top:var(--fd-border-w) solid var(--fd-border)}
[data-fd-style] .fd-total-value{margin-left:auto;font-family:var(--fd-font-num);font-size:1.5rem;color:var(--fd-primary)}
[data-fd-style] .fd-checks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}
[data-fd-style] .fd-check{display:flex;gap:8px;font-size:0.8rem;align-items:baseline}
[data-fd-style] .fd-check[data-pass="1"]{color:var(--fd-muted)}
[data-fd-style] .fd-check[data-pass="0"]{color:var(--fd-danger)}
[data-fd-style] .fd-review{display:grid;grid-template-columns:minmax(0,120px) minmax(0,1fr);gap:4px 12px;font-size:0.84rem}
[data-fd-style] .fd-review-k{color:var(--fd-muted);font-family:var(--fd-font-num);font-size:0.72rem;letter-spacing:var(--fd-label-tracking);text-transform:var(--fd-label-transform)}
[data-fd-style] .fd-actions{display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap}
[data-fd-style] .fd-note{font-size:0.78rem;color:var(--fd-muted)}
[data-fd-style] .fd-flag{font-family:var(--fd-font-num);font-size:0.7rem;color:var(--fd-muted)}
[data-fd-style] .fd-foot{grid-column:1 / -1;font-size:0.76rem;color:var(--fd-muted);padding:14px 4px}
[data-fd-style] .fd-mono{font-family:var(--fd-font-num)}
[data-fd-style] .fd-empty{font-size:0.8rem;color:var(--fd-muted)}
[data-fd-style] .fd-baseline{height:36px}
`;

export function injectStyleCss(id: StyleId): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById('fd-style-css');
  if (existing !== null) existing.remove();
  const el = document.createElement('style');
  el.id = 'fd-style-css';
  el.textContent = styleCss(id);
  document.head.appendChild(el);
}
