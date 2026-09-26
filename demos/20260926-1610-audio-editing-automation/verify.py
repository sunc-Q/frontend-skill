#!/usr/bin/env python3
"""audio-editing-automation 产物取证。

三条独立证据链：
  B 组：技能自称的三档平台规格（Podcast / ACX 有声书 / YouTube）用 ffmpeg 实测对账；
  D 组：变异与负对照——证明这些断言不是自我证明；
  E 组：纯 Python 手写 ITU-R BS.1770 K-weighting + 门控，独立复算 LUFS，与 ffmpeg ebur128 交叉核对。
"""
import json
import math
import os
import re
import struct
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out"
MUT = ROOT / "mutation"
BLD = ROOT / "build"
INP = ROOT / "inputs"
MUT.mkdir(exist_ok=True)

results = []


def check(group, name, ok, detail=""):
    results.append((group, name, bool(ok), detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {group}::{name}  {detail}")


def ffprobe_json(path):
    p = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format",
                        "-of", "json", str(path)], capture_output=True, text=True)
    return json.loads(p.stdout) if p.returncode == 0 else None


def ebur128(path):
    """return (integrated LUFS, max true peak dB, LRA) measured by ffmpeg's EBU R128."""
    p = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path),
                        "-filter_complex", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True)
    err = p.stderr
    summary = err[err.rfind("Summary:"):]
    i = float(re.search(r"I:\s+(-?[\d.]+) LUFS", summary).group(1))
    tp = float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", summary).group(1))
    lra = float(re.search(r"LRA:\s+(-?[\d.]+) LU", summary).group(1))
    return i, tp, lra


def astats(path):
    """astats 先按通道打印、最后打印 Overall 段；取每个键最后一次出现即 Overall。"""
    p = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path),
                        "-af", "astats", "-f", "null", "-"], capture_output=True, text=True)
    want = {"rms": "RMS level dB", "peak": "Peak level dB",
            "noise_floor": "Noise floor dB", "dc": "DC offset"}
    out = {}
    for key, label in want.items():
        vals = []
        for line in p.stderr.splitlines():
            body = re.sub(r"^\[.*?\] ", "", line.strip())
            if body.startswith(label + ":"):
                vals.append(body.split(":", 1)[1].strip())
        # -inf = 纯数字零（合成语音的静音间隙真的一个非零采样都没有）
        out[key] = -999.0 if not vals or vals[-1] in ("-inf", "nan") else float(vals[-1])
    return out


def ff(*args):
    p = subprocess.run(["ffmpeg", "-hide_banner", "-y", *[str(a) for a in args]],
                       capture_output=True, text=True)
    return p.returncode, p.stderr


# ---------- E 组用：纯 Python 手写 BS.1770 integrated loudness ----------
B1 = (1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585)
B2 = (1.0, -2.0, 1.0, -1.99004715497716, 0.99007225036621)


def decode_pcm48k(path):
    """ffmpeg -> raw f32le @48k, 按源文件真实声道数分离（用 pipe，不落临时文件）。"""
    nch = int(ffprobe_json(path)["streams"][0].get("channels") or 1)
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-ac", str(nch), "-ar", "48000",
           "-f", "f32le", "-"]
    p = subprocess.run(cmd, capture_output=True)
    assert p.returncode == 0, p.stderr.decode()[:300]
    n = len(p.stdout) // 4
    samples = struct.unpack("<%df" % n, p.stdout[: n * 4])
    return [samples[i::nch] for i in range(nch)]


