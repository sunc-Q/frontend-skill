# 第 19 轮 · midi-generation（把实验室台账谱成一段 MIDI）

- **时间**：2026-09-26 14:37–14:47（约 10 分钟出产物，40 分钟全流程含验证/变异/记录）
- **Skill**：`midi-generation`（上游仓库 `tubone24/midi-agent-skill`，MIT）
- **来源**：Qoder 官方市场 `mcp__extension-market__search_extensions`，查询词 `midi` → 条目 `official_BatU2lbS / 迷你音乐专家… Midi生成`，publisher `majiayu000`，tags 含 `origin:modelscope`

## 获取方式（确切命令，两轮都要用得上）

```bash
# 1) 市场安装（走 Full Access，无需确认；装到全局技能库）
#    mcp__extension-market__install_extension({ installRef: "<search 返回的 installRef>" })
ls ~/.qoder-cn/skills/midi-generation        # → 只有 metadata.json + SKILL.md，scripts 全丢！

# 2) 关键补救：metadata.json 里有真仓库名，用 git SSH 浅克隆完整包到 LAB/.skills
cd /Users/apple/Documents/workProject/试验/skill演示场
git clone --depth 1 git@github.com:tubone24/midi-agent-skill.git .skills/midi-agent-skill

# 3) 依赖（纯 Python，无原生编译，3 秒）
python3 -m pip install --target .tmp/mlib midiutil -i https://mirrors.aliyun.com/pypi/simple/
```

## 它自称干什么

SKILL.md：「Generate MIDI files with GM instruments and music theory」——按音乐理论规则（不准相差半音同时发声、贝斯只弹根音/五音、声部跨八度铺开）把 composition JSON 渲染成标准 MIDI 文件。工作流强制 **只用它给的脚本**（`skills/{normalize,refine,generate}_composition/midi.py`），不许自己写 MIDI 代码；`convert_to_wav.py` 需要 FluidSynth + A320U.sf2 音色库。

## 本轮跑的小任务

给它一个贴合设计意图的活：**把本实验室 18 轮跑测的 `state.json.runs[].seconds` 谱成一段 11.25 秒的曲子**。

- 旋律轨（celesta）：18 轮时长 360s..1500s 线性映射到 C 宫五声阶梯 `C5 D5 E5 G5 A5 C6 D6 E6 G6 A6`（10 档，秒数越大音越高）
- 和声床：I–vi–IV–V–I，每 4 轮一组，根音轨 + 五音轨各 5 个音（时长 4/4/4/4/2 拍），贝斯轨只弹根音
- 第 8 轮 `sec-audit-cn` 台账里 `seconds: null` → 落在挂音 C5，作为「数据缺口」的可听标记

产物目录：`demos/20260926-1445-midi-generation/`

| 文件 | 是什么 |
|---|---|
| `skill-showcase-run-ledger-sonified.mid` | 主产物 460B，SMF format=1 / 5 track（含 midiutil 自带 tempo 轨）/ division 960 / 96BPM，sha256 `38b38392…` |
| `piano-roll.svg` | 1180×1870 钢琴卷帘：18 个旋律块 + 15 个伴奏块，逐拍标了 `#轮次:秒数`，肉眼可读 |
| `composition.json` / `mapping.json` | 喂给技能的曲谱 + 秒数→音高的完整对照表 |
| `build_composition.mjs` → `gen.py` → `verify.mjs` | 复现三件套：建谱 / 走技能脚本 / 独立断言 |
| `output.log` | 19/19 断言 + 4 个附录（技能自带 messy-input 归一化、坏音名错误路径、八度越界钳位、浏览器渲染断言） |

## 复现步骤（从零重建）

```bash
cd /Users/apple/Documents/workProject/试验/skill演示场/demos/20260926-1445-midi-generation
node build_composition.mjs                                   # 读 LAB/state/state.json 出曲谱
python3 gen.py ../../.skills/midi-agent-skill composition.json   # normalize→refine→generate，产出 .mid
node verify.mjs                                              # 手搓 SMF 解析器 + 19 条断言 + 3 个变异 + 重画 SVG
open piano-roll.svg                                          # 或用 Chrome 打开做 getComputedStyle 断言
```

## 验证结果

`verify.mjs` **19 PASS / 0 FAIL**，全部由自己写的 SMF 二进制解析器（变长 delta、running status、meta 事件）从 `.mid` 反读，与 `mapping.json` 逐音对账：

