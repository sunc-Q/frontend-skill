# 2026-09-26 22 时段轮 · shader × 商品 360° 展示页

> 本轮是「每小时前端页面 Skill 验证」的第 22 号槽位。同一小时里 ★#1 会话跑了 `shader × 音乐/音频可视化`
> （产物 `artifacts/20260926-22-shader-audio-visualizer/`，台账已先写入），本轮跑的是
> `state.next_candidates[0]` 里挂着的 ★#2 组合：**变体轴 = 视角**。
> 两份产物共用同一个技能快照 `LAB/skills/shader/`，互不覆盖，写回台账时各自只加自己的条目。

## 1. 结论先说

**留用（·推荐），但只推荐它做「像素型判据的载体」，不推荐它做「视觉设计来源」。**

- 三张双击即开的单文件页，同一个 WebGL1 程序、同一个视角轴，三种完全不同的观感；
- 全链路 550 条断言（静态 257 + 真浏览器 284 + 磁盘纪律 9）全绿，8 例变异注入里 6 例被点名抓住，
  2 例是**记在账上的判据盲区**（见 §7，本轮最有价值的产出就是这两条）；
- 技能本身对「商品/模型怎么摆、多风格怎么区分」依旧零覆盖，全部纪律来自自建令牌与逐字节共用区闸。

产物：`前端skill实验室/artifacts/20260926-22-shader-360-showcase/`（1.19 MB / 40 文件）
入口：`preview/styles.html`（三风格数字对照页）→ 里面链到三张产物页。

## 2. 技能与来源

| 项 | 值 |
| --- | --- |
| 名称 | `shader`（v1.0.0，owner `jvy`） |
| 本机路径 | `~/.qoder-cn/skills/shader`（Qoder 技能目录，已装，无需安装动作） |
| 上游 | https://github.com/openclaw/skills/commit/29d4e050995c71f361ff33110b0feade4845237b |
| 仓库内只读快照 | `前端skill实验室/skills/shader/`（23 文件 44,964B，sha1 前 12 位 `554b0fd8c482`，登记在 `skills/MANIFEST.json`） |
| 同步配方 | `rsync -a --exclude '__pycache__' --exclude '*.pyc' <source_path>/ skills/<name>/ && node scripts/gen-skills-manifest.mjs` |
| 本轮用到它的哪一段 | SKILL.md 的「raw WebGL / GLSL ES」路线 + WebGL1 纪律清单（无 `#version`、`attribute`/`gl_FragColor`、显式 `precision highp float`、常量循环上界、无非常量数组下标）＋ Three.js/R3F 段落**未用**（本轮刻意不引三方库，产物必须 file:// 下零依赖） |

## 3. 场景与三种风格

**场景**：虚构商品「墨准 MOZHUN MZ-3 手冲壶 Gooseneck Kettle」的商品详情 360° 展示页
（`src/product.json` 是唯一事实源：700ml / 304 不锈钢 / ¥689 / 上市 2026-11-03 / 6 个部件 / 6 行规格 / 3 种涂层可选，
页面里还照原样写了 `demoDisclaimer`：这是技能验证用的虚构示例，不构成售卖）。

一个 WebGL1 canvas（420×420 背板，SDF 射线步进：包围球裁剪 → 96 步 → eps 0.0009），
**页面唯一的变体轴是水平方位角 uAzimuth（0~360°）**：拖拽 / 5 个预设 / 自动旋转 / 键盘 ←→ 都只改这一个量。
alpha 通道即剪影（没命中就写 `vec4(0,0,0,0)`），所以 readPixels 的 alpha 就是无成本的轮廓真值。

| 风格 id | 名称 | 一句话主张 | 着色块 | 视角轴上的可断言差异 |
| --- | --- | --- | --- | --- |
| `vitrine` | 射灯橱窗 | 暗场射灯＋描边铜线，商品靠自身高光从黑色里浮出来 | `glossy-ceramic`：釉面 2 色 + 黄铜分区 + rim/spec，spec 项含 `uTime` | 唯一允许 uTime 改像素的皮肤（呼吸高光），但绝不允许改 alpha |
| `plaque` | 展签美术馆 | 展签压画框：米灰墙面＋柔和扩散投影，页面不抢话 | `matte-plaster`：哑光石膏 + 深色修复补块，**高光是零**，`uTime` 在本块一次都不出现 | uTime 换值 → rgba 必须逐位不变 |
| `industrial` | 工业配置器 | 配置单口径：硬投影＋等宽数字＋大写标签 | `brushed-safety`：拉丝钢 + 安全黄喷涂分区 | 同上，rgba 对 uTime 免疫 |

