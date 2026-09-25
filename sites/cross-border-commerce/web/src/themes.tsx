import paper from './styles/theme-paper.css?raw';
import vapor from './styles/theme-vapor.css?raw';
import crt from './styles/theme-crt.css?raw';

export interface ThemeDef {
  id: string;
  label: string;
  mood: string;
  css: string;
}

// 三风格 = 同一份 DOM + 同一份 JS，只有这里换 CSS。
export const THEMES: readonly ThemeDef[] = [
  { id: 'paper', label: '暖纸编辑排版', mood: '米色纸感 · 衬线杂志排式 · 细黑线分隔', css: paper },
  { id: 'vapor', label: '蒸汽波', mood: '紫夜渐变 · 霓虹粉青发光 · 大圆角', css: vapor },
  { id: 'crt', label: '终端绿字 CRT', mood: '黑底绿字 · 等宽全大写字母 · 扫描线', css: crt },
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
  if (typeof window === 'undefined') return 'paper';
  // 优先级：URL ?theme= > 宿主注入的 __THEME__（单文件预览与断言脚本用） > localStorage。
  const urlTheme = new URLSearchParams(window.location.search).get('theme');
  if (isThemeId(urlTheme)) return urlTheme;
  if (isThemeId(window.__THEME__)) return window.__THEME__;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isThemeId(stored) ? stored : 'paper';
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
      {theme === 'paper' ? (
        <>
          <rect x="3" y="2" width="18" height="20" className="swatch-alt" />
          <path d="M6 7h12M6 11h12M6 15h8" className="swatch-line" />
        </>
      ) : null}
      {theme === 'vapor' ? (
        <>
          <circle cx="12" cy="10" r="7" fill="currentColor" />
          <path d="M2 17h20M2 20h20" className="swatch-line" />
        </>
      ) : null}
      {theme === 'crt' ? (
        <>
          <rect x="2" y="4" width="20" height="14" className="swatch-alt" />
          <path d="M5 8l3 3-3 3M9 14h6" className="swatch-line" />
        </>
      ) : null}
    </svg>
  );
}
