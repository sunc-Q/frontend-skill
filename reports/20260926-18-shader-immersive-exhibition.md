# 2026-09-26 18:00 轮 · shader × 沉浸式展览页（「着色器真的在画」只能看像素）

- 轮次编号：`20260926-18`（产物目录 `artifacts/20260926-18-shader-gallery/`，台账 `20260926-18-shader-exhibit`）
- 技能：`shader`（本机只读快照已随仓库入 `skills/shader/`，23 文件 / 108KB，SKILL.md sha1 前 12 位见 `skills/MANIFEST.json`；源路径 `~/.qoder-cn/skills/shader`）
- 场景：虚构沉浸式展览页「回声的形状 ECHO SHAPE」（屿光美术馆 第三展厅，五件实时生成图像装置）
- 三风格：液态铬面 liquid-chrome / 栅格磷光 crt-plasma / 丝绸极光 silk-aurora（三个中文名 + slug 均为本轮新面孔，台账 `used_styles` 原 66 项无一冲突）
- 结果：**成功，留用**。产物 3 份单文件 HTML，双击即开，零外链；静态断言 check-node 282 条 + 真浏览器断言 check-browser 91 条全绿，变异 12 例全部被抓且点名，还原后复跑无残渣。

---

## 1. 为什么是这一组（选题依据）

`state/state.json` 的 `tried` 里 shader 从未出现（快照：22 条已试组合，无一条含 `shader ×`），`state/next_candidates` 也没有它——它是 `skills_seen` 里「本机其他候选（未试）」那一条。选它的理由不是补清单，而是这个技能**全部条款都关于「画出来了没有」**：`references/black-screen-checklist.md`、`Guardrails` 里的「最小可工作着色器」「不要假设 WebGL2」「性能建议除非知道真机就只给方向」，全是可机检句式。

关键在于：**这些断言一条都不能靠 DOM 或读代码验证**。页面里放一个 canvas，DOM 上看不到着色器是否在跑、uniform 是否真进了 GPU、三个视口是不是真的算了三种东西。唯一判据是 `readPixels` 拿到的真帧像素。所以本轮把全部验证重心压在像素侧，并把技能自带的 6 段 snippet 也在真 GL 上下文里编译一遍——这是前 21 轮没有过的判据类型（此前最多到「渲染出的几何/布局」）。

场景选展览页：它天然要求「一块实时着色器背景 + 压在上面仍可读的正文」，把技能条款里最容易被糊过去的两件事（着色器是否真的响应输入、正文对比度是否被活动背景吃掉）逼到必须量。

## 2. 技能条款清单与本轮落地

技能给的是一页**工作流 + CLI + 资产清单**（不是设计规范），逐条对应到本轮判据（A 组 20 条专管技能自己的契约，C 组 75 条管条款落进代码）：

| 技能条款（原文要点） | 本轮怎么兑现 | 落点 |
| --- | --- | --- |
| 先锁运行时：ShaderToy / 裸 WebGL / Three.js / R3F / postprocess | 锁死「裸 WebGL1 + GLSL ES 1.0 + 全屏 fragment」，并断言三份着色器都不许出现 `#version 300 es`、`in vec2`、`out vec2`、`texture(` | `C/no-webgl2-syntax:*`、`C/glsl-inlined:*` |
| `Do not assume WebGL2 unless the host clearly uses it` | 宿主只 `getContext("webgl")`，浏览器侧断言运行时 `glVersion === "webgl1"` 且帧缓冲非空；降级臂 `?probe=nogl` 必须给出可读的静态替代 | `J/webgl1-only:*`、`K/nogl-fallback` |
| 主机 uniforms 用 `uTime/uResolution/uMouse/uTexture` | 六个 uniform（含自加的 `uScroll/uVariant/uOrigin`）逐个断言：声明了、`getUniformLocation` 非 null、每帧真传值 | `J/uniform-locations:*`、`C/uniform-*` |
| 从可见基线开始，一次只加一个运动项 | 纯色基线臂 `?probe=solid`：同一份宿主换成 `gl_FragColor=vec4(常数)`，整帧 σ 必须塌到接近 0，用来证明「信号来自着色器而不是页面自身」 | `K/solid-baseline-flat`、`J/frame-has-signal:*` |
| 黑屏/全白先查清单（`black-screen-checklist.md`） | 不做文字复述，改成像素判据：帧内有信号（σ、p99.5−p0.5）、控制台零 error、`gl.getError()==0`、buffer 非空 | `J/console-clean:*`、`M/snippet-compiles:*` |
| 匹配宿主而不是想法来源（ShaderToy→WebGL 翻译） | 三份着色器全部用 `gl_FragCoord.xy - uOrigin` 起手，而不是直接吃画布坐标（见 §6，这是本轮真发现的坑） | `C/fragcoord-uses-origin:*` |
| 性能建议「除非知道真机只给方向」 | 本轮全部跑在 SwiftShader 软件渲染上，帧率**只记录不结论**（5.6 / 18.9 / 8.9 fps 是软件光栅器的读数，不是 GPU 结论） | `metrics.softFps` 只进对照页，不进任何断言 |