三风格的**几何、视角、宿主胶水、DOM 结构逐字节相同**（唯一合法差异是 `<body data-skin>` 与 `<style>` + frag 的 SHADE 段），
「同一件商品换皮」在源码层是恒等式而不是两边各抄一遍常数。

## 4. 调用 / 安装方式（从零）

技能已装则无需安装；换机复现：

```sh
# 1) 技能：Qoder 里装 shader（或从上面的 commit 取 SKILL.md + assets/ 放到 ~/.qoder-cn/skills/shader/）
# 2) 依赖：只要 Node ≥ 20（产物与全部脚本零运行时依赖）。浏览器套件要 playwright-core：
cd 前端skill实验室/.tmp/shader360 && npm i playwright-core   # 走 npmmirror，见 §9 坑 6
#    复用系统 Chrome：pw.chromium.executablePath() 由 CHROME_PATH/系统安装提供，本轮不下载浏览器
# 3) 一条命令跑完整验证（约 8 分钟，全绿退出码 0）：
cd 前端skill实验室/artifacts/20260926-22-shader-360-showcase
sh scripts/verify.sh
# 4) 只看页面：双击 preview/styles.html，或 preview/showcase-vitrine.html（file:// 直接能跑，无模块、无外链）
```

## 5. 产物清单（相对 `artifacts/20260926-22-shader-360-showcase/`）

| 路径 | 是什么 |
| --- | --- |
| `preview/showcase-{vitrine,plaque,industrial}.html` | 三张商品 360° 页，49.4 / 48.2 / 50.1 KB，各自真单文件（零外链、零本地引用） |
| `preview/styles.html` | 三风格数字对照页，378 KB，133 个 `data-num` 指针，内嵌 3 张宽屏剪影 PNG（data URI），零脚本 |
| `src/product.json` | 唯一事实源：商品事实 + 几何字段 + 着色参数 + 视角与控件常数 + 三风格声明（290 行） |
| `src/labels.json` | 全部文案，DOM 里只留 `data-i18n` 键 |
| `src/body.html` `src/host.js` `src/skins/*.css` `src/shaders/*.glsl` | 骨架 / 宿主与探针 / 三套令牌表 / 7 个着色块（head·vert·geometry·main·shade×3） |
| `scripts/` | `build.mjs` `lib.mjs` `check-node.mjs` `check-browser.mjs` `mutate.mjs` `make-styles.mjs` `check-clean.mjs` `ledger-snapshot.mjs` `verify.sh` |
| `evidence/` | `build-report` `check-node` `browser-report` `mutation-report` `contrast` `regions` `ledger` 七份 JSON 读数 |
| `shots/` | 6 张宽屏/窄屏舞台截图（check-browser 真帧产出，喂给对照页） |
| `scripts/ledger-snapshot.json` | 写回台账**前**的台账快照（§8 用它对账） |

`scripts/smoke.mjs` 是开发期的一次性方位扫描脚本，收尾时已删（原文抄在 §10），因此 check-clean 有一条
`clean/no-oneoff-probes` 专门盯着这类「目录里没人能解释的第二套判据」。

## 6. 验证体系在管什么（550 条）

**静态 `check-node.mjs`（257 条，毫秒级，A–N 组）**
A 自包含 37（零 http/零 module/零 url()/体积）· B 单一事实源 13（**DOM 文本节点零数字**，数字只能来自 `data-fact`）·
C 共用区逐字节相同 14（@VERT/@HOST/HEAD/GEOMETRY/MAIN 三页同 hash、SHADE 三页互异、DOM 归一化后同）·
D 色板跨层单一来源 34（`--x-token` 必须既在 `:root` 又被解成 GLSL `vec3`，shade 段零十六进制）·
E 三风格指纹互异 19（技能给的式子复算 + class 覆盖闸，防某套 CSS 漏写规则掉回默认值）·
F 结构与无障碍 47（表格语义、`aria`、预设行三列、实测列初值不是结论）·
G 几何镜像 15（GLSL 每个标量常量都要能在 `product.json` 里找到同一个数，**反向也要**）·
H GLSL ES 1.00 纪律 24（含「几何/求交段零 `uTime`」）· I WCAG 对比度 18（`:root` 现算，见 `evidence/contrast.json`）·
J 技能条款落地 9 · K 单位纪律 11（度数只走 `deg2rad/rad2deg`，宿主里出现裸 `180`/`Math.PI/180` 即红）·
L 预设自洽 9 · N 对照页数字溯源 7（每个 `data-num` 指针现算，且现算结果必须等于页面印出来的那个数）。

