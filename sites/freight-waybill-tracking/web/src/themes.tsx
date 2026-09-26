import ticketStub from './styles/theme-ticket-stub.css?raw';
import michelinGilt from './styles/theme-michelin-gilt.css?raw';
import crackleGlaze from './styles/theme-crackle-glaze.css?raw';

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
    id: 'ticket-stub',
    label: '老式票证打孔风',
    mood: '柴油纸登机牌 · 打孔撕线 · 打字机窄字与印章红',
    css: ticketStub,
  },
  {
    id: 'michelin-gilt',
    label: '指南烫金卡风',
    mood: '深宝石绿底 · 烫金双线卡框 · 高对比衬线小字距',
    css: michelinGilt,
  },
  {
    id: 'crackle-glaze',
    label: '青瓷开片冰裂风',
    mood: '粉青釉面 · 冰裂细纹 · 铁足厚边与克制的赭色点缀',
    css: crackleGlaze,
  },
];

const STORAGE_KEY = 'fwt-theme';

export function isThemeId(value: string | null | undefined): value is string {
  return value !== null && THEMES.some((t) => t.id === value);
}

declare global {
  interface Window {
    __THEME__?: string;
  }
}

export function initialTheme(): string {
  if (typeof window === 'undefined') return 'ticket-stub';
  // 优先级：URL ?theme= > 宿主注入的 __THEME__（单文件预览与断言脚本用） > localStorage。
  const urlTheme = new URLSearchParams(window.location.search).get('theme');
  if (isThemeId(urlTheme)) return urlTheme;
  if (isThemeId(window.__THEME__)) return window.__THEME__;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isThemeId(stored) ? stored : 'ticket-stub';
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
      {theme === 'ticket-stub' ? (
        <>
          {/* 登机牌：一侧打孔 + 存根撕线 */}
          <path d="M2 6h14a2 2 0 012 2v8a2 2 0 01-2 2H2z" fill="currentColor" />
          <path d="M14 5v14" className="swatch-line" strokeDasharray="2 2" />
          <circle cx="4.4" cy="8.4" r="1.1" className="swatch-alt" />
          <circle cx="4.4" cy="12" r="1.1" className="swatch-alt" />
          <circle cx="4.4" cy="15.6" r="1.1" className="swatch-alt" />
        </>
      ) : null}
      {theme === 'michelin-gilt' ? (
        <>
          {/* 米其林人形轮廓：圆头 + 肩线，外裹双层卡框 */}
          <rect x="1.5" y="1.5" width="21" height="21" rx="2" fill="currentColor" />
          <rect x="4" y="4" width="16" height="16" rx="1.2" className="swatch-line" />
          <circle cx="12" cy="9.6" r="2.6" className="swatch-alt" />
          <path d="M7.8 17.6c.9-2.5 2.4-3.6 4.2-3.6s3.3 1.1 4.2 3.6z" className="swatch-alt" />
        </>
      ) : null}
      {theme === 'crackle-glaze' ? (
        <>
          {/* 梅瓶剪影 + 冰裂开片线 */}
          <path
            d="M10.6 2.4h2.8l-.4 2.6c2.3 1.1 3.8 3.4 3.8 6.1 0 4-2.6 7.1-7.4 8.3-4.8-1.2-7.4-4.3-7.4-8.3 0-2.7 1.5-5 3.8-6.1z"
            fill="currentColor"
          />
          <path d="M11 6.2l-2.6 5.1 3.4 1.9-1.8 5.6" className="swatch-line" />
          <path d="M14.4 8.6l1.6 3.2-2.4 2.2" className="swatch-line" />
        </>
      ) : null}
    </svg>
  );
}
