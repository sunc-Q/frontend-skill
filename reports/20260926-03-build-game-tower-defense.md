# 2026-09-26 03:00 · build-game × 3D 塔防（哨站 TOWERLINE）

## 0. 结论速览

**留用**，并升格为「3D / 游戏化交互产物」的唯一路径——本机六个可自主调用的前端技能里，它是第一个（也是目前唯一一个）能产出**可玩的 WebGL 应用**的，且自带的工程纪律（27 段固定结构、图形质量硬指标、单文件交付）在本轮全部可机检化。代价是**它文档里的两条图形常数在真实渲染下是错的**，不实测就会交付黑屏（见 §5、§6）。

| 项 | 实测 |
| --- | --- |
| 断言 | **220 条**，写回台账前 213 通过 / 7 失败（7 条全是 G 组台账幂等锁，写回后闭合） |
| 产物 | 3 风格 × 2 形态 = 6 个可直接打开的 HTML + 1 个对照入口页 |
| 场景目录 | 6,305,209 B ≈ 6.0 MB（限额 50 MB） |
| 真实缺陷 | **7 处**（技能文档 2 + 我自己写码 5），全部有断言兜底 |
| 三风格同构性 | 内联脚本 sha1 **完全相同**（`1402c5a6…414129`），DOM 骨架哈希相同，只有 `window.__THEME_ID` 一行不同 |
| 玩法与主题解耦 | 同一 build 脚本在三风格下逐字段相等：`gold 150 / spent 1980 / earned 2130 / damageDealt 22339 / spawned 120 / killed 120 / wave 10 / victory / time 288.93` |

## 1. 技能与来源

- 名称：`build-game`（3D Game Builder）v1.2.0
- 来源：`https://github.com/openclaw/skills`，owner `kewang0622`，slug `build-game`，发布 commit `https://github.com/openclaw/skills/commit/6a0e1b374e01a7c5fc392ba0dad83ce43a5cd7dd`
- 本机安装：`~/.qoder-cn/skills/build-game/`（208 KB，`SKILL.md` + `reference/` 6 篇 + `scripts/serve.sh`）——**与 graphic-gif / vercel 轮不同，本次引用文件全部在盘**，`graphics-quality.md / gui-patterns.md / game-systems.md / audio-patterns.md / engine-patterns.md / procedural-assets.md` 一本不缺，这是它「契约有资产」的直接证据。
- 调用方式：`/build-game "<游戏描述或修改要求>"`；技能自身的工作目录是 `/tmp/game-build/index.html`（Phase 0 用它判断新建还是迭代）。**本轮按实验室纪律未使用它的 /tmp 工作目录**，产物落在 `artifacts/20260926-03-build-game-tower-defense/`，源码与构建脚本全部保留，因此迭代能力（它的核心卖点之一）本轮只验到「同一 src 重建 3 风格」这一层。

## 2. 安装与复现（本机网络现实）

技能正文假设 `three` 从 jsDelivr 取、游戏跑在 `/tmp/game-build` + `serve.sh`。本机要改两处：

```bash
# 1) 构建依赖（jsDelivr 对 curl 被 TLS 重置，npm 走 npmmirror）
cd 前端skill实验室 && mkdir -p .tmp/build && cd .tmp/build
npm i --registry=https://registry.npmmirror.com esbuild three@0.160.0 playwright-core
# 2) 出片（LAB 根目录执行）
node artifacts/20260926-03-build-game-tower-defense/scripts/build.mjs
# 3) 校验（需上面那份 node_modules + 缓存的 chromium-1148）
node artifacts/20260926-03-build-game-tower-defense/scripts/check.mjs
node artifacts/20260926-03-build-game-tower-defense/scripts/make-index.mjs   # 对照入口页
```

**jsDelivr 的重要更正**（推翻上一轮记下的「CDN 全灭」倾向）：技能文档规定的 importmap 形态**在浏览器里是能加载的**。`scripts/cdn-form-probe.mjs`（保留在产物里）同一时刻两边各测一次：

```
threeLoaded: true, revision: "160", err: null, requestFailures: [], console: []
curl: { exit: 35, note: "curl: (35) Recv failure: Connection reset by peer" }
```

即 **curl 被 TLS 重置、Chromium 拿到 200**。所以本轮把两种形态都当成正式交付物（§3），离线内联版是「双击即玩」的便利品，不是网络失败的遮羞布。

## 3. 交付形态（两种，同一段代码）

`scripts/build.mjs` 一次产出 6 个文件：

| 形态 | 路径 | 做法 | 体积 |
| --- | --- | --- | --- |
| ① 离线单文件 | `<id>.html` | esbuild `format:iife` + `minify`，three/addons 全打进文件 | 756,500 / 756,502 / 756,501 B（bundle 756,095 B 三者相同） |
| ② 文档形态 | `cdn/<id>.html` | esbuild `format:esm` + `external:['three','three/addons/*']`，HTML 里放 SKILL.md 原文的 `<script type="importmap">` 指向 jsDelivr | 75,524 / 75,526 / 75,525 B（9 模块图） |