**真浏览器 `check-browser.mjs`（284 条，playwright-core + ANGLE/SwiftShader 真帧）**
`source` 2（页面自报的 sha1 必须等于磁盘源码，防 src↔产物漂移）+ 每套皮肤 92×3 + `crossSkin` 6。
每套里最硬的是 `sweep`（12 方位）：
- **镜像恒等** `bandCx(θ) + bandCx(180−θ) === W−1`，且面积相等、包围盒左右互换（模型对 z→−z 严格对称，
  配对的方位是 θ 与 **180−θ**，不是 θ+180——这一点本轮踩过，见 §9 坑 3）；
- 顶带重心贴着壶嘴尖的**解析投影**（JS 独立实现一遍相机式子，两条式子落在同一个像素上）；
- 转 180° 顶带必须换边；不触边、占屏比在 12%~60%；
- `time`：换 `uTime` 不改面积/包围盒/alpha 指纹，vitrine 允许 rgba 变、plaque/industrial 必须 rgba 不变；
- `uniform`：探针记录每次 `uniform1f`，4000° 与 −720° 都要被 wrap 进 [0,τ)；
- `presets`：5 个预设 × (读数 + 锚点 + 像素指纹) 三向核对——**声明的锚点 = 解析的锚点 = 像素实测的锚点**；
- `shot`：宽/窄两档截图落 `shots/`。

**数字对照页 `make-styles.mjs`**：133 个数字全部由 `lib.mjs` 的**同一个指针解析器**现算
（`bytes:` / `sha1:` / `json:rel#/ptr` / `count:` / `css:style:--token` / `calc:`），
解析器同时供生成侧和 N 组复核侧使用，任何一侧改了口径当场对不齐。

## 7. 变异测试：6 抓 2 盲区（本轮最值钱的一段）

`node scripts/mutate.mjs` → `evidence/mutation-report.json`。每个臂只改一个字节级事实，
且要求**点名**那条判据变红（红在别处不算抓住）。全部动作只在 `LAB/.tmp/mutate-<id>/` 副本里，产物目录零污染。

| 臂 | 改什么 | 该谁抓 | 结果 |
| --- | --- | --- | --- |
| M-hardcoded-number | DOM 骨架里手写 `700ml` | `B-DOM文本节点零数字` | ✅ 红 3 条 |
| M-face-shift | `ZONE_SPOUT_X` 挪到 JSON 之外 | `G-GLSL每个标量常量都在JSON里` | ✅ 红 2 条 |
| M-shared-geometry | 只改一套皮肤的 `BODY_R` | `C-geometry三页相同` | ✅ 红 2 条 |
| M-time-leak | 求交步长里塞 `uTime` | `H-几何段零uTime` | ✅ 红 3 条 |
| M-plaque-shimmers | 哑光皮肤长出呼吸高光 | `time.plaque/uTime 完全无影响` | ✅ 红 1 条 |
| M-fake360 | 假 360°：读数在动、`uAzimuth` 恒 0 | `实测锚点=声明锚点` | ✅ 红 18 条 |
| **M-shading-frozen** | `spoutFace()` 直接 `return 1.0`（分区不再随视角转） | 色心判据 | ⚠️ **全绿 = 盲区** |
| **M-facing-half-turn** | `toCam` 的朝向相位整体 +180°（镀色面长在背面） | 色心判据 | ⚠️ **全绿 = 盲区** |

两条盲区不是失败，是本轮量出来的**判据边界**，机理值得记下来：

1. 剪影类判据全部只看 alpha → 几何正确性与着色手性正交，`M-facing-half-turn` 一个像素的轮廓都不动；
2. 想靠「分区色心」补位也不行：壶嘴在**任意方位都探出器身**，所以无论镀色面朝前朝后，
   偏差加权重心都跟着顶带走 → 色心判据只能证明「分了区」，证不了「分区在转」；
