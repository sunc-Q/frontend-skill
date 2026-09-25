import swiss from './styles/theme-swiss.css?raw';
import win95 from './styles/theme-win95.css?raw';
import cyber from './styles/theme-cyber.css?raw';

export interface ThemeDef {
  id: string;
  label: string;
  mood: string;
  css: string;
}

// 三风格 = 同一份 DOM + 同一份 JS，只有这里换 CSS。
export const THEMES: readonly ThemeDef[] = [
  { id: 'swiss', label: '瑞士网格', mood: '黑白红三原色 · 严格 12 栏 · 直角无阴影', css: swiss },
  { id: 'win95', label: '复古 Win95', mood: '系统灰 · 立体凸起边框 · 标题栏窗口', css: win95 },
  { id: 'cyber', label: '暗色霓虹', mood: '深底 · 荧光描边发光 · 大圆角等宽字', css: cyber },
];

export type ThemeId = (typeof THEMES)[number]['id'];

const STORAGE_KEY = 'biz-site-theme';

export function isThemeId(value: string | null | undefined): value is string {
  return value !== null && THEMES.some((t) => t.id === value);
}

declare global {
  interface Window {
    __THEME__?: string;
  }
}

export function initialTheme(): string {
  if (typeof window === 'undefined') return 'swiss';
  // 优先级：URL ?theme= > 宿主注入的 __THEME__（单文件预览与断言脚本用） > localStorage。
  const urlTheme = new URLSearchParams(window.location.search).get('theme');
  if (isThemeId(urlTheme)) return urlTheme;
  if (isThemeId(window.__THEME__)) return window.__THEME__;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isThemeId(stored) ? stored : 'swiss';
}

export function persistTheme(id: string): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, id);
}

export function themeCss(id: string): string {
  return (THEMES.find((t) => t.id === id) ?? THEMES[0])?.css ?? '';
}

// 色卡只用 currentColor 与 fill，配色完全由当前主题的 CSS 变量决定，
// 这样「换风格只换 CSS」的承诺不会被内联图形破坏。
export function Swatch({ theme }: { theme: string }): React.JSX.Element {
  return (
    <svg className="swatch" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {theme === 'swiss' ? (
        <>
          <rect x="2" y="2" width="9" height="9" fill="currentColor" />
          <rect x="13" y="2" width="9" height="9" className="swatch-alt" />
          <rect x="2" y="13" width="9" height="9" className="swatch-alt" />
          <rect x="13" y="13" width="9" height="9" fill="currentColor" />
        </>
      ) : null}
      {theme === 'win95' ? (
        <>
          <rect x="2" y="2" width="20" height="6" className="swatch-alt" />
          <rect x="2" y="10" width="20" height="12" fill="currentColor" />
          <rect x="4" y="12" width="16" height="8" className="swatch-line" />
        </>
      ) : null}
      {theme === 'cyber' ? (
        <>
          <circle cx="12" cy="12" r="9" className="swatch-alt" />
          <path d="M12 3v18M3 12h18" className="swatch-line" />
        </>
      ) : null}
    </svg>
  );
}
