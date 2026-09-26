# 第 22 轮 · audio-editing-automation（FFmpeg 音频自动化）

- 时间：2026-09-26 16:05–16:25（+08:00）
- 结论：**留用（推荐）**
- 产物类型：**真实可听的音频成品**（.mp3 / .m4a）——本实验室第 1 次出音频类产物，此前只有 .mid（第 19 轮）

## 1. 技能与获取方式

| 项 | 值 |
|---|---|
| 名称 | `audio-editing-automation`（canonicalName `majiayu000-audio-editing-automation`） |
| 来源 | Qoder 官方扩展市场 `official_RFge26r7`，publisher `majiayu000`，tags `origin:modelscope` |
| 获取 | `mcp__extension-market__search_extensions({query:"audio",kinds:["skill"]})` → `install_extension({installRef:"ext_..."})`（一次性 ref，不硬编码） |
| 落地 | `~/.qoder-cn/skills/audio-editing-automation/`（市场安装不能改路径），只读快照放进 `LAB/skills/audio-editing-automation/`（去写权限）并登记进 `skills/manifest.json` |
| 包体 | **仅 SKILL.md（119 行）+ metadata.json，零 scripts / 零 references / 零网络** |

**安全闸门：PASS。** 通读 SKILL.md 全文：内容全是本地 `ffmpeg` 命令与 Python `subprocess` 片段，输入输出路径由调用方给定，不读凭据、不外发内容、不碰 LAB 外文件。唯一"实现层"是 ffmpeg 本身（本机 `~/.local/bin/ffmpeg` 9.0.1 已装）。

**它自称干什么**：FFmpeg 音频处理、批量编辑、响度归一化、混音与自动化音频制作流水线，并给了三档平台交付规格（Podcast / ACX 有声书 / YouTube）。

## 2. 本轮跑的小任务（贴合它的设计意图）

按它自己的 `Automation Workflow`（归一化 → 混音 → 二次归一化 → 多平台导出）搭一条**本地播客后期流水线**，原料也不联网：

- 语音：macOS 自带 `say -v Ting-Ting -r 185`（24.24s 中文口播，纯本地 TTS，零凭据）
- 音乐床：`ffmpeg -f lavfi -i aevalsrc=<A3/C#4/E4/A4 四个正弦>|<同>:s=44100:d=40 -af tremolo`
- 处理：技能给的两遍法 `loudnorm=I=-16:TP=-1.5:LRA=11`（先 `print_format=json` 取实测再回填 `measured_*`）→ `[1:a]volume=0.3[bg];[0:a][bg]amix=duration=first` → 二次 loudnorm → 按三档规格导出

## 3. 产物

```
demos/20260926-1610-audio-editing-automation/
├── listen.html                  ← 打开即可试听（4 个 <audio> + 4 张图，相对路径，file:// 直用）
├── out/podcast.mp3              583,723B  MP3 192k / 44.1kHz / 实测 −16.2 LUFS
├── out/audiobook.mp3            583,723B  MP3 192k / 峰值 −5.8dBFS / RMS −20.15dB / 底噪 −84.7dB
├── out/youtube.m4a              581,069B  AAC 192k / 48kHz / 实测 −14.2 LUFS
├── out/wave_{voice_raw,voice_normalized,mixed,podcast}.png   4 张 1400×240 波形
├── out/spec_final.png           1400×420 频谱图
├── inputs/voice_raw.aiff        处理前原料（前后对照）
├── mutation/{m1,m2,not_audio}   3 个变异/负对照件
├── evidence/measurements.json   全部实测数字
├── evidence/browser-evidence.txt 浏览器真加载转录
├── pipeline.py / verify.py / output.log / verify.log
```
本轮 demos 目录 4.9MB（上限 5MB 软 / 20MB 硬）。

## 4. 复现步骤（从零）

```bash
cd LAB/demos/20260926-1610-audio-editing-automation
python3 pipeline.py            # 出原料 + 三档成品 + 波形/频谱，日志 -> output.log
python3 verify.py              # 42 条断言，退出码 0 = 全绿
open listen.html               # 浏览器点试听
```

## 5. 取证（42/42 PASS）

- **B 组｜技能自称规格 vs 实测**（`ebur128` 集成响度 + 真峰值、`astats` RMS/底噪、`ffprobe` 编解码/采样率/码率）：
  podcast I=−16.20（目标 −16±0.5）TP=−1.80（≤−1）；youtube I=−14.20（目标 −14）TP=−1.50（≤−1.5）；audiobook TP=−5.80（≤−3）、RMS=−20.15（−18~−23 带内）、底噪=−84.69dBFS（≤−60）；三档码率 191.3k~192.6k。