技能自带的 6 条 CLI 命令本轮全部真跑（`scripts/cli-probe.mjs` → `evidence/cli-probe.json`）：`intake / debug / effects / boilerplate / snippet / demo / scaffold` 共 7 个 advertised 子命令、文档示例逐条执行、退出码记录。资产清单 8 模板 / 6 snippet / 5 reference **全部存在**，磁盘上也没有未登记的资产（`A/disk-assets-fully-documented = 0`）——这是历轮少见的「契约完全兑现」，但见 §7 的四处内部缺陷。

## 3. 调用方式

装法：本轮用的是用户已装入 `~/.qoder-cn/skills/shader` 的技能，零安装步骤（不需要 npm/pip）。调用面两条腿：

```bash
node ~/.qoder-cn/skills/shader/scripts/shader.js intake "three fullscreen webgl1 background shaders for an exhibition page"
node ~/.qoder-cn/skills/shader/scripts/shader.js snippet ripple        # 指向 assets/snippets/ripple.md
node ~/.qoder-cn/skills/shader/scripts/shader.js demo webgl ripple
node ~/.qoder-cn/skills/shader/scripts/shader.js scaffold postprocess scanline
```

真正可用的部分是**纯文本资产**：`snippet`/`boilerplate` 输出的是可直接粘进 `main()` 的 GLSL ES 1.0 片段（`// snippet:` 标记），`demo`/`scaffold` 输出的是模板文件路径。本轮逐字复用了 3 段屏空间 snippet（`ripple`、`scanline`、`pixelate` 在 crt-plasma 里逐字出现，`C/snippets-verbatim-set` 断言恰好这个集合），另外 3 段（`fresnel`、`dissolve`、`vertex-wobble`）需要法线/网格/顶点阶段，全屏 fragment 宿主不适用——这条判据不是「没用就不管」，而是显式断言「不适用的确实没被硬塞进去」（`C/snippet-applicability:*`）。6 段全部在真 WebGL 上下文里编译 + 链接 + 与「换成常量」的对照臂比像素（`M/snippet-compiles:*`、`M/snippet-mutates-frame:*`，91 条浏览器断言里占 12 条）。

## 4. 产物：一份事实源、一个宿主、三份皮肤

同一份 `src/facts.json`（展览标题/展期/五件作品/三个空间/票价/注意事项）、同一份 `src/host.js`（哨兵 `==SHARED-HOST-BOUNDARY==` 之后的共享段三份产物逐字相同）、同一套 DOM（`B/dom-identical-across-styles`：三份的标签序列完全一致），差异只允许出现在 `src/css/skin-*.css` 的 `:root` 令牌与 `src/shaders/*.glsl`：

| 风格 | 技法（取自着色器自己的 `// 技法：` 行） | GLSL | 产物 |
| --- | --- | --- | --- |
| liquid-chrome | fbm 三层域扭曲 + 铬面高光，冷金属镜面流动 | 82 行 | liquid-chrome → 38,341 字节 |
| crt-plasma | plasma + 像素量化 + 扫描线，CRT 磷光栅格 | 88 行 | crt-plasma → 39,017 字节 |
| silk-aurora | fbm 丝带（到扭曲曲线的距离场）+ 余弦调色板 + 加法干涉，亮底低对比 | 80 行 | silk-aurora → 38,180 字节 |

三份都是单文件（着色器源码以 `JSON.stringify(...).replace(/</g,"\\u003c")` 内联），`<style>` 是 base.css + skin 的拼接，页面里出现的每个数字（票价、面积、密度、导览合计、参观日数）都由 `src/facts.json` 现算，产物中不含手写常量（E 组 16 条把每个数字反解回事实源重算）。产物在 `preview/exhibit-<style>.html`，对照页在轮次根 `styles.html`。

## 5. 发现一：像素判据里「平均值」是坏判据，必须逐像素比

最初 `strip-variants-distinct`（三带是否真在算三种东西）用的是三条带平均亮度之极差 > 阈值，结果 crt-plasma 假失败：它的三个变体把能量在不同空间频率间搬运，**均值几乎不变**（极差 0.4），像素却大面积不同。这不是产物缺陷，是判据选错。

