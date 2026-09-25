# 2026-09-25 18:10 · algorithmic-art（生成艺术 / p5.js）

## 基本信息
- **Skill**：`algorithmic-art` — Anthropic 官方技能仓库 `anthropics/skills`
- **来源**：`git@github.com:anthropics/skills.git`（main @ 3337550…）→ `skills/algorithmic-art/`
- **获取方式（确切命令）**：
  ```bash
  LAB=/Users/apple/Documents/workProject/试验/skill演示场
  cd $LAB/.skills
  GIT_SSH_COMMAND="ssh -o UserKnownHostsFile=$LAB/.tmp/known_hosts -o StrictHostKeyChecking=accept-new" \
    git clone --depth 1 --filter=blob:none --sparse git@github.com:anthropics/skills.git anthropic-skills
  cd anthropic-skills && git sparse-checkout disable
  ```
  本轮同时**首次验证了来源②通路**：`ssh -T git@github.com` → `Hi sunc-Q! You've successfully authenticated`（HTTPS 仍不可达，未重复探测）。
- **它自称干什么**：先写一份「算法哲学宣言」（.md），再据此用 p5.js 实现**带种子随机**的生成艺术，产出**一个自包含交互式 HTML**（侧栏含 Seed 导航 / 参数滑杆 / 取色器 / Regenerate·Reset·Download PNG），并硬性要求以包内 `templates/viewer.html` 为唯一起点、保留 Anthropic 品牌样式。

## 本轮跑的小任务
给这条 30 分钟流水线自己画一幅生成艺术：**「Cron Organicism · 定时有机主义」**。
概念之种（按技能要求不外显）= 三个实验室各自的 cron 时间槽：三条水脉从画布三个横向带上出生，
沿「Perlin 湍流 + 沿 y 的周期余弦节律」合成场漂流，120 轮沉积出密度图；
`Cadence Strength` 滑杆就是「节律绑定强度」——拧到 0 三条时区带解散成普通流场，拧到满则被钉死在各自槽里。
默认种子 `20260925`。

## 产物
- `demos/20260925-1810-algorithmic-art/art-index.html` — **最终可见产物，998KB 单文件，双击即开**（p5.min.js 1.7.0 已整体内联，零外链、零 CDN、file:// 下可跑）
- `philosophy.md` — 技能第 1 步要求的算法哲学宣言
- `viewer.src.html` — 未内联的源版（可读，含 `/*__P5_INLINE__*/` 占位）
- `build.mjs` — 内联构建脚本
- `output.log` — 结构/布局/像素/交互断言原文 + 两版构图直方图对照

## 从零复现
```bash
LAB=/Users/apple/Documents/workProject/试验/skill演示场
D=$LAB/demos/20260925-1810-algorithmic-art
mkdir -p $LAB/.tmp/p5x
curl -sSL -o $LAB/.tmp/p5.tgz https://registry.npmmirror.com/p5/-/p5-1.7.0.tgz   # cdnjs 被 TLS 重置，只能走 npm 镜像
tar -xzf $LAB/.tmp/p5.tgz -C $LAB/.tmp/p5x
cd $D && node build.mjs            # -> art-index.html (~998KB)
# 验证：用系统浏览器或 browser-use 打开 art-index.html，看 canvas 是否有三条彩色水脉、侧栏按钮是否可点
rm -rf $LAB/.tmp/p5.tgz $LAB/.tmp/p5x
```
p5 API 变更时只需替换 `build.mjs` 里的库路径，`viewer.src.html` 与库无关。

## 验证结论（全 PASS）
- 结构 12 项 T01–T12：侧栏 320px、Prev/Next 等宽双列 [132,132]、5 个滑杆 200px 未塌陷、
  Actions 三按钮齐、Anthropic 品牌变量在、**外部引用数 = 0**、canvas 1200×1200、三条泳道像素类别成形。