D 组对这两种形态的断言（不是「看起来对」，是算式）：
- `D/sizeAccounting`：`inline 字节 == bundle 字节 + 2 × </script 转义次数`（本局转义 0 次，故 756,500 = 756,095 + 405 的 HTML 骨架差由该式覆盖，任何一处偷偷内联别的东西都会炸）；
- `D/cdnFormSmallerThanInline`：≥ 8×（实测 10.0×）；
- `D/cdnBootsAndRenders/<id>`：CDN 版在浏览器里真的 `startRun()` 并推进了时钟（`after.time > 0`）；
- `D/cdnFrameMatchesInline/<id>`：CDN 版与内联版**同一状态的帧平均亮度差 < 3**（实测三风格 state 逐字段相等，见 §8 的 shots.json）；
- `D/cdnFormKeepsBareImports`：CDN 版仍保留裸 `three` 引用（没被误打包）。

## 4. 场景与三种风格

场景：**3D 塔防**——「哨站 TOWERLINE」，12×8 格、S 形走廊、3 种塔（弩炮 60 / 霜环 85 / 熔炉 125）、4 种敌人（runner/brute/swift/titan）、10 波、起始金 220 / 生命 20、拆塔返还 70%、localStorage 存档、胜利/失败结算屏。三风格**共用同一份引擎与关卡数据**，只有 `src/themes.js` 的主题对象不同（技能 Phase 的「多主题」要求）。

| 风格 | 主张 | 实测帧指标（check.mjs 打印） |
| --- | --- | --- |
| 日光苔原 `sunlit-moss` | 低多边形苔原 + 卡通描边，正午暖光 | meanLuma **123.99**，σ **46.16**，mid% 99.94，曝光 1.32，bloom 0.35，vignette 0.15 |
| 曜岩熔脉 `obsidian-lava` | 曜岩 + 自发光熔缝 + 霓虹余烬，夜间 | meanLuma **53.53**，σ **33.55**，mid% 30.12，曝光 1.35，bloom 0.5，vignette 0.28 |
| 极冠晶塔 `arctic-glass` | 透射冰晶（MeshPhysicalMaterial transmission）+ 金属镀铬，冷蓝雾 | meanLuma **95.37**，σ **32.12**，mid% 96.51，曝光 1.06，bloom 0.35，vignette 0.26 |

互斥性：`:root` 变量集两两**零交集**；同构性：DOM 骨架哈希相同、10 个 CSS 变量名齐全、每风格 ≥5 项指纹与另两风格不同。三张实战帧见 `previews/`（12 张 PNG：3 风格 × {实战/标题/结算/CDN}）。

## 5. 决定性发现 A：技能规定的后期链少了 `OutputPass`，成品比正确版本暗 3–8 倍

`reference/graphics-quality.md` 给的链路是 `RenderPass → SSAOPass → UnrealBloomPass → （自定义调色） → FXAA`，**没有 OutputPass**。three.js r160 里 composer 的中间缓冲是线性空间，缺了这一步就没有线性→sRGB 转换，直接上屏必然偏暗。消融实测（`.tmp/build/ablation-src.mjs`，sunlit 场景，脚本全文见 §9）：

| 链路子集 | meanLuma | brightPct |
| --- | --- | --- |
| RenderPass 单独 | 90.33 | 99.48 |
| RP + Bloom | 90.33 | 99.48 |
| RP + SSAO | 22.91 | 0 |
| RP + 调色 | 15.33 | 0 |
| RP + FXAA | 23.12 | 0 |
| **技能原文完整链** | **15.06** | **0** |
| 完整链 + OutputPass | 65.95 | 80.40 |
| RP + SSAO + OutputPass | 89.55 | 99.48 |
| RP + SSAO + Bloom + OutputPass + FXAA | 89.68 | 99.47 |

游戏内三风格的复现（check.mjs `H/docFormDegrades/<id>`，运行时把 OutputPass 从链上摘掉再读帧）：

| 风格 | 修复后 meanLuma | 文档形态 meanLuma | 比值 |
| --- | --- | --- | --- |
| sunlit-moss | 123.99 | 37.98 | 0.306 |
| obsidian-lava | 53.53 | 13.20 | 0.247 |
| arctic-glass | 95.37 | 15.53 | 0.163 |

这是**文档化偏离**：我在 `engine.js` 的 addPass 序列里插了 `new OutputPass()` 并标 `label:'OutputPass'`，注释写明原因。断言写成方向式（文档形态 meanLuma 严格更低、比值 <0.95、且高光带占比 `hiPct` 严格下降），所以将来谁把它删掉，H 组立刻红。