- A1–A4 结构：format/ntracks/division、轨名、通道 0/1/2/3 互不相同且不占 9（GM 鼓道）、程序号 `8,48,48,32` 与技能自己的 `resolve_instrument` 一致
- A5–A7 内容：18 个旋律音的音高/起始拍/时值全部等于台账换算结果；3 条伴奏轨各 5 音 4/4/4/4/2 拍
- A8：tempo meta 625000µs = 96BPM，全曲 18 拍 = 11.25s
- A9/A10/A11/A12：技能 SKILL.md 那 3 条「不协和规则」逐条量化——0 组同时发声音差 1 半音（33 音两两核）、贝斯音级全部属于当前和弦根/五音、每个和弦床恰是纯五度双音、旋律离伴奏最近 14 个半音
- A13/A14/A15：SVG 33 个音块 = 解析出的 33 个音；最长轮 #15 A6=1760Hz > 最短轮 #18 C5=523.25Hz；产物已归档且字节数与解析一致
- 变异对照（证明断言可失败）：M1 第 10 轮改 A5 → 只有旋律 idx 9 变了（`sha` 变，A5 抓到）；M2 贝斯首音改 C#3 → 半音探针从 0 变 1（A9 可红）；M3 bpm 96→90 → tempo meta 变 666666（A8 可红）；R1 复原后与 golden **逐字节相同**
- 浏览器侧（面板 hidden，按惯例用 DOM/computed style 断言）：SVG 打开后 `rect[rx=5]` = 33、`text` = 82、`getScreenCTM()` 非空、包围盒 1180×1870、四条轨的 fill 计数 18/5/5/5

## 效果结论：**留用（推荐）**

一句话：**它是这批技能里少见的「本机零网络、3 秒、零浏览器依赖」就能出可听产物的技能**，还自带一套可量化执行的音乐理论约束（不协和三条规则我用断言逐条验了），产物 .mid 只有 460B 却信息完整；五声音阶映射让台账数据第一次「能听」。缺点也真实：市场镜像丢脚本、WAV 通路要外部依赖。

留用价值：任何「数据→声音」的趣味可视化（跑测时长、行情波动、构建耗时）都能用它 5 分钟内出片。

## 踩的坑（写给下一轮）

1. **市场镜像又丢脚本了**：`~/.qoder-cn/skills/midi-generation/` 只有 `SKILL.md`+`metadata.json`，`skills/*.py`、`resources/*.md`、`midi_types/` 全没——但 **`metadata.json` 里带真仓库名 `repo: tubone24/midi-agent-skill`**，照着 `git@github.com:` SSH 浅克隆就补齐了。以后遇到市场包缺文件，第一步是读 metadata.json 找上游仓库，别急着判 blocked。
2. **midiutil 会额外插一条纯 tempo 轨**：`MIDIFile(4)` 产出 `ntracks=5`，轨 0 只有 setTempo+endOfTrack。按索引取「第 i 个乐器轨」会全部错位（我第一版 M1 变异断言就因此假红），要 `tracks.filter(t=>t.notes.length)`。
3. **generate_midi.py 每条轨是单声部串行**（`time += duration` 累加），**同一轨不能同时按两个音**——和弦必须拆成多条轨。SKILL.md 没写，读代码才发现。
4. **旋律与伴奏挤在同一音区时真会违反它自己的规则 3**：第一版旋律 C4–A5 与弦乐五音 D4 只差 2 个半音，A12 直接红；把旋律整体抬到 C5–A6 后最近距离 14 半音。→ 自动生成的音区一定要断言，别信「看起来分开了」。
5. **`parse_pitch` 对越界八度是静默钳位**：`C20`/`B20` → 127，不报错（附录 3）；只有非法音名 `H4` 才 warn+跳音（附录 2，产物 460B→451B 可核对）。喂脏数据时得自己校验音高区间。
6. **WAV 通路本机不可用**：`convert_to_wav.py` 需 `brew install fluidsynth` + 外网下 `A320U.sf2`（本机无 fluidsynth，且 soundfont 走 HTTPS 会被 TLS 重置）→ 本轮只交 .mid + SVG，音频播放留给用户本机 QuickTime/DAW。
7. `duration` 支持 `T4`/`T8` 三连音和 `32`，但 **不支持休止符**——休止只能靠「该轨不写音」，而那会让后续音整体前移（单声部累加导致）。数据里有 null 时只能像我这样换成挂音并显式标注。
8. 收尾：`.tmp/mlib`（midiutil）已删；`LAB/.skills/midi-agent-skill/output/` 里留了生成件（.gitignore 排除）；无监听端口、无残留进程（全程没起服务）。
