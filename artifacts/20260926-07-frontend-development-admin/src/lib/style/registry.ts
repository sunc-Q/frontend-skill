/**
 * Style registry. Each style is one token object; the MUI theme, the CSS custom
 * properties and the "signature" CSS are all *derived* from it, so a colour can never
 * exist in one place only (one tone, one derivation).
 */
export type StyleId = 'neumorph' | 'bitmap' | 'phosphor';

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
    reliefLight: string;
    reliefDark: string;
  };
  shape: number;
  borderWidth: number;
  fontUi: string;
  fontNum: string;
  letterSpacing: string;
  headTransform: 'none' | 'uppercase';
  /** how the style separates surfaces */
  separation: 'relief-shadow' | 'hairline-grid' | 'glow-halo';
  shadowLevel: 'double-relief' | 'none' | 'luminous';
  headingSize: string;
  bodySize: string;
}

const SANS = `-apple-system, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif`;
const MONO = `ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace`;

export const STYLES: Record<StyleId, StyleTokens> = {
  neumorph: {
    id: 'neumorph',
    name: '软浮雕',
    desc: '同底色浮起：零描边、双向阴影塑形、大圆角、低饱和靛蓝强调',
    color: {
      bg: '#e9ebf1',
      paper: '#e9ebf1',
      paperAlt: '#eef0f5',
      text: '#3b4252',
      muted: '#68728d',
      primary: '#4650c8',
      onPrimary: '#f4f5fb',
      border: '#e9ebf1',
      success: '#2f7355',
      warning: '#8a5f16',
      danger: '#a83a3a',
      reliefLight: '#ffffff',
      reliefDark: '#c4c9d6',
    },
    shape: 18,
    borderWidth: 0,
    fontUi: SANS,
    fontNum: SANS,
    letterSpacing: '0.01em',
    headTransform: 'none',
    separation: 'relief-shadow',
    shadowLevel: 'double-relief',
    headingSize: '2.1rem',
    bodySize: '0.94rem',
  },
  bitmap: {
    id: 'bitmap',
    name: '1-bit 系统',
    desc: '两色位图界面：1px 实线网格、零圆角零阴影，状态靠反白与字符而非颜色',
    color: {
      bg: '#f7f5ef',
      paper: '#ffffff',
      paperAlt: '#ece9e0',
      text: '#12100e',
      muted: '#6b665c',
      primary: '#12100e',
      onPrimary: '#ffffff',
      border: '#12100e',
      success: '#12100e',
      warning: '#12100e',
      danger: '#12100e',
      reliefLight: '#ffffff',
      reliefDark: '#d8d4c8',
    },
    shape: 0,
    borderWidth: 1,
    fontUi: MONO,
    fontNum: MONO,
    letterSpacing: '0.06em',
    headTransform: 'uppercase',
    separation: 'hairline-grid',
    shadowLevel: 'none',
    headingSize: '1.5rem',
    bodySize: '0.86rem',
  },
  phosphor: {
    id: 'phosphor',
    name: '监护仪荧光',
    desc: '临床遥测屏：近黑青底 + 磷绿荧光 + 琥珀告警，大号等宽读数与发光描边',
    color: {
      bg: '#050b0e',
      paper: '#0a1519',
      paperAlt: '#0e1e24',
      text: '#d9f5e4',
      muted: '#6d9c88',
      primary: '#9df76a',
      onPrimary: '#04120a',
      border: '#17323a',
      success: '#9df76a',
      warning: '#ffb020',
      danger: '#ff5d5d',
      reliefLight: '#12262e',
      reliefDark: '#000000',
    },
    shape: 2,
    borderWidth: 1,
    fontUi: SANS,
    fontNum: MONO,
    letterSpacing: '0.02em',
    headTransform: 'none',
    separation: 'glow-halo',
    shadowLevel: 'luminous',
    headingSize: '1.75rem',
    bodySize: '0.9rem',
  },
};

export const STYLE_IDS: StyleId[] = ['neumorph', 'bitmap', 'phosphor'];

