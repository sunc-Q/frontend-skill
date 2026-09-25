// 交互校验（零依赖）：用 vm + 桩 DOM 跑三页内联脚本，验证复制按钮的两条分支
// 运行：node scripts/interact.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENE = path.resolve(HERE, "..");
const PAGES = { ukiyo: "ukiyo/index.html", astro: "astro/index.html", pixel: "pixel-console/index.html" };

let pass = 0, fail = 0;
const t = (c, m, d) => (c ? (pass++, console.log("  ✓ " + m)) : (fail++, console.log("  ✗ " + m + (d ? " :: " + d : ""))));

function runScript(html, { clipboard, label }) {
  const code = html.match(/[ \t]*<script>([\s\S]*?)<\/script>/)[1];
  const btn = { textContent: label, listeners: {}, getAttribute: () => null };
  btn.addEventListener = (ev, fn) => { btn.listeners[ev] = fn; };
  const timers = [];
  const sandbox = {
    document: { getElementById: (id) => (id === "copyMail" ? btn : null) },
    navigator: clipboard ? { clipboard: { writeText: (s) => Promise.resolve(s) } } : {},
    setTimeout: (fn, ms) => { timers.push(fn); return timers.length; },
    clearTimeout: () => {},
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "inline.js" });
  return { btn, timers, click: () => btn.listeners.click() };
}

for (const [k, rel] of Object.entries(PAGES)) {
  const html = fs.readFileSync(path.join(SCENE, rel), "utf8");
  const label = (html.match(/<button[^>]*id="copyMail"[^>]*>([^<]+)<\/button>/) || [, ""])[1];
  t(!!label.trim(), `${k}: 按钮有初始文案`, JSON.stringify(label));
  const original = runScript(html, { clipboard: false, label });
  t(typeof original.btn.listeners.click === "function", `${k}: 绑定了 click`);
  original.click();
  t(/复制/.test(original.btn.textContent), `${k}: 无 clipboard API 时给出可理解的回退文案`, original.btn.textContent);
  t(/手动|请/.test(original.btn.textContent), `${k}: 回退文案指向手动操作`, original.btn.textContent);
  t(original.timers.length === 1, `${k}: 回退后安排了文案复原`, String(original.timers.length));

  const okRun = runScript(html, { clipboard: true, label });
  await okRun.click();
  await Promise.resolve();
  await Promise.resolve();
  t(/已复制|✔/.test(okRun.btn.textContent), `${k}: clipboard 成功分支给出确认反馈`, okRun.btn.textContent);
  const restore = runScript(html, { clipboard: true, label });
  await restore.click(); await Promise.resolve(); await Promise.resolve();
  restore.timers.forEach((fn) => fn());
  t(restore.btn.textContent === label, `${k}: 反馈结束后回到初始文案`, `${restore.btn.textContent} vs ${label}`);
}

// 三页共用同一邮箱常量：复制的内容必须与 mailto 一致
for (const [k, rel] of Object.entries(PAGES)) {
  const html = fs.readFileSync(path.join(SCENE, rel), "utf8");
  const mailto = (html.match(/href="mailto:([^"]+)"/) || [, ""])[1];
  const constMail = (html.match(/var MAIL="([^"]+)"/) || [, ""])[1];
  t(!!mailto && mailto === constMail, `${k}: 复制用的邮箱常量与 mailto 链接同源`, `${mailto} vs ${constMail}`);
}

console.log(`\n交互校验：${pass} 通过 / ${fail} 失败`);
if (fail) process.exit(1);
