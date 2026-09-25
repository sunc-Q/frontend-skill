import bauhaus from './styles/theme-bauhaus.css?raw';
import newsprint from './styles/theme-newsprint.css?raw';
import instrument from './styles/theme-instrument.css?raw';

export interface ThemeDef {
  id: string;
  label: string;
  mood: string;
  css: string;
}

// 三风格 = 同一份 DOM + 同一份 JS，只有这里换 CSS。
export const THEMES: readonly ThemeDef[] = [
  { id: 'bauhaus', label: '包豪斯原色', mood: '红黄蓝三原色 · 几何色块 · 粗黑描边', css: bauhaus },
  { id: 'newsprint', label: '报章密排', mood: '新闻纸底 · 衬线密排 · 细分栏线 · 小字号高信息', css: newsprint },
  { id: 'instrument', label: '航空仪表盘', mood: '深色金属面板 · 琥珀刻度字 · 圆表与铆钉边', css: instrument },
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
  if (typeof window === 'undefined') return 'bauhaus';
  // 优先级：URL ?theme= > 宿主注入的 __THEME__（单文件预览与断言脚本用） > localStorage。
  const urlTheme = new URLSearchParams(window.location.search).get('theme');
  if (isThemeId(urlTheme)) return urlTheme;
  if (isThemeId(window.__THEME__)) return window.__THEME__;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isThemeId(stored) ? stored : 'bauhaus';
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
      {theme === 'bauhaus' ? (
        <>
          <circle cx="8" cy="8" r="6" fill="currentColor" />
          <rect x="12" y="12" width="10" height="10" className="swatch-alt" />
          <path d="M2 22 L12 22 L2 12 Z" className="swatch-line" />
        </>
      ) : null}
      {theme === 'newsprint' ? (
        <>
          <rect x="2" y="2" width="20" height="4" fill="currentColor" />
          <rect x="2" y="8" width="9" height="14" className="swatch-line" />
          <rect x="13" y="8" width="9" height="14" className="swatch-alt" />
        </>
      ) : null}
      {theme === 'instrument' ? (
        <>
          <circle cx="12" cy="12" r="9" className="swatch-alt" />
          <circle cx="12" cy="12" r="9" className="swatch-line" />
          <path d="M12 12 L17 7" className="swatch-line" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
        </>
      ) : null}
    </svg>
  );
}
