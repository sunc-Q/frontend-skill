/* Entry point: injects the shared HUD skeleton, applies the theme's skin class,
   then boots the engine. THEME_ID is replaced by scripts/build.mjs per page, so
   the three deliverables are one bundle with three constants. */
import { hudHtml, HUD_BASE_CSS } from './hud.js';
import { THEMES, themeById, HUD_SKIN_CSS } from './themes.js';
import { createGame } from './engine.js';

const THEME_ID = typeof window !== 'undefined' && window.__THEME_ID
  ? window.__THEME_ID
  : (typeof location !== 'undefined' && location.hash ? location.hash.slice(1) : THEMES[0].id);

export function boot() {
  const theme = themeById(THEME_ID);
  document.documentElement.classList.add(`skin-${theme.id}`);
  const style = document.createElement('style');
  style.textContent = `${HUD_BASE_CSS}\n${HUD_SKIN_CSS}\n`;
  document.head.appendChild(style);
  document.body.insertAdjacentHTML('beforeend', hudHtml({
    title: theme.game, sub: theme.sub, cta: theme.cta, hint: theme.hint, brand: '拾光谷 · GLEAMHOLLOW',
  }));
  const game = createGame(theme);
  window.__GAME = game;
  window.__THEME = theme;
  window.__THEME_ID = theme.id;
  return game;
}

if (typeof document !== 'undefined' && document.body) boot();
