# 2026-09-26 22:00 轮 · shader × 音乐/音频可视化（「音频在驱动画面」只能靠互斥消融臂证明）

- 轮次编号：`20260926-22`（产物 `artifacts/20260926-22-shader-audio-visualizer/`）
- 技能：`shader`（第 2 次使用；本机只读快照 `skills/shader/`，23 文件 / 44KB，sha1 前 12 位 `554b0fd8c482`，见 `skills/MANIFEST.json`；源路径 `~/.qoder-cn/skills/shader`，`_meta.json` 记 owner=`jvy` / slug=`shader` / 发布 commit 指向 `github.com/openclaw/skills`）
- 场景：虚构曲目《井中月》——16 秒 / 120 BPM / 8 小节的电子曲，由 `scripts/synth-track.mjs` 用固定 seed（20260926）确定性合成为 22050Hz 单声道 WAV，再以 data URI 内联进三份单文件页面；WebAudio `AnalyserNode` 把音频变成着色器 uniform 与两张纹理
- 三风格：方格账簿 graph-ledger（colonnade）/ 井月水墨 ink-moon（ripple）/ 声纹热像 thermogram（thermal）——三个中文名与 slug 都是新面孔，台账 `used_styles` 原 69 项无冲突
- 结果：**成功，留用**。三份单文件 HTML 双击即开、零外链，各约 995KB（其中 919KB 是内联音频）；`SHADER_SKIP_BROWSER=1 sh scripts/verify.sh` 可无浏览器复现（静态判据 + 清理 + 汇总），装好 playwright-core 后跑全链

---

## 1. 为什么是这一组（选题依据）

`state/next_candidates[0]` 的 ★ 排队首选就是它，理由写在台账里：**这个技能的全部条款都在管「画出来了没有」，一句都没提「外部数据怎么进来」**。翻 `skills/shader/SKILL.md` 的输入清单，原文只到 `required inputs: uTime, uResolution, UVs, normals, textures, mouse` 为止；`references/black-screen-checklist.md` 第 4 步倒是提了一句「把 uniform 值打印到控制台」，但它给的是调试习惯，不是口径。

音频可视化恰好是「外部数据进着色器」最狠的一档：数据每帧变、变了画面就得变、而且**没人能看着一帧画面说「这是被音乐驱动的」**。上一轮（18:00 shader × 沉浸式展览页）的判据停在「着色器在跑、uniform 传到了、像素有信号」，那一整套在音频场景全部失效——画面在动不等于音频在动它，`uTime` 自己在动，页面 rAF 自己在动，宿主的历史缓冲也自己在动。

所以本轮的核心命题只有一个，并且必须做成可证伪的：**凭什么说这几张图是音频画出来的，而不是宿主自己在动画**。答案见 §5 的互斥消融臂。

## 2. 技能条款与本轮落地

| 技能条款（原文要点） | 本轮怎么兑现 | 落点 |
| --- | --- | --- |
| 先锁运行时（ShaderToy / 裸 WebGL / Three.js / R3F / postprocess） | 锁「裸 WebGL1 + GLSL ES 1.0 + 全屏 fragment」；三份着色器不许出现 `#version 300 es` / `in vec2` / `out vec2` / `texture(` | `C/*-no-webgl2-syntax`、`J1 boot` |
| `Do not assume WebGL2 unless the host clearly uses it` | 宿主只 `getContext("webgl")`；运行时断言拿到的是 `WebGLRenderingContext`（不是 `WebGL2RenderingContext`） | `J1`、`launch()` 里对上下文的显式校验 |
| 主机 uniform 命名 `uTime/uResolution/uMouse/uTexture` | 沿用这 4 个名字，另**自建 8 个音频量**：`uLevel uBass uMid uTreb uFlux uBeat uSpectrum uHistory`（外加 `uOrigin` `uVariant` 两个多变体量）；技能对后半截零覆盖，见 §8 | `B/uniform 三方纪律` |
| 从可见基线开始，一次加一个运动项 | 基线臂 `?probe=solid`（着色器换成常量品红）：整幅必须仍是那三个数 `rgb(255,0,255)`，用来证明绘制通路活着；`?probe=nogl` 证明无 WebGL 时不空白 | `L11`、`L12` |
| 黑屏/全白先查 `black-screen-checklist.md` | 不复述清单，改成像素判据：`gl.getError()==0`、`missing.length==0`、缓冲尺寸随 DPR 放大、帧内 σ 与 p99.5−p0.5 非零、控制台零 error/warning/pageerror | `J1–J4`、`N1–N3` |
| 匹配宿主而不是想法来源（`iTime→uTime`、`fragCoord→gl_FragCoord`） | 三个子视口共用一块画布，所以 `gl_FragCoord.xy - uOrigin` 起手（18:00 轮的发现，本轮直接继承并断言） | `B12`、`L16` |
| 性能建议「除非知道真机只给方向」 | 全部读数来自 SwiftShader 软件光栅器，帧率只记录不结论（`boot.frames.fps` 进产物总览页，不进任何断言） | 总览页脚注 |

技能自带的 CLI（`node skills/shader/scripts/shader.js …`）本轮**没有**当作产物来源：上一轮已经逐条跑过它的 7 个子命令并给出「文本资产可用、脚手架不可用」的结论，本轮复用该结论，只把 `snippet`/`boilerplate` 类资产当 GLSL 参考。这条复用是本轮唯一没重跑技能接口之处，其余判据全部新写。

## 3. 环境、安装与调用

技能侧零安装。校验侧需要真浏览器，装法（**这就是本轮最大的环境坑**）：

```bash
mkdir -p ../../.tmp/audiobuild && cd ../../.tmp/audiobuild
npm i --registry=https://registry.npmmirror.com playwright-core   # 装到 1.48.2
```

`playwright-core@1.48.2` 默认找 `~/Library/Caches/ms-playwright/chromium-1140`，本机只有 **chromium-1148**，`chromium.launch()` 直接报「executable doesn't exist」。`check-browser.mjs` 因此不靠默认值，改为显式候选表并逐个试启，**第一个真起出 `WebGLRenderingContext` 的才算数**，用的是哪个可执行文件写进 `evidence/check-browser.json` 的 `browser` 字段（台账里的浏览器名也从这里取，不手打）：

