# 2026-09-26 05:00 · build-game × 参考图驱动的第三人称 3D 游戏

- 技能：`build-game` v1.2.0（第 2 次使用）
- 本机路径：`~/.qoder-cn/skills/build-game/SKILL.md`（+ `reference/` 6 篇 + `scripts/serve.sh`，资产完整）
- 上游：github.com/openclaw/skills，owner `kewang0622`
- 场景：第三人称采集/探索《拾光谷 GLEAMHOLLOW》，三套世界全部由三张参考图**量**出来
- 结论：**留用**。537/537 断言全绿（写回前 531/537，6 条失败全在 G 组台账幂等锁）
- 产物：`前端skill实验室/artifacts/20260926-05-build-game-reference-driven/`（13MB）

---

## 1. 为什么选这个组合

03:00 轮（3D 塔防）留下两个第一问：

1. SKILL.md 宣称支持 reference images，但 Phase 1B 只写了三行——
   > Read/view any provided image files … Extract key visual elements: colors, proportions,
   > distinctive features, style/mood … translate visual references into Three.js primitive recipes
   **没有任何方法**：没说量什么、怎么量、量完怎么变成 Three.js 参数。模糊条款正是实验室的靶子。
2. 能否断言「参考图的色板真的出现在产物里」，而不是「看起来像」。

同时用第三人称（而非 03:00 的顶视塔防）顺带吃掉另一条 ★：`game-systems.md` 的状态机/对话/任务系统。

## 2. 场景

《拾光谷 GLEAMHOLLOW》：圆形场地 `ARENA_R 33`，中央光柱 `HUB_R 3.6`，玩家（体力 3、光囊 4 格）
在场上收 12 枚光尘（`wisp/shard/emberling`，靠近即 flee）并回光柱交付；三目标
`gather → ask → dusk`（收 3 枚 → 找守护者对话 → 天黑前交付，夜里才浮出 3 枚灰烬碎片）；
3 只猎犬走 `patrol → chase → contact → stunned → return` FSM；昼夜 `DAY_LEN 45 / NIGHT_LEN 35`；
localStorage 存档带 `version`；标题/对话/胜利/失败四屏。三风格共用同一 `src/engine.js`
与同一布局种子 `20260926`，**只有主题对象不同**（bundle 字节三风格全等 778,876B）。

## 3. 三套风格（名字与全部数字都来自参考图）

| 风格 | 参考图 | mean_luma | 色相族 | mood | 曝光 | 环境光 | 主光 | 散布 | 声明色 |
|---|---|---|---|---|---|---|---|---|---|
| 濑户春岸 `seto-coast` | `ref-seto-spring.png` 1536×1024 | 0.5403 | 2 | 0.407 | 1.012 | 0.514 | 2.46 | 391 flora | 12 |
| 赭土绿洲 `atlas-ochre` | `ref-atlas-ochre.png` 1536×1024 | 0.6480 | 1 | 0.355 | 1.000 | 0.500 | 2.35 | 369 boulder | 10 |
| 极夜冰湖 `nordic-night` | `ref-nordic-night.png` 1536×1024 | 0.3267 | 1 | 0.354 | 1.268 | 0.800 | 2.67 | 369 shard | 10 |

三张参考图由 ImageGen 生成（本轮的输入不是真照片而是位图，量测链条对两者一视同仁），
留在 `references/` 里做溯源证据，6.8MB。

## 4. 安装与调用

```bash
cd 前端skill实验室
mkdir -p .tmp/refbuild && cd .tmp/refbuild
npm i --registry=https://registry.npmmirror.com \
  esbuild@^0.24.0 three@^0.160.0 playwright-core@^1.48.2 pngjs@^7.0.0
```

Chromium 用本机已有缓存，不下载浏览器：
`~/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium`
（所有脚本经 `CHROME` 环境变量覆盖，默认值即此路径）。

## 5. 复现步骤（六段脚本，全部从 LAB 根目录跑）

```bash
S=artifacts/20260926-05-build-game-reference-driven/scripts
node $S/extract-reference.mjs   # PNG -> scripts/reference-map.json（15 条具名公式 + 公式文本）
node $S/gen-themes.mjs          # map -> src/themes.js + scripts/theme-summary.json（只做代入）
node $S/build.mjs               # src -> 3 个自包含 html + cdn/ 三形态 + build-sizes.json
node $S/smoke.mjs               # 真 Chromium 起页 -> shots/{id}-title.png, {id}-world.png + 帧统计
node $S/check.mjs               # 537 条断言 -> scripts/check-result.json（含 per-group 计数）
node $S/gen-index.mjs           # index.html 对照入口（数字 import 自 themes.js，69 行推导表）
node $S/smoke-play.mjs          # 功能回路：移动→逃跑→夜→拾取→交付→对话→胜利 / 单独一条失败路径
```

