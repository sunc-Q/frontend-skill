import ledger from './styles/theme-ledger.css?raw';
import picture from './styles/theme-picture.css?raw';
import corporate from './styles/theme-corporate.css?raw';

export interface ThemeDef {
  id: string;
  label: string;
  mood: string;
  css: string;
}

// 三风格 = 同一份 DOM + 同一份 JS，只有这里换 CSS。
// 由 scripts/derive-themes.py 从「共享结构 + 三套设计令牌」派生，不复制组件。
export const THEMES: readonly ThemeDef[] = [
  { id: 'ledger', label: '冷灰账簿', mood: '印刷账本 · 细密网格 · 等宽数字 · 零圆角', css: ledger },
  { id: 'picture', label: '儿童绘本', mood: '奶油底 · 大圆角软阴影 · 手写标题 · 蜡笔色点', css: picture },
  { id: 'corporate', label: '深色企业台', mood: '近黑蓝底 · 青蓝高亮 · 分隔线 · 紧凑信息密度', css: corporate },
];

export type ThemeId = (typeof THEMES)[number]['id'];

const STORAGE_KEY = 'sla-desk-theme';

export function isThemeId(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && THEMES.some((t) => t.id === value);
}

declare global {
  interface Window {
    __THEME__?: string;
  }
}

export function initialTheme(): string {
  if (typeof window === 'undefined') return 'ledger';
  // 优先级：URL ?theme= > 宿主注入的 __THEME__（单文件预览与断言脚本用） > localStorage。
  const urlTheme = new URLSearchParams(window.location.search).get('theme');
  if (isThemeId(urlTheme)) return urlTheme;
  if (isThemeId(window.__THEME__)) return window.__THEME__;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isThemeId(stored) ? stored : 'ledger';
}

export function persistTheme(id: string): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, id);
}

export function themeCss(id: string): string {
  return (THEMES.find((t) => t.id === id) ?? THEMES[0])?.css ?? '';
}

// 色卡三种形状完全相同，配色只由当前主题的 CSS 变量决定：
// 「换风格只换 CSS」的承诺不能被子图形的分支破坏。
export function Swatch(): React.JSX.Element {
  return (
    <svg className="swatch" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="20" height="6" className="swatch-alt" />
      <rect x="2" y="10" width="9" height="12" fill="currentColor" />
      <rect x="13" y="10" width="9" height="12" className="swatch-alt" />
      <circle cx="12" cy="16" r="3" className="swatch-line" />
    </svg>
  );
}
