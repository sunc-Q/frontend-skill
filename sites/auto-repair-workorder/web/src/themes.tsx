import garagePlate from './styles/theme-garage-plate.css?raw';
import couture from './styles/theme-couture.css?raw';
import tarot from './styles/theme-tarot.css?raw';

export interface ThemeDef {
  id: string;
  label: string;
  mood: string;
  css: string;
}

// 三风格 = 同一份 DOM + 同一份 JS，只有这里换 CSS。
// 产物由 scripts/derive-themes.py 从 base.css + tokens-<id>.css 拼出来，别手改 theme-*.css。
export const THEMES: readonly ThemeDef[] = [
  {
    id: 'garage-plate',
    label: '机车搪瓷牌照风',
    mood: '牌蓝搪瓷底 · 反光黄压字 · 铆钉圆角与粗白描边',
    css: garagePlate,
  },
  {
    id: 'couture',
    label: '高定时装屋排版',
    mood: '象牙纸白 · 发丝线与大字距小型大写字母 · 细衬线高瘦数字',
    css: couture,
  },
  {
    id: 'tarot',
    label: '塔罗神谕卡牌风',
    mood: '午夜紫底 · 金线双框卡牌 · 星点纸纹与衬线斜体牌名',
    css: tarot,
  },
];

export type ThemeId = (typeof THEMES)[number]['id'];

const STORAGE_KEY = 'arw-theme';

export function isThemeId(value: string | null | undefined): value is string {
  return value !== null && THEMES.some((t) => t.id === value);
}

declare global {
  interface Window {
    __THEME__?: string;
  }
}

export function initialTheme(): string {
  if (typeof window === 'undefined') return 'garage-plate';
  // 优先级：URL ?theme= > 宿主注入的 __THEME__（单文件预览与断言脚本用） > localStorage。
  const urlTheme = new URLSearchParams(window.location.search).get('theme');
  if (isThemeId(urlTheme)) return urlTheme;
  if (isThemeId(window.__THEME__)) return window.__THEME__;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isThemeId(stored) ? stored : 'garage-plate';
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
      {theme === 'garage-plate' ? (
        <>
          {/* 牌照：圆角矩形 + 四颗铆钉 */}
          <rect x="1" y="5" width="22" height="14" rx="3" fill="currentColor" />
          <rect x="3.6" y="7.6" width="16.8" height="8.8" rx="1.6" className="swatch-line" />
          <circle cx="4.6" cy="6.6" r="1" className="swatch-alt" />
          <circle cx="19.4" cy="6.6" r="1" className="swatch-alt" />
        </>
      ) : null}
      {theme === 'couture' ? (
        <>
          {/* 缝线与顶针：一条竖线穿过一枚细圈 */}
          <path d="M12 1v22" className="swatch-line" />
          <circle cx="12" cy="8" r="4.6" fill="none" stroke="currentColor" strokeWidth="0.9" />
          <circle cx="12" cy="17.6" r="1.5" className="swatch-alt" />
        </>
      ) : null}
      {theme === 'tarot' ? (
        <>
          {/* 拱形卡牌 + 牌面八角星 */}
          <path d="M5 24V9a7 7 0 0114 0v15z" fill="currentColor" />
          <path d="M12 6.5l1.3 3.2 3.2 1.3-3.2 1.3-1.3 3.2-1.3-3.2L6.2 11l3.2-1.3z" className="swatch-alt" />
          <path d="M7.4 17.5h9.2" className="swatch-line" />
        </>
      ) : null}
    </svg>
  );
}