定稿口径：把时钟冻在某一帧（`?probe=frozen` + `setPaused(true)` 真的停住 `state.time`），对三条带各取 201 个采样点做**逐像素**比较，要求任一对改变比例 > 25%；同时配一条反向臂 `?probe=samevariant`（宿主把变体轴恒置 0），要求它既均值不动（极差 ≤ 0.5）**又**逐像素几乎不变（≤ 2 个点）。指针与滚动同理，全部在冻结时钟下测，否则「两帧之间本来就不同」会把一切淹掉。

## 6. 发现二：`gl_FragCoord` 是画布坐标——一个画布多视口必须自带原点

为了省掉「三个 canvas 三次合成」，宿主用**一个全屏画布 + `gl.viewport(x,0,w,h)` 画三次**。三份着色器最初的写法是标准的 `vec2 p = gl_FragCoord.xy / uResolution.xy;`，实测发现三条带的平均亮度完全相同——因为 `gl_FragCoord` 是**整张画布**的坐标，每个视口里传同一份 `uResolution` 时，三条带算的是同一张图的三段裁片，而不是「同一个程序算三种变体」。

修法：宿主每带额外传 `uOrigin`（该视口的窗口原点），着色器一律 `vec2 fc = gl_FragCoord.xy - uOrigin;` 起手，并传该带自己的宽高作 `uResolution`。这条不是理论推出来的，是被 M3 变异钉死的：把 `gl.uniform2f(locations.uOrigin, x, 0)` 偷偷改成 `(…, 0, 0)`，`K/samevariant-flattens-strip` 立刻红（201/201 采样点变成同一张画），证明这个传参在像素层面确实有作用。**技能资产里没有任何一处提到这个坑**——`assets/webgl-fullscreen-demo` 只有一个视口，`references/glsl-quick-reference.md` 只说「`fragCoord` → `gl_FragCoord.xy`」。多视口/分屏/一图多画是展览页与仪表盘背景的真实形态，值得技能补一段。

## 7. 发现三：技能 CLI 自身有四处可机检缺陷

这些都不影响它的文本资产，但「文档承诺 = 实际行为」这条契约有缺口（A 组逐条断言其存在性，将来技能修好后这些断言会红，属于**故意反着写**的看门狗）：

1. `scaffold postprocess pixelate` 返回的 effect 是 `scanline`（`A/scaffold-aliases-pixelate-to-scanline`）——别名表里 pixelate 被映射错了。
2. `effects` 的短语→技法矩阵对 `webgl fullscreen` 这一行的命中数为 0（`A/webgl-fullscreen-demo-unreachable-by-own-router`）：技能自带的 8 个模板里，`webgl-fullscreen-demo` 无法被自己的路由器选中，只能靠 `demo webgl <effect>` 显式点名。
3. `boilerplate` 里 material 分支有一处死三元：两侧字符串完全相同（`A/dead-ternary-in-material-branch`，实测 left == right == `assets/threejs-material-demo/index.html`）。
4. 覆盖面缺口：`boilerplate`/`snippet` 对 `gradient`、`noise`、`fbm` 直接退出码 1（pixelate 只有 boilerplate 缺，snippet 有），而 SKILL.md 的 Common Uses 明写了 `gradient`、`noise`——文档承诺了实现没有的键（`A/boilerplate-coverage-gap`、`A/snippet-coverage-gap`）。
5. 另记两条环境事实（不算缺陷）：`scripts/shader.js` 未在 SKILL.md 的 Scripts 清单里单列（`A/script-count` 只报数量不报路径）；`assets/threejs-material-demo` 依赖 `https://unpkg.com/three@0.176.0/...`（双击不可离线用），`assets/r3f-demo` 需要 vite 起服务（本机 GitHub/npm 直连被 TLS 重置，这类模板本机不可验证，见 `environment_notes`）。

## 8. 发现四：三份产物互比抓不到「三份一起改」，必须加 src ↔ 产物漂移闸

M2 变异第一次跑就钻过去了：把 `--accent` 在**色板源文件**里改成与另一风格相同的橙，`D/palette-disjoint` 抓到 ✓；但只在**产物**里改（模拟直接编辑交付件），两套校验当时全绿——因为 B 组全部是「三份产物互比」，三份一起改（或只改一份的源外副本）在互比里是**不可见的**。

补两条闸（`B/css-source-inlined:*`、`B/host-source-inlined:*`）：产物 `<style>` 必须逐字包含 `src/css/base.css` + 对应 skin，哨兵之后的共享宿主段必须与 `src/host.js` 逐字一致。M2b（只改产物 accent）与 M3b（三份同时各加一句注释）现在分别点名为这两条抓住。第一版写成 `PAGES[s].includes(hostJs)` 造成 3 条假失败——因为 `host.js` 哨兵之前有 `{{STYLE_NAME}}`/`{{PALETTE_JSON}}`/`{{SHADER_SOURCE_JSON}}` 槽位，只有哨兵之后的共享段才是逐字内联的。