def k_filter(x):
    b0, b1, b2, a1, a2 = B1
    y = [0.0] * len(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        t = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, v, y1, t
        y[i] = t
    b0, b1, b2, a1, a2 = B2
    z = [0.0] * len(y)
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(y):
        t = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, v, y1, t
        z[i] = t
    return z


def lufs_bs1770(path):
    chs = [k_filter(c) for c in decode_pcm48k(path)]
    block, hop = 400 * 48, 100 * 48
    n = min(len(c) for c in chs)
    blocks = []
    for s in range(0, n - block + 1, hop):
        z = 0.0
        for c in chs:
            seg = c[s:s + block]
            z += sum(v * v for v in seg) / block      # G_L = G_R = 1.0
        blocks.append(z)
    if not blocks:
        return None
    gate_abs = 10 ** ((-70.0 + 0.691) / 10)
    kept = [z for z in blocks if z > gate_abs]
    if not kept:
        return -999.0
    a0 = -0.691 + 10 * math.log10(sum(kept) / len(kept))
    gate_rel = 10 ** ((a0 - 10.0 + 0.691) / 10)
    kept2 = [z for z in kept if z > gate_rel]
    if not kept2:
        return -999.0
    return -0.691 + 10 * math.log10(sum(kept2) / len(kept2))


def ink(path):
    rc, err = ff("-i", path, "-vf", "signalstats,metadata=print", "-f", "null", "-")
    for line in err.splitlines():
        if "lavfi.signalstats.YAVG" in line:
            return float(line.split("=")[1])
    return None


def main():
    # ---------------- A. 产物存在 / 可解码 ----------------
    files = {
        "podcast": OUT / "podcast.mp3",
        "audiobook": OUT / "audiobook.mp3",
        "youtube": OUT / "youtube.m4a",
        "final_wav": BLD / "final.wav",
    }
    for k, f in files.items():
        check("A", f"exists_nonempty::{k}", f.exists() and f.stat().st_size > 1000,
              f"{f.name} {f.stat().st_size if f.exists() else 0}B")
    pr = {k: ffprobe_json(f) for k, f in files.items()}
    for k, j in pr.items():
        check("A", f"ffprobe_decodable::{k}", j is not None and j.get("streams"),
              f"duration={j['format']['duration'] if j else '?'}s")
    dur_voice = float(ffprobe_json(BLD / "voice_normalized.wav")["format"]["duration"])
    dur_music = float(ffprobe_json(INP / "music_raw.wav")["format"]["duration"])

    # ---------------- B. 技能自称规格 vs 实测 ----------------
    specs = {
        "podcast": {"codec": "mp3", "bitrate": 192000, "rate": 44100, "I": -16.0, "TP_max": -1.0},
        "audiobook": {"codec": "mp3", "bitrate": 192000, "rate": 44100, "TP_max": -3.0,
                      "RMS_band": (-23.0, -18.0), "noise_floor_max": -60.0},
        "youtube": {"codec": "aac", "bitrate": 192000, "rate": 48000, "I": -14.0, "TP_max": -1.5},
    }
    meas = {}
    for k, sp in specs.items():
        st = pr[k]["streams"][0]
        fmt = st["codec_name"]
        check("B", f"codec::{k}", fmt == sp["codec"], f"{fmt} vs {sp['codec']}")
        check("B", f"sample_rate::{k}", int(st["sample_rate"]) == sp["rate"],
              f"{st['sample_rate']} vs {sp['rate']}")
        br = int(pr[k]["format"].get("bit_rate") or st.get("bit_rate") or 0)
        check("B", f"bitrate_192k::{k}", abs(br - sp["bitrate"]) <= sp["bitrate"] * 0.06,
              f"{br} bps")
        i, tp, lra = ebur128(files[k])
        a = astats(files[k])
        meas[k] = {"I": i, "TP": tp, "LRA": lra, **a, "bitrate": br, "codec": fmt,
                   "rate": int(st["sample_rate"])}
        check("B", f"true_peak::{k}", tp <= sp["TP_max"] + 0.05,
              f"TP={tp:.2f}dBFS <= {sp['TP_max']}")
        if "I" in sp:
            check("B", f"integrated_loudness::{k}", abs(i - sp["I"]) <= 0.5,
                  f"I={i:.2f}LUFS vs 目标 {sp['I']}±0.5")
        if "RMS_band" in sp:
            lo, hi = sp["RMS_band"]
            check("B", f"acx_rms_band::{k}", a["rms"] is not None and lo - 1.0 <= a["rms"] <= hi + 1.0,
                  f"RMS={a['rms']}dB (技能规定 {lo}~{hi})")
        if "noise_floor_max" in sp:
            check("B", f"acx_noise_floor::{k}", a["noise_floor"] <= sp["noise_floor_max"],
                  f"noise floor={a['noise_floor']}dBFS <= {sp['noise_floor_max']}")

    # ---------------- C. 处理链真的生效（前后对照） ----------------
    i_raw, tp_raw, _ = ebur128(INP / "voice_raw.aiff")
    i_norm, tp_norm, _ = ebur128(BLD / "voice_normalized.wav")
    check("C", "loudnorm_raises_voice", i_norm > i_raw + 1.0,
          f"raw I={i_raw:.2f} -> normalized I={i_norm:.2f} LUFS")
    check("C", "loudnorm_hits_target", abs(i_norm - (-16.0)) <= 0.5, f"I={i_norm:.2f}")
    check("C", "raw_was_below_spec", i_raw < -16.5 and tp_raw < -2.0,
          f"raw I={i_raw:.2f} TP={tp_raw:.2f}（处理前不达标，处理后达标 = 增益确实来自本管线）")

    dur_mixed = float(ffprobe_json(BLD / "mixed.wav")["format"]["duration"])
    check("C", "mix_duration_is_voice", abs(dur_mixed - dur_voice) < 0.15 and dur_music > dur_voice + 5,
          f"mixed={dur_mixed:.3f}s voice={dur_voice:.3f}s music={dur_music:.3f}s（duration=first 生效）")

    nf_voice = astats(BLD / "voice_normalized.wav")["noise_floor"]
    nf_mixed = astats(BLD / "mixed.wav")["noise_floor"]
    v_show = "数字零(-inf)" if nf_voice <= -900 else f"{nf_voice:.1f}dB"
    check("C", "music_bed_audible_in_gaps", nf_mixed > nf_voice + 5.0,
          f"底噪 voice={v_show} -> mixed={nf_mixed:.1f}dB（0.3 音量音乐床留在语音间隙里）")
    i_mixed, _, _ = ebur128(BLD / "mixed.wav")
    check("C", "ducking_keeps_voice_dominant", i_mixed < i_norm + 6.0,
          f"I voice={i_norm:.2f} -> I mixed={i_mixed:.2f}（+0.3 音乐床抬升受限）")

    # 波形图墨量（像素）反推增益，与音频实测 LUFS 增益交叉核对 —— 跨介质对账
    bg = ink(BLD / "wave_silence_ref.png")
    ink_raw, ink_norm = ink(OUT / "wave_voice_raw.png"), ink(OUT / "wave_voice_normalized.png")
    check("C", "waveform_png_has_structure", ink_norm - bg > 1.0 and ink_raw - bg > 1.0,
          f"背景 Y={bg:.1f}，raw Y={ink_raw:.2f}(墨{ink_raw-bg:.2f})，norm Y={ink_norm:.2f}(墨{ink_norm-bg:.2f})")
    pix_gain = 20 * math.log10((ink_norm - bg) / (ink_raw - bg))
    check("C", "pixel_gain_matches_audio_gain", abs(pix_gain - (i_norm - i_raw)) <= 1.0,
          f"像素反推增益={pix_gain:.2f}dB vs ebur128 实测 {i_norm - i_raw:.2f}dB（差 {abs(pix_gain-(i_norm-i_raw)):.2f}）")
    hashes = {p.name: subprocess.run(["shasum", "-a", "256", str(p)], capture_output=True,
                                     text=True).stdout.split()[0]
              for p in sorted(OUT.glob("wave_*.png"))}
    check("C", "four_waveforms_distinct", len(set(hashes.values())) == 4, f"{len(hashes)} files")

    # ---------------- D. 变异与负对照 ----------------
    # M1 值变异：YouTube 目标 -14 -> -19，规格断言必须变红，且实测 LUFS 真的跟着降
    rc, _ = ff("-i", BLD / "final.wav", "-af",
               "loudnorm=I=-19:TP=-1.5:LRA=11", "-ar", "48000",
               "-c:a", "aac", "-b:a", "192k", MUT / "m1_youtube_minus19.m4a")
    i_m1, _, _ = ebur128(MUT / "m1_youtube_minus19.m4a")
    check("D", "M1_target_moves_output", abs(i_m1 - (-19.0)) <= 0.6 and i_m1 < meas["youtube"]["I"] - 3,
          f"I={i_m1:.2f} vs 原 {meas['youtube']['I']:.2f}（目标值确实驱动结果）")
    check("D", "M1_caught_by_spec_gate", abs(i_m1 - specs["youtube"]["I"]) > 0.5,
          f"用 -14 规格去卡 M1：|{i_m1:.2f}-(-14)|>0.5 -> 断言会红")

    # M2 结构变异：整条链去掉 loudnorm（直接 amix 原始语音 + 满音量音乐）
    rc, _ = ff("-i", INP / "voice_raw.aiff", "-i", INP / "music_raw.wav",
               "-filter_complex", "[1:a]volume=1.0[bg];[0:a][bg]amix=inputs=2:duration=first:normalize=0",
               "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "192k", MUT / "m2_no_loudnorm.mp3")
    i_m2, tp_m2, _ = ebur128(MUT / "m2_no_loudnorm.mp3")
    nf_m2 = astats(MUT / "m2_no_loudnorm.mp3")["noise_floor"]
    check("D", "M2_caught_by_loudness_gate", abs(i_m2 - (-16.0)) > 0.5 or tp_m2 > -1.0 + 0.05,
          f"无归一化版 I={i_m2:.2f} TP={tp_m2:.2f} -> B 组响度/峰值断言会红")
    check("D", "M2_caught_by_bed_gate", nf_m2 > nf_mixed + 3.0,
          f"未 ducking 底噪={nf_m2}dB vs 已 ducking {nf_mixed}dB -> C 组音乐床断言会红")

    # M3 结构变异：duration=first -> longest，混音长度应变为音乐长度
    rc, _ = ff("-i", BLD / "voice_normalized.wav", "-i", INP / "music_raw.wav",
               "-filter_complex", "[1:a]volume=0.3[bg];[0:a][bg]amix=inputs=2:duration=longest:normalize=0",
               "-ar", "44100", MUT / "m3_longest.wav")
    d_m3 = float(ffprobe_json(MUT / "m3_longest.wav")["format"]["duration"])
    check("D", "M3_duration_gate_bites", abs(d_m3 - dur_music) < 0.2 and abs(d_m3 - dur_voice) > 1,
          f"longest={d_m3:.3f}s ≈ music {dur_music:.3f}s，C 组时长断言会红")

    # 负对照：伪造一个不是音频的文件当 mp3，ffprobe 必须拿不到音频流
    bogus = MUT / "not_audio.mp3"
    bogus.write_bytes(b"this is not audio data at all" * 4)
    j = ffprobe_json(bogus)
    dec_fail = j is None or not (j.get("streams") and j["streams"][0].get("codec_type") == "audio")
    check("D", "negative_control_probe_rejects_fake", dec_fail,
          f"伪造 mp3：ffprobe 无音频流（{None if j is None else j.get('streams')}）")

    # ---------------- E. 第二套解析器交叉核对 LUFS ----------------
    for k in ("podcast", "youtube", "final_wav"):
        i_ff = ebur128(files[k])[0]
        i_py = lufs_bs1770(files[k])
        check("E", f"cross_parser_lufs::{k}", abs(i_ff - i_py) <= 0.35,
              f"ffmpeg ebur128={i_ff:.2f} vs 纯 Python BS.1770={i_py:.2f} LUFS")

    (ROOT / "measurements.json").write_text(
        json.dumps({"by_platform": meas, "voice": {"raw_I": i_raw, "normalized_I": i_norm},
                    "durations": {"voice": dur_voice, "music": dur_music, "mixed": dur_mixed},
                    "noise_floor": {"voice": nf_voice, "mixed": nf_mixed, "no_duck": nf_m2},
                    "wave_ink_bg": bg, "wave_ink": {"raw": ink_raw, "normalized": ink_norm},
                    "pixel_gain_dB": pix_gain, "audio_gain_dB": i_norm - i_raw},
                   indent=2, ensure_ascii=False), encoding="utf-8")

    npass = sum(1 for r in results if r[2])
    print(f"\n==== {npass}/{len(results)} PASS ====")
    for g, n, ok, d in results:
        if not ok:
            print(f"  FAIL {g}::{n}  {d}")
    sys.exit(0 if npass == len(results) else 1)


if __name__ == "__main__":
    main()