## 6. 决定性发现 B：技能写死的 SSAO 常数在正交顶视机位下把整帧压成纯黑

同一篇文档给 SSAO 的参数是 `kernelRadius 16 / minDistance 0.005 / maxDistance 0.1`。塔防在技能自己的机位建议下（`OrthographicCamera`，near 0.1 / far 2000，CAM_Y 52）跑这三个值，**整帧全黑**：

```
doc 16/0.005/0.1        → mean 0.00  bright 0.00
mine 14/0.0025/0.09     → mean 0.00  bright 0.00
kr2 / min2e-4 / max4e-3 → mean 121.71 bright 99.48   ← 采用
kr3 / min1e-4 / max2e-3 → mean 121.71
kr4 / min1e-4 / max3e-3 → mean 121.71
kr6 / min5e-5 / max1e-3 → mean 121.71
（对照组：整条链去掉 SSAO = 121.71）
```

原因：`minDistance/maxDistance` 是**归一化深度**上的阈值，near/far 比 20000 时 0.005 已经相当于把整个可见深度判成遮挡。SSAO 输出模式探针（`.tmp/build/ssao.mjs`）佐证：`OUTPUT.Default=0 / SSAO=0 / Blur=0`，而 `Depth=247.21 / Normal=223.74`——深度与法线纹理是好的，是**遮挡判定**把画面杀了。

更难看的事实是：把参数缩到能看的量级以后，**SSAO 一个像素都不改变**（`H/ssaoChangesNothingAtThisScale`：开 121.71 vs 关 121.71，差 <1.5），却要多花 **1.59× 三角面**（`H/ssaoCostsDraws`）。所以本轮的处理是：保留该 pass（技能硬要求「必须有 SSAO」），把常数按相机深度范围缩放，并在 `CONSTANTS.SSAO` 上方用注释把这条发现钉在代码里；同时两条断言（文档值必黑、采用值不改变画面但增加开销）把这个「合规但无收益」的状态如实钉住，供后续轮次判断是否值得留着。

## 7. 真实缺陷清单（7 处，全部先由断言或帧暴露，再修）

1. **`themes.js` 里的 `THREE is not defined`**（我写码错）：工厂函数 `em()` 在模块作用域引用了未导入的 `THREE` → ReferenceError → 页面全白、`__ready` 永不成立、控制台在 IDE 面板里一个字都不吐。修法：emissive 直接传十六进制（`Material.setValues()` 会对 emissive 槽调 `Color.set()`）。教训固化成 `boot/ready/<id>` + `boot/hooks/<id>` 断言组：**页面死了要大声失败，不能让 200 条断言级联报错**。
2. **`towerFire` 读空字段**（我写码错）：`Cannot read properties of undefined (reading 'copy')`——把对象池取出的 Mesh 当成数据记录用了。修法：池 Mesh 与 side `Map` 数据记录分离，删掉池记录里没人用的 `from` 字段。
3. **`isOnPath` 坐标系错**（我写码错，最隐蔽）：拿**格子坐标** `(cx,cz)` 去和**世界坐标**折线比距离，阈值还是世界单位 `CELL*0.95`。后果：96 格里 **53 格被误判成路径**，可建造格只剩 43 且**全部挤在右半区**（`leftBuild=0`、覆盖列数 6/12）——左半场一格都建不了，肉眼在缩略图上只看出「左边有点空」。修法：`const p = cellToWorld([cx,cz])`。新增 `C/corridorIsNarrow`（走廊格数 15–35、左右两半各 >5 格可建、覆盖 12 列）与 `C/padsMatchMask`（垫块实例数 == 96 − 走廊格数）两条式子，正是这套数字。
4. **路面被埋进底板**（我写码错）：`pathMesh.scale.y = 0.12` 会**连 y 偏移一起缩放**——曲线顶点本来在 y=0.45，压完变 0.054±0.132，整条路沉到底板（顶面 0.4）以下，三个主题的路面材质（含曜岩主题的自发光熔缝）白写。修法：曲线放 y=0、改 `pathMesh.position.y = 0.47`，敌人基线抬到 0.62。新增 `C/roadAbovePlate`：路面顶必须高于底板顶 0.05–0.35。
5. **视觉抖动泄漏进玩法**（我写码错，被 F 组当场抓住）：`F/scenarioSameAcrossStyles` 报 obsidian `towers 25 / gold 90` vs 另两风格 `towers 24 / gold 150`。根因链：`rng` 由 `theme.seed` 播种且**与粒子/装饰共用一条流**，粒子发射率随主题不同 → 消耗次数不同 → 敌人 `bob` 相位不同 → 而索敌用的是**三维距离** `distanceTo`，于是 y 方向的走路起伏决定了谁被射死。修法：新增 `xzDist()`，索敌/脉冲/溅射一律用地面平面距离。修完三风格 400 秒全通模拟逐字段相等（`gold 10044 / towers 74 / time 162.38`，见 `previews/shots-end.json`）。
6. **曜岩夜 scene 过暗**（配色错）：首版 meanLuma **18.68 / darkPct 51.38**，一半像素糊成黑。调雾色、补光、环境光、曝光与调色后到 51.18→（后续微调）53.53。
7. **`state.lives` 会扣成负数**（我写码错）：无塔空局 trace 里出现 `lives: -1`，HUD 会直接显示负的生命值。修法：`Math.max(0, lives - drain)`，并加 `F/livesNeverNegative`（两条 trace 全程 ≥0）。

