#!/usr/bin/env python3
"""本地音频生产线 —— 按 audio-editing-automation 技能的 Automation Workflow 与三档平台规格实现。

零网络：语音由 macOS 自带 `say` 合成，音乐床由 ffmpeg lavfi 合成。
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INP = ROOT / "inputs"
BLD = ROOT / "build"
OUT = ROOT / "out"
for d in (INP, BLD, OUT):
    d.mkdir(parents=True, exist_ok=True)

VOICE_TEXT = (
    "欢迎收听《每半小时》第二十二期。今天我们聊一件很小但很有用的事："
    "怎样把一段随手录的语音，加上背景音乐，自动处理成符合播客、有声书和视频平台各自规范的成品。"
    "整个过程不需要任何联网服务，全部在本地一条命令完成。"
)


def run(cmd, capture=False):
    print("$ " + " ".join(str(c) for c in cmd))
    p = subprocess.run([str(c) for c in cmd], capture_output=capture, text=True)
    if capture:
        return p.returncode, p.stdout or "", p.stderr or ""
    if p.returncode != 0:
        sys.exit(f"command failed: {cmd}")
    return 0, "", ""


def ff(*args, **kw):
    return run(["ffmpeg", "-hide_banner", "-y", *args], **kw)


# ---------- 0. 原料 ----------
def make_inputs():
    rc, so, se = run(["say", "-v", "?"], capture=True)
    avail = so + se
    voice = next((v for v in ("Ting-Ting", "婷婷", "Mei-Jia") if re.search(rf"^\s*{re.escape(v)}\b", avail, re.M)), None)
    if voice is None:
        voice = avail.strip().splitlines()[0].split()[0]
    run(["say", "-v", voice, "-r", "185", "-o", str(INP / "voice_raw.aiff"), VOICE_TEXT])
    (INP / "voice_text.txt").write_text(VOICE_TEXT + f"\n(voice={voice}, rate=185)\n", encoding="utf-8")

    # 40 秒和声垫（必须长于语音，才能验证混音的 duration 语义）：
    # A3/C#4/E4/A4 四个正弦 + 缓慢颤音
    chord = ("0.16*sin(2*PI*220*t)+0.12*sin(2*PI*277.18*t)+0.10*sin(2*PI*329.63*t)"
             "+0.07*sin(2*PI*440*t)")
    ff("-f", "lavfi", "-i", f"aevalsrc={chord}|{chord}:s=44100:d=40",
       "-af", "tremolo=f=0.25:d=0.35", str(INP / "music_raw.wav"))


# ---------- 1. 技能规定的四步 ----------
def measure_loudnorm(src):
    """two-pass loudnorm 的第一遍：拿到实测 I/TP/LRA/thresh/offset。"""
    rc, _, err = ff("-i", str(src), "-af",
                    "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
                    "-f", "null", "-", capture=True)
    return json.loads(err[err.rfind("{"):err.rfind("}") + 1])


def ln_filter(src, target_i, target_tp):
    m = measure_loudnorm(src)
    return (f"loudnorm=I={target_i}:TP={target_tp}:LRA=11"
            f":measured_I={m['input_i']}:measured_TP={m['input_tp']}"
            f":measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}"
            f":offset={m['target_offset']}:linear=true"), m


def normalize_voice():
    f, m = ln_filter(INP / "voice_raw.aiff", -16, -1.5)
    ff("-i", str(INP / "voice_raw.aiff"), "-af", f, "-ar", "44100", str(BLD / "voice_normalized.wav"))
    return m


def mix_with_music(duck=0.3, mode="first"):
    # 技能示例：Voice + background music (ducking)
    ff("-i", str(BLD / "voice_normalized.wav"), "-i", str(INP / "music_raw.wav"),
       "-filter_complex",
       f"[1:a]volume={duck}[bg];[0:a][bg]amix=inputs=2:duration={mode}:normalize=0",
       "-ar", "44100", str(BLD / "mixed.wav"))


def final_normalize(dst=BLD / "final.wav", target_i=-16, target_tp=-1.5):
    f, m = ln_filter(BLD / "mixed.wav", target_i, target_tp)
    ff("-i", str(BLD / "mixed.wav"), "-af", f, "-ar", "44100", str(dst))
    return m


def export_platforms():
    """Audio Quality Standards: Podcast / Audiobook(ACX) / YouTube."""
    f, _ = ln_filter(BLD / "final.wav", -16, -1.0)
    ff("-i", str(BLD / "final.wav"), "-af", f, "-ar", "44100",
       "-c:a", "libmp3lame", "-b:a", "192k", str(OUT / "podcast.mp3"))

    # ACX 那档规定「底噪 <= -60dB、RMS -18~-23dB」——带音乐床必然不达标，
    # 所以有声书成品只能走纯语音支路（这是技能给的规格自己逼出来的分叉）。
    f, _ = ln_filter(BLD / "voice_normalized.wav", -20, -3.0)
    ff("-i", str(BLD / "voice_normalized.wav"), "-af", f, "-ar", "44100",
       "-c:a", "libmp3lame", "-b:a", "192k", str(OUT / "audiobook.mp3"))

    f, _ = ln_filter(BLD / "final.wav", -14, -1.5)
    ff("-i", str(BLD / "final.wav"), "-af", f, "-ar", "48000",
       "-c:a", "aac", "-b:a", "192k", str(OUT / "youtube.m4a"))


def waveforms():
    for src, dst in (
        (INP / "voice_raw.aiff", OUT / "wave_voice_raw.png"),
        (BLD / "voice_normalized.wav", OUT / "wave_voice_normalized.png"),
        (BLD / "mixed.wav", OUT / "wave_mixed.png"),
        (OUT / "podcast.mp3", OUT / "wave_podcast.png"),
    ):
        ff("-i", str(src), "-filter_complex",
           f"[0:a]showwavespic=s=1400x240:colors=#0f3460|#e94560:split_channels=1",
           "-frames:v", "1", str(dst))
    ff("-i", str(BLD / "final.wav"), "-lavfi",
       "showspectrum=s=1400x420:scale=log", "-frames:v", "1",
       str(OUT / "spec_final.png"))
    # 纯静音参考波形：给取证用做「墨量 = YAVG - 背景」的基准
    ff("-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=24", "-filter_complex",
       "[0:a]showwavespic=s=1400x240:colors=#0f3460|#e94560:split_channels=1",
       "-frames:v", "1", str(BLD / "wave_silence_ref.png"))


def main():
    make_inputs()
    m_voice = normalize_voice()
    mix_with_music()
    m_mixed = final_normalize()
    export_platforms()
    waveforms()
    (ROOT / "loudnorm_measured.json").write_text(
        json.dumps({"voice_raw_pass1": m_voice, "mixed_pass1": m_mixed}, indent=2, ensure_ascii=False),
        encoding="utf-8")
    print("PIPELINE OK")


if __name__ == "__main__":
    main()