```
/Users/apple/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

GL 参数缺一不可：`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`（软件渲染）、`--autoplay-policy=no-user-gesture-required`（不被自动播放策略掐掉）、`--allow-file-access-from-files`（file:// 下读自己的 data URI）、`--mute-audio` + `--disable-features=AudioServiceOutOfProcess`（CI 上不出音频设备也不影响 AnalyserNode 取数）。

一键复现：

```bash
sh scripts/verify.sh              # 全链，含真浏览器取证，约 10 分钟
sh scripts/verify.sh --skip-browser   # 无浏览器依赖：合成→解析→组装→静态判据→变异→总览→清理+汇总
```

## 4. 产物：一份曲目、一个宿主、三份皮肤

事实源唯一：`src/audio-spec.json`（曲目企划 + 合成参数 + Node 侧解析出的逐事件真值）、`src/bands.js`（64 条对数带边界，浏览器与 Node 共用）、`src/features.js`（dB 窗口、带均值→粗带、通量、起拍阈值公式，两端共用）。皮肤差异只允许出现在 `src/css/skin-*.css` 与 `src/shaders/*.glsl`：

| 风格 | 着色器主张 | GLSL | 色板（进 shader 的 6 个 `--gl-*`） | 产物 |
| --- | --- | --- | --- | --- |
| colonnade 方格账簿 | 柱廊：x→频带的柱列、逐小节账簿表格压在浅纸底上 | 66 行 | `#23281f #f2efe4 #b5352b #3d6b4c #8a6a1f #2f5570` | 995,713B |
| ripple 井月水墨 | 径向外圈：底鼓推一圈涟漪，中频调墨的干湿 | 67 行 | `#050a12 #0e1420 #7fd4c1 #2f5d7a #9fb7c9 #f0e3b8` | 996,115B |
| thermal 声纹热像 | 64×128 滚动热像：x=时间、y=频带，全站等宽 + 4px 描边 | 54 行 | `#0a070c #140f17 #ff8a3d #5f2c8c #e2357a #ffd94a` | 995,087B |

调色板是**单一来源**：皮肤 CSS 里的 `--gl-*` 十六进制由 build 解析成 shader 的 `vec3` uniform，产物里出现的每个色值都必须等于 CSS 里那一个（`C` 组的条数见 §7 分组表，那张表由 `evidence/check-node.json` 的 `groups` 生成，不手打），三页色板两两零交集，另加 WCAG 相对亮度核对。想改色只能改 CSS，改不动判据。

宿主 `src/host.js`（606 行，含探针）一份，两个 canvas：主画面（1 视口）+ 分频条带（同一程序 3 个子视口，`gl.viewport` + 逐视口 `uOrigin` + `uVariant` 1/2/3）。数据通路：`AnalyserNode(fftSize=2048, smoothing=0)` → 1024 bin → 64 条对数带（`aggregateBands`）→ 粗带 `level/bass/mid/treble` + 通量 + 起拍脉冲 → 标量 uniform；同时把 64 带上传成 `64×1 LUMINANCE` 频谱纹理，并推入 `64×128` 滚动历史纹理。

## 5. 主判据：互斥消融臂对（本轮真正的方法沉淀）

单条消融臂只能证一半。`?probe=frozen`（冻住 `uTime`、音频照跑）证明「变化不全来自时钟」；但只有把 probe 做成**可逗号叠加**的列表之后，才存在 `?probe=frozen,noaudio` 这一条：时钟和音频一起拔掉，画面**必须一个像素都不动**。前者排除「是 uTime 在动」，后者排除「还有第三样东西在动」，两条一起才把「音频在驱动画面」钉死。为此宿主里所有 `probe === "x"` 比较都改成 `has("x")`。

实测（`L1–L5`，逐风格）：

- `frozen`：`uTime` 两次读数逐位相同（`time0 === time1`），但音频仍在跑、画布像素变化率 5.2% / 33.0% / 17.2%（colonnade / ripple / thermal）
- `frozen,noaudio`：`features()` 全部归零，且**变化像素恰好为 0**（`changed === 0 && meanAbsDelta === 0`，采样 1,100,800 px）

这条「恰好 0」是本轮最硬的读数：任何一处还留着 `Date.now()`、rAF 计数器或宿主自推的动画，都会让它变成非零。

其余消融臂：`noaudio`（只拔音频）、`staticspectrum`（喂与音乐无关的固定斜坡）、`mislabel`（64 带顺序反转后上传）、`samevariant`（三个子视口都发 `uVariant=0`）、`noonset`（起拍检测器不喂数据 → `uBeat` 恒 0）、`nomouse`（`uMouse` 只在初始化写一次）、`solid`、`nogl`。

## 6. 两个解析器对账（防止「浏览器自己跟自己圆」）

Node 侧另写一套完全独立的解析：`scripts/analyze-node.mjs` 手工解 WAV → Hann 窗 + 自写 radix-2 FFT → 同一条 `bands.js` 带边界 → 同一条 `features.js` 粗带/起拍公式，产出 `evidence/ground-truth.json`（逐帧真值 + 1371 帧 CSV）。浏览器侧在连续播放中采 60 点序列，对齐搜索 ±0.15s，比 Pearson 相关。

**关键口径：只断言方向，不断言等值。** Chrome 会把 22050Hz 的文件重采样到 AudioContext 的 44100Hz，用 Blackman 窗，且自带一套归一化——绝对电平实测差 0.109–0.131，比值口径也差得远（groove 低频中位数 Node 0.755 vs 浏览器 0.63；breakdown 凹陷比值 Node 0.508 vs 浏览器 0.342/0.406/0.304）。两边必须同向的只有结构事实：起拍时刻逐条匹配（35/35）、底鼓时刻低频 > 高频、breakdown 段落低频塌陷。把「等值」写进判据会得到一套永远跑不过或者永远跑不过期版本的假测试。

## 7. 判据体系与规模

| 组 | 管什么 | 落点 |
| --- | --- | --- |
| A | 构建一致性：三页 DOM 骨架同构、共享段逐字相同、单文件内联、无外链 | check-node |
| B | uniform 三方纪律：着色器声明集 == 宿主登记集 == `getUniformLocation` 非 null；`uOrigin`/`uVariant` 逐视口真的不同 | check-node + `L16` |
| C | 色板封闭（CSS 令牌 == shader vec3）、三页两两零交集、字号/圆角/描边取向、WCAG 相对亮度 | check-node |
| D | 曲目事实：BPM/小节/时长/削顶/峰值/逐小节角色、prose↔fact 绑定（`D37`） | check-node |
| E | 台账幂等：`prev 快照 + 本轮新增 == 现值`、历史条目一条不少、本轮目录名同时出现在 work-log 末行与 `runs` 末条 | check-node |
| F | 仓库契约：技能快照、目录只有可直开产物、单页体积、总额 50MB、内联音频与 Node 真值同字节（sha256） | check-node |
| J | 真浏览器启动：boot ok、`missing==0`、`glError==0`、DPR 缓冲、fftSize 2048、smoothing 0、`ctxState=running`、数据 URI 音频 | check-browser |
| K | 两解析器对账：相关 r、对齐偏移、起拍匹配、窗口口径下的凹陷 | check-browser |
| L | 消融臂像素判据：`L1–L5` 互斥对、`L6` 反转臂可跑、`L7/L8b` 确定性臂、`L8a` 主画面反转、`L9` 逐视口 `uVariant` 登记值、`L10` 假频谱脱钩、`L11–L16` solid/nogl/noonset/nomouse/uOrigin | check-browser |
| M | 三风格真机指纹：背景/字体族/圆角/大写/描边宽度互异、无横向溢出（1280 与 390 两档）、真机层叠后的对比度与字号 | check-browser |
| N | 零跨源请求、控制台零消息、音频时长与合成事实一致 | check-browser |
| G | 总览页自检：本页每个数字都必须能在证据 JSON 里找到，脚本不认的字段直接 throw | make-styles |
| H | 清理纪律：无 node_modules/dist/.tmp、恰好三页 + 总览、单页 0.9–1.5MB、总额 ≤50MB、四页零外链、最小文件集、无一次性脚本残留、CSV 帧数 == 解析器帧数 | check-clean |
| 变异 | 16 个故意破坏，每个都必须被**点名**抓住，随后按字节还原并复跑 | mutate |

（条数由 `evidence/assert-totals.json` 给出，本页与台账里的数字都从那个文件转写，不手打。）

### 断言总量（以下每一行都由 `/tmp/inject22.py` 现场从 `evidence/*.json` 转写，不手打；该脚本自身也录进 §18）

| 套件 | 条数 | 备注 |
| --- | --- | --- |
| check-node（静态） | **146/146** | 分组：A 23 · B 34 · C 26 · D 44 · E 14 · F 5 |
| check-browser（真浏览器） | **120/120** | 组 J/K/L/M/N；用的可执行文件 `Chromium`（131.0.6778.33），软件渲染 |
| check-clean（清理纪律） | **10/10** | 组 H |
| 合计 | **276/276** | 全部为无条件项：任何一条都不带「如果不满足就跳过」的分支，所以这个总数与本轮实际执行到的判据数恒等 |
| 对抗性变异 | **16/16 全部点名抓住** | 还原后复跑与基线失败集逐字一致：True；explore 阶段曾漏 3 条（S2, X1, X2），据此补出 D37/B16 |
| 产物体积 | 5.17 MB | 预算 50 MB |

变异清单（每个变异的「预期被谁抓住」与「实际被谁抓住」见 `evidence/mutation-strict.json`）：

| id | 类型 | 破坏内容 | 被抓住的位置 |
| --- | --- | --- | --- |
| V1 | value | 换窗口上限却不动反事实证据 | D16 |
| V2 | value | 改阈值常数，页面脚注还写着 1.35 | D25、D26 |
| V3 | value | 粗带边界挪一格，Node 真值里的划分没跟着挪 | D12 |
| V4 | value | 手抄的打击乐计数与时刻数组脱钩 | D6 |
| V5 | value | 解析帧数被改，而 hop/FFT/时长推出的是 1371 | D9 |
| V6 | value | 逐小节表少写一位小数（肉眼看不出，对账看得出） | D29 |
| S1 | structural | 着色器声明了宿主没登记的 uniform（会被编译器裁掉 → 定位符 null） | build:throw |
| S2 | structural | 消融臂退回单值比较：构建期的「臂清单 == 宿主 has() 集」双向核对当场就炸（B13/B14 是第二层） | build:throw |
| S3 | structural | 三块子视口共用原点 → 只是同一张图的三条裁片 | B12 |
| S4 | structural | 两页共享一个色值 → 「换皮」而不是「换风格」 | C4 |
| S5 | structural | 结构层混进字面颜色 → 皮肤令牌不再是唯一色源 | C2 |
| S6 | structural | 页面 uniform 表少一行（表与代码漂移） | build:throw |
| S7 | structural | 只拔音频不拔历史：静态判据全无反应，只有互斥消融臂（frozen,noaudio 像素必须零变化）能抓 | （静态无反应，由浏览器判据 ['(静态无反应) → L4'] 挡） |
| S8 | structural | 叠加臂退回「只认第一个」：?probe=frozen,noaudio 里 noaudio 静默失效。补强 B13（把 has() 的函数体形状也锁上）之前，静态判据毫无反应 | B13 |
| X1 | semantic | 导语指错小节：结构校验全绿，事实核对才抓得住 | D37 |
| X2 | semantic | 陈述与着色器实际声明相反（colonnade 根本没有 uTime） | B16 |


## 8. 发现一：技能对「外部数据」零覆盖，缺口是自上而下的

技能给的 8 个音频 uniform 一个都没有，缺的不只是名字，还有三条纪律，本轮全部自建并做成判据：

1. **传参纪律**：只有着色器真声明的 uniform 才写，且写之前把要写的值记进 `record`——于是「登记过 == 声明过 == 真取到 location」三方可以双向对账（`B` 组），漏登记、漏声明、拼错名字三种事故都会红。
2. **量纲纪律**：`uLevel…uBeat` 一律夹到 `0..1`，`NaN` 归零；dB 窗口 `-100..-10` 由 `features.js` 单点定义，`AnalyserNode.minDecibels/maxDecibels` 直接从它取，两端不可能不一致。
3. **纹理纪律**：`uSpectrum` 是 64×1 LUMINANCE、`uHistory` 是 64×128，条带三视口与主画面对同一张纹理的采样轴不同（见 §10），这一点必须在判据里区分，否则「反转带序」在某一页上根本没有可观察后果。

## 9. 发现二：dB 窗口是判据力的一部分，不是参数细节

`AnalyserNode` 默认 `min/maxDecibels = -100/-30`。本曲 groove 段的低频在 -30 dBFS 之上大量溢出：实测 **groove 低频带 28.54% 的 texel 被顶到 1.0**、低频时间序列 **17.95% 的帧整段钉满**、唯一值从 266 掉到 182。饱和区里的「画面随音乐变」是自我证明的——数值全 1，怎么动都一样。改成 `-100/-10` 后饱和率 0。

本轮没有只写一句「记得调窗口」，而是把 -30 当**反事实**用同一条公式重算一遍，读数印进 `evidence/ground-truth.json.counterfactualCeilMinus30`，再由产物总览页原样转写。这样下一个人把常量改回去，会看到一组变红的判据加一组变差的读数，而不是一句注释。

## 10. 发现三：均值是坏判据，于是造了一条确定性臂

这一条改了三次才站住，过程值得写：

1. 第一版判据「三带读数四舍五入后互不相同」。浅纸底色的 colonnade 三带均值实测 `219.0 / 214.3 / 219.3`，低带与高带只差 0.3 LSB——底色主导了均值，筛带只留下零点几的偏移。这条判据在同一段代码上时过时败。
2. 第二版改成配对统计（逐帧算 `|A-B|`，用中位数比它自己的四分位距）。仍然不稳：三个子视口的读数是**先后**取的，主画面又带 `uTime` 动画，配对差里混进了动画相位，实测热像同一臂两次运行的逐带自反差不止 1，浅纸页的信号与噪声同量级。
3. 第三版：把「uVariant 有没有改这块视口的画面」搬到**确定性臂**上——`?probe=frozen,staticspectrum`（冻时钟 + 喂与音乐无关的固定频谱）+ `setPaused(true)` + 精确 140 次 `drawOnce()`。此时画面只由代码决定，实测**同一臂两次独立加载的逐带读数差恰好为 0**，于是「非零即证据」成立：
   - 只把 `uVariant` 换成 0（`samevariant`），逐带读数变化 colonnade `+40.36 / +31.55 / +13.72`，ripple `-21.60 / -20.71 / -1.38`，thermal `-55.63 / -33.41 / -23.28`（LSB）——三条视口都必须变；
   - 只反转带序（`mislabel`），colonnade `+8.99 / +6.57 / -16.88`、ripple `-0.67 / -0.28 / +0.90`、thermal `+0.00 / +1.90 / -0.03`。

   以上都是定标脚本在 90 次重绘下的读数；判据 `L7/L8b` 用 140 次重绘，臂本身逐位确定，所以绝对值随重绘次数而变，最终数字以 `evidence/check-browser.json` 为准。

   顺带暴露两件事：**假频谱必须是斜坡不能是常数**（常数对「筛带」和「反转」都是不变量，喂它什么也测不出来，`L10` 现在同时断言它脱钩且单调爬升 `0.150→0.850`）；**热像条带把 x 轴当时间用**，均值对水平平移是不变量，所以反转带序在它身上几乎没有可观察后果。

4. 第四版（`L8b` 定稿）：本来写成「确定性臂下反转带序后至少一条分频视口要变」，热像给的却是 `[-0.22 / -0.43 / -0.03]`——三次重绘次数不同的运行里连符号都不稳，因为它本来就没有可观测的分频效应，硬断言就是随机红。判据换成**对照式**：正常 `uVariant=1/2/3` 时三带两两相差 ≥0.5 LSB，把 `uVariant` 全钉成 0 后这个 spread 必须塌缩到 `max(0.2, 原 spread/8)` 以内（残余那点差是视口纵横比与原点，不是筛带）。反转差 `mDelta` 原样写进 `evidence/check-browser.json` 的 reads，只是不再参与判定；那一页的反转证据落在 `L8a`（真音频主画面统计）。口径差异全部印进判据文本，不藏。

`uVariant` 的「值到底发没发」另有一判：读宿主逐视口登记记录，正常臂 `[1,2,3]`、`samevariant` 臂 `[0,0,0]`、主画面恒 0（`L9`）。像素判据管「改了画面」，登记判据管「改的是对的值」，两条都要。

## 11. 发现四：`seek()` 之后立刻采样会读到预滚，K6 假失败

第一版 K6 在 `seek(4.0)` 后马上取样，读出 groove→breakdown 比值 0.78，与 Node 真值 0.508 差得远，一度被记成「浏览器实现不同」。实际是 Chrome 对 `<audio>` 的预滚（preroll）让 seek 完成事件早于分析缓冲进入正轨。改成**连续播放中按窗口取中位数**（窗口口径直接取 `ground-truth.summary.windows`，与 Node 同一份定义）后，浏览器读出的比值 0.304–0.406，方向一致且凹陷比 Node 更深——两个解析器对同一事实同向，只断言方向（§6）。

## 12. 发现五：变异测试抓到两处真实判据漏洞

`scripts/mutate.mjs` 先以 explore 模式跑一遍（期望可以落空，用来找漏洞），再按实测结果固化为 strict 模式。explore 第一次跑出两条**无人抓住**的语义变异：

- `X1`：把产物正文里的「第 06 小节是 breakdown」改成「第 03 小节」。抓住它需要新判据 `D37/D37b`：先断言页面里 `第 NN 小节是 breakdown` 只出现一次，再断言那一处与解析器算出的 `breakdownBar+1` 逐字节相等（位置绑定，不是「正确文本出现在某处」）。
- `X2`：把「主画面刻意没有 `uTime`」改成「刻意有」。补 `B16`：逐风格断言「页面里有没有这句声明」与「着色器里有没有 `uniform float uTime`」同真同假。

教训通用：**生成型产物里手写死的文案，会和新数据矛盾，而结构校验全绿也抓不到**——文案必须绑回事实源。

16 个变异体的完整清单与各自被谁抓住见 `evidence/mutation-strict.json`；另有两个「静态判据无反应」的（`S7` 删 noaudio 的历史缓冲守卫）设计就是只有互斥消融臂能抓（`L4`），这类项在 strict 模式里断言的是「静态无反应 + 浏览器抓得住」。

## 13. 发现六：判据自己也会带病灶——三条只在「通过边缘」才发作的假判据

台账写回之后复跑，静态判据从 9 红变成 2 红，逼出来三个问题。共同点是：**它们在失败路径上表现正常，只在接近通过时才失效**，所以第一轮全绿完全是运气。

| 判据 | 病灶 | 症状与修法 |
| --- | --- | --- |
| `E1 tried` | 快照存的是 `skill \|\| 场景` 字符串键，`state.json.tried` 是对象数组，`includes` 两边永远对不上 | 「历史条目一条不少」假红 23 条、「新增项确实写入」假红——两个方向都错但恰好互相掩盖。加 `triedKeys()` 把两侧统一成同一把键 |
| `E5` | `state.runs[last].includes(...)` 对对象调 `.includes` 会抛 `TypeError` | 只在「work-log 那一半已经为真」时短路才失效——也就是**入账前红着看不出来，入账后立刻炸**。改成 `JSON.stringify(...)` 再比 |
| `E7` | `prev.tried.includes(combo_key)`：左边是复合键、右边是裸场景串，恒为 `false`，即 `eq(..., false)` 恒过 | 一条永真的假绿判据。改成同时要求「快照的去重结论为『新』」且「新增场景串不出现在任何历史键里」 |

教训：判据的**两侧口径**（键怎么拼、元素是串还是对象）比判据逻辑更容易出错，而且要专门检查「这条判据在失败时会说什么」。`E5` 那类靠 `&&` 短路的写法，把崩溃推迟到通过的那一刻——写判据时应假定操作数可能是对象。

## 14. 发现七：`--apply` 允许复写自己的那一行（台账数字要留稳定态）

`E` 组的口径是「台账现值 == 快照 + 本轮新增」，于是**入账前它必红、入账后才全绿**——一个鸡生蛋。若台账只写一次，记下的就是 `137/146` 这个「因为还没入账所以红」的暂态，与下一个人重跑 `verify.sh` 得到的 `146/146` 不符。

做法：`update-ledger.mjs --apply` 跑第二遍时不再跳过，而是**只按最新 `evidence/assert-totals.json` 复写本轮自己写进去的那一行/那一条**（`runs` 末条 `assertions` 与 work-log 末行）。护栏两条：末行必须含本轮目录名，否则拒绝写入并报错；若已经与证据逐字相同就报「幂等，无需复写」。历史行依旧一个字节都不碰。

顺带修掉一个真错误：work-log 的行格式是 `时间 | skill | ...`，**不带前导 `|`**（21 条历史行统计确认），我最初写成带前导竖线，会破坏表格。

`make-styles.mjs` 也炸过一次：自检计数器起名 `cf`，与上文「dB 窗口 -30 反事实」的 `const cf` 撞名，直接 `SyntaxError`。改叫 `gPass/gFail`。

护栏在真实并发下当场生效：第二次 `--apply` 时，另一个并行轮次（00:20，shader × 商品 360° 展示）已经往 work-log 末尾追加了它自己的一行，于是本轮那行不再是末行——脚本按设计**拒绝复写并报错退出**，历史一个字都没动。结论：本 LAB 允许多轮并发写台账，但「复写自己的那一行」这类操作必须在**同一轮内、追加后立即**做完；隔了并发写入就只能手写补记。本轮的计数恰好在被挤下去之前已经复写成稳定态（`276/276`），无需补记。

最后一次的完整复现：`sh scripts/verify.sh` 八步全绿（静态 146/146 · 真浏览器 120/120 · 变异 16/16 · 清理 10/10，约 9.5 分钟），日志与证据都在本目录。

## 15. 发现八：`K5` 点采样在第二次运行时随机落空（「首跑全绿」再次不算数）

`K5` 原来是「在 4.4–4.7s 找一行，比较它的低频段均值与高频段均值」。第一次跑三风格全绿；随后跑一键复现 `verify.sh` 时 ripple 报 `no row`。根因不在被测代码，而在取样方式：宿主探针每 120ms 采一行且 `warm()` 会漂，0.3s 宽的点窗本来就可能一行不落。

改成与 `K6` 同一口径：**按小节窗口筛行、再按起拍邻域（±0.14s）聚合，取中位数**，并把「聚合了几行 / groove 共几行」写进判据文本——样本不足时判据自己会喊，而不是静默落空。判据语义没变弱（底鼓时刻能量仍必须堆在低频），但去掉了「时刻恰好有行」这个与被测对象无关的前提。

这条正是历轮同一个教训的第 N 次复现：**同一份代码、同一个实例上再跑一遍，才会暴露读侧竞态**；首轮全绿只是运气。

## 16. 发现九：并发轮次让台账判据的隐含假设失效（本轮真实发生）

LAB 是多个自动任务共用的仓库，本轮 `--apply` 之后 20 分钟，另一个并发轮次（00:20，shader × 商品 360°）
往同一份 `work-log.md` / `state.json` 追加了它自己的一条。三处原本假设「本轮是唯一写入者」的判据当场失效：

| 判据 | 原口径 | 并发下的真相 | 改后 |
| --- | --- | --- | --- |
| `E1/E2/E3` 条数 | `cur == prev + added` | 别人也加了条目，实测 `25 ≥ 24` | 等式降为下界 `cur ≥ prev + added`，「历史一条不少」与「本轮新增确实在」两条保持精确 |
| `E4` runs | `len == prev + 1` | 同上 | `len ≥ prev + 1` |
| `E5` work-log | 本轮目录名必须在**末行** | 末行已经是对方的 | 本轮行**出现且只出现一次**、且**晚于**快照记下的上一轮行——不再依赖「谁是最后一行」，仍守住「只追加、不改历史」 |

同时 `state.runs` 里定位本轮条目也改成按目录名查而不是取末条（`--stamp-push` 就是这么找到的），
`update-ledger.mjs` 的复写护栏（末行不含本轮目录名即拒绝写入）在这一次真的挡下了一次越界写：
它没有去改对方那一行，而是报错退出。

结论：**共用台账的判据必须写成「只增不减 + 自身可定位」，不能写成计数等式或位置断言**；
计数等式在没有并发时更好（能抓到漏写），但它把「并发」这一真实运行条件当成了异常。
本轮做法：等式降为下界，同时保留「本轮新增必须在」这条精确判据——漏写仍会被抓，只是多写不会假红。

## 17. 踩过的坑（环境类）

| 坑 | 现象 | 处置 |
| --- | --- | --- |
| playwright-core 与缓存 revision 不匹配 | `executable doesn't exist at .../chromium-1140`，本机只有 1148 | 候选表逐个试启 + 校验 `WebGLRenderingContext`（§3） |
| `page.evaluate` 的闭包变量 | `ReferenceError: step is not defined` | evaluate 里不许出现 Node 作用域变量，参数一律走第二个实参：`p.call((ms)=>…warm(ms), 700)` |
| 自写 `open()` 包装漏暴露接口 | `p.addScriptTag is not a function`、`p.evaluate` 不存在 | 包装只暴露 `page/call/play/close`，脚本注入用 `p.page.addScriptTag` |
| 对比度只量父一层 | 深色页 `.btn` 读出 ratio 1.0 | 元素自己常有背景，改为**从元素向上逐层叠色**再算（`__labBg`） |
| 390px 视口横向溢出 79px | 三页全中，元凶是表格里 `uResolution` 这类长词撑破 `minmax(0,1fr)` 轨道，外加 `.ablations code` 的 `nowrap` | `@media (max-width:720px)` 里 `overflow-wrap: anywhere` + 取消 nowrap；`M10` 从只测一页改成三页都测 |
| 小字号 | 判据要求 ≥12px，实测 `--fs-meta` 是 11.5 / 11px | 提到 12.5 / 12px（ripple 本来就 13px） |
| 后台任务被回收 | `nohup … & disown` 的子进程在日志里留下 `Killed` | 长任务一律用运行器的后台模式，不用 shell 悬挂 |
| npm 安装退出码骗人 | 命令尾部一个非零（`ls` 空目录）把整条报成失败，依赖其实装好了 | 判成败看 `added N packages` 与 require 冒烟 |
| 循环打补丁留下脏值 | 常量被留在扫描末尾的 `-5`，注释还写着「对齐默认值」 | 改常量一律用编辑工具并回读（历轮同款，再次复发） |

## 18. 被删掉的一次性脚本（内容全录，可逐字重放）

以下脚本都是一次性定标/定位工具，按台账规矩跑完即删（`LAB/.tmp` 与 `/tmp` 里的本轮临时文件都清掉），内容照抄在这里，是为了让「判据为什么长成现在这样」可以被下一个人重演而不是重猜。它们依赖 `.tmp/audiobuild/node_modules/playwright-core`，路径写死在本机，属正常。

### `probe-launch.mjs` —— 回答「playwright-core 到底能用哪个可执行文件起出真 WebGL1 上下文」——就是它把 revision 不匹配这件事变成 `check-browser.mjs` 里的候选表

```javascript
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire("/Users/apple/Documents/workProject/试验/前端skill实验室/.tmp/audiobuild/x.js");
const { chromium } = require(path.join("/Users/apple/Documents/workProject/试验/前端skill实验室/.tmp/audiobuild", "node_modules", "playwright-core"));
const cands = {
  "pw-1148": "/Users/apple/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
  "sys-chrome": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
};
for (const [name, p] of Object.entries(cands)) {
  try {
    const b = await chromium.launch({ executablePath: p, args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
    const pg = await (await b.newContext()).newPage();
    await pg.setContent("<canvas id=c></canvas>");
    const gl = await pg.evaluate(() => { const c=document.getElementById('c'); const g=c.getContext('webgl'); if(!g) return 'none'; const d=g.getExtension('WEBGL_debug_renderer_info'); return g.constructor.name+'|'+(d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):'?'); });
    console.log(name, "OK version=", b.version(), "gl=", gl);
    await b.close();
  } catch (e) { console.log(name, "FAIL", String(e.message).split("\n")[0]); }
}
```

### `smoke22.mjs` —— 第一次真开机冒烟：读 `data-boot`、`probe.info()` 的两视口 missing/缓冲/glError，确认宿主与探针能对话

```javascript
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire("/Users/apple/Documents/workProject/试验/前端skill实验室/.tmp/audiobuild/x.js");
const { chromium } = require("/Users/apple/Documents/workProject/试验/前端skill实验室/.tmp/audiobuild/node_modules/playwright-core");
const ROOT = process.cwd();
const b = await chromium.launch({ executablePath: "/Users/apple/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
  args: ["--no-sandbox","--allow-file-access-from-files","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--autoplay-policy=no-user-gesture-required","--mute-audio"] });
const p = await (await b.newContext({ viewport:{width:1280,height:860} })).newPage();
const msgs=[]; p.on("console",m=>msgs.push(m.type()+":"+m.text().slice(0,100))); p.on("pageerror",e=>msgs.push("pageerror:"+e.message.slice(0,100)));
await p.goto("file://"+path.join(ROOT,"preview","visualizer-thermal.html"), { waitUntil:"load" });
await p.waitForTimeout(400);
console.log("boot:", await p.evaluate(()=>document.body.getAttribute("data-boot")));
const info = await p.evaluate(()=>window.__shaderProbe.info());
console.log("strip.bands",info.strip.bands,"missing",info.fx.missing,info.strip.missing,"buf",info.fx.buffer,info.strip.buffer,"glError",info.fx.glError);
console.log("start:", await p.evaluate(async()=>await window.__shaderProbe.start()));
await p.evaluate(()=>window.__shaderProbe.seek(4.0));
await p.evaluate(()=>new Promise(r=>setTimeout(r,600)));
const a = await p.evaluate(()=>window.__shaderProbe.audio());
console.log("audio:", a.ctxState, a.fftSize, a.binCount, a.smoothing, a.minDecibels, a.maxDecibels, a.currentTime.toFixed(2), a.srcPrefix, a.duration);
const f = await p.evaluate(()=>{const q=window.__shaderProbe;const x=q.features();return {lvl:x.level,bass:x.bass,mid:x.mid,tr:x.treble,beats:x.beatLog.length,bands:x.bands.slice(0,4),dr:q.draws(),fr:q.frames()};});
console.log("feat:", JSON.stringify(f));
console.log("snap:", await p.evaluate(()=>window.__shaderProbe.snapshot("fx",0)));
await p.evaluate(()=>new Promise(r=>setTimeout(r,700)));
console.log("diff:", JSON.stringify(await p.evaluate(()=>window.__shaderProbe.diff("fx",0))));
console.log("stats:", JSON.stringify(await p.evaluate(()=>{const s=window.__shaderProbe.stats("strip",0);return {mean:s.mean,rgb:s.meanRgb,p50:s.p50};})));
const last = await p.evaluate(()=>window.__shaderProbe.host("strip").lastUniforms());
console.log("lastU:", JSON.stringify({o:last.uOrigin,v:last.uVariant,t:last.uTime,bass:last.uBass}));
console.log("drawLog len:", await p.evaluate(()=>window.__shaderProbe.features().drawLog.length));
await p.addScriptTag({content:"window.__x=1;"});
console.log("addScriptTag on file://:", await p.evaluate(()=>window.__x));
console.log("msgs:", JSON.stringify(msgs.slice(0,6)));
await b.close();
```

### `measure22.mjs` —— L7/L8 的第一代定标：逐风格三臂（正常 / mislabel / samevariant）采均值与 σ，顺手量出 AudioContext 采样率与 Node 侧不同这一事实。它给出的数字直接否证了我最初写的判据

```javascript
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire("/Users/apple/Documents/workProject/试验/前端skill实验室/.tmp/audiobuild/x.js");
const { chromium } = require("/Users/apple/Documents/workProject/试验/前端skill实验室/.tmp/audiobuild/node_modules/playwright-core");
const ROOT = process.cwd();
const gt = JSON.parse(fs.readFileSync("evidence/ground-truth.json","utf8"));
const out = {};
const b = await chromium.launch({ executablePath: "/Users/apple/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
  args: ["--no-sandbox","--allow-file-access-from-files","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--autoplay-policy=no-user-gesture-required","--mute-audio"] });
const med = (xs)=>{const s=xs.slice().sort((p,q)=>p-q);return s[Math.floor(s.length/2)];};
async function open(style, probe){
  const c = await b.newContext({ viewport:{width:1280,height:860}, deviceScaleFactor:1 });
  const p = await c.newPage();
  await p.goto("file://"+path.join(ROOT,"preview","visualizer-"+style+".html")+(probe?"?probe="+probe:""), {waitUntil:"load"});
  await p.waitForTimeout(300);
  await p.evaluate(async()=>await window.__shaderProbe.start());
  return { p, c };
}
for (const style of ["colonnade","ripple","thermal"]) {
  const { p, c } = await open(style, "");
  const sr = await p.evaluate(()=>window.__shaderProbe.audio().sampleRate);
  await p.evaluate(()=>window.__shaderProbe.seek(3.5));
  await p.evaluate(()=>new Promise(r=>setTimeout(r,300)));
  const rows=[];
  for (let i=0;i<84;i++){ rows.push(await p.evaluate(()=>{const q=window.__shaderProbe;const a=q.audio(),f=q.features();return {t:a.currentTime,bass:f.bass,mid:f.mid,tr:f.treble,lvl:f.level};}));
    await p.evaluate(()=>new Promise(r=>setTimeout(r,115))); }
  const W=gt.summary.windows;
  const inGroove=(x)=>W.grooveBars.some(bar=>x.t>=bar*W.barSec&&x.t<(bar+1)*W.barSec);
  const inBreak=(x)=>x.t>=W.breakdownBar*W.barSec+0.2&&x.t<(W.breakdownBar+1)*W.barSec-0.2;
  const bg=med(rows.filter(inGroove).map(r=>r.bass)), bb=med(rows.filter(inBreak).map(r=>r.bass));
  out[style]={ctxSampleRate:sr,n:rows.length,grooveN:rows.filter(inGroove).length,breakN:rows.filter(inBreak).length,
    browser:{groove:bg,breakdown:bb,ratio:bb/bg},node:{groove:gt.summary.bassWindowAtCeil.groove.median,breakdown:gt.summary.bassWindowAtCeil.breakdown.median,ratio:gt.summary.dips.ratio},
    browserMid:[med(rows.filter(inGroove).map(r=>r.mid)),med(rows.filter(inBreak).map(r=>r.mid))],
    browserTreb:[med(rows.filter(inGroove).map(r=>r.treble)),med(rows.filter(inBreak).map(r=>r.treble))]};
  await c.close();
  // band stats across arms
  const st={};
  for (const probe of ["","mislabel","samevariant"]) {
    const o = await open(style, probe);
    await o.p.evaluate(()=>window.__shaderProbe.seek(4.3));
    await o.p.evaluate(()=>new Promise(r=>setTimeout(r,700)));
    const bands=[]; for (const i of [0,1,2]) bands.push(await o.p.evaluate((k)=>{return window.__shaderProbe.stats("strip",k);},i).then(s=>({mean:+s.mean.toFixed(2),sigma:+s.sigma.toFixed(2),rgb:s.meanRgb.map(v=>+v.toFixed(1))})));
    const fx = await o.p.evaluate(()=>{const s=window.__shaderProbe.stats("fx",0);return {mean:+s.mean.toFixed(2),sigma:+s.sigma.toFixed(2),p50:+s.p50.toFixed(1),rgb:s.meanRgb.map(v=>+v.toFixed(1))};});
    st[probe||"normal"]={bands,fx};
    await o.c.close();
  }
  out[style].arms=st;
}
await b.close();
fs.writeFileSync("/tmp/measure22.json",JSON.stringify(out,null,1));
console.log(JSON.stringify(out,null,1).slice(0,4000));
```

### `calib22.mjs` —— 第二代定标：连续播放中逐带采样，量出「同一时刻两带之差」的信号与它自己的抖动同量级，于是配对统计这条路也被否掉

```javascript
/* /tmp/calib22.mjs —— 定标探针（用完即删，内容抄进复现报告 §「L7/L8b 判据是怎么定出来的」）
 * 目的：在 uTime 被 frozen 冻住的两条臂之间逐带比较，看「只换 uVariant」带来的像素差
 *       有多少 LSB，用来给 check-browser 的 L7/L8b 选阈值（不是先拍阈值再找数据）。 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire("/Users/apple/Documents/workProject/试验/前端skill实验室/.tmp/audiobuild/x.js");
const { chromium } = require("/Users/apple/Documents/workProject/试验/前端skill实验室/.tmp/audiobuild/node_modules/playwright-core");
const ROOT = "/Users/apple/Documents/workProject/试验/前端skill实验室/artifacts/20260926-22-shader-audio-visualizer";
const quant = (v, p) => { const s = v.slice().sort((a, b) => a - b); return s[Math.round(p * (s.length - 1))]; };
const b = await chromium.launch({
  executablePath: "/Users/apple/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
  args: ["--no-sandbox", "--allow-file-access-from-files", "--use-gl=angle", "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required", "--mute-audio"]
});
async function series(style, probe) {
  const c = await b.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  const p = await c.newPage();
  await p.goto("file://" + path.join(ROOT, "preview", "visualizer-" + style + ".html") + (probe ? "?probe=" + probe : ""), { waitUntil: "load" });
  await p.waitForTimeout(300);
  await p.evaluate(async () => await window.__shaderProbe.start());
  await p.evaluate(() => window.__shaderProbe.seek(3.6));
  await p.evaluate(() => window.__shaderProbe.warm(500));
  const cols = [[], [], []];
  for (let i = 0; i < 10; i++) {
    for (const k of [0, 1, 2]) cols[k].push(await p.evaluate((band) => window.__shaderProbe.stats("strip", band).mean, k));
    await p.evaluate(() => window.__shaderProbe.warm(110));
  }
  await c.close();
  return cols;
}
const out = {};
for (const style of ["colonnade", "ripple", "thermal"]) {
  const nv = await series(style, "frozen");
  const sv = await series(style, "frozen,samevariant");
  const ml = await series(style, "frozen,mislabel");
  const rr = await series(style, "frozen");
  const dmed = (A, B) => A.map((_, i) => quant(A[i].map((x, s) => Math.abs(x - B[i][s])), 0.5));
  out[style] = {
    perBandMedian: nv.map((v) => +quant(v, 0.5).toFixed(2)),
    sameBandVariantOff: dmed(nv, sv).map((x) => +x.toFixed(2)),
    sameBandReversed: dmed(nv, ml).map((x) => +x.toFixed(2)),
    selfRepeatability: dmed(nv, rr).map((x) => +x.toFixed(2)),
    sameVariantAspectFloor: [0, 1, 2].flatMap((i) => [1, 2].filter((j) => j > i).map((j) =>
      +quant(nv[i].map((_, s) => Math.abs(nv[i][s] - nv[j][s])), 0.5).toFixed(2)))
  };
}
await b.close();
fs.writeFileSync("/tmp/calib22.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
```

### `calib22b.mjs` —— 第三代（最终采用）：`frozen` + 斜坡 `staticspectrum` + `setPaused` + 精确 N 次 `drawOnce` 的确定性臂，实测两次加载逐带读数差恰好 0，L7/L8b 的绝对阈值由此而来

```javascript
/* /tmp/calib22b.mjs —— 定标探针 2（用完即删，内容抄进复现报告）
 * 假设：把 frozen + staticspectrum（斜坡）叠起来，画面就完全由代码决定，
 *       于是「只换 uVariant」「只反转带序」的逐带差可以用一个绝对阈值断言，不再需要猜噪声。
 * 要回答三件事：
 *   a) 同一臂两次独立加载，逐带读数是否逐位相同（确定性成不成立）
 *   b) uVariant 关掉后每条带掉多少 LSB
 *   c) 带序反转后每条带掉多少 LSB（热像的 x 轴是时间，预期≈0，这条决定 L8b 怎么写） */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire("/Users/apple/Documents/workProject/试验/前端skill实验室/.tmp/audiobuild/x.js");