## 9. 发现五：对照页的每个数字都要能复算（本轮新工具）

对照页 `styles.html` 是「给人看的读数表」，也是最容易撒谎的地方——上一轮就撞过「生成器里手写死的文案和被生成的东西互相矛盾，结构校验全绿也抓不到」。本轮把它做成机制：

- `scripts/make-styles.mjs` 每次取数都调 `fixed/int/grouped/diff/minOf/verbatim/joined/stripped`，这些函数在返回渲染值的同时往 `evidence/styles-numbers.json` 追加一条 `{rendered, op, digits, source:{file,path}, operand}`；技法一句话、snippet 名单、色板 hex 都从 `src/` 现取（连 `// 技法：` 行都是解析出来的，脚本里不再有任何描述性数字）。
- `check-node.mjs` 的 **N 组 17 条**当第二双眼睛：拿 `path` 指针（自写小语法：`prop` / `prop[0]` / `prop[key=value]` / `prop[key~value]` / `prop[key]` 真值过滤）重新读源文件、重算换算，逐条比对 `rendered`；再反向扫页面测量区（`<li>` 与 `<td class="m">`），把溯源里出现过的字符串先挖掉，剩下的数字必须为 0 个。
- 两个副作用立刻出现：① 断言「页面上没有第二个数字来源」第一次变成可机检的（每条溯源都要能按指针复算，5 个源文件各自一条 `N/provenance-resolves:<file>`）；② 自指出现——页脚最初写「check-node 通过 X/总 Y」，而 X 会被这次运行自己改变，导致**奇偶振荡**（绿→红→绿交替）。修法是把通过数从引用里去掉，只留与引用无关的总数（总数只随代码组成变化，不随通过/失败变化，有不动点）。这条已进 `environment_notes` 素材。
- 第三个坑是**总数也会随台账写回而变**：I 组原本只在写回后才追加 3 条（字段完整 / 报告存在 / run 已链接），于是「278 条」在写回那一刻要多出 3 条，页脚与报告里刚抄进去的数字当场变成假话——而这一条 R/N 组都救不了，因为红的是「写回之后」那一遍。改法和 R 组对未写出报告的处理同口径：**断言恒存在，未写回时按 pending 通过**，总数只由代码组成决定，这样 282 是写回前后的同一个不动点（本轮改完后总数只随代码组成变化）。这也是 verify 顺序里「第 7 步重生成 → 第 8 步终局闸」真正的价值：它把「谁改了总数」这件事变成 machine-checked，而不是靠我记得。
- **集合判据有个洞，M9 亲手演示了一遍**：反向扫描只问「这个数在不在溯源集合里」，而对照页把变异表逐行转录进了测量区，注入原文「内联色板 12 项」因此自己成了合法溯源值。补的判据是位置绑定：`make-styles.mjs` 末尾用与 check-node 同一套正则把本次生成的全部测量区（本轮 81 个：30 个 `<li>` + 51 个 `<td class="m">`）快照进 `evidence/styles-regions.json`，`N/regions-match-generation` 从盘上的页面再取一遍、逐区比字节——手改一格文字就红，且不受像素噪声影响（详见 §11 M9）。两处正则必须同步，注释里已互相点名。
- 报告本身也被拉进同一判据：最后一组 R 组（1 条）要求 `reports/20260926-18-...md` 里逐字出现三份产物的字节数、两套断言总数与变异例数——人写的报告与盘上产物不同源就红。

## 10. 三风格实测一览（无头 Chrome 1148 + SwiftShader，软件渲染）

> 本节由 `.tmp/shader-report.mjs` 从 `evidence/check-browser.json`（`2026-09-26T13:29:55.185Z` 那一跑）整段生成，
> 不是手抄——软件渲染的读数每轮都漂，手抄的那张表在最后一次 verify 之后就已经是旧数据。

| 维度 | liquid-chrome | crt-plasma | silk-aurora |
| --- | --- | --- | --- |
| 整帧平均亮度 / σ | 67.51 / 28.79 | 46.70 / 42.04 | 193.69 / 29.28 |
| 动态范围 p99.5−p0.5 | 128.9 | 201.9 | 170.5 |
| 三带 uVariant 逐像素改变（/201） | 201 / 200 / 201 | 182 / 186 / 191 | 142 / 156 / 156 |
| 指针响应改变像素（/201） | 171 | 159 | 161 |
| 滚动响应改变像素（/201） | 201 | 86 | 163 |
| 软件帧率 / 每帧 | 5.6 fps / 229.8ms | 18.9 fps / 52.9ms | 7.8 fps / 124.8ms |
| 最坏正文对比度（压活着色器 + 衬底） | 7.31:1 | 6.59:1 | 5.09:1 |
| 逐段对比度最低项 | facts-dt 7.31 | work-rule 6.59 | work-rule 5.09 |

