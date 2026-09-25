import glass from './styles/theme-glass.css?raw';
import construct from './styles/theme-construct.css?raw';
import journal from './styles/theme-journal.css?raw';

export interface ThemeDef {
  id: string;
  label: string;
  mood: string;
  css: string;
}

// 三风格 = 同一份 DOM + 同一份 JS，只有这里换 CSS。
export const THEMES: readonly ThemeDef[] = [
  { id: 'glass', label: '苹果玻璃拟态', mood: '渐变底 · 磨砂半透明 · 细白描边 · 大圆角柔影', css: glass },
  { id: 'construct', label: '构成主义海报', mood: '红黑米三色 · 斜切色块 · 超长字距标题 · 直角粗边', css: construct },
  { id: 'journal', label: '手账纸质拼贴', mood: '米黄纸纹 · 和纸胶带 · 虚线便签卡 · 手写字族', css: journal },
];

export type ThemeId = (typeof THEMES)[number]['id'];

const STORAGE_KEY = 'biz-site-theme';

export function isThemeId(value: string | null | undefined): value is string {
  return value !== null && THEMES.some((t) => t.id === value);
}

declare global {
  interface Window {
    __THEME__?: string;
    __THEME_FALLBACK?: string;
  }
}

export function initialTheme(): string {
  if (typeof window === 'undefined') return 'glass';
  // 优先级：URL ?theme= > 宿主注入的 __THEME__（单文件预览与断言脚本用） > localStorage。
  const urlTheme = new URLSearchParams(window.location.search).get('theme');
  if (isThemeId(urlTheme)) return urlTheme;
  if (isThemeId(window.__THEME__)) return window.__THEME__;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isThemeId(stored) ? stored : 'glass';
}

export function persistTheme(id: string): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, id);
}

export function themeCss(id: string): string {
  return (THEMES.find((t) => t.id === id) ?? THEMES[0])?.css ?? '';
}

// 色卡只用 currentColor 与主题内定义的类，配色完全由当前主题 CSS 决定，
// 这样「换风格只换 CSS」的承诺不会被内联图形破坏。
export function Swatch({ theme }: { theme: string }): React.JSX.Element {
  return (
    <svg className="swatch" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {theme === 'glass' ? (
        <>
          <rect x="2" y="4" width="20" height="16" rx="5" className="swatch-alt" />
          <path d="M4 15l5-6 4 4 3-2 4 5" className="swatch-line" />
        </>
      ) : null}
      {theme === 'construct' ? (
        <>
          <path d="M2 22L14 2l8 20z" fill="currentColor" />
          <path d="M2 22h20" className="swatch-line" />
          <circle cx="17" cy="7" r="3" className="swatch-alt" />
        </>
      ) : null}
      {theme === 'journal' ? (
        <>
          <rect x="3" y="5" width="18" height="15" className="swatch-alt" />
          <path d="M3 9h18M8 5v15" className="swatch-line" />
          <path d="M14 3l6 3-6 3z" fill="currentColor" />
        </>
      ) : null}
    </svg>
  );
}