const { chromium } = require("/Users/apple/Documents/workProject/试验/前端skill实验室/.tmp/audiobuild/node_modules/playwright-core");
const ROOT = "/Users/apple/Documents/workProject/试验/前端skill实验室/artifacts/20260926-22-shader-audio-visualizer";
const b = await chromium.launch({
  executablePath: "/Users/apple/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
  args: ["--no-sandbox", "--allow-file-access-from-files", "--use-gl=angle", "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required", "--mute-audio"]
});
async function means(style, probe) {
  const c = await b.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  const p = await c.newPage();
  await p.goto("file://" + path.join(ROOT, "preview", "visualizer-" + style + ".html") + "?probe=" + probe, { waitUntil: "load" });
  await p.waitForTimeout(250);
  await p.evaluate(() => { const q = window.__shaderProbe; q.setPaused(true); for (let i = 0; i < 90; i++) q.drawOnce(); });
  const strip = [], fx = [];
  for (const k of [0, 1, 2]) strip.push(await p.evaluate((band) => window.__shaderProbe.stats("strip", band).mean, k));
  for (let r = 0; r < 3; r++) fx.push(await p.evaluate(() => window.__shaderProbe.stats("fx", 0).mean));
  await c.close();
  return { strip, fx };
}
const out = {};
for (const style of ["colonnade", "ripple", "thermal"]) {
  const A1 = await means(style, "frozen,staticspectrum");
  const A2 = await means(style, "frozen,staticspectrum");
  const V = await means(style, "frozen,staticspectrum,samevariant");
  const M = await means(style, "frozen,staticspectrum,mislabel");
  out[style] = {
    normal: A1.strip.map((v) => +v.toFixed(3)), normal2: A2.strip.map((v) => +v.toFixed(3)),
    determinismMaxDiff: +Math.max(...A1.strip.map((v, i) => Math.abs(v - A2.strip[i]))).toFixed(6),
    variantOffDelta: A1.strip.map((v, i) => +(v - V.strip[i]).toFixed(2)),
    mislabelDelta: A1.strip.map((v, i) => +(v - M.strip[i]).toFixed(2)),
    fx: { normal: +A1.fx[2].toFixed(2), variantOff: +(A1.fx[2] - V.fx[2]).toFixed(2), mislabel: +(A1.fx[2] - M.fx[2]).toFixed(2), fxRepeatSpread: +(Math.max(...A1.fx) - Math.min(...A1.fx)).toFixed(6) }
  };
}
await b.close();
fs.writeFileSync("/tmp/calib22b.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
```

### `overflow22.mjs` —— 390px 溢出定位：打印所有右边界越界的元素，三页全中，元凶是表格里的长词与 `nowrap` 的臂名

```javascript
/* /tmp/overflow22.mjs —— 一次性定位窄屏溢出的元素（用完即删，结论抄进报告 §坑） */
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire("/Users/apple/Documents/workProject/试验/前端skill实验室/.tmp/audiobuild/x.js");
const { chromium } = require("/Users/apple/Documents/workProject/试验/前端skill实验室/.tmp/audiobuild/node_modules/playwright-core");
const ROOT = "/Users/apple/Documents/workProject/试验/前端skill实验室/artifacts/20260926-22-shader-audio-visualizer";
const b = await chromium.launch({
  executablePath: "/Users/apple/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
});
for (const style of ["colonnade", "ripple", "thermal"]) {
  const c = await b.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1 });
  const p = await c.newPage();
  await p.goto("file://" + path.join(ROOT, "preview", "visualizer-" + style + ".html"), { waitUntil: "load" });
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => {
    const bad = [];
    document.querySelectorAll("body *").forEach((el) => {
      const q = el.getBoundingClientRect();
      if (q.right > window.innerWidth + 1 || q.width > window.innerWidth + 1) {
        bad.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 24), right: Math.round(q.right), w: Math.round(q.width), txt: (el.textContent || "").trim().slice(0, 18) });
      }
    });
    return { inner: window.innerWidth, scroll: document.documentElement.scrollWidth, bad: bad.slice(0, 8) };
  });
  console.log(style, JSON.stringify(r));
  await c.close();
}
await b.close();
```

### `inject22.py` —— 本报告 §7 的断言总量表与这一节的脚本清单就是它生成的（Python，非 Node；跑完随其余临时文件一起删）

```python
#!/usr/bin/env python3
"""把 evidence/*.json 与 /tmp 里那些一次性探针的内容注入复现报告。
   数字与脚本正文都不经过我的手打字，报告里的每条计数都能回指到文件。"""
