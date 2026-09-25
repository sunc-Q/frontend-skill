import brutal from './styles/theme-brutal.css?raw';
import washi from './styles/theme-washi.css?raw';
import morandi from './styles/theme-morandi.css?raw';

export interface ThemeDef {
  id: string;
  label: string;
  mood: string;
  css: string;
}

// 三风格 = 同一份 DOM + 同一份 JS，只有这里换 CSS。
export const THEMES: readonly ThemeDef[] = [
  { id: 'brutal', label: '新粗野主义', mood: '亮黄底 · 4px 硬黑边 + 错位投影 · 巨型粗黑标题', css: brutal },
  { id: 'washi', label: '日式留白', mood: '和纸米白 · 发丝细线 · 大段留白与衬线竖排气韵', css: washi },
  { id: 'morandi', label: '莫兰迪色块', mood: '灰粉灰绿雾蓝 · 无描边色块 · 大圆角与柔和字重', css: morandi },
];

export type ThemeId = (typeof THEMES)[number]['id'];

const STORAGE_KEY = 'fitness-studio-theme';

export function isThemeId(value: string | null | undefined): value is string {
  return value !== null && THEMES.some((t) => t.id === value);
}

declare global {
  interface Window {
    __THEME__?: string;
  }
}

export function initialTheme(): string {
  if (typeof window === 'undefined') return 'brutal';
  // 优先级：URL ?theme= > 宿主注入的 __THEME__（单文件预览与断言脚本用） > localStorage。
  const urlTheme = new URLSearchParams(window.location.search).get('theme');
  if (isThemeId(urlTheme)) return urlTheme;
  if (isThemeId(window.__THEME__)) return window.__THEME__;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isThemeId(stored) ? stored : 'brutal';
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
      {theme === 'brutal' ? (
        <>
          <rect x="2" y="2" width="14" height="14" fill="currentColor" />
          <rect x="8" y="8" width="14" height="14" className="swatch-alt" />
          <rect x="11" y="11" width="8" height="8" className="swatch-line" />
        </>
      ) : null}
      {theme === 'washi' ? (
        <>
          <rect x="4" y="2" width="1.6" height="20" fill="currentColor" />
          <rect x="11" y="6" width="1.6" height="16" fill="currentColor" />
          <circle cx="18" cy="8" r="3.4" className="swatch-alt" />
        </>
      ) : null}
      {theme === 'morandi' ? (
        <>
          <rect x="2" y="4" width="9" height="16" rx="4" className="swatch-alt" />
          <rect x="13" y="4" width="9" height="9" rx="4" fill="currentColor" />
          <rect x="13" y="15" width="9" height="5" rx="2.5" className="swatch-line" />
        </>
      ) : null}
    </svg>
  );
}
