// PoC-B：第 7 轮交付物 frostlight-gather.html（唯一「对外发布」的产物，已推送到远端分支）
// 验证「客户端说了算」的整条篡改链：调试钩子 → 改分数 → 结束回合 → 落盘 localStorage → 刷新后仍然生效。
// 本机 headless Chrome 加载 file://，零网络。
import { chromium } from 'playwright-core';
import path from 'node:path';

const ART = path.resolve(import.meta.dirname, '../20260925-2332-build-game/frostlight-gather.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const KEY = 'frostlight-gather-best';

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-gpu', '--mute-audio'] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message)));
await page.goto('file://' + ART, { waitUntil: 'load' });

const r = [];
const say = (k, v) => { r.push([k, v]); console.log('  ' + k.padEnd(30) + ' ' + JSON.stringify(v)); };

console.log('\n[1] 发布产物暴露的全局调试面（未鉴权、无开关）');
say('hooks', await page.evaluate(() => ({
  advanceTime: typeof window.advanceTime,
  render_game_to_text: typeof window.render_game_to_text,
  __game: typeof window.__game,
  __game_keys: window.__game ? Object.keys(window.__game).join(',') : null,
  __game_writes_state: !!(window.__game && window.__game.state),
})));

const baseline = await page.evaluate(() => window.render_game_to_text().split('\n').filter(l => /^(mode|score|best|timeLeft|crystals)=/.test(l)).join(' '));
say('baseline 状态', baseline);

console.log('\n[2] 攻击者视角：控制台 3 行改分并强制结算（不打游戏）');
const cheat = await page.evaluate(([key]) => {
  const g = window.__game;
  // 未导出的 startGame() 也可以从外部触发：canvas 上有一次 pointerdown 即进入 playing（第 666 行的真实入口）
  document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  const started = g.state.mode;
  g.state.score = 99999;
  window.advanceTime(61000);                      // 走完 60s 计时 → 触发既有的结算写盘路径
  const ls = localStorage.getItem(key);
  return { started_mode: started, score: g.state.score, best: g.state.best, mode: g.state.mode, localStorage_best: ls, hud: document.body.innerText.match(/Best [^\n|]*/)?.[0] ?? null };
}, [KEY]);
say('篡改后即时状态', cheat);

console.log('\n[3] 持久性：重新加载页面（等价于用户下次打开）');
await page.reload({ waitUntil: 'load' });
const after = await page.evaluate(([key]) => ({
  localStorage_best: localStorage.getItem(key),
  state_best: window.__game.state.best,
  hud_best: document.body.innerText.match(/Best [^\n|]*/)?.[0] ?? null,
  state_score: window.__game.state.score,
  crystals: window.render_game_to_text().split('\n').find(l => l.startsWith('crystals=')),
}), [KEY]);
say('刷新后', after);

console.log('\n[4] 对照：不经任何 JS、纯玩法可得的最好结果（60s 内自动跑）');
const legit = await page.evaluate(() => {
  const g = window.__game;
  g.state.score = 0; g.state.best = 0; localStorage.removeItem('frostlight-gather-best');
  document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  window.advanceTime(61000);   // 同一套流程，但不改 score
  return { mode: g.state.mode, score: g.state.score, best: g.state.best, localStorage_best: localStorage.getItem('frostlight-gather-best') };
});
say('零操作 60s 的真实得分', legit);

console.log('\n[5] 单文件产物里是否有任何服务端/完整性校验（期望：无）');
const noServer = await page.evaluate(() => ({
  requests_to_network: performance.getEntriesByType('resource').filter(e => /^https?:/.test(e.name)).length,
  service_worker: 'serviceWorker' in navigator,
  csp_meta: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
  integrity_attrs: document.querySelectorAll('[integrity]').length,
  script_src_external: [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => /^https?:/.test(s)).length,
  inline_script_tags: document.querySelectorAll('script:not([src])').length,
}));
say('运行期网络/CSP', noServer);

const pass = cheat.localStorage_best === '99999' && after.state_best === 99999 && after.hud_best && after.hud_best.includes('99999') && legit.score === 0 && noServer.csp_meta === false && errs.length === 0;
console.log('\n结论：篡改链闭环 = ' + (pass ? '成立（写盘+跨刷新+HUD 显示，零校验）' : '不成立'));
console.log('pageerror 数 = ' + errs.length + (errs.length ? ' :: ' + errs.join(' | ') : ''));
await browser.close();
