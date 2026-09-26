/* 变异测试：往「真正会被人双击打开的那份产物」（含对照页 styles.html）或 src/ 里注入缺陷，
 * 看两套校验抓不抓得到、报错有没有点名。全绿而没有反例的测试等于没测。
 * 每个用例跑完立即还原（含异常路径），最后再跑一次双套确认没留变异残渣。
 * 用法：node scripts/mutate.mjs [--only=M1,M3] [--list]
 * 注意：带 browser 的用例每个要起一次无头 Chrome（软件 GL，约 55s/次）。 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const LAB = dirname(dirname(ROOT));
const BAK = join(LAB, ".tmp", "shader-mutbak");

const CASES = [
  {
    id: "M1", kind: "值变异", suite: "node", file: "preview/exhibit-liquid-chrome.html",
    name: "把表格说明里的「面积合计 390 ㎡」手改成 360（页面数字不再由事实现算）",
    from: "面积合计 390 ㎡", to: "面积合计 360 ㎡", keyword: "面积合计 390",
  },
  {
    id: "M2", kind: "值变异", suite: "node", file: "src/css/skin-liquid-chrome.css", rebuild: true,
    name: "在色板源文件里把 liquid-chrome 的 --accent 改成 crt-plasma 的橙（三套色板要求两两不相交）",
    from: "--accent: #4fd7e8;", to: "--accent: #ffb347;", keyword: "#ffb347",
  },
  {
    id: "M2b", kind: "结构变异", suite: "node", file: "preview/exhibit-liquid-chrome.html",
    name: "只改产物不改源：页面里的 --accent 与 src/css 漂移（M2 第一轮就是从这里钻过去的）",
    from: "--accent: #4fd7e8;", to: "--accent: #9aa0a6;", keyword: "src/css",
  },
  {
    id: "M6", kind: "值变异", suite: "node", file: "preview/exhibit-silk-aurora.html",
    name: "内联 GLSL 顶部加 #version 300 es（宿主是 WebGL1，GLSL ES 1.0 不允许）",
    from: "\\nprecision highp float;", to: "\\n#version 300 es\\nprecision highp float;", keyword: "产物内联",
  },
  {
    id: "M3", kind: "结构变异", suite: "browser", file: "preview/exhibit-liquid-chrome.html",
    name: "视口原点恒传 0（三带退化成同一张画布的三个裁片）",
    from: "gl.uniform2f(locations.uOrigin, x, 0);", to: "gl.uniform2f(locations.uOrigin, 0, 0);", keyword: "uVariant",
  },
  {
    id: "M4", kind: "结构变异", suite: "browser", file: "preview/exhibit-crt-plasma.html",
    name: "变体轴拉平：三个视口都传 uVariant=0（展览页宣称的「一个程序三种密度」变假话）",
    from: "var v = probe === \"samevariant\" ? 0 : index;", to: "var v = 0;", keyword: "uVariant",
  },
  {
    id: "M5", kind: "结构变异", suite: "browser", file: "preview/exhibit-silk-aurora.html",
    name: "删掉 gl.uniform1f(locations.uScroll, …)：滚动进度算好了却没进着色器",
    from: "      gl.uniform1f(locations.uScroll, values.uScroll);\n", to: "", keyword: "uScroll",
  },
  {
    id: "M3b", kind: "结构变异", suite: "node", file: "preview/exhibit-liquid-chrome.html", all: true,
    name: "三份产物的共享宿主一起改（在 uOrigin 传参后加一句注释）——跨页互比仍然全绿，只有「产物 vs 源文件」能抓",
    from: "gl.uniform2f(locations.uOrigin, x, 0);", to: "gl.uniform2f(locations.uOrigin, x, 0); /* 手工微调过产物 */",
    keyword: "共享宿主",
  },
  {
    id: "M7", kind: "结构变异", suite: "browser", file: "preview/exhibit-liquid-chrome.html",
    name: "删掉 .hero-inner 的衬底声明（正文直接压在活着色器上）",
    from: "  max-width: var(--measure);\n  background: var(--scrim);", to: "  max-width: var(--measure);", keyword: "衬底",
  },
  {
    id: "M8", kind: "结构变异", suite: "node", file: "preview/exhibit-crt-plasma.html",
    name: "只给一个风格加一段 DOM（三风格必须同构，差异只允许在 CSS 与着色器）",
    from: "<caption>三个展陈空间，面积合计 390 ㎡", to: "<p>多出来的一段说明</p>\n      <caption>三个展陈空间，面积合计 390 ㎡", keyword: "dom-identical",
  },
  {
    id: "M9", kind: "值变异", suite: "node", file: "styles.html",
    name: "往对照页里手打一个更好的数字：把「内联色板 10 项」改成 12 项（页面数字脱离了 evidence）",
    /* 锚点刻意选稳定整数而不是实测对比度：软件 GL 的读数每帧都有噪声，上一版写死 >7.30:1<，
     * 这一轮它就漂成 7.32 而锚点未命中——用例自己也会过期。
     * 判据也换过：原本期望 N/page-numbers-traceable 抓它，但对照页会把变异表（含本例的注入原文
     * 「内联色板 12 项」）转录进测量区，12 因此成了合法溯源值，用例把自己的判据洗白了；
     * 现在由位置绑定判据 N/regions-match-generation 抓——它问的是「这个位置上是不是生成器当次写的那串」。 */
    from: "内联色板 10 项", to: "内联色板 12 项", keyword: "regions-match-generation",
  },
  {
    id: "M10", kind: "语义变异", suite: "node", file: "src/shaders/silk-aurora.glsl",
    name: "给 silk-aurora 的「技法」注释里加上并没有实现的 fresnel 边缘光（文案与代码各说各话）",
    from: "// 技法：fbm 丝带（到扭曲曲线的距离场）+ 余弦调色板 + 加法干涉，亮底低对比",
    to: "// 技法：fbm 丝带（到扭曲曲线的距离场）+ 余弦调色板 + fresnel 边缘光，亮底低对比",
    keyword: "silk-aurora.glsl:technique",
  },
];