3. 试过三条替代量测，全被实测数据否掉（`.tmp/mprobe` 里对照跑）：分区面积随朝向的相关系数
   三套皮肤给出 `+0.65 / −0.17 / +0.11`，平均彩度给出 `−0.74 / +0.69 / +0.83`——**符号都不一致**，
   因为顶带里恒有「黄铜盖钮」（回转体，视角不变量）和 rim/spec 高亮在污染统计。
   据此把临时加上的 `zoneArea/chroma` 探针与 `product.json` 的 `probe` 阈值一并回滚，不留没牙的判据。

**要抓住它们需要什么样的判据**（下一轮如果继续用这个技能，这是现成的起手式）：
在着色器里加一个「分区门控探针」uniform（`uZoneDebug`），冻结同一方位分别渲染「分区开/关」两帧，
断言两帧的 rgba **必须**不同、且不同像素的质心落在解析算出的壶嘴扇区里——
这才是能把「着色手性」量出来的双帧差分校验，纯观测量（面积/彩度/质心）在这一族形状上是被抵消的。

`mutate.mjs` 里这两条臂标了 `blind:` 字段，语义是**已知缺口**：它们必须仍然漏，
哪天补上真判据、它们变红，套件会当场报 `staleBlind` 提醒摘标签（缺口的账也是账）。

## 8. 台账与去重

开工第一动作：读 `records/work-log.md` + `state/state.json`。
- 组合 `shader × 商品 360°` 在 `tried` 里 0 命中（写回前快照 `combo_before: 0`），且正是 `next_candidates[0]` 的 ★ 候选；
- 三种风格名 `射灯橱窗 vitrine / 展签美术馆 plaque / 工业配置器 industrial` 与当时已占用的 72 个风格名零碰撞（`styles_before: 0`）；
- 技能来源无需重新探测：`skills_seen` 已记 shader 可用（★#1 会话当轮就在用）。

`node scripts/ledger-snapshot.mjs` 在写回**前**拍快照（`scripts/ledger-snapshot.json`），
写回**后** `--verify` 对账：本轮组合恰好 1 条、三种风格都在 `used_styles`、工作日志本轮恰好一行且六字段齐全、
`tried/used_styles/runs/environment_notes` 只增不减（**并发闸**：同一小时两个会话写同一个 state.json，谁覆盖谁当场露馅）、
不新增台账字段欠账。读数落在 `evidence/ledger.json`。

**本轮实跑结果**：写回前快照 `combo_before=0 / styles_before=0 / tried=24 / used_styles=72`；
写回后 `--verify` **15/15 全绿**，台账变成 `tried=25 / used_styles=75 / runs=25 / next_candidates=9 / environment_notes=162`。
连同页面的 550 条，本轮共 565 条机器判定，全绿。

## 9. 问题与踩坑（都已在代码里修掉，写下来免得下一轮重犯）

1. **注释会伪装成断言**：`uTime 零出现` 一开始被注释里的单词触发假失败 → 所有条款核对先过 `noComments()` 再匹配。
2. **`eq()` 吞掉了诊断参数**：两套套件里 `eq` 的第 4 个参数没进 `results`，红了看不见为什么红 → 签名补 `detail`。
3. **镜像配对写错**：先按 θ+180 配对，`bandCx(θ)+bandCx(θ+180)=W−1` 怎么都不闭合。
   z→−z 对称的正确配对是 **θ 与 180−θ**；改完恒等式精确到 `W−1`（不是容差）。
4. **「实测」列永远空**：宿主 `state.live` 默认 false → 像素实测与锚点读数从不填。补 `live: true` + 2 条断言（默认关着的自检等于没自检）。
5. **自指数字**：对照页一度引用「本套件断言条数」，跑一次改一次永远对不齐；引用 build-report 的全长 sha1 而页面印 12 位也对不齐
   → 指针一律只指向 `src/*.json` 与 `evidence/*.json` 里由别的步骤写下的事实，页面用 `sha1:` 现切 12 位。
6. **npm 与后台命令**：`npm i` 走 npmmirror；后台命令尾部任何非零退出（比如 `ls` 一个不存在的路径）会把整条报成失败，判成败看 stdout 的 `added N packages`。
7. **`SPHERE_R` 只在 GLSL 里手写**：包围球半径不在 JSON → 几何可以悄悄长出去切掉商品。补 `geometry.bounds.sphereRadius`，
   G 组用其它几何字段**解析算出需求半径**并与之比对（装得下、又不松垮）。
