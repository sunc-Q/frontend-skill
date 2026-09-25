import memphis from './styles/theme-memphis.css?raw';
import sport from './styles/theme-sport.css?raw';
import blueprint from './styles/theme-blueprint.css?raw';

export interface ThemeDef {
  id: string;
  label: string;
  mood: string;
  css: string;
}

// 三风格 = 同一份 DOM + 同一份 JS，只有这里换 CSS。
export const THEMES: readonly ThemeDef[] = [
  { id: 'memphis', label: '孟菲斯几何', mood: '撞色几何 · 粗描边圆点 · 俏皮大圆角', css: memphis },
  { id: 'sport', label: '高对比荧光运动风', mood: '炭黑底 · 荧光绿强调 · 斜切角标 · 超粗字重', css: sport },
  { id: 'blueprint', label: '蓝图工程制图', mood: '工程蓝底 · 白线网格 · 等宽标注 · 直角细描边', css: blueprint },
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
  if (typeof window === 'undefined') return 'memphis';
  // 优先级：URL ?theme= > 宿主注入的 __THEME__（单文件预览与断言脚本用） > localStorage。
  const urlTheme = new URLSearchParams(window.location.search).get('theme');
  if (isThemeId(urlTheme)) return urlTheme;
  if (isThemeId(window.__THEME__)) return window.__THEME__;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isThemeId(stored) ? stored : 'memphis';
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
      {theme === 'memphis' ? (
        <>
          <circle cx="7" cy="7" r="5" fill="currentColor" />
          <rect x="12" y="3" width="9" height="9" className="swatch-alt" />
          <path d="M3 21l9-9 9 9" className="swatch-line" />
        </>
      ) : null}
      {theme === 'sport' ? (
        <>
          <path d="M2 20L14 4h8L10 20z" fill="currentColor" />
          <path d="M2 12l8-8h4l-8 8z" className="swatch-alt" />
        </>
      ) : null}
      {theme === 'blueprint' ? (
        <>
          <rect x="2" y="2" width="20" height="20" className="swatch-line" />
          <path d="M2 8h20M2 16h20M8 2v20M16 2v20" className="swatch-grid" />
          <circle cx="12" cy="12" r="3" className="swatch-alt" />
        </>
      ) : null}
    </svg>
  );
}