`THREE_PKG` 默认 `.tmp/refbuild/node_modules/three`；`check.mjs` 需要 `.tmp/refbuild` 在位。
双击 `seto-coast.html` / `atlas-ochre.html` / `nordic-night.html` 即离线可玩，
`index.html` 是三风格对照入口（含每风格完整推导表与真帧截图）。

## 6. 把「读图」变成公式（本轮的真正产出）

`extract-reference.mjs` 下采样到 220px（实采样 32,340 px），median-cut `k=10 min_share=2%`，
取 6 个色槽，然后**每个进主题的数字都记 {值, 公式名, 公式文本, 代入过程}**：

| 公式 | 内容 |
|---|---|
| `PALETTE` | median-cut 6 槽 + share/L* |
| `FEATURE` | 上/中/下分区与地平线位置 |
| `GROUND` | 下半区面积冠军色 |
| `VISIBILITY` | 通道地板 `0x44`，按比例抬亮（否则天顶色在主光下读作纯黑） |
| `SUN` | 最亮 2% 像素均值 → 色；质心 (u,v) → |
| `THETA`/`PHI` | 太阳质心 → 方位角/仰角 → `R=78` 球坐标 → key light 位置 |
| `KEYI` | `2.0 + (1 - mean_luma) * 1.0`（参考越暗主光越强） |
| `AMBIENT`/`EXPOSURE`/`FOG`/`BLOOM`/`CONTRAST`/`HUEFAMILIES`/`MOOD` | 全部由 `mean_luma`、`lstar_range`、`family_count`、`mood` 线性/夹逼式导出 |
| `FAMILIES`+`MOTE-FALLBACK` | 光尘三色取自身色相族，不足三支则把强调色色相旋转 ±40°（ΔE≥15 才收）并记为**合成色** |
| `SKIN` | 散布形态 → HUD 圆角/阴影/字体大小写等 9 个指纹 |
| `TEXTCONTRAST` | 面板色与文字色 ΔE<28 时，把文字混向黑或白直到 ≥28 |
| `NOT-FROM-IMAGE` | 布局种子三风格故意共享：明写「这条不来自照片」 |

`gen-themes.mjs` 只做代入 ⇒ **产物里没有一个手打的十六进制，连构建 id 都是推导值**。

## 7. 验证套件：537 条，A–G

`per group: A 37/37 | B 207/207 | C 186/186 | D 78/78 | E 11/11 | F 9/9 | G 9/9`

- **A 交付完整性**：三文件字节数与 `build-sizes.json` 全等；`Buffer.byteLength(bundle)` 相等
  （bundle 含中文，不能用 `.length`）；单 `<script>` 切片正确；属性/CSS 层无 http(s) 外链。
- **B 参考重推导（207 条）**：检查器**独立复算**每一条公式再与 `themes.js` 比对；
  `B29` 两两色板交集 ≤1、主光方向夹角 ≥15°、曝光/环境光/光尘名册互异；
  `B36/B37` 份额加权 L*/C*ab 色调必须分开（|ΔL*|≥8 或 |ΔC|≥4）**且**结构必须同构
  （键集与 mapping 槽位逐位相等）——「不同世界，同一游戏」；
  `B38–B41` 颜色溯源闭包：`declaredColors` 每一项要么是照片色、要么是 VISIBILITY 抬亮色、
  要么只能是**文档化变换**（`×0.72` / `+26` / 混向黑白 / 标量倍或常量偏移）的照片色；
  照片色板最多允许 1 项未被采用；地面与强调色必须是照片色；`groundAlt == ground×0.72`。
- **C 活体场景（186 条）**：读**真实 scene graph** 而不是配置——后期链
  `RenderPass>SSAOPass>UnrealBloomPass>OutputPass>ColorGradePass>FXAAPass`（`OutputPass` 是
  03:00 轮记下的**文档化偏离**）、ACES/SRGB/PMREM/阴影、实例数与 `scatter.count` 相等、
  ≥6 类实体族、>40 mesh、`C30/C30b/C30c` 三条色板封闭（材质色/ShaderMaterial uniforms/
  顶点色调制各自成式）、`C48` 用 `page.on('request')` 拦截证明运行期零外部请求、
  `C43–C48b` 整帧曝光统计。
- **D 玩法（78 条）**：相机相对移动四角度、A/D Strafe 方向、世界轴不锁死、光尘 flee、
  猎犬 FSM 全路径 + 回家恢复 patrol、昼夜与灰烬可见性、拾取/交付/胜利/失败、存档 `version`。
- **E 跨风格（11 条）**：`E1` 三风格 1800 步纯 `FIXED_DT` 脚本跑出的**状态签名全等**
  （位置/状态机/计数，不含任何颜色与浮点噪声）；`E4` 1800 步恰好 30.0000 模拟秒；
  `E6/E7/E8` HUD 至少 4 个属性互异、标签色三者不同、面板骨架同数；
  `E9` 渲染亮度必须保持参考图的**排序**（nordic<seto<atlas）。
