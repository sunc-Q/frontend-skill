"""Round 20 demo: turn the skill-showcase run ledger into a scannable QR card wall.

Everything here drives the qrcode-skills scripts exactly as SKILL.md documents;
this module only builds the input data and records each script's real JSON.
"""
import csv
import json
import os
import shutil
import subprocess
import sys

LAB = "/Users/apple/Documents/workProject/试验/skill演示场"
SKILL = os.path.expanduser("~/.qoder-cn/skills/qrcode-skills/scripts")
HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
ENV = dict(os.environ, PYTHONPATH=os.path.join(LAB, ".tmp", "pylibs"))
REPORT = {}


def skill(script, extra):
    proc = subprocess.run([PY, os.path.join(SKILL, script)] + extra,
                          capture_output=True, text=True, env=ENV)
    try:
        payload = json.loads(proc.stdout.strip())
    except json.JSONDecodeError:
        payload = {"raw_stdout": proc.stdout, "stderr": proc.stderr}
    return {"exit": proc.returncode, "json": payload,
            "stderr": proc.stderr.strip(), "argv": [script] + extra}


def main():
    state = json.load(open(os.path.join(LAB, "state", "state.json"), encoding="utf-8"))
    runs = state["runs"]
    rows = []
    for i, r in enumerate(runs, start=1):
        secs = r.get("seconds")
        res = str(r.get("result", ""))
        verdict = "留用" if any(k in res[:14] for k in ("成功", "PASS", "success")) else "未留用"
        rows.append({
            "轮次": str(i),
            "技能": r["skill"],
            "结论": verdict,
            "秒数": "" if secs is None else str(secs),
            "二维码内容": f"Qoder技能演示场 第{i}轮 {r['skill']}｜耗时"
                          f"{'未记' if secs is None else str(secs) + '秒'}｜{verdict}",
        })

    # step 1 -- header with no recognised keyword: SKILL.md says the script must
    # answer need_column instead of guessing a column.
    blind = os.path.join(HERE, "input-blind.csv")
    write_csv(blind, ["轮次", "技能", "结论", "秒数", "载荷"], rows,
              rename={"二维码内容": "载荷"})
    REPORT["step1_need_column"] = skill("batch_generate.py", [
        "--input", blind, "--output-dir", os.path.join(HERE, "_unused")])

    # step 2 -- the real ledger: auto-detection resolves 二维码内容 (keyword 内容)
    ledger = os.path.join(HERE, "input-ledger.csv")
    write_csv(ledger, ["轮次", "技能", "结论", "秒数", "二维码内容"], rows)
    REPORT["step2_batch_generate"] = skill("batch_generate.py", [
        "--input", ledger, "--output-dir", os.path.join(HERE, "qr-wall"),
        "--size", "400", "--error-correction", "H", "--zip"])

    # step 3 -- explicit --column with a name (second, smaller wall)
    REPORT["step3_named_column"] = skill("batch_generate.py", [
        "--input", ledger, "--column", "技能", "--output-dir",
        os.path.join(HERE, "qr-names"), "--size", "200", "--error-correction", "L"])

    # step 4 -- single generate: the two hand-scan cards, one PNG one SVG
    last = runs[-1]["skill"]
    card_png = f"Qoder 技能演示场 第{len(runs)}轮 {last}｜分支 skill-showcase"
    REPORT["step4_card_png"] = skill("generate.py", [
        "--data", card_png, "--output", os.path.join(HERE, "card-last-round.png"),
        "--size", "600", "--error-correction", "H", "--border", "3"])
    card_svg = f"git@github.com:sunc-Q/frontend-skill.git -> branch skill-showcase ({len(runs)} rounds)"
    REPORT["step5_card_svg"] = skill("generate.py", [
        "--data", card_svg, "--output", os.path.join(HERE, "card-branch.svg"),
        "--format", "svg", "--error-correction", "Q"])

    # step 6 -- batch decode the whole wall through the skill's own decoder
    manifest = os.path.join(HERE, "input-paths.txt")
    with open(manifest, "w", encoding="utf-8") as f:
        for i in range(1, len(rows) + 1):
            f.write(os.path.join(HERE, "qr-wall", f"{i}.png") + "\n")
    REPORT["step6_batch_decode"] = skill("batch_decode.py", [
        "--input", manifest, "--output-txt", os.path.join(HERE, "decoded-wall.txt")])

    json.dump({"rows": rows, "card_png": card_png, "card_svg": card_svg},
              open(os.path.join(HERE, "expected.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    json.dump(REPORT, open(os.path.join(HERE, "build-report.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    shutil.rmtree(os.path.join(HERE, "_unused"), ignore_errors=True)
    for k, v in REPORT.items():
        print(k, "->", json.dumps(v["json"], ensure_ascii=False)[:220])


def write_csv(path, headers, rows, rename=None):
    src = {h: (rename or {}).get(h, h) for h in headers}
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(headers)
        for r in rows:
            w.writerow([r.get(src[h], "") for h in headers])


if __name__ == "__main__":
    main()
