import skeuo from './styles/theme-skeuo.css?raw';
import iso from './styles/theme-iso.css?raw';
import acid from './styles/theme-acid.css?raw';

export interface ThemeDef {
  id: string;
  label: string;
  mood: string;
  css: string;
}

// 三风格 = 同一份 DOM + 同一份 JS，只有这里换 CSS。
export const THEMES: readonly ThemeDef[] = [
  { id: 'skeuo', label: '拟物工艺台历', mood: '皮革纸纹 · 双层投影凸起 · 缝线铆钉 · 衬线字', css: skeuo },
  { id: 'iso', label: '等距轴测工业风', mood: '轴测网格纸 · 30° 斜切挤出体 · 等宽标注 · 安全黄', css: iso },
  { id: 'acid', label: '酸性夜场海报', mood: '纯黑底 · 荧光绿橙 · 变形大字 · 硬边错位块', css: acid },
];

export type ThemeId = (typeof THEMES)[number]['id'];

const STORAGE_KEY = 'biz-site-theme';
const FALLBACK = 'skeuo';

export function isThemeId(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && THEMES.some((t) => t.id === value);
}

declare global {
  interface Window {
    __THEME__?: string;
  }
}

export function initialTheme(): string {
  if (typeof window === 'undefined') return FALLBACK;
  // 优先级：URL ?theme= > 宿主注入的 __THEME__（单文件预览与断言脚本用） > localStorage。
  const urlTheme = new URLSearchParams(window.location.search).get('theme');
  if (isThemeId(urlTheme)) return urlTheme;
  if (isThemeId(window.__THEME__)) return window.__THEME__;
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  return isThemeId(stored) ? stored : FALLBACK;
}

export function persistTheme(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // 隐私模式下 localStorage 会抛错：风格记不住不影响看数据，不能因此白屏。
  }
}

export function themeCss(id: string): string {
  return (THEMES.find((t) => t.id === id) ?? THEMES[0])?.css ?? '';
}

// 色卡只用 currentColor 与主题内定义的类，配色完全由当前主题 CSS 决定，
// 这样「换风格只换 CSS」的承诺不会被内联图形破坏。
export function Swatch({ theme }: { theme: string }): React.JSX.Element {
  return (
    <svg className="swatch" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {theme === 'skeuo' ? (
        <>
          <rect x="2" y="3" width="20" height="18" rx="4" className="swatch-alt" />
          <path d="M2 9h20" className="swatch-line" />
          <circle cx="7" cy="6" r="1.4" fill="currentColor" />
          <circle cx="17" cy="6" r="1.4" fill="currentColor" />
        </>
      ) : null}
      {theme === 'iso' ? (
        <>
          <path d="M12 3l9 5-9 5-9-5z" fill="currentColor" />
          <path d="M3 8v8l9 5v-8z" className="swatch-alt" />
          <path d="M21 8v8l-9 5v-8z" className="swatch-line" />
        </>
      ) : null}
      {theme === 'acid' ? (
        <>
          <path d="M4 20L14 4l6 16z" fill="currentColor" />
          <circle cx="18" cy="7" r="3.2" className="swatch-alt" />
          <path d="M2 14h8" className="swatch-line" />
        </>
      ) : null}
    </svg>
  );
}