8. **变异的落点要选得有意义**：`toCam` 里 `v.z*sa` 换符号几乎不改像素（壶嘴壳在 z≈0），抓不到是变异选得不好而不是判据没牙；
   换成朝向相位 +180° 后仍然抓不到，才确认是真盲区（§7）。
9. **`.tmp` 是共享的**：变异臂一度误删 `LAB/.tmp`（会把 playwright 安装一起删掉）；现在每个臂只删自己的 `mutate-<id>`。
10. **技能能给什么**：SKILL.md 的 WebGL1 纪律清单与 snippet 直接可用作静态断言来源（J 组）；
    但它对「多风格」「商品建模」「怎么验证像素」零覆盖——这三块本轮全靠自建，别指望技能本身。

## 10. 已删除的一次性脚本原文

`scripts/smoke.mjs`（开发期方位扫描，产物目录不留它，`check-clean` 有闸）：

```js
// 冒烟：三页 compile + 12 方位扫一遍，检查取景（alpha 剪影不得触边）与三向核对是否闭合。
import path from "node:path";
import url from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const ROOT = path.resolve(import.meta.dirname, "..");
const LAB = path.resolve(ROOT, "..", "..");
const GL_ARGS = ["--no-sandbox", "--allow-file-access-from-files", "--use-gl=angle",
  "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const pw = require(require.resolve("playwright-core", { paths: [path.join(LAB, ".tmp", "shader360", "node_modules")] }));
const browser = await pw.chromium.launch({ executablePath: pw.chromium.executablePath(), args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => console.log("pageerror:" + e.message));
await page.goto(url.pathToFileURL(path.join(ROOT, "preview", "showcase-vitrine.html")).href, { waitUntil: "load" });
await page.waitForTimeout(600);
const rows = await page.evaluate(() => {
  const mz = window.__mz;
  mz.setFrozenTime(0);
  const out = [];
  for (let az = 0; az < 360; az += 30) {
    mz.setView(az, 8);
    mz.renderNow(0);
    const m = mz.measureNow();
    const t = mz.projectTipNow();
    out.push({ az, area: m.area, bbox: m.bbox, bandCx: m.band && m.band.cx, tipX: t && t.x, anchor: m.band ? ((m.band.cx - m.W / 2) / (m.W / 2) > 0.06 ? "R" : (m.band.cx - m.W / 2) / (m.W / 2) < -0.06 ? "L" : "C") : "-" });
  }
  return out;
});
for (const r of rows) {
  const touch = r.bbox.minX <= 0 || r.bbox.maxX >= 419 || r.bbox.top <= 0 || r.bbox.bottom >= 419;
  console.log([r.az, r.area, JSON.stringify(r.bbox), r.bandCx, r.tipX, r.anchor, touch ? "TOUCH-EDGE" : ""].join("  "));
}
await browser.close();
```

它的每一次扫描后来都被 `check-browser.mjs` 的 `sweep.*` 组接管（12 方位 + 镜像恒等 + 触边 + 三向核对），
所以删除不丢判据。

## 11. 判定与下一步

- **技能评价**：留用。第 2 次通过（第 1 次 = 18:00 展览页）。相对第 1 次，本轮新增的贡献是
  「**变体轴 = 视角**」这套判据：镜像恒等式、解析投影 vs 像素质心的同像素核对、假 360° 抓法（M-fake360 红 18 条）。
  它不适合单独承担视觉设计，适合当「必须先过 GPU 编译才有画面」这类产物的载体。
- **场景评价**：商品 360° 是 WebGL 技能目前最好的验收场——它有天然不变量（对称、投影、旋转闭合），
  断言可以写成恒等式而不是阈值，`readPixels` 的 alpha 又白送一个轮廓真值。
- **给下一轮的候选**（按优先级）：
  1. 分区门控探针 `uZoneDebug` + 同方位双帧差分，把 §7 两条盲区变成有牙判据（做完就把臂上的 `blind` 摘掉）；
  2. 把本轮「θ 与 180−θ 镜像恒等」的配方搬给任何带旋转/对称的产物（build-game 轮次的相机同样适用）；
  3. `next_candidates` 里剩下的 ★：`audio-editing-automation × 有声产物`（技能×技能接缝）。
