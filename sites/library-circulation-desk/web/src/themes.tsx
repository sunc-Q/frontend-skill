import lego from './styles/theme-lego.css?raw';
import riso from './styles/theme-riso.css?raw';
import decon from './styles/theme-decon.css?raw';

export interface ThemeDef {
  id: string;
  label: string;
  mood: string;
  css: string;
}

// 三风格 = 同一份 DOM + 同一份 JS，只有这里换 CSS。
// 产物由 scripts/derive-themes.py 从 base.css + tokens-<id>.css 拼出来，别手改 theme-*.css。
export const THEMES: readonly ThemeDef[] = [
  { id: 'lego', label: '乐高积木块面', mood: '浅灰底板 · 原色颗粒 · 粗黑轮廓与硬底阴影', css: lego },
  { id: 'riso', label: 'Risograph 孔版印刷', mood: '荧光粉加湖蓝 · 套准错位 · 纸张颗粒', css: riso },
  { id: 'decon', label: '解构主义拼版', mood: '深灰纸片 · 衬线压无衬线 · 斜贴与撕口', css: decon },
];

export type ThemeId = (typeof THEMES)[number]['id'];

const STORAGE_KEY = 'libdesk-theme';

export function isThemeId(value: string | null | undefined): value is string {
  return value !== null && THEMES.some((t) => t.id === value);
}

declare global {
  interface Window {
    __THEME__?: string;
  }
}

export function initialTheme(): string {
  if (typeof window === 'undefined') return 'lego';
  // 优先级：URL ?theme= > 宿主注入的 __THEME__（单文件预览与断言脚本用） > localStorage。
  const urlTheme = new URLSearchParams(window.location.search).get('theme');
  if (isThemeId(urlTheme)) return urlTheme;
  if (isThemeId(window.__THEME__)) return window.__THEME__;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isThemeId(stored) ? stored : 'lego';
}

export function persistTheme(id: string): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, id);
}

export function themeCss(id: string): string {
  return (THEMES.find((t) => t.id === id) ?? THEMES[0])?.css ?? '';
}

// 色卡只用 currentColor 与两个 CSS 变量类（.swatch-alt / .swatch-line），
// 配色完全由当前主题的 CSS 变量决定，这样「换风格只换 CSS」不被内联图形破坏。
export function Swatch({ theme }: { theme: string }): React.JSX.Element {
  return (
    <svg className="swatch" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {theme === 'lego' ? (
        <>
          <rect x="1" y="7" width="10" height="10" rx="2" fill="currentColor" />
          <rect x="13" y="7" width="10" height="10" rx="2" className="swatch-alt" />
          <circle cx="6" cy="4" r="2.2" fill="currentColor" />
          <circle cx="18" cy="4" r="2.2" className="swatch-alt" />
        </>
      ) : null}
      {theme === 'riso' ? (
        <>
          <circle cx="9" cy="12" r="7" fill="currentColor" />
          <circle cx="15" cy="12" r="7" className="swatch-alt" />
          <path d="M12 6.2v11.6" className="swatch-line" />
        </>
      ) : null}
      {theme === 'decon' ? (
        <>
          <path d="M2 20L12 3l4 7z" fill="currentColor" />
          <path d="M13 21h9l-4-8z" className="swatch-alt" />
          <path d="M2 21h8" className="swatch-line" />
        </>
      ) : null}
    </svg>
  );
}
