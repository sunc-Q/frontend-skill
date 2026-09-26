import velvet from './styles/theme-velvet.css?raw';
import nautical from './styles/theme-nautical.css?raw';
import typewriter from './styles/theme-typewriter.css?raw';

export interface ThemeDef {
  id: string;
  label: string;
  mood: string;
  css: string;
}

// 三风格 = 同一份 DOM + 同一份 JS，只有这里换 CSS。
export const THEMES: readonly ThemeDef[] = [
  { id: 'velvet', label: '丝绒影院售票亭', mood: '深红丝绒 · 烫金描边 · 灯泡跑马边框', css: velvet },
  { id: 'nautical', label: '航海图罗盘', mood: '海图蓝底 · 经纬网格 · 罗盘玫瑰与等深线', css: nautical },
  { id: 'typewriter', label: '老式打字机稿件', mood: '机械打字 · 等宽铅字 · 回格线与色带印痕', css: typewriter },
];

export type ThemeId = (typeof THEMES)[number]['id'];

const STORAGE_KEY = 'etk-site-theme';
const FALLBACK: ThemeId = 'velvet';

const ids: readonly string[] = THEMES.map((t) => t.id);

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return value !== undefined && value !== null && ids.includes(value);
}

declare global {
  interface Window {
    __THEME__?: string;
  }
}

export function initialTheme(): ThemeId {
  if (typeof window === 'undefined') return FALLBACK;
  // 优先级：URL ?theme= > 宿主注入的 __THEME__（单文件预览与断言脚本用） > localStorage。
  const urlTheme = new URLSearchParams(window.location.search).get('theme');
  if (isThemeId(urlTheme)) return urlTheme;
  if (isThemeId(window.__THEME__)) return window.__THEME__;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isThemeId(stored) ? stored : FALLBACK;
}

export function persistTheme(id: ThemeId): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, id);
}

export function themeCss(id: ThemeId): string {
  const found = THEMES.find((t) => t.id === id);
  if (found !== undefined) return found.css;
  // 主题表为空属于构建期错误，这里只能给空串而不是崩在运行期。
  return '';
}

// 品牌位只用 currentColor 与 fill=currentColor 两类着色，配色完全交给当前主题 CSS 变量。
// 关键：图形的节点必须与主题无关——曾按主题换分支渲染，三风格 DOM 节点数就不一致，
// 直接违背「只换 CSS」的验收口径。
export function Swatch(): React.JSX.Element {
  return (
    <svg className="swatch" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2 6h20v5a2 2 0 000 4v5H2v-5a2 2 0 000-4V6z" className="swatch-body" />
      <path d="M14 6v14" className="swatch-line" />
      <circle cx="8.5" cy="13" r="2.2" className="swatch-dot" />
    </svg>
  );
}