import json, io, os, sys

ART = "/Users/apple/Documents/workProject/试验/前端skill实验室/artifacts/20260926-22-shader-audio-visualizer"
REPORT = "/Users/apple/Documents/workProject/试验/前端skill实验室/reports/20260926-22-shader-audio-visualizer.md"


def j(p):
    with io.open(os.path.join(ART, p), encoding="utf-8") as f:
        return json.load(f)


t = j("evidence/assert-totals.json")
node = j("evidence/check-node.json")
browser = j("evidence/check-browser.json")
clean = j("evidence/check-clean.json")
mut = j("evidence/mutation-strict.json")
explore = j("evidence/mutation-explore.json")

grp = node["groups"]
totals_md = f"""### 断言总量（以下每一行都由 `/tmp/inject22.py` 现场从 `evidence/*.json` 转写，不手打；该脚本自身也录进 §18）

| 套件 | 条数 | 备注 |
| --- | --- | --- |
| check-node（静态） | **{node['pass']}/{node['total']}** | 分组：{' · '.join(f"{k} {v}" for k, v in sorted(grp.items()))} |
| check-browser（真浏览器） | **{browser['pass']}/{browser['total']}** | 组 J/K/L/M/N；用的可执行文件 `{os.path.basename(browser['browser'])}`（{browser['browserVersion']}），软件渲染 |
| check-clean（清理纪律） | **{clean['pass']}/{clean['total']}** | 组 H |
| 合计 | **{t['grandPass']}/{t['grandTotal']}** | 全部为无条件项：任何一条都不带「如果不满足就跳过」的分支，所以这个总数与本轮实际执行到的判据数恒等 |
| 对抗性变异 | **{mut['caught']}/{mut['count']} 全部点名抓住** | 还原后复跑与基线失败集逐字一致：{mut['restored_identical']}；explore 阶段曾漏 {len([m for m in explore['mutations'] if not m['ok']])} 条（{', '.join(m['id'] for m in explore['mutations'] if not m['ok']) or '无'}），据此补出 D37/B16 |
| 产物体积 | {t['artifactMb']} MB | 预算 {t['budgetMb']} MB |

变异清单（每个变异的「预期被谁抓住」与「实际被谁抓住」见 `evidence/mutation-strict.json`）：

| id | 类型 | 破坏内容 | 被抓住的位置 |
| --- | --- | --- | --- |
{chr(10).join(f"| {m['id']} | {m['kind']} | {m['note']} | {'、'.join(m['caughtBy']) if m['caughtBy'] else '（静态无反应，由浏览器判据 ' + str(m.get('expectBrowser') or m['expected']) + ' 挡）'} |" for m in mut['mutations'])}
"""

