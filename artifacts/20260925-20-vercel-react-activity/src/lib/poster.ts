import { EVENT, FIXTURE_ARTISTS } from './content';

/* 海报生成器：只在用户点开「生成海报」时才被 import（bundle-dynamic-imports / bundle-conditional），
   产物里是独立 chunk，不占首屏。 */
export interface PosterParams {
  tier: string;
  holder: string;
  qty: number;
}

/* 姓名来自用户输入，拼进 SVG 前必须转义（否则 poster 是 XSS 注入点） */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;'));
}

export function buildPoster(p: PosterParams): { svg: string; headline: string } {
  const acts = FIXTURE_ARTISTS.slice(0, 6).map((a) => a.name).join(' / ');
  const headline = `${EVENT.name} · ${p.holder === '' ? '持票人待填' : p.holder}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="900" viewBox="0 0 640 900">
  <rect width="640" height="900" fill="#0e1116"/>
  <circle cx="320" cy="250" r="150" fill="none" stroke="#e7c873" stroke-width="6"/>
  <path d="M170 250h300" stroke="#e7c873" stroke-width="6"/>
  <text x="320" y="450" text-anchor="middle" fill="#f3efe6" font-size="34" font-family="Georgia, serif">${esc(headline)}</text>
  <text x="320" y="500" text-anchor="middle" fill="#9aa4b2" font-size="20">${esc(EVENT.city)}</text>
  <text x="320" y="560" text-anchor="middle" fill="#e7c873" font-size="22">${p.qty} 张 · ${esc(p.tier)}</text>
  <text x="320" y="640" text-anchor="middle" fill="#6d7684" font-size="15">${esc(acts)} 等 12 组</text>
  <text x="320" y="840" text-anchor="middle" fill="#4d5561" font-size="14">10.16-10.18 · Sound Isle Festival · 纪念票根</text>
</svg>`;
  return { svg, headline };
}