三套的「方向」互斥且可测：liquid-chrome 最均匀（σ 28.79）压深底亮字，silk-aurora 是亮底（均值 193.7）压深字，动态范围最大的是 crt-plasma（201.9，它把画面切成量化色阶）。本轮最低正文对比度 5.09:1（silk-aurora 的 work-rule）——没有靠提高衬底不透明度去凑数，而是**报告出来**并单独配一条消融臂 `K/scrim-works`（同一段正文：有衬底 13.85:1 vs 去掉衬底 4.08:1），把「L 组的对比度确实是衬底给的」量清楚，而不是让读者去猜。指针/滚动两条响应用 `?probe=nomouse` / `?probe=noscroll` 做隔离对照。1280 与 390 两个宽度下三份产物均无横向溢出、无死选择器（`J/no-h-overflow:*`、`J/no-dead-selectors:*`）。

## 11. 变异测试：变异 12 例全部被抓且点名

`scripts/mutate.mjs` 注入缺陷 → 跑双套 → 立刻还原 → 记录「哪几条断言红了、FAIL 行有没有点名」。值变异 4 + 结构变异 7 + 语义变异 1：

| 用例 | 注入 | 抓到它的断言 |
| --- | --- | --- |
| M1 值/node | 产物里把「面积合计 390 ㎡」手改成 360 | `E/text-present:*` + `B/dom-identical` |
| M2 值/node/src+重建 | 色板源文件把 liquid-chrome 的 `--accent` 改成与 crt-plasma 同色 | `D/palette-disjoint`（点名交集 hex） |
| M2b 结构/node | 只改产物里的 `--accent`（源不动） | `B/css-source-inlined`（§8 补的闸） |
| M6 值/node | 内联 GLSL 顶部塞 `#version 300 es` | `C/glsl-inlined` |
| M3 结构/browser | `uOrigin` 恒传 0（三带退化成裁片） | `K/samevariant-flattens-strip` |
| M4 结构/browser | 变体轴恒置 0（一个程序三种密度变假话） | `J/strip-variants-distinct`（0/204） |
| M5 结构/browser | 删掉 `gl.uniform1f(locations.uScroll, …)` | `J/scroll-uniform`（0/201） |
| M3b 结构/node/三份同改 | 三份产物各加一句注释 | 只有 `B/host-source-inlined`×3（互比全绿） |
| M7 结构/browser | 删掉 `.hero-inner` 的衬底声明 | `L/contrast-live` + `K/scrim-works` + `B/base-css-identical` + `B/css-source-inlined` |
| M8 结构/node | 只给一个风格加一段 `<p>` | `B/dom-identical-across-styles` |
| M9 值/node | 对照页里把「内联色板 10 项」手打成 12 项 | `N/regions-match-generation`（区间快照，见 §9） |
| M10 语义/node | 在着色器 `// 技法：` 注释里加没实现的 fresnel | `N/provenance-resolves:silk-aurora.glsl` + `C/glsl-inlined` |

M9 吃了两次教训，都写进了用例注释：① 锚点原本写死实测值 `>7.30:1<`，下一帧漂成 7.32 就「锚点未命中」——**用例自己也会过期**，故改用稳定整数（10 项，且 D 组断言三套各 10 色）。② 判据原本指望 `N/page-numbers-traceable`（「页面测量区里的数字必须能在溯源集合里对上」），第四次 verify 它当场放行：对照页会把变异表逐行转录进测量区，而变异表里就带着本例的注入原文「内联色板 12 项」，于是 12 成了一个合法溯源值——**用例把自己的判据缴了械**。集合判据只能问「这个数在不在证据里」，问不出「这个位置上的这个数是不是生成器当次放的那个」，所以补了 `N/regions-match-generation`：`make-styles.mjs` 末尾用与 check-node 同一套正则把本次生成的 81 个测量区快照进 `evidence/styles-regions.json`，check-node 从盘上的页面再取一遍逐区比字节。注入 12 后那一区文字与快照不符，红得点名且与像素噪声无关（集合判据那条反而依赖当轮巧合，快照判据不依赖）。
M10 是本轮唯一「语义变异」：它不改任何行为，只让文案说代码没做的事，正是上一轮靠人眼才发现的那类缺陷，现在有机器判据（`N/provenance-resolves:silk-aurora.glsl` 复算 `// 技法：` 行 + `C/glsl-inlined` 比产物与源）。