SCR = ["probe-launch.mjs", "smoke22.mjs", "measure22.mjs", "calib22.mjs", "calib22b.mjs", "overflow22.mjs", "inject22.py"]
ROLE = {
    "probe-launch.mjs": "回答「playwright-core 到底能用哪个可执行文件起出真 WebGL1 上下文」——就是它把 revision 不匹配这件事变成 `check-browser.mjs` 里的候选表",
    "smoke22.mjs": "第一次真开机冒烟：读 `data-boot`、`probe.info()` 的两视口 missing/缓冲/glError，确认宿主与探针能对话",
    "measure22.mjs": "L7/L8 的第一代定标：逐风格三臂（正常 / mislabel / samevariant）采均值与 σ，顺手量出 AudioContext 采样率与 Node 侧不同这一事实。它给出的数字直接否证了我最初写的判据",
    "calib22.mjs": "第二代定标：连续播放中逐带采样，量出「同一时刻两带之差」的信号与它自己的抖动同量级，于是配对统计这条路也被否掉",
    "calib22b.mjs": "第三代（最终采用）：`frozen` + 斜坡 `staticspectrum` + `setPaused` + 精确 N 次 `drawOnce` 的确定性臂，实测两次加载逐带读数差恰好 0，L7/L8b 的绝对阈值由此而来",
    "overflow22.mjs": "390px 溢出定位：打印所有右边界越界的元素，三页全中，元凶是表格里的长词与 `nowrap` 的臂名",
    "inject22.py": "本报告 §7 的断言总量表与这一节的脚本清单就是它生成的（Python，非 Node；跑完随其余临时文件一起删）",
}
scripts_md = ["## 18. 被删掉的一次性脚本（内容全录，可逐字重放）", "",
              "以下脚本都是一次性定标/定位工具，按台账规矩跑完即删（`LAB/.tmp` 与 `/tmp` 里的本轮临时文件都清掉），"
              "内容照抄在这里，是为了让「判据为什么长成现在这样」可以被下一个人重演而不是重猜。"
              "它们依赖 `.tmp/audiobuild/node_modules/playwright-core`，路径写死在本机，属正常。", ""]