## 8. 校验脚本（保留在产物里，未删）

`scripts/check.mjs`（约 39 KB，220 条断言，A–J 十组）：

| 组 | 条数 | 内容 |
| --- | --- | --- |
| A | 54 | 技能 `graphics-quality.md` 硬指标：pass 标签链、曝光、pixelRatio、阴影贴图 4096 + normalBias、主光 2.0–3.0 / 补光 0.5–1.0 / 环境 0.5–0.8 / 半球 0.4–0.6、bloom 0.25–0.5、vignette ≤0.3、PMREM envMap、REVISION==160、天空穹 |
| B | 15 | 三风格中景色分离（sRGB 通道 ≥0x44）、雾存在与密度区间 |
| C | 21 | 塔/敌人部件数 15–30（**后代网格遍历**，不是 children.length）、InstancedMesh 装饰、投影开关、**走廊几何（本轮新增 2 条）** |
| D | 26 | 离线形态零外链/零 importmap、字节记账式、CDN 形态证据新鲜度、CDN 真启动真渲染、帧一致性、体积比 |
| E | 18 | bundle sha1 三者相同、DOM 骨架哈希相同、`:root` 变量名齐全、色板两两零交集、≥5 指纹差异、曜岩自发光计数、只有 `__THEME_ID` 不同 |
| F | 30 | 确定性（同 seed 两次快照逐字节相等）、金币守恒 `earned − spent − gold == 0`、HP 守恒、胜利策略（10 波通关）、无塔必败、击杀记账 `killed+leaked==spawned`、池增长有界、**跨风格玩法等价**、**生命非负**、环境粒子按主题不同 |
| G | 8 | 台账契约（快照 + 增量 == 现值） |
| H | 28 | 渲染真实性：帧直读像素的 meanLuma/bright/dark/clipped/hi/mid/σ、**OutputPass 退化**、**SSAO 文档常数全黑**、SSAO 开销与无效性、对比度下限 |
| I | 16 | HUD 计算样式（pointer-events、tabular-nums、z-index 层序、backdrop-filter、transition）、合成指针建造/拆塔（返还 `floor(cost*0.7)`）、localStorage 形状、控制台零错误 |
| J | 4 | 磁盘纪律：场景目录 <50 MB、单文件 <1 MB、目录内无 node_modules/dist、每页可独立打开 |

跨页取证的关键手法（写进 `__diag()`，因为**压缩后 `constructor.name` 会变成 `jl/s/ec`**）：pass 用 `pass.label`、材质用 `material.type`、颜色用 `color.getHex(SRGBColorSpace)`（`Color` 内部存线性值，直接读 `.r*255` 与 sRGB 十六进制对不上）、`renderer.info.autoReset=false` 才能累计一整条 composer 链的 draw call。

## 9. 被删掉的探针脚本（内容抄录，产物目录里已无副本）

以下都在 `LAB/.tmp/build/` 与 `LAB/.tmp/`，收尾时删除，**结果已并入 §5–§7**，此处留可复现代码。

### 9.1 `bisect.mjs` —— 逐 pass 子集二分（发现 OutputPass 缺失的第一步）