`mutate.mjs` 还原后的最后一遍会容忍 `N/provenance-resolves` / `N/page-numbers-traceable` 的红（本脚本自己刚刷新了像素 evidence，对照页要到下一步才重生成），并把这些红如实写进 `evidence/mutation.json` 的 `restored.tolerated_page_freshness`，页面数字真正的闸在 verify 第 8 步。

这个容忍本身是第三次 verify 跑出来的 bug：容忍算出来了、也写进 evidence 了，**但退出码仍然按原始失败数判**，于是 verify 第 6 步以「变异测试：1 项不合格」中止——而 mutation.json 里 `node_pass` 明明写着 true。两个口径打架时，脚本自己的 summary 才是真相，判据与退出码必须共用同一个变量（`if (!nodeClean …)`），否则「已解释的红」和「真残渣」在流水线里等价。修好后同一条日志会直接写明「仅 N 条页面新鲜度红，下一步重生成即消」。

## 12. 从零复现

前置：macOS/Linux + Node 20+；浏览器侧需要 playwright-core 与已缓存的 Chromium（本机装在 `前端skill实验室/.tmp/shaderbuild/`，见 §13 的清理说明——它被本轮清理删掉了，重跑前需装回）。

```sh
cd 前端skill实验室/artifacts/20260926-18-shader-gallery
npm --prefix ../../.tmp/shaderbuild i playwright-core@1.49.1 pngjs@7.0.0 --registry=https://registry.npmmirror.com
sh scripts/verify.sh          # 约 8 分钟；全绿退出码 0
```

`verify.sh` 九步，**顺序是有因果的**（脚本头部注释同样写了）：

1. `build.mjs`：`src/` 组装出三份 `preview/exhibit-*.html` + `scripts/build-sizes.json`；
2. `cli-probe.mjs`：把技能 7 个子命令真跑一遍，读数落 `evidence/cli-probe.json`（A 组读它）；
3. `check-browser.mjs` 第一遍：真帧像素 + 10 条对照臂 + 6 段 snippet 真编译（91 条，约 60s）；
4. `make-styles.mjs`：按当前 evidence 生成对照页与 `evidence/styles-numbers.json`；
5. `check-node.mjs`：静态 282 条（含 N 组复算 + 区间快照比对）；
6. `mutate.mjs`：12 例注入 + 逐例还原 + 复跑；
7. `make-styles.mjs` 第二遍：拿 mutate 还原后的 evidence 重生成对照页；
8. `check-node.mjs` 终局闸：页面每个数字都要能按指针现算出来；
9. `check-clean.mjs`：磁盘纪律 + 凭据形状扫描（7 条）。

软件渲染读数只用于「相对差异 + 有无信号」判据，不作性能结论（技能 `Guardrails` 最后一条自己就这么要求）。

## 13. 清理、被删临时件与体积

本轮目录文件字节合计 444KB、31 个文件（≤50MB 上限），零 `node_modules/`、零 `dist/`、零 `*.log`、零空目录、白名单之外零文件、产物零外链、引用零断链、凭据形状扫描零命中（`scripts/check-clean.mjs` 7 条）。仓库内 `.gitignore` 已排除 `node_modules/ .tmp/ dist/ *.log`。

删除的一次性件（内容按要求转录）：