if (process.argv.includes("--list")) {
  for (const c of CASES) console.log(`${c.id} [${c.kind}/${c.suite}] ${c.name}`);
  process.exit(0);
}
const only = (process.argv.find((a) => a.startsWith("--only=")) || "").replace("--only=", "").split(",").filter(Boolean);
const picked = only.length ? CASES.filter((c) => only.includes(c.id)) : CASES;

function run(script) {
  const t0 = Date.now();
  try {
    const out = execFileSync("node", [join(HERE, script + ".mjs")], { encoding: "utf8", cwd: ROOT, maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "pipe"] });
    return parse(out, t0);
  } catch (e) {
    return parse(String(e.stdout || "") + String(e.stderr || ""), t0, true);
  }
}
function parse(out, t0, crashed = false) {
  const m = /check-\w+: (\d+)\/(\d+) PASS/.exec(out);
  return {
    ok: !!m && Number(m[1]) === Number(m[2]) && !crashed,
    fails: m ? Number(m[2]) - Number(m[1]) : -1,
    seconds: +((Date.now() - t0) / 1000).toFixed(1),
    text: out,
  };
}
const failLines = (t) => t.split("\n").filter((l) => l.trim().startsWith("FAIL") || l.trim().startsWith("✗"));

/* 每轮变异后两套校验都会把自己的 evidence 覆写一遍，所以「哪几条断言红了」直接从那两份 JSON 读，
 * 不在控制台文本里靠正则猜。 */
function readFails(rel) {
  try {
    const j = JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
    return (j.results || []).filter((r) => !r.pass).map((r) => r.id);
  } catch {
    return [];
  }
}

const THREE = ["preview/exhibit-liquid-chrome.html", "preview/exhibit-crt-plasma.html", "preview/exhibit-silk-aurora.html"];
const targets = (c) => (c.all ? THREE : [c.file]);
const bakName = (f) => f.replace(/[\/.]/g, "_") + ".bak";

