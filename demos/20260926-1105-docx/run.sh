#!/usr/bin/env bash
# One-shot reproduction of this round's artifact. Run from the demo directory.
set -uo pipefail
D="$(pwd)"
LAB="$(cd ../.. && pwd)"
SK="$LAB/.skills/anthropic-skills/skills/docx"
export TMPDIR="$LAB/.tmp" PYTHONPATH="$LAB/.tmp/pylibs"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

step() { echo; echo "########## $* ##########"; }

step "1. facts (read-only: state.json + demos/*/output.log)"
node facts.cjs

step "2. chart.png via system Chrome headless CLI"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=2500 \
  --window-size=720,320 --default-background-color=FFFFFFFF \
  --screenshot="$D/chart.png" "file://$D/chart.html" 2>&1 | grep -v CVDisplayLink

step "3. base.docx with docx-js"
node build.cjs

step "4. skill's own validator on base.docx"
python3 "$SK/scripts/office/validate.py" "$D/base.docx" 2>&1

step "5. A/B control — comments + tracked changes patched with the NAIVE regex"
rm -rf "$D/.ab/unpacked"; mkdir -p "$D/.ab/unpacked"
(cd "$D/.ab/unpacked" && unzip -q "$D/base.docx")
python3 "$SK/scripts/comment.py" "$D/.ab/unpacked" "摘要里的 12 分钟中位数只有 10 个样本：第 8 轮 runs[].seconds 为 null，正文却写成「中位数在 12 分钟附近」。要么补齐该轮耗时，要么在表里显式标注未记。" --author "评审组" --initials "PS" >/dev/null
python3 "$SK/scripts/comment.py" "$D/.ab/unpacked" "已改为现场实测：facts.cjs 直接从 state.json 取数，null 在表格中渲染为「未记」而不是补 0。" --author "自动化值守" --initials "AU" --parent 0 >/dev/null
python3 "$SK/scripts/comment.py" "$D/.ab/unpacked" "「约九成字节为单行内联第三方库」是第 8 轮审计的量化结论（97.8% / 89.2%），引用时请连同两个数字一起给出。" --author "评审组" --initials "PS" >/dev/null
python3 "$D/patch_xml.py" "$D/.ab/unpacked/word/document.xml" --bad
(cd "$D/.ab/unpacked" && rm -f ../review-bad.docx && zip -Xqr ../review-bad.docx .)
python3 "$SK/scripts/office/validate.py" "$D/.ab/review-bad.docx" --original "$D/base.docx" --author "评审组" 2>&1; echo "validate.py exit=$? (1 = it reported the nested-run defect, which is the point of this control)"

step "6. final artifact — same pipeline with the fixed regex"
rm -rf "$D/unpacked"; mkdir -p "$D/unpacked"
(cd "$D/unpacked" && unzip -q "$D/base.docx" && find . -type l -delete)
python3 "$SK/scripts/comment.py" "$D/unpacked" "摘要里的 12 分钟中位数只有 10 个样本：第 8 轮 runs[].seconds 为 null，正文却写成「中位数在 12 分钟附近」。要么补齐该轮耗时，要么在表里显式标注未记。" --author "评审组" --initials "PS" | tee -a "$D/comments-cli.log"
python3 "$SK/scripts/comment.py" "$D/unpacked" "已改为现场实测：facts.cjs 直接从 state.json 取数，null 在表格中渲染为「未记」而不是补 0。" --author "自动化值守" --initials "AU" --parent 0 | tee -a "$D/comments-cli.log"
python3 "$SK/scripts/comment.py" "$D/unpacked" "「约九成字节为单行内联第三方库」是第 8 轮审计的量化结论（97.8% / 89.2%），引用时请连同两个数字一起给出。" --author "评审组" --initials "PS" | tee -a "$D/comments-cli.log"
python3 "$D/patch_xml.py" "$D/unpacked/word/document.xml"

step "6b. repair docx-js's dangling style table (validator is syntax-only and misses it)"
python3 "$D/fix_styles.py" "$D/unpacked/word/styles.xml"
(cd "$D/unpacked" && rm -f ../skill-showcase-review.docx && zip -Xqr ../skill-showcase-review.docx .)
python3 "$SK/scripts/office/validate.py" "$D/skill-showcase-review.docx" --original "$D/base.docx" --author "评审组" 2>&1; echo "validate.py exit=$?"

step "7. independent assertions (not the skill's checker)"
python3 "$D/verify.py"; echo "verify.py exit=$?"


step "7b. readable preview (no Word/pandoc/LibreOffice on this box)"
python3 "$D/preview.py"

step "7c. cross-check with a second independent parser (python-docx)"
python3 "$D/readback.py"

step "8. cleanup"
rm -rf "$D/.ab" "$D/unpacked" "$D/comments-cli.log"
echo "kept: $(ls "$D" | tr '\n' ' ')"