- **`.tmp/shader-report.mjs`（本轮收尾用，把 §10 整节与 §13/校验卡的体积读数改成与 evidence 同源）**：读 `evidence/check-browser.json` 生成 §10 的八行表 + 结论段，并按 `[^（]*（≤50MB 上限）` 与「check-clean | 7 | 体积」两处锚点替换目录字节数与文件数。它跑一次即失效（原地改 md，重复跑只会用同一份 evidence 再写一遍同样的话），故删。**它最值得留的是三条 guard 而不是排版**：① 取不到 `K/scrim-works` 的「有衬底 X:1 / 去掉衬底 Y:1」两个读数就 throw；② 动态范围冠军若不是 crt-plasma 就 throw——因为紧跟其后的那句解释「它把画面切成量化色阶」只对这一套成立，读数漂了宁可让脚本判红，也不让人话跟着搬家；③ σ 最小与均值最大必须分别是 liquid-chrome / silk-aurora，同理。模板里凡「谁最 X」的排序都提成了具名变量（`flattest/brightest/widest/lowest`）再判，不在插值里现算——现算的那份没法 guard。
- **`.tmp/shader-ledger.mjs`（台账写回，见 §15）**：同样零手打——目录字节/文件数递归现算，断言分组条数从 `evidence/check-node.json`、`check-browser.json` 的 `results` 现算，变异例数与三类占比从 `evidence/mutation.json` 现算，溯源条数与区间数从 `styles-numbers.json` / `styles-regions.json` 现算，技能快照的 `files/bytes/skill_sha1` 从 `skills/MANIFEST.json` 现取，衬底消融臂直接把 `K/scrim-works` 的 detail 原文嵌进行文本。入口有幂等闸：`state.tried` 里已有 `shader` 开头的条目就打印一句「写回只做一次」退出，所以重复跑不会写两行（I 组那条断言正是查这个）。
- **`.patch1.mjs`（104 行，本轮用来给 check-node 打补丁，补丁结果已进代码，脚本本身无保留价值）**，它做的 9 处替换：① 加 `stripSlashes/stripCssComments` 并把 GLSL/CSS 条款改跑在去注释文本上（历轮教训：注释里写着「用了 texture()」会让判据假绿）；② 修正 r3f 模板判据（从「文件存在」改成「`<script src="/main.jsx">` + vite dev + @react-three/fiber 依赖」三条同时成立）；③ charset 判据改成允许 `<meta charset="UTF-8" />`；④ uniform 使用判据从 `\bU\b(?!\s*;)` 改成剥掉 `uniform` 声明行后直接查引用；⑤ snippet 判据从「逐字复用与否」改成「三段屏空间技法必须逐字复用 + 三段需网格法线的确实没被硬塞」；⑥⑦ 色板判据改成剥掉所有注释与所有 `:root` 块后再查外部字面量；⑧ 台账健康从「零欠账」改成「与写回前快照比对，不新增欠账」（他人轮次字段缺失不由本轮代改）；⑨ reports/ 形态从「必须是文件」改成「本轮不新增目录」。
- **`.tmp/shaderbuild/smoke.mjs`（本轮第一版像素探针，55 行）**：起 chromium（`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`），逐风格 `page.goto(pathToFileURL(...))`，读 `window.__shaderProbe` 的 `frames()/time()/info()/stats("fx",0)/stats("strip",0..2)`，打印 `gl` 状态（compiled/linked/nullLocations/glError/buffer）、每带 mean/σ/p05/p995/meanRgb 与控制台消息。它的判据版已全部固化进 `scripts/check-browser.mjs`（含冻结时钟、逐像素 diff、对照臂），故删。转录如下（保留原样以便后续轮次起手复用）：

```js
import { createRequire } from "node:module";
import path from "node:path";
import url from "node:url";
const require = createRequire(import.meta.url);
const NM = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "node_modules");
const { chromium } = require(require.resolve("playwright-core", { paths: [NM] }));
const ART = "<产物目录绝对路径>";
const styles = process.argv[2] ? [process.argv[2]] : ["liquid-chrome", "crt-plasma", "silk-aurora"];
const query = process.argv[3] || "";
const browser = await chromium.launch({
  executablePath: chromium.executablePath(),
  args: ["--no-sandbox", "--allow-file-access-from-files", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const msgs = [];
page.on("console", (m) => msgs.push(`${m.type()}:${m.text()}`));
page.on("pageerror", (e) => msgs.push("pageerror:" + e.message));
for (const style of styles) {
  await page.goto(url.pathToFileURL(path.join(ART, "preview", `exhibit-${style}.html`)).href + query, { waitUntil: "load" });
  await page.waitForTimeout(600);
  const info = await page.evaluate(() => {
    const p = window.__shaderProbe;
    if (!p) return { missing: true };
    return { style: p.style, frames: p.frames(), time: p.time(), info: p.info(),
      fx: p.stats("fx", 0), strip0: p.stats("strip", 0), strip1: p.stats("strip", 1), strip2: p.stats("strip", 2) };
  });
  console.log("#####", style, JSON.stringify(info, null, 1));
  console.log("  msgs:", JSON.stringify(msgs.slice(0, 6)));
}
await browser.close();
```

- `src/styles/`（空目录，早期规划的第四份皮肤未做，rmdir）；`.tmp/shaderprobe/*.txt`（7 个 CLI 输出副本，内容与 `evidence/cli-probe.json` 重复，删）；`.tmp/shaderbuild/`（9.0MB：playwright-core + pngjs + package-lock，属构建缓存，按规程删——代价是复现前要先跑 §12 的 `npm i`，已写进本文档）。**未动**其他会话留下的 `geo-*.json`、`probe*.mjs`、`chrome-profile/`、`.tmp/known_hosts`。

## 14. 留用判断与后续