function build() {
  try {
    execFileSync("node", [join(HERE, "build.mjs")], { encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

rmSync(BAK, { recursive: true, force: true });
mkdirSync(BAK, { recursive: true });
for (const f of [...new Set(CASES.map((c) => c.file))]) copyFileSync(join(ROOT, f), join(BAK, bakName(f)));

const needBrowser = picked.some((c) => c.suite === "browser");
const runBrowser = () => (needBrowser ? run("check-browser") : { ok: true, fails: 0, text: "", seconds: 0 });

const baseNode = run("check-node");
const baseBrowser = runBrowser();
console.log(`基线：check-node ${baseNode.ok ? "全绿" : baseNode.fails + " 失败"} / check-browser ${needBrowser ? (baseBrowser.ok ? "全绿" : baseBrowser.fails + " 失败") + `（${baseBrowser.seconds}s）` : "本批次无 browser 用例，跳过"}`);
let bad = 0;
if (!baseNode.ok || !baseBrowser.ok) { bad++; console.log("  ✗ 基线不全绿——先修基线再谈变异，否则变异结果无法解释"); }

const records = [];
if (baseNode.ok && baseBrowser.ok) {
  for (const c of picked) {
    const files = targets(c);
    const origs = files.map((f) => readFileSync(join(ROOT, f), "utf8"));
    const hit = origs.map((s) => s.includes(c.from));
    if (hit.some((h) => !h)) {
      bad++;
      console.log(`  ✗ ${c.id} 锚点未命中（产物/源已和这份用例脱节）：${files[hit.indexOf(false)]} ← ${c.from.slice(0, 40)}`);
      continue;
    }
    files.forEach((f, i) => writeFileSync(join(ROOT, f), origs[i].replace(c.from, c.to)));
    if (c.rebuild && !build()) { bad++; console.log(`  ✗ ${c.id} 改源后 build.mjs 失败，用例作废`); files.forEach((f, i) => writeFileSync(join(ROOT, f), origs[i])); build(); continue; }
    const node = run("check-node");
    const nodeFails = readFails("evidence/check-node.json");
    const browser = c.suite === "browser" ? run("check-browser") : null;
    const browserFails = browser ? readFails("evidence/check-browser.json") : [];
    files.forEach((f, i) => writeFileSync(join(ROOT, f), origs[i]));
    if (c.rebuild) build();

    const text = node.text + "\n" + (browser ? browser.text : "");
    const caughtBy = [];
    if (!node.ok) caughtBy.push(`node(${node.fails})`);
    if (browser && !browser.ok) caughtBy.push(`browser(${browser.fails})`);
    const expectedCaught = c.suite === "node" ? !node.ok : Boolean(browser && !browser.ok);
    const named = failLines(text).some((l) => l.includes(c.keyword));
    const verdict = expectedCaught && named;
    if (!verdict) bad++;
    records.push({
      id: c.id, kind: c.kind, suite: c.suite, all: Boolean(c.all), rebuild: Boolean(c.rebuild),
      file: c.file, name: c.name, injection: { from: c.from, to: c.to }, keyword: c.keyword,
      caught_by: caughtBy, named, verdict,
      failed_assertions: [...new Set(nodeFails.concat(browserFails))],
    });
    console.log(`  ${verdict ? "✓" : "✗"} ${c.id} [${c.kind}/${c.suite}${c.all ? "/三份同改" : ""}] ${c.name}`);
    console.log(`      实际抓到：${caughtBy.join(" + ") || "都没有"}；FAIL 行点名「${c.keyword}」=${named ? "是" : "否"}`);
    console.log(`      失败的断言：${[...new Set(nodeFails.concat(browserFails))].join(", ") || "无"}`);
    for (const l of failLines(text).slice(0, 2)) console.log("      " + l.trim().slice(0, 180));
  }
}

for (const f of [...new Set(CASES.map((c) => c.file))]) {
  const b = join(BAK, bakName(f));
  if (existsSync(b)) copyFileSync(b, join(ROOT, f));
}
rmSync(BAK, { recursive: true, force: true });
build();
const afterNode = run("check-node");
/* 还原后的这一遍，「对照页 vs 刚被本脚本刷新过的 evidence」这类新鲜度断言（N/provenance-resolves、
 * N/page-numbers-traceable）必然是红的：每跑一个 browser 用例都会重写 check-browser 的像素指标，
 * 而对照页要到流水线下一步（make-styles）才按新值重生成。这类红如实记录但单列，不算变异残渣；
 * 页面数字真正的闸在 verify.sh 第 8 步（重生成之后再跑一次 check-node）。 */
const PAGE_FRESH = /^N\/(provenance-resolves|page-numbers-traceable)/;
const nodeFailsAfter = readFails("evidence/check-node.json");
const stalePageFails = nodeFailsAfter.filter((id) => PAGE_FRESH.test(id));
const realNodeFails = nodeFailsAfter.filter((id) => !PAGE_FRESH.test(id));
const nodeClean = afterNode.ok || realNodeFails.length === 0;
/* 本批没有 browser 用例时不重跑 check-browser：软件 GL 的像素测量每帧都有噪声，
 * 白跑一次会把 evidence 里的指标刷新成新值，让已经生成的对照页数字全部过期。 */
const afterBrowser = runBrowser();
writeFileSync(
  join(ROOT, "evidence", "mutation.json"),
  JSON.stringify(
    {
      ran_at: new Date().toISOString(),
      picked: picked.map((c) => c.id),
      baseline: { node_pass: baseNode.ok, browser_pass: baseBrowser.ok },
      cases: records,
      restored: { node_pass: nodeClean, browser_pass: afterBrowser.ok, node_failures: nodeFailsAfter, tolerated_page_freshness: stalePageFails },
      all_caught: bad === 0,
    },
    null,
    2,
  ),
);
console.log(`还原后复跑：check-node ${afterNode.ok ? "全绿" : nodeClean ? `仅 ${stalePageFails.length} 条页面新鲜度红（${stalePageFails.join(",")}），下一步 make-styles 重生成即消` : afterNode.fails + " 失败"} / check-browser ${needBrowser ? (afterBrowser.ok ? "全绿" : afterBrowser.fails + " 失败") : "本批无 browser 用例，未重跑（evidence 保持原值）"}`);
if (!nodeClean || !afterBrowser.ok) bad++;
console.log(bad ? `变异测试：${bad} 项不合格` : `变异测试：${picked.length} 项注入全部被抓且还原干净（evidence 已刷新为还原后的全绿结果）`);
process.exit(bad ? 1 : 0);