- **F 体积**：单场景 ≪50MB，场景目录内零 `node_modules`/`dist`。
- **G 台账幂等锁**：`ledger-snapshot.json`（本轮开工前 tried/runs/styles = 15/15/45）
  + 本轮增量 == 当前 `state.json`，且 work-log 行数 == runs 数。写回前 6 条红，写回后闭合。

## 8. 真实缺陷与教训（先由断言或真帧暴露）

1. **THREE 顶点色与 diffuse map 相乘**。把绝对色写进 `color` attribute 等于把底色平方，
   地面实测暗约 4×。顶点色只能存 1.0 上下的调制量（本轮限 0.45..1.05，`C30c` 钉住范围）。
2. **一个色调只允许一种推导**。`groundAlt` 曾被写成 `×0.7` 与 `×0.72` 两份，声明色板带的是
   0.7 那份而材质读 0.72 ⇒ 溯源闭包必漏（`C30` 抓到 `#816D07` 不在声明里）。修法：生成器算
   一次 `altHex` 全处引用，并新增 `B41` 式子 `groundAlt == ground×0.72`。
3. **帧探针必须读整张 drawing buffer**。旧实现 `readPixels(0,0,320,200)` 在 1280×800 画布上
   只取左下角 6.25% 面积，把「天空泛白」和「地面压黑」都判成正常，三条曝光阈值全建立在错样本
   上。改整帧跨步采样后：seto mean 80.8→68.0、atlas σ 7.96→60.9。同时绝对档 `45..215` 对夜景
   参考（83/255）永远不可能过 ⇒ 换成参考色调带 `frame/ref ∈ 0.4..1.8` + `E9` 排序保持。
4. **跨风格等价必须跑在干净引擎上**。签名原先排在所有玩法探针之后，前序留下的 `held/deposited`
   位使 `E1` 假失败（`m:` 字段差一个 `1.0`）；把签名挪到 `LIVE_SCRIPT` 最前解决。
5. **`startRun()` 不清 keys**。1800 步签名跑完漏下一个 `KeyD`，后续「无输入静置 60 帧」的
   移动探针其实一直在飘，`D1/D2` 表现为「四角度位移几乎为零」的假缺陷（值 0.072,-0.019,…）。
   测试自己造的前置由测试自己清：签名后显式 `setKey(...,false)`。
6. **测试要自己造隔离**（`park()`）：不隔离猎犬时，`D2` 的 strafe 实测 0.906 是击退叠加，
   不是移动 bug（隔离后 0.997/0.9995）。

## 9. 检查器自身的坑（历轮「检查器 bug 伪装成内容缺陷」模式复现）

- 不可证明的断言要换成真运行时证据：`A5`「产物里没有任何 http(s) URL」被 three.js 内嵌的
  `http://www.w3.org/1999/xhtml` 字符串证伪 ⇒ 只查属性/CSS 出现处，外链与否交给 `C48` 拦截。
- 别断言夹具到不了的性质：`E4` 曾要求 30 秒跑里出现夜晚，而 `DAY_LEN=45` ⇒ 换成固定步长时钟
  精确性这条**真**性质。
- 期望值不口算：`D24` 面板数改为从 `src/hud.js` 的 `class="panel"` 计数导出（曾写死 5，骨架实为 6）。
- `page.evaluate` 返回值按引用序列化：数组在后续 mutation 之后才序列化 ⇒ 造出「`questDone`
  没重置」的假 bug（`log.before.done` 打印 `[true,true,true]`）。
- 正则式断言要按真实文档形态写：`A7` 的行首 `^<script>` 在单行文档上恒假；`A8` 从**第一个**
  `<script>` 切片会吞掉第二个脚本自己的闭合标签。
- `B28` 的 provenance 词表：`SKY-horizon`/`SKY-zenith` 是生成器的调色极值规则，必须同时约束
  「只允许出现在 `sky.*` 槽位」，否则等于给任意标签开后门。
- 同名 `const back`（一处是猎犬状态轨迹、一处是存档回读）使整个 `LIVE_SCRIPT` 编译失败，
  而 Node 把错误报到无关行——报错位置与真凶不同源时先查重复声明。
- 压缩后的 three 无 `Color.getComponent`；`new THREE.Color(hex)` 在 r160 ColorManagement 下
  **精确往返**（node 里实测），所以「色板里找不到某个色」一定是生成器 bug，不是色彩空间。

## 10. 已删除探针脚本转录（收尾时随 `.tmp` 一起删）

`pose.mjs`——为 §8.3 的机位选择提供数据（同一风格试 7 个机位，选玩家真正看到的那个）：

