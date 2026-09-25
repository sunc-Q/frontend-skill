/* Entry point for one style. Usage: node build.mjs <themeId> */
import * as THREE from 'three';
import { createGame } from './engine.js';
import { hudHtml, HUD_BASE_CSS as BASE_CSS } from './hud.js';
import * as themes from './themes.js';

const id = window.__THEME_ID;
const theme = Object.values(themes).find((t) => t && t.id === id);
if (!theme) throw new Error('unknown theme ' + id);

theme.hudHtml = hudHtml({
  title: theme.titleText,
  subtitle: theme.subText,
  cta: theme.ctaText,
  brand: theme.brand,
  hint: theme.hintText,
});

const style = document.createElement('style');
style.textContent =
  BASE_CSS + '\n:root{' + theme.cssVars + '}\n' + theme.skinCss +
  '\nbody{background:' + themeCssFallback(id) + '}';
document.head.appendChild(style);

/* expose the theme for the checker */
window.__THEME = { id, label: theme.label, seed: theme.seed };
window.__ready = false;
createGame(theme);
window.__ready = true;

function themeCssFallback(t) {
  return t === 'sunlit-moss' ? '#0e1a12' : t === 'obsidian-lava' ? '#1a0d0b' : '#0d1520';
}
export { THREE };