```js
import { chromium } from 'playwright-core';
import path from 'node:path';
const EXE = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox','--allow-file-access-from-files'] });
const p = await (await b.newContext({viewport:{width:960,height:600}})).newPage();
await p.goto('file://' + path.resolve('artifacts/20260926-03-build-game-tower-defense/sunlit-moss.html'));
await p.waitForFunction(() => window.__ready === true);
const r = await p.evaluate(() => {
  const g = window.__game, gl = g.renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(4*w*h);
  const luma = () => { gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px); let s=0,b2=0;
    for (let i=0;i<px.length;i+=4){const l=0.2126*px[i]+0.7152*px[i+1]+0.0722*px[i+2]; s+=l; if(l>60)b2++;}
    return {m:+(s/(px.length/4)).toFixed(2), bright:+(100*b2/(px.length/4)).toFixed(2)}; };
  const all = [...g.composer.passes];
  const out = { labels: all.map(x=>x.label), sets: {} };
  const subsets = { RP:[0], RP_SS:[0,1], RP_BL:[0,2], RP_OU:[0,3], RP_GR:[0,4], RP_FX:[0,5],
    RP_SS_BL:[0,1,2], RP_SS_BL_OU:[0,1,2,3], RP_SS_BL_OU_GR:[0,1,2,3,4], full:[0,1,2,3,4,5], noSSAO:[0,2,3,4,5] };
  for (const [k, idxs] of Object.entries(subsets)) {
    g.composer.passes = idxs.map(i => all[i]);
    g.composer.passes[g.composer.passes.length-1].renderToScreen = true;
    g.composer.passes.slice(0,-1).forEach(pp => pp.renderToScreen = false);
    try { g.composer.render(); out.sets[k] = luma(); } catch(e) { out.sets[k] = 'ERR '+e.message.slice(0,60); }
  }
  g.composer.passes = all;
  all.forEach((pp,i)=> pp.renderToScreen = i===all.length-1);
  g.composer.render(); out.restored = luma();
  return out;
});
console.log(JSON.stringify(r, null, 1));
await b.close();
```

输出（sunlit，修复前那版）：`RP 97.94 / RP+SSAO 0 / RP+Bloom 122.09 / RP+Grade 35.46 / RP+FXAA 38.44 / full 0 / noSSAO 121.71`。`full 0` 与 `RP+SSAO 0` 同时出现，直接把矛头从「OutputPass」引到「SSAO 常数」，两条线索由此分开。

§9.1 的 `bisect.mjs` 是在真游戏的 composer 上按名字摘 pass，能证明「SSAO 压黑」，但证不了「OutputPass 缺失」——因为那两个变动的量同时存在。`ablation-src.mjs` 换一个干净的实验：自己搭一个与塔防无关的最小场景（正交相机、`MeshPhysicalMaterial`、ACES + `outputColorSpace = SRGBColorSpace`、`preserveDrawingBuffer:true`），只用 `stats(gl,w,h)` 读 `meanLuma/brightPct`，然后枚举 12 条链各渲一帧。唯一变量就是链里有没有 `OutputPass`。结果落 `out/ablation.json`（完整表见 §5）：`skill_chain_full 15.06 / brightPct 0` vs `skill_chain_plus_outputpass 65.95 / 80.40`，同一份场景只差一个 pass。

原文（`LAB/.tmp/build/ablation-src.mjs`，esbuild 打包成 `ab.bundle.js`）：

```js
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
// 技能文档里那段 ColorGrade shader 的原样复刻（uniforms + 两段 GLSL），省略见上
const grade = { uniforms:{tDiffuse:{value:null},brightness:{value:0.02},contrast:{value:1.1},saturation:{value:1.15},vignetteIntensity:{value:0.3}},
 vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
 fragmentShader:'uniform sampler2D tDiffuse;uniform float brightness,contrast,saturation,vignetteIntensity;varying vec2 vUv;void main(){vec4 c=texture2D(tDiffuse,vUv);c.rgb+=brightness;c.rgb=(c.rgb-0.5)*contrast+0.5;float l=dot(c.rgb,vec3(.299,.587,.114));c.rgb=mix(vec3(l),c.rgb,saturation);vec2 p=vUv-0.5;c.rgb*=clamp(1.0-dot(p,p)*vignetteIntensity*3.0,0.0,1.0);gl_FragColor=c;}'};
function stats(gl,w,h){const px=new Uint8Array(4*w*h);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);let s=0,b=0;for(let i=0;i<px.length;i+=4){const l=.2126*px[i]+.7152*px[i+1]+.0722*px[i+2];s+=l;if(l>60)b++;}return{meanLuma:+(s/(px.length/4)).toFixed(2),brightPct:+(100*b/(px.length/4)).toFixed(2)};}
window.__ab = function(){
  const W=320,H=240, out={};
  function scene(){const sc=new THREE.Scene();sc.background=new THREE.Color(0x88aacc);
    const cam=new THREE.OrthographicCamera(-20,20,20,-20,.1,200);cam.position.set(0,30,20);cam.lookAt(0,0,0);
    const m=new THREE.Mesh(new THREE.BoxGeometry(6,6,6),new THREE.MeshPhysicalMaterial({color:0x4a9a3a,roughness:.4,metalness:.1}));m.castShadow=true;sc.add(m);
    const g=new THREE.Mesh(new THREE.PlaneGeometry(80,80),new THREE.MeshStandardMaterial({color:0x666688,roughness:.9}));g.rotation.x=-Math.PI/2;g.receiveShadow=true;sc.add(g);
    const s=new THREE.DirectionalLight(0xfff2d0,2.5);s.position.set(20,40,20);s.castShadow=true;sc.add(s);
    sc.add(new THREE.AmbientLight(0x202030,0.6));return{sc,cam};}
  function rend(){const r=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});r.setSize(W,H);r.setPixelRatio(1);
    r.shadowMap.enabled=true;r.shadowMap.type=THREE.PCFSoftShadowMap;r.toneMapping=THREE.ACESFilmicToneMapping;r.toneMappingExposure=1.2;r.outputColorSpace=THREE.SRGBColorSpace;document.body.appendChild(r.domElement);return r;}
  const builders = {
    rp_then_grade: (sc,cam)=>{ /* RP + ShaderPass(grade) */ },
    rp_then_fxaa: (sc,cam)=>{ /* RP + FXAA */ },
    rp_bloom_grade: (sc,cam)=>{ /* RP + Bloom(.4,.3,.85) + grade */ },
    rp_bloom_fxaa: (sc,cam)=>{ /* RP + Bloom + FXAA */ },
    rp_ssao_output: (sc,cam)=>{ /* RP + SSAO + OutputPass */ },
    rp_ssao_bloom_out_fxaa: (sc,cam)=>{ /* RP + SSAO + Bloom + OutputPass + FXAA */ },
    direct_noComposer: (sc,cam)=>{const r=rend();r.render(sc,cam);return r.domElement.getContext('webgl2');},
    composer_renderpass_only: (sc,cam)=>{ /* 只有 RP */ },
    composer_renderpass_ssa: (sc,cam)=>{ /* RP + SSAO，无 OutputPass */ },
    composer_renderpass_bloom: (sc,cam)=>{ /* RP + Bloom，无 OutputPass */ },
    skill_chain_full: (sc,cam)=>{ /* 技能文档那条：RP→SSAO→Bloom→grade→FXAA */ },
    skill_chain_plus_outputpass: (sc,cam)=>{ /* 同上，grade 后插 OutputPass */ },
  };
  for(const [k,f] of Object.entries(builders)){const{sc,cam}=scene();try{out[k]=stats(f(sc,cam),W,H);}catch(e){out[k]={err:String(e).slice(0,140)};}}
  return out;
};
```