**留用，评级「核心（像素型判据的唯一来源）」**。理由：① 它的文本资产（6 段 snippet、`glsl-quick-reference`、黑屏清单）在本轮全部经真 GL 验证可用，3 段逐字复用零改动；② 它的 `Guardrails` 是可机检句式而不是口号，本轮 75 条 C 组断言几乎逐条对应；③ 缺陷集中在「CLI 的路由与覆盖面」（§7 五条），不影响拿它写着色器，且都是可回报的小洞。它不适合单独承担「多风格设计」任务——技能完全不管视觉与排版，本轮的皮肤差异全部来自自建 CSS 令牌纪律。

后续（已进 `next_candidates`）：

- 把 §6 的 `gl_FragCoord` 画布坐标坑回报给技能（补 `references/` 一段：多视口/分屏时的原点与每带分辨率），并加一条 `uOrigin` 消融臂为跨轮固定判据；
- shader × 音乐/音频可视化（需要 `AnalyserNode` 真实频谱喂 uniform，是第一个「外部数据驱动着色器」的场景，能把 `uAudio` 这类自定义 uniform 的传参纪律逼出来）；
- shader × 商品 360° 展示（变体轴 = 视角，可以把「一个程序多变体」做成可旋转的硬判据）；
- 技能 CLI 的 pixelate 别名与 effects 矩阵命中 0 两条，适合直接给上游提 issue（本轮 A 组断言可当复现脚本）；
- 台账卫生既有欠账（他人轮次）本轮只报告未代改：`tried[10]/[11]` 缺 `report`、`tried[13]` 缺 `time`，`reports/` 下仍有 1 个目录形态条目。

## 15. 台账写回、技能快照与推送

写回由 `.tmp/shader-ledger.mjs` 完成（转录见 §13），全部读数现算：`state.json` 的 `tried` +1、`runs` +1、`used_styles` +3、`environment_notes` +6、`next_candidates` 换成本轮 7 条、`updated` 记本轮槽位时间；`records/work-log.md` 追加一行（六段竖线分隔，含本轮 `20260926-18-shader-exhibit` 口径的产物路径与结论）。写回后再跑一遍 `check-node`，I 组那 11 条从 pending 变成真判：`tried/runs/used_styles` 的增量、工作日志行数、`tried` 字段完整性、报告文件存在、run 已回填体积与清理，全部与写回前快照 `scripts/ledger-snapshot.json` 对齐——**快照只在写回前取一次，写回后不许重取**，否则幂等闸自己就被自己骗过去。

技能快照：`skills/shader/` 23 文件（只读，含 SKILL.md、scripts/shader.js、6 段 snippet、5 份 references、5 个模板目录），`node scripts/gen-skills-manifest.mjs` 重新生成 `skills/MANIFEST.json` 与 `skills/README.md`，本轮记 `shader sha1 前 12 位 554b0fd8c482`。

推送：本机的 github.com HTTPS 会被 TLS 重置，只走 SSH（`GIT_SSH_COMMAND` 指向 `LAB/.tmp/known_hosts`，`StrictHostKeyChecking=accept-new`），命令与文件里不出现任何 token。三段式提交：主体 `400f33a..2cfad05`（60 文件 = 产物 31 + 本报告 + work-log/state 两份台账 + skills/shader 快照 23 + MANIFEST/skills-README 登记 + `scripts/gen-skills-manifest.mjs` 的 shader 源路径）→ 补记 `2cfad05..`（run 的 `cleanup`/`push` 两格与本节段号）→ 区间定稿一段。补记之后再跑 `check-node`，总数仍是 282——这正是 §9 那条「条件性断言会让总数跳变」修好的东西：台账从「未写回」到「已写回」到「已回填」，被页面引用的总数一路不动。

### 附：本轮校验卡（读数由脚本现写，非手抄）

| 卡 | 条数 | 内容 |
| --- | --- | --- |
| check-node | 282 | A 20（技能契约）· B 43（结构不变式与 src↔产物漂移）· C 75（GLSL 条款落地）· D 43（令牌与色板）· E 16（页面数字反解事实源）· F 27（反膨胀）· G 23（响应式与减动效）· H 6（磁盘纪律 4 条 + 报告形态 2 条，只有报告已写出时才存在，故本轮定稿后恒为 6）· I 11（台账契约幂等，写回前后条数相同：未写回的 3 条按 pending 通过）· N 17（对照页数字溯源复算 + 测量区快照比对）· R 1（报告与产物同源） |
| check-browser | 91 | J 45（真帧像素与响应）· L 18（六段正文逐段对比度）· K 14（10 条对照臂）· M 14（snippet 真编译 + CLI 读数） |
| mutate | 12 例 | 值 4 / 结构 7 / 语义 1，全部被抓且点名，还原后复跑无残渣 |
| check-clean | 7 | 体积 444KB / 31 文件、无残渣、无空目录、文件全在白名单、引用可达、零外链、零凭据形状 |
