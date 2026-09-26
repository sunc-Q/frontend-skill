/* 构建：src/{template.html, css/base.css, css/skin-*.css, shaders/*.glsl, facts.json}
 *      -> preview/exhibit-<style>.html（三份单文件、零外链、双击即开）
 * 页面里的每一个数字与每一句文案都由这份脚本从 facts.json 现算，零手写。
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SRC = path.join(ROOT, "src");
const OUT = path.join(ROOT, "preview");

const facts = JSON.parse(fs.readFileSync(path.join(SRC, "facts.json"), "utf8"));
const template = fs.readFileSync(path.join(SRC, "template.html"), "utf8");
const baseCss = fs.readFileSync(path.join(SRC, "css", "base.css"), "utf8");
const hostJs = fs.readFileSync(path.join(SRC, "host.js"), "utf8");

const STYLES = [
  { name: "liquid-chrome", shader: "liquid-chrome", skin: "skin-liquid-chrome" },
  { name: "crt-plasma", shader: "crt-plasma", skin: "skin-crt-plasma" },
  { name: "silk-aurora", shader: "silk-aurora", skin: "skin-silk-aurora" },
];

function daysInclusive(a, b) {
  const ms = Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z");
  return Math.round(ms / 86400000) + 1;
}

function group(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const derived = {
  run_days: daysInclusive(facts.show.open, facts.show.close),
  work_count: facts.works.length,
  total_duration: facts.works.reduce((a, w) => a + w.duration_s, 0),
  room_area_total: facts.rooms.reduce((a, r) => a + r.area_m2, 0),
  room_cap_total: facts.rooms.reduce((a, r) => a + r.capacity, 0),
  guided_total: Math.round((facts.stats.guided_tours_per_week * daysInclusive(facts.show.open, facts.show.close)) / 7),
  visitors: group(facts.stats.visitors_expected),
};
derived.room_density = (derived.room_area_total / derived.room_cap_total).toFixed(2);

const worksMarkup = facts.works
  .map(
    (w) =>
      `<article class="work" id="work-${w.no}">
  <p class="no">作品 ${w.no}</p>
  <div>
    <h3>${w.name}</h3>
    <p class="rule">${w.rule}</p>
    <p class="meta">${w.year} 年 · 循环 <span class="dur">${w.duration_s}</span> 秒 · 种子 ${w.seed}</p>
  </div>
</article>`,
  )
  .join("\n");

const roomsMarkup = facts.rooms
  .map(
    (r) =>
      `<tr><th scope="row">${r.name}</th><td>${r.area_m2}</td><td>${r.capacity}</td><td>${(r.area_m2 / r.capacity).toFixed(2)}</td></tr>`,
  )
  .join("\n");

const notesMarkup = facts.notes
  .map((n) => `<li><span class="when">${n.date}</span> ${n.text}</li>`)
  .join("\n");

const creditsMarkup = facts.credits
  .map((c) => `<li><span class="role">${c.role}</span> ${c.name}</li>`)
  .join("\n");

const variantLabels = [0, 1, 2]
  .map((i) => `<span>变体 ${"ABC".charAt(i)} · uVariant ${i}</span>`)
  .join("");

function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

// 不用 replaceAll(值)：替换串里的 $ 会被当成模式引用（历轮踩过的自复制坑）
function put(html, key, value) {
  return html.split(key).join(value);
}

fs.mkdirSync(OUT, { recursive: true });
const slots = {
  "{{TITLE}}": `${facts.show.title_zh} ${facts.show.title_en} · ${facts.show.venue}`,
  "{{SHOW_TITLE_ZH}}": facts.show.title_zh,
  "{{SHOW_TITLE_EN}}": facts.show.title_en,
  "{{SUBTITLE}}": facts.show.subtitle,
  "{{VENUE}}": facts.show.venue,
  "{{CITY}}": facts.show.city,
  "{{OPEN}}": facts.show.open,
  "{{CLOSE}}": facts.show.close,
  "{{RUN_DAYS}}": String(derived.run_days),
  "{{STATEMENT}}": facts.show.statement,
  "{{WORKS}}": worksMarkup,
  "{{WORK_COUNT}}": String(derived.work_count),
  "{{TOTAL_DURATION}}": String(derived.total_duration),
  "{{VARIANT_LABELS}}": variantLabels,
  "{{VISIT_DAYS}}": facts.visit.days,
  "{{VISIT_HOURS}}": facts.visit.hours,
  "{{LAST_ENTRY}}": facts.visit.last_entry,
  "{{CLOSED_NOTE}}": facts.visit.closed_note,
  "{{TICKET_ADULT}}": String(facts.visit.ticket_adult),
  "{{TICKET_CONCESSION}}": String(facts.visit.ticket_concession),
  "{{VISITORS_EXPECTED}}": derived.visitors,
  "{{GUIDED_TOURS}}": String(facts.stats.guided_tours_per_week),
  "{{GUIDED_TOTAL}}": String(derived.guided_total),
  "{{ROOMS}}": roomsMarkup,
  "{{ROOM_AREA_TOTAL}}": String(derived.room_area_total),
  "{{ROOM_CAP_TOTAL}}": String(derived.room_cap_total),
  "{{ROOM_DENSITY}}": derived.room_density,
  "{{NOTES}}": notesMarkup,
  "{{CREDITS}}": creditsMarkup,
  "{{DEMO_NOTE}}": facts.footer.demo_note,
  "{{TECH}}": facts.footer.tech,
  "{{FACTS_JSON}}": jsonForScript({ ...facts, derived }),
  "{{FALLBACK_ATTRS}}": " hidden",
};

const built = [];
for (const style of STYLES) {
  const glsl = fs.readFileSync(path.join(SRC, "shaders", `${style.shader}.glsl`), "utf8");
  const skin = fs.readFileSync(path.join(SRC, "css", `${style.skin}.css`), "utf8");
  const palette = (skin.match(/--[a-z0-9-]+:\s*#[0-9a-f]{6}/gi) || []).map((line) => line.split(":")[1].trim());

  let html = template;
  html = put(html, "{{HOST}}", hostJs);
  html = put(html, "{{CSS}}", `${baseCss}\n${skin}`);
  for (const [key, value] of Object.entries(slots)) html = put(html, key, value);
  html = put(html, "{{STYLE_NAME}}", style.name);
  html = put(html, "{{SHADER_FILE}}", `${style.shader}.glsl`);
  html = put(html, "{{PALETTE_JSON}}", jsonForScript(palette));
  html = put(html, "{{SHADER_SOURCE_JSON}}", jsonForScript(glsl));

  if (/\{\{[A-Z_]+\}\}/.test(html)) {
    throw new Error("未替换的槽位：" + html.match(/\{\{[A-Z_]+\}\}/g).join(", "));
  }
  const file = path.join(OUT, `exhibit-${style.name}.html`);
  fs.writeFileSync(file, html);
  built.push({ style: style.name, shader: `${style.shader}.glsl`, file: path.basename(file), bytes: Buffer.byteLength(html), palette_count: palette.length });
}

fs.writeFileSync(
  path.join(ROOT, "scripts", "build-sizes.json"),
  JSON.stringify({ built, derived, styles: STYLES }, null, 2),
);
console.log(JSON.stringify({ built, derived }, null, 2));