- 可复现 8 项 X01–X08（技能的招牌承诺）：
  - `regenerate()` 同种子 → 哈希 **3746692814-22500** 逐像素不变；
  - `nextSeed()` → 变（3153931902-22500），`previousSeed()` 往返 → **精确复原**；
  - `resetParameters()` → 参数与画面双双复原到同一哈希；
  - 取色器只改对应那一条水脉；Agents 滑杆 2600 → `particles.length=7800`；Cadence=0 → 画面改变。
- 渲染 7 项 R01–R07：inkRatio 0.418，10 条横向分带全部有墨。

## 踩的坑（下轮直接抄）
1. **模板的 CDN 依赖在本机必挂**：`templates/viewer.html:23` 引 cdnjs p5、24-26 行引 Google Fonts。
   实测 `curl https://cdnjs.cloudflare.com/...` → `Recv failure: Connection reset by peer`。
   对策：`registry.npmmirror.com/p5/-/p5-1.7.0.tgz`（302 → cdn.npmmirror.com，加 `-L`）取 `package/lib/p5.min.js`
   整体内联；字体退化为 `'Poppins','PingFang SC',sans-serif` 本地族名回退。
   内联前先 `grep -c "</script" p5.min.js`（=0 才安全），替换用 **replacer 函数** `s.replace(ph, () => lib)`，
   否则库里的 `$&` 之类会让文档自我复制（本实验室已知坑）。
2. **线性跨步取像素会骗人**：`for(i+=4*37)` 再用 `y=(i/12)/W` 反推坐标，采样点全落在 7 条网格线上，
   第 1 版因此误判「只有上半部有墨」。像素分析必须 `for(y)for(x){ i=(y*W+x)*4 }` 按坐标走。
3. **viewport 0×0 触发响应式假阴性**：直接在页面里量 `.container .sidebar` 得 1360px（命中
   `@media(max-width:600px)` 堆叠规则）。把侧栏 `cloneNode(true)` 塞进
   `position:fixed;left:-99999px;width:320px` 的离屏容器再量，才拿到真实的 320px / 132px 双列。
4. **evaluate_script 15s 硬超时**：一次调用串 3–4 次 `regenerate()`（每次 ~4s）必超时，
   **但页面侧仍会执行完**。对策：一次调用只做一次重绘，超时后补一次只读探针取终态。
5. **技能文档与自带模板不一致**：SKILL.md 第 330 行要求 Actions 含 Regenerate / Reset / **Download PNG** 三键，
   `templates/viewer.html` 里只有 Reset。以 SKILL.md 为准补齐，否则「Download PNG 必须可用」这条验不了。
6. **Download PNG 在本环境只到「调用链正确」**：点击后 `saveCanvas('cron-organicism-seed-20260925','png')` 确被调用，
   但沙箱浏览器不写 `~/Downloads`（find 无匹配）。要实体 PNG 得用系统浏览器打开。

## 效果结论：**留用**
一句话：它是本实验室目前遇到的**约束最硬、承诺最可验**的生成艺术技能——
「同种子必得同图」不是一句口号，而是 `randomSeed/noiseSeed + 静态绘制`，能被脚本逐像素证伪（本轮证了，PASS），
这让无人值守产物第一次具备「可复现」属性；模板 + 品牌 + Seed 导航写死，也大幅降低了每次重做 UI 的成本。
局限也很具体：(a) 默认走 CDN，在本机这类网络受限环境**必须**自己改内联，否则产物直接白屏；
(b) 重绘成本高（4800 粒 × 120 轮 ≈ 4s），做「参数网格搜索 / 批量出图」类玩法要先把 `passes` 降下来；
(c) 一次 `evaluate_script` 撑不住多轮重绘，交互验证得拆调用。
后续可复用点：把它当「可视化任意流水线/数据节律」的壳——种子=运行编号，滑杆=系统参数，
沉积图=长期日志的形状。