export function readStyleId(): StyleId {
  const raw = document.documentElement.getAttribute('data-fd-style') ?? '';
  return STYLE_IDS.includes(raw as StyleId) ? (raw as StyleId) : 'neumorph';
}

/** Every hex/rgb literal a page may contain: the declared palette of that style. */
export function paletteOf(id: StyleId): string[] {
  const t = STYLES[id];
  return [...Object.values(t.color), '#ffffff', '#000000', 'transparent'];
}

function cssVars(t: StyleTokens): string {
  const c = t.color;
  return [
    `--fd-bg:${c.bg}`,
    `--fd-paper:${c.paper}`,
    `--fd-paper-alt:${c.paperAlt}`,
    `--fd-text:${c.text}`,
    `--fd-muted:${c.muted}`,
    `--fd-primary:${c.primary}`,
    `--fd-on-primary:${c.onPrimary}`,
    `--fd-border:${c.border}`,
    `--fd-success:${c.success}`,
    `--fd-warning:${c.warning}`,
    `--fd-danger:${c.danger}`,
    `--fd-relief-light:${c.reliefLight}`,
    `--fd-relief-dark:${c.reliefDark}`,
    `--fd-radius:${t.shape}px`,
    `--fd-border-w:${t.borderWidth}px`,
    `--fd-font-ui:${t.fontUi}`,
    `--fd-font-num:${t.fontNum}`,
    `--fd-tracking:${t.letterSpacing}`,
    `--fd-head-size:${t.headingSize}`,
    `--fd-head-transform:${t.headTransform}`,
    `--fd-body-size:${t.bodySize}`,
  ].join(';');
}

const SKELETON = `
/* Every rule is prefixed with [data-fd-style] so it outranks MUI's single-class
   emotion rules (equal specificity + later injection would otherwise win). */
[data-fd-style]{font-family:var(--fd-font-ui);font-size:var(--fd-body-size);letter-spacing:var(--fd-tracking)}
[data-fd-style] body{margin:0;background:var(--fd-bg);color:var(--fd-text)}
[data-fd-style] h2{font-size:var(--fd-head-size);text-transform:var(--fd-head-transform);letter-spacing:var(--fd-tracking)}
[data-fd-style] .fd-shell{display:grid;grid-template-columns:minmax(0,220px) minmax(0,1fr);gap:20px;padding:20px;max-width:min(100%,1320px);margin:0 auto}
[data-fd-style] .fd-main{min-width:0;display:flex;flex-direction:column;gap:18px}
[data-fd-style] .fd-kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(0,208px));gap:16px}
[data-fd-style] .fd-panel-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(0,340px));gap:16px}
[data-fd-style] .fd-panel-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
[data-fd-style] .fd-num{font-family:var(--fd-font-num);font-variant-numeric:tabular-nums}
[data-fd-style] .fd-slug{font-family:var(--fd-font-num)}
[data-fd-style] .fd-truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:min(280px,42vw)}
[data-fd-style] .fd-empty{padding:18px;text-align:center;color:var(--fd-muted)}
[data-fd-style] .fd-pill{display:inline-block;padding:1px 8px;border:var(--fd-border-w) solid var(--fd-border);font-family:var(--fd-font-num);font-size:0.8em;border-radius:var(--fd-radius)}
[data-fd-style] .fd-detail{padding:12px;background:var(--fd-paper-alt)}
[data-fd-style] .fd-switch{display:inline-flex;align-items:center;gap:6px;cursor:pointer}
[data-fd-style] .fd-detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(0,180px));gap:10px;margin:0}
[data-fd-style] .fd-detail-grid dt{font-size:0.78em;color:var(--fd-muted)}
[data-fd-style] .fd-detail-grid dd{margin:2px 0 0}
[data-fd-style] .fd-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
[data-fd-style] .fd-toolbar-note{margin-left:auto;color:var(--fd-muted);font-size:0.82em}
[data-fd-style] .fd-scope{font-family:var(--fd-font-num);font-size:0.78em;padding:1px 6px;border:var(--fd-border-w) solid var(--fd-border)}
[data-fd-style] .fd-foot{margin-top:8px;font-size:0.78em;color:var(--fd-muted)}
[data-fd-style] .fd-delta-up{color:var(--fd-success)}
[data-fd-style] .fd-delta-down{color:var(--fd-danger)}
[data-fd-style] .fd-event-kind{font-family:var(--fd-font-num);font-size:0.78em;color:var(--fd-muted);min-width:3.2em}
[data-fd-style] a{text-decoration:none;color:inherit}
[data-fd-style] .fd-navlink{padding:6px 10px;border-radius:var(--fd-radius);border:var(--fd-border-w) solid transparent;color:var(--fd-muted);display:flex;gap:8px;align-items:center}
[data-fd-style] .fd-navlink[data-active="1"]{color:var(--fd-primary);background:var(--fd-paper-alt)}
`;