for name in SCR:
    p = os.path.join("/tmp", name)
    if not os.path.exists(p):
        scripts_md.append(f"### `{name}`\n\n（本机已不存在，角色：{ROLE.get(name, '')}）\n")
        continue
    body = io.open(p, encoding="utf-8").read().rstrip()
    scripts_md.append(f"### `{name}` —— {ROLE.get(name, '')}\n\n```{'python' if name.endswith('.py') else 'javascript'}\n{body}\n```\n")
scripts_md.append("### `verify.sh` 的 `--skip-browser` 分支")
scripts_md.append(
    "`SHADER_SKIP_BROWSER=1`（等价于传 `--skip-browser`）时，第 5 步只打印一行跳过说明并继续跑完 6/7/8 步："
    "静态判据、变异套件、总览页与清理判据都不依赖浏览器。`check-browser.mjs` 自己找不到 `playwright-core` 时"
    "打印 `SKIP` 并以 2 退出，`verify.sh` 用 `|| [ $? -eq 2 ]` 容忍这一种退出，其余非零一律中止——不给「没装就自动算通过」留口子。")
scripts_md.append("")

text = io.open(REPORT, encoding="utf-8").read()
assert "TODO-TOTALS" in text and "TODO-SCRIPTS" in text, "占位符不见了"
text = text.replace("TODO-TOTALS", totals_md.rstrip() + "\n")
text = text.replace("TODO-SCRIPTS", "\n".join(scripts_md).rstrip() + "\n")
io.open(REPORT, "w", encoding="utf-8").write(text)
print("注入完成：报告现在 " + str(len(text)) + " 字符，断言合计 " + str(t['grandPass']) + "/" + str(t['grandTotal']) +
      "，变异 " + str(mut['caught']) + "/" + str(mut['count']))