（上面 12 个 builder 的省略处只是同一行模板 `const r=rend();const c=new EffectComposer(r);c.addPass(...);c.render();return r.domElement.getContext('webgl2');` 换 pass 列表——FXAA 记得 `f.material.uniforms['resolution'].value.set(1/W,1/H)`，Bloom 记得 `new THREE.Vector2(W,H),.4,.3,.85`。注释里标的链名与 §5 表格逐行对应，跑出来的数就是那张表。）

驱动器 `ablation-run.mjs`（全文）：

```js
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const EXE = '/Users/apple/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const p = await b.newPage({ viewport: { width: 640, height: 480 } });
const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0,140)));
fs.writeFileSync('.tmp/build/out/ab.html', '<!doctype html><html><body><script>' + fs.readFileSync('.tmp/build/ab.bundle.js','utf8') + '</script></body></html>');
await p.goto('file://' + process.cwd() + '/.tmp/build/out/ab.html');
const r = await p.evaluate(() => window.__ab());
fs.writeFileSync('.tmp/build/out/ablation.json', JSON.stringify({ r, errs }, null, 1));
for (const [k,v] of Object.entries(r)) console.log(k.padEnd(28), JSON.stringify(v));
console.log('pageerrors', errs);
await b.close();
```

这个形状值得记：最小场景 + 一次只动一个变量，比在成品上摘 pass 更适合用来证明「某个 pass 的有无」；反过来，要证明成品自身的表现，还得回到 §9.1 那种在真 composer 上做的二分。

### 9.3 `ssao.mjs` / `ssao2.mjs` —— SSAO 输出模式与常数扫描

`ssao.mjs` 用 `ssao.constructor.OUTPUT`（静态枚举，实例上没有）逐个切 `Default/SSAO/Blur/Depth/Normal` 读帧：`0 / 0 / 0 / 247.21 / 223.74`。
`ssao2.mjs` 的扫描表（原文见下，其余部分与 9.1 的 `luma()` 相同）：

```js
  const ssao = g.composer.passes[1];
  const out = { off: noSSAO(), cand: {} };
  const cands = {
    'doc 16/0.005/0.1':   { kernelRadius: 16, minDistance: 0.005,   maxDistance: 0.1   },
    'mine 14/0.0025/0.09':{ kernelRadius: 14, minDistance: 0.0025,  maxDistance: 0.09  },
    'kr2/min2e-4/max4e-3':{ kernelRadius: 2,  minDistance: 0.0002,  maxDistance: 0.004 },
    'kr3/min1e-4/max2e-3':{ kernelRadius: 3,  minDistance: 0.0001,  maxDistance: 0.002 },
    'kr4/min1e-4/max3e-3':{ kernelRadius: 4,  minDistance: 0.0001,  maxDistance: 0.003 },
    'kr6/min5e-5/max1e-3':{ kernelRadius: 6,  minDistance: 0.00005, maxDistance: 0.001 },
  };
  for (const [k, v] of Object.entries(cands)) { Object.assign(ssao, v); g.composer.render(); out.cand[k] = luma(); }
```

