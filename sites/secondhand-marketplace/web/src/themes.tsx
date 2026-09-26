import transit from './styles/theme-transit.css?raw';
import tag from './styles/theme-tag.css?raw';
import vinyl from './styles/theme-vinyl.css?raw';

export interface ThemeDef {
  id: string;
  label: string;
  mood: string;
  css: string;
}

// 三风格 = 同一份 DOM + 同一份 JS，只有这里换 CSS。
export const THEMES: readonly ThemeDef[] = [
  { id: 'transit', label: '地铁线路图导视风', mood: '线路色带 · 方格底纹 · 站牌式表头', css: transit },
  { id: 'tag', label: '旧货手写价签风', mood: '牛皮纸签 · 手写体数字 · 图钉与麻绳', css: tag },
  { id: 'vinyl', label: '黑胶唱片封套风', mood: '大色块封套 · 粗体标题 · 唱片纹圆角', css: vinyl },
];

export type ThemeId = (typeof THEMES)[number]['id'];

const STORAGE_KEY = 'flea-site-theme';

export function isThemeId(value: string | null | undefined): value is string {
  return value !== null && THEMES.some((t) => t.id === value);
}

declare global {
  interface Window {
    __THEME__?: string;
  }
}

export function initialTheme(): string {
  if (typeof window === 'undefined') return 'transit';
  // 优先级：URL ?theme= > 宿主注入的 __THEME__（单文件预览与断言脚本用） > localStorage。
  const urlTheme = new URLSearchParams(window.location.search).get('theme');
  if (isThemeId(urlTheme)) return urlTheme;
  if (isThemeId(window.__THEME__)) return window.__THEME__;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isThemeId(stored) ? stored : 'transit';
}

export function persistTheme(id: string): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, id);
}

export function themeCss(id: string): string {
  return (THEMES.find((t) => t.id === id) ?? THEMES[0])?.css ?? '';
}

// 色卡只用 currentColor 与 fill，配色完全由当前主题的 CSS 变量决定，
// 这样「换风格只换 CSS」的承诺不会被内联图形破坏。
// 注意：mark 分支必须与 theme 无关——品牌位曾按当前主题换图形，
// 结果三风格的 DOM 不一致，直接违背「只换 CSS」的验收口径。
export function Swatch({ theme }: { theme: string }): React.JSX.Element {
  if (theme !== 'transit' && theme !== 'tag' && theme !== 'vinyl') {
    return (
      <svg className="swatch" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M3 11L11 3h9v9l-8 8-9-9z" className="swatch-alt" />
        <circle cx="16" cy="7" r="1.6" fill="currentColor" />
        <path d="M7 12h6M7 15h4" className="swatch-line" />
      </svg>
    );
  }
  return (
    <svg className="swatch" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {theme === 'transit' ? (
        <>
          <path d="M2 18h8l6-8h6" className="swatch-line" />
          <path d="M2 8h6l4 4h10" className="swatch-line swatch-alt" />
          <circle cx="12" cy="12" r="2.4" fill="currentColor" />
        </>
      ) : null}
      {theme === 'tag' ? (
        <>
          <path d="M3 9l7-6h11v11l-6 7-8-8z" className="swatch-alt" />
          <circle cx="17" cy="7" r="1.8" fill="currentColor" />
          <path d="M7 13h7" className="swatch-line" />
        </>
      ) : null}
      {theme === 'vinyl' ? (
        <>
          <rect x="2" y="2" width="20" height="20" className="swatch-alt" />
          <circle cx="12" cy="12" r="7" fill="currentColor" />
          <circle cx="12" cy="12" r="2" className="swatch-line" />
        </>
      ) : null}
    </svg>
  );
}