```

### `verify.sh` 的 `--skip-browser` 分支
`SHADER_SKIP_BROWSER=1`（等价于传 `--skip-browser`）时，第 5 步只打印一行跳过说明并继续跑完 6/7/8 步：静态判据、变异套件、总览页与清理判据都不依赖浏览器。`check-browser.mjs` 自己找不到 `playwright-core` 时打印 `SKIP` 并以 2 退出，`verify.sh` 用 `|| [ $? -eq 2 ]` 容忍这一种退出，其余非零一律中止——不给「没装就自动算通过」留口子。

### `/tmp/renum22.py` 与 `/tmp/find9-22.py` —— 把「发现六～九」插进本报告并整体顺延小节号

这两个脚本只做文档搬运（把定稿的段落插到指定小节之前、把后续 `## N.` 号顺延），不含判据逻辑；`renum22.py` 已在上一轮清理时删除，两者的差别只有被插入的标题文字。这里把后一个原样录下，是为了让「报告为什么是 18 节而不是 13 节」这件事也能被复核，而不是留下一段解释不上的编号跳变。

```python
#!/usr/bin/env python3
"""插入「发现九：并发轮次下台账判据的隐含假设失效」并把后两节号顺延（16→17、17→18）。"""
import io, re
R = "/Users/apple/Documents/workProject/试验/前端skill实验室/reports/20260926-22-shader-audio-visualizer.md"
SEC = """## 16. 发现九：并发轮次让台账判据的隐含假设失效（本轮真实发生）

LAB 是多个自动任务共用的仓库，本轮 `--apply` 之后 20 分钟，另一个并发轮次（00:20，shader × 商品 360°）
往同一份 `work-log.md` / `state.json` 追加了它自己的一条。三处原本假设「本轮是唯一写入者」的判据当场失效：

| 判据 | 原口径 | 并发下的真相 | 改后 |
| --- | --- | --- | --- |
| `E1/E2/E3` 条数 | `cur == prev + added` | 别人也加了条目，实测 `25 ≥ 24` | 等式降为下界 `cur ≥ prev + added`，「历史一条不少」与「本轮新增确实在」两条保持精确 |
| `E4` runs | `len == prev + 1` | 同上 | `len ≥ prev + 1` |
| `E5` work-log | 本轮目录名必须在**末行** | 末行已经是对方的 | 本轮行**出现且只出现一次**、且**晚于**快照记下的上一轮行——不再依赖「谁是最后一行」，仍守住「只追加、不改历史」 |

同时 `state.runs` 里定位本轮条目也改成按目录名查而不是取末条（`--stamp-push` 就是这么找到的），
`update-ledger.mjs` 的复写护栏（末行不含本轮目录名即拒绝写入）在这一次真的挡下了一次越界写：
它没有去改对方那一行，而是报错退出。

结论：**共用台账的判据必须写成「只增不减 + 自身可定位」，不能写成计数等式或位置断言**；
计数等式在没有并发时更好（能抓到漏写），但它把「并发」这一真实运行条件当成了异常。
本轮做法：等式降为下界，同时保留「本轮新增必须在」这条精确判据——漏写仍会被抓，只是多写不会假红。
"""
t = io.open(R, encoding="utf-8").read()
assert t.count("## 16. 踩过的坑（环境类）") == 1
t = t.replace("## 16. 踩过的坑（环境类）", SEC.strip() + "\n\n## 17. 踩过的坑（环境类）")
t = t.replace("## 17. 被删掉的一次性脚本", "## 18. 被删掉的一次性脚本")
t = t.replace("该脚本自身也录进 §17", "该脚本自身也录进 §18").replace("这一节的脚本清单", "这一节的脚本清单")
io.open(R, "w", encoding="utf-8").write(t)
print("小节号：" + ", ".join(re.findall(r"^## (\d+)", t, flags=re.M)))
```