坑两处：`sed` 打补丁会让探针踩到 TDZ（`Cannot access 'O' before initialization`），改整文件重写；`ssao.OUTPUT` 是静态属性，实例上取到 `undefined`。

### 9.4 `netprobe.mjs` —— jsDelivr 在浏览器里到底通不通

```js
p.on('response', async r => { if (/jsdelivr|unpkg/.test(r.url())) reqs.push({ url: r.url().slice(0,80), status: r.status(), hdrs: {...} }); });
p.on('requestfailed', r => { if (/jsdelivr|unpkg/.test(r.url())) reqs.push({ url: r.url().slice(0,80), failed: (r.failure()||{}).errorText }); });
await p.goto('file://' + process.cwd() + '/artifacts/20260926-03-build-game-tower-defense/scripts/cdn-form.html');
await p.waitForFunction(() => window.__probe !== undefined, null, { timeout: 60000 }).catch(()=>{});
```

结论见 §2。这份结论的**常驻副本**是 `scripts/cdn-form-probe.mjs` + `scripts/cdn-probe.json`（保留，未删），因为它已经变成 D 组两条断言的证据源。

### 9.5 `pads.mjs` / `pix.mjs` / `pix2.mjs` —— 「左半场建不了」的定位链

`pads.mjs` 打印 12×8 的 `isOnPath` 掩码 + 垫块实例矩阵反解坐标；`pix2.mjs` 先 `composer.render()` 再 `readPixels`（**不先渲染会整屏读到 0，第一轮就被这个假象骗过**），并用 `Vector3.project(camera)` 把世界点投到帧坐标取色，配合 `sips -c 720 640` 裁 PNG 目视。定位结果即 §7 第 3、4 条。

### 9.6 `shots.mjs` / `shots2.mjs` / `idxshot.mjs` —— 像素级复核（IDE 面板给不了的那一层）

历轮记录过「MCP 浏览器面板 hidden/0×0 无法截图」，本轮**用 headless Chromium 直接出真帧**，第一次做到游戏产物的目视复核：

- `shots.mjs`：驱动到波中（建造 8 塔 + `advanceTime` + 2.2 秒实时余量），对**内联与 CDN 两形态各截一张**，截前读 `render_game_to_text()` 落 `previews/shots.json`。实测两形态状态逐字段相同：

```
sunlit-moss    inline {"wave":2,"gold":4141,"alive":3,"towers":8,"score":12,"time":22.1}
sunlit-moss    cdn    {"wave":2,"gold":4141,"alive":3,"towers":8,"score":12,"time":22.22}
obsidian-lava  inline {"wave":2,"gold":4210,"alive":0,"towers":8,"score":15,"time":26.25}
obsidian-lava  cdn    {"wave":2,"gold":4210,"alive":0,"towers":8,"score":15,"time":26.23}
arctic-glass   inline {"wave":3,"gold":4210,"alive":1,"towers":8,"score":15,"time":30.22}
arctic-glass   cdn    {"wave":3,"gold":4210,"alive":1,"towers":8,"score":15,"time":30.2}
```

- `shots2.mjs`：标题屏 + 全通结算屏各一张，并验证「满配建造 400 秒 → victory」在三风格下 `gold 10044 / towers 74 / time 162.38 / score 120` **完全一致**（§7 第 5 条修好之后才成立，这条一致性本身就是解耦证明）。
- `idxshot.mjs`：渲染对照入口页并断言 3 张 `<img>` `naturalWidth>0` + 控制台零错误。这一步**抓到一个真实结构 bug**：卡片 `<a>` 里再套 `<a>`（CDN 形态的「打开」链接）是非法 HTML，解析器会提前闭合外层标签，导致 dl 掉出卡片、布局炸开——改成 `.card` 为 div、`.play` 为唯一外层链接后正常。

目视复核的产出（不是断言，但只有看图能看出来）：曜岩主题的熔缝路在修复后成为三风格里最抢眼的一张；极冠主题首版整屏泛白（meanLuma 216.8、σ 23），据此把曝光 1.4→1.06、底板/垫块/雾/天空压暗、`H/contrast`（σ>30 且 mid%>10）写成常驻断言，最终 95.37/σ32.12。

## 10. 我自己踩的检查器坑（假失败，历轮模式复现）