```js
const tryPose = (tag, px, pz, yaw, pitch) => {
  g.startRun(); for (const k of ['KeyW','KeyD','KeyA','KeyS']) g.setKey(k,false);
  g.player.x=px; g.player.z=pz; g.camRig.yaw=yaw; if (pitch!=null) g.camRig.pitch=pitch;
  for (let i=0;i<90;i++){ park(); g.update(1/60); }
  const r = window.__frameProbe(320,200);
  runs.push({ tag, mean:r.meanLuma, dark:r.darkPct, p05:r.p0_5, p995:r.p99_5, mid:r.midPct });
};
tryPose('home-default', g.player.x, g.player.z, g.camRig.yaw);   // <- 最终采用
tryPose('hub-0', 0, 8, 0);   // mean==p05==p995=219.6：机位被几何吃掉，整帧纯色
```

`hub-0` 那组「完全均匀」的输出正是角采样掩盖不了的第三种缺陷：机位插进光柱里，整帧一个色。

`dprobe.mjs`——定位 §8.5 的按键泄漏：在签名跑之后逐段快照
`{mode, time, px, pz, speed, yaw}`，看到「无输入静置 60 帧」里玩家从 (0,14) 飘到 (-5.38,13.73)，
方向恰为 `KeyD` 在 yaw=0 时的 right 向量 ⇒ 判定为遗留按键而非物理 bug。

`idx.mjs`——`index.html` 的渲染复核：`pageerror`/`requestfailed` 双监听 +
`[...document.images].map(i=>i.src+':'+i.naturalWidth)` + `a.play` 的 href 列表，
实测 6 张图全部 `naturalWidth=1280`、三链接指向三个 html、零失败请求。

`sig.mjs` / `win.mjs` / `qd.mjs` / `qd2.mjs`（本轮早段）分别用于：跨风格签名互等性、
胜利路径逐字段核对、`questDone` 假 bug 的序列化时机证明。

## 11. 台账写回

`state.json`：tried 15→16、runs 15→16、used_styles 45→48、environment_notes 84→90、
skills_seen 的 build-game 条目补第 2 次使用结论、next_candidates 移除两条已兑现 ★ 并新增 4 条。
`records/work-log.md` 追加一行（16 行时间戳 == 16 runs，`G9` 断言）。

## 12. 产物清单与磁盘纪律

```
index.html            15,935B  三风格对照入口（数字全部 import 自 themes.js）
seto-coast.html      779,274B  ┐
atlas-ochre.html     779,275B  ├ 自包含离线单文件（three.js 与全部代码内联）
nordic-night.html    779,276B  ┘
cdn/*.html           109,1xxB  三形态：改走 jsDelivr 加载 three 的对照版
references/*.png     6.8MB     三张 1536×1024 参考图（溯源证据）
shots/*.png          3.4MB     6 张真帧（title/world ×3）
src/                 112KB     engine.js 76.9KB · themes.js 21.2KB · hud.js 8.1KB · entry.js 1.2KB
scripts/             148KB     7 个 .mjs + 5 份 JSON（含 check-result.json 逐条结果）
```

合计 13MB（上限 50MB）。收尾删除：`LAB/.tmp` 全部（`refbuild/node_modules` 52MB + 8 个探针脚本
+ `index-shot.png`，探针内容先抄进 §10）、`/tmp` 下历轮遗留的 8 个 `.mjs`、空目录 `previews/`。
场景目录内零 `node_modules`/`dist`（`F` 组断言）；全程 `file://`，未起 http.server；
技能目录零写入；未修改实验室以外任何文件。

## 13. 未验项与下轮方向

未验：`scripts/serve.sh`、Phase 0 的 `/tmp/game-build` 迭代回路、`procedural-assets.md` 贴图上限、
移动端触控、真机帧率与 GC 预算（本轮只记 draw call/triangles）、headless 下 WebAudio 首触解锁、
**非照片类参考图**（手绘设定图没有天空/地面分区，`GROUND`「下半区面积冠军」与 `SUN`「最亮 2% 均值」
两条公式会退化，需要先能检测退化）。

下轮 ★（已写进 `next_candidates`）：

1. `build-game` × 手绘/设定图参考——把 Phase 1B 的另一半输入形态补上，重点是「公式退化检测式」。
2. 把「整帧跨步采样 + 参考色调带 `frame/ref ∈ 0.4..1.8`」移植回 `graphic-gif` 与 `ppt-generator` 轮：
   它们此前用的是角采样或绝对亮度档，同一条缺陷可能一直在假通过。
3. `build-game` × 性能预算档：帧 σ/色调带与 draw call 双约束，正好测 SSAO 那类「合规但无收益」的 pass。
4. `build-game` × 第一人称/载具：检验 `D1/D2/D3` 相机相对移动式子的普适性。