function signature(t: StyleTokens): string {
  if (t.separation === 'relief-shadow') {
    return `
[data-fd-style=neumorph] .fd-relief{background:var(--fd-paper);border:0;border-radius:var(--fd-radius);box-shadow:8px 8px 18px var(--fd-relief-dark),-8px -8px 18px var(--fd-relief-light)}
[data-fd-style=neumorph] .fd-relief--in{box-shadow:inset 5px 5px 12px var(--fd-relief-dark),inset -5px -5px 12px var(--fd-relief-light)}
[data-fd-style=neumorph] .fd-pill{border:0;background:var(--fd-paper);box-shadow:inset 3px 3px 6px var(--fd-relief-dark),inset -3px -3px 6px var(--fd-relief-light);border-radius:999px}
[data-fd-style=neumorph] .fd-pill--on{color:var(--fd-success)}
[data-fd-style=neumorph] table{border-collapse:separate}
[data-fd-style=neumorph] .MuiTableCell-root{border-bottom:1px solid var(--fd-paper-alt)}
`;
  }
  if (t.separation === 'hairline-grid') {
    return `
[data-fd-style=bitmap] .fd-relief{background:var(--fd-paper);border:var(--fd-border-w) solid var(--fd-border);border-radius:0;box-shadow:none}
[data-fd-style=bitmap] .MuiTableCell-root{border:var(--fd-border-w) solid var(--fd-border)}
[data-fd-style=bitmap] thead .MuiTableCell-root{background:var(--fd-text);color:var(--fd-on-primary)}
[data-fd-style=bitmap] .fd-pill--on{background:var(--fd-text);color:var(--fd-on-primary)}
[data-fd-style=bitmap] .fd-scope{border-style:dotted}
`;
  }
  return `
[data-fd-style=phosphor] .fd-relief{background:var(--fd-paper);border:var(--fd-border-w) solid var(--fd-border);border-radius:var(--fd-radius);box-shadow:0 0 0 1px rgba(157,247,106,.06),0 0 18px rgba(0,0,0,.6)}
[data-fd-style=phosphor] .fd-num,[data-fd-style=phosphor] thead .MuiTableCell-root{text-shadow:0 0 6px rgba(157,247,106,.45)}
[data-fd-style=phosphor] .MuiTableCell-root{border-bottom:var(--fd-border-w) solid var(--fd-border)}
[data-fd-style=phosphor] .fd-pill{color:var(--fd-warning);border-color:var(--fd-warning)}
[data-fd-style=phosphor] .fd-pill--on{color:var(--fd-success);border-color:var(--fd-success)}
[data-fd-style=phosphor] .fd-scanline{position:relative;overflow:hidden}
[data-fd-style=phosphor] .fd-scanline::after{content:'';position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(180deg,rgba(255,255,255,.03) 0 1px,transparent 1px 3px)}
`;
}

export function styleCss(id: StyleId): string {
  const t = STYLES[id];
  return `:root{${cssVars(t)}}\n${SKELETON}\n${signature(t)}\n`;
}

export function injectStyleCss(id: StyleId): void {
  const el = document.createElement('style');
  el.setAttribute('data-fd-css', id);
  el.textContent = styleCss(id);
  document.head.appendChild(el);
}