- **C 组｜增益真的来自本管线**：原始语音 I=−18.40 / TP=−2.90（处理前**不达标**）→ 归一化后 −16.00；`duration=first` 使混音停在 24.243s（音乐床 40s）；语音间隙底噪从 **数字零（−inf，合成语音真有一个非零采样都没有）** 变成 −21.0dB（音乐床留下了）；未 ducking 版底噪 −10.8dB。
- **★跨介质对账**：用纯静音参考波形求出背景亮度 Y=16，由"波形图墨量"反推归一化增益 = **2.48 dB**，与 `ebur128` 实测 **2.40 dB** 相差 0.08 dB —— 像素侧与音频侧两条独立路径对上。
- **D 组｜变异不是自我证明**：M1 把 YouTube 目标 −14 改成 −19 → 实测 I=−19.10（跟着动），且用 −14 规格卡它会红；M2 整链去掉 loudnorm → I=−13.70 / **TP=+0.6dBFS 削顶**，响度与峰值闸门同时红；M3 `duration=first`→`longest` → 时长变 40.000s，时长断言红；负对照：手搓的假 mp3（纯文本字节）ffprobe 拿不到音频流。
- **E 组｜第二套解析器交叉回读**：手写 ITU-R BS.1770（K-weighting 双二阶 + 400ms/75% 重叠门控 + 绝对 −70 / 相对 −10 两级门控）纯 Python 复算 LUFS：−16.23 / −14.24 / −15.98，与 ffmpeg ebur128 差 ≤0.05 LU。
- **浏览器侧**：`listen.html` 在 file:// 下 4 张图 naturalWidth 全部非 0（1400×240 ×3、1400×420），4 个 `<audio>` 设 `preload=auto` 后 duration = 24.243/24.243/24.3/24.243、`error=null` —— 与 ffprobe 一致，说明是真能播的音频，不是标签。

## 6. 踩的坑（写给下一轮）

1. **`showspectrum` 在本机 ffmpeg 9.0.1 没有 `mode=line`/`combined` 常量**（`Undefined constant or missing '(' in 'line'`），mode 只认整数；去掉 `mode=` 用默认即可出图。
2. **`amix` 会把输出拉成单声道**：语音是 `say` 出的 mono，与 stereo 音乐床混合后成品是 **mono**（`channels=1`）。做 LUFS 手写复算时若硬套 `-ac 2` 对偶单声道求和会多算 +3dB —— 按源文件真实声道数解码才对（实测两者这次巧合相等，别指望）。
3. **`astats` 不是 `key=value` 而是 `key: value`，且先按通道打印、最后才是 Overall**：取"每个键最后一次出现"才等于 Overall；纯静音间隙的 `Noise floor dB` 打印 **`-inf`**，float() 会炸，要显式当哨兵。
4. **写错的 K-weighting 第二级状态更新（`y1,y2` 赋值顺序颠倒）把信号衰减了 16.8 dB** —— 正是 E 组的第二解析器把它抓出来的。教训：自写实现必须和第二解析器对账，只看"跑通了"完全看不出来。
5. **ACX 那档"底噪 ≤ −60dB"和"带音乐床"物理互斥**：`amix` 后底噪 −21dB 必然超标 → 有声书支路必须走纯语音（技能自己的规格逼出的分叉，不是我们想加的）。
6. `browser-use` 的 `evaluate_script` 一次返回过长字符串（含 4 个 currentSrc + canPlayType 的对象）会 **15s 超时**；拆成小标量、先 `preload='auto'; load()` 再另起一次调用读 duration 才拿得到（`preload=none` 时读到的是 NaN，不是 bug）。

## 7. 值不值得留用

**留用（推荐）。** 它是本实验室目前少见的"知识型但立刻能用"的技能：包体小、零依赖安装（ffmpeg 已在盘）、零网络，而且给的三档平台规格是**可实测证伪的硬数字**，天然适合做验收。缺点是它没有任何实现层（scripts/references 全无），批处理那段 Python 只是伪代码，真正干活的是你自己写的 ffmpeg 命令；且 loudnorm 两遍法它没写，得自己补 `print_format=json` → 回填 `measured_*`。
