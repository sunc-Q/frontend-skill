import flightBoard from './styles/theme-flight-board.css?raw';
import watchDial from './styles/theme-watch-dial.css?raw';
import botanicalPlate from './styles/theme-botanical-plate.css?raw';

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
    id: 'flight-board',
    label: '机场航班信息板风',
    mood: '翻牌式深炭黑底 · 琥珀灯号 · 全大写窄体与硬边框',
    css: flightBoard,
  },
  {
    id: 'watch-dial',
    label: '机械腕表表盘剖视风',
    mood: '米白漆面 · 同心刻度圈 · 蓝钢指针与轨道式小表盘',
    css: watchDial,
  },
  {
    id: 'botanical-plate',
    label: '植物标本图鉴版画风',
    mood: '泛黄图鉴纸 · 铜版蚀刻线 · 墨绿与赭石双色印刷',
    css: botanicalPlate,
  },
];

const STORAGE_KEY = 'fco-theme';

export function isThemeId(value: string | null | undefined): value is string {
  return value !== null && THEMES.some((t) => t.id === value);
}

declare global {
  interface Window {
    __THEME__?: string;
  }
}

export function initialTheme(): string {
  if (typeof window === 'undefined') return 'flight-board';
  // 优先级：URL ?theme= > 宿主注入的 __THEME__（单文件预览与断言脚本用） > localStorage。
  const urlTheme = new URLSearchParams(window.location.search).get('theme');
  if (isThemeId(urlTheme)) return urlTheme;
  if (isThemeId(window.__THEME__)) return window.__THEME__;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isThemeId(stored) ? stored : 'flight-board';
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
      {theme === 'flight-board' ? (
        <>
          {/* 翻牌信息板：一块翻牌 + 上下两行灯位 */}
          <rect x="1.5" y="5" width="21" height="14" rx="1" fill="currentColor" />
          <path d="M1.5 12h21" className="swatch-line" />
          <path d="M6 2.6h12" className="swatch-line" />
          <circle cx="4.6" cy="8.4" r="1.1" className="swatch-alt" />
          <circle cx="4.6" cy="15.6" r="1.1" className="swatch-alt" />
        </>
      ) : null}
      {theme === 'watch-dial' ? (
        <>
          {/* 表盘剖视：外圈刻度 + 时分针 + 小秒盘 */}
          <circle cx="12" cy="12" r="9.6" fill="currentColor" />
          <circle cx="12" cy="12" r="7.4" className="swatch-line" />
          <path d="M12 12V6.2" className="swatch-alt" />
          <path d="M12 12l4.4 2.6" className="swatch-alt" />
          <circle cx="12" cy="17" r="1.9" className="swatch-line" />
        </>
      ) : null}
      {theme === 'botanical-plate' ? (
        <>
          {/* 标本版画：主脉叶片 + 固定用十字绑带 */}
          <path
            d="M12 2.4c5.2 2.6 7.6 6.4 7.2 11.6-.3 3.8-3.3 6.9-7.2 7.6-3.9-.7-6.9-3.8-7.2-7.6-.4-5.2 2-9 7.2-11.6z"
            fill="currentColor"
          />
          <path d="M12 4.2v15.4" className="swatch-line" />
          <path d="M12 9.4L7.6 12.6M12 12.6l4.4 3.2" className="swatch-line" />
          <path d="M3.4 8.2h17.2" className="swatch-alt" />
        </>
      ) : null}
    </svg>
  );
}