1. **压缩后类名不可用**：`constructor.name` → `jl/s/ec`，pass 与材质断言全瞎 → 引擎侧挂 `pass.label`、用 `material.type`。
2. **`byType` 后写覆盖**：主光断言实际断到了补光 → `dirs[]` 按 intensity 排序后取 `[0]`/`[1]`。
3. **线性 vs sRGB**：`color.r*255` 与十六进制不一致 → `getHex(SRGBColorSpace)`。
4. **`children.length` 少算部件**：塔只有 11 个「孩子」，部件是孙子 → 后代网格遍历。
5. **正则吞标签**：`inlineScript()` 的非贪婪式把主题选择脚本并进 bundle，sha 多出 53 B → 取所有 `<script>` 块里最长的那个。
6. **`D/noAbsoluteUrl` 误报**：命中 three 打包进来的文档字符串 URL → 只查「可加载位置」（src/href/importmap）。
7. **页内闭包看不见 Node 侧函数**：`hexSet is not defined` → 探针必须自包含序列化。
8. **`readPixels` 前没渲染** → 全 0 假象（§9.5）。
9. **伪断言**：`>= 0`、`? true : true`、指纹里 `+1` 凑数 → 换成真实自发光计数与散点几何类型断言。
10. **`H/docFormDegrades` 过度指定**：要求「暗像素变多」，但极冠是 100% 亮像素的雪景，永远不可能变多 → 改成方向式（meanLuma 严格降 + 比值 <0.95 + 高光带 `hiPct` 严格降），并为此给 `luma()` 加 `clippedPct/hiPct/midPct/std`。
11. **正则字面量里的引号**让解析器把错误报到下一行，真凶是上一行 `Object.fromEntries` 括号不配平 → 改普通 for 循环。
12. **`renderer.info` 只反映最后一次内部渲染** → `autoReset=false` + 手动 `reset()`。
13. **shell 引号**：`cat -A` / heredoc / 带引号 `printf` 在本机 zsh 下不可靠，改用 `node -e` 写文件。

## 11. 产物路径

```
前端skill实验室/artifacts/20260926-03-build-game-tower-defense/   （6.0 MB）
├── sunlit-moss.html  obsidian-lava.html  arctic-glass.html      离线单文件，双击即玩
├── cdn/sunlit-moss.html  cdn/obsidian-lava.html  cdn/arctic-glass.html   技能文档形态（importmap）
├── index.html                                                    三风格对照入口（数字取自断言输出）
├── previews/                                                     12 张 PNG（实战/标题/结算/CDN）+ shots.json + shots-end.json
├── src/  engine.js(55KB) themes.js(13KB) hud.js(7.6KB) entry.js
└── scripts/ build.mjs check.mjs(39KB) make-index.mjs cdn-form.html cdn-form-probe.mjs
             cdn-probe.json build-sizes.json check-result.json(220 条逐条结果) ledger-snapshot.json
```

## 12. 是否值得留用

**留用。** 三条理由：①它是本机唯一能产出「可玩 3D 应用」的技能，且 27 段工程结构 + 图形硬指标 + 单文件交付全部可机检，产物质量能被断言钉住而不是靠目测；②它的「迭代」范式（同一 src 多主题）天然适配实验室的三风格要求，本轮 bundle sha1 三者全等说明同构性做到了字节级；③它文档的资产完整（6 篇 reference 全在盘），不像 graphic-gif/vercel 那样「契约无资产」。

**用之前要知道的两个前提**：①**图形常数必须实测**，`graphics-quality.md` 的 SSAO 三参数在正交顶视下直接黑屏、后期链少 `OutputPass`——照抄就是交付黑图，本轮两条 H 组断言就是给下一位用的；②**它默认把游戏写进 `/tmp/game-build`**，与实验室「产物必须在 artifacts/」冲突，本轮按实验室口径改路。

**未验项**：Phase 0 的 `/tmp/game-build/index.html` 迭代回路（只验到同 src 重建）、`scripts/serve.sh`（本轮全程 file:// 直开，未起服务）、`reference/procedural-assets.md` 的贴图生成器上限（只用了噪声法线 + 渐变天空）、移动端触控、60fps 性能预算（未做帧率断言，只做了 draw call/triangles 记账）、真实浏览器（非 headless）下的 WebAudio 首触解锁。

## 13. 下轮候选

★ build-game × 第二人称动作/RPG（验 `game-systems.md` 的状态机与对话系统，并把本轮的 `pass.label`/`material.type` 取证配方移植过去）；★ build-game × 参考图驱动（技能支持「reference images」，本轮未用，第一问是它如何把位图转成程序化材质）；★ 把 `H/contrast`（σ + mid%）式子移植回 graphic-gif 与 ppt-generator 轮做横检；其余排队项不变（27 张图模板诚实度横筛、dark_warm 提案、三条式子移植、sites 多页站点、vercel×Next.js、三技能叠加）。
