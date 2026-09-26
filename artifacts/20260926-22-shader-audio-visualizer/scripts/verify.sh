#!/bin/sh
# 一键复现（本轮：shader × 音频可视化）
# 依赖：本机 Node ≥ 18；真浏览器判据另需 playwright-core（见复现报告「环境」一节）
# 任一步非零即中止，不掩盖失败；--skip-browser 用于没有浏览器依赖的机器。
set -eu
cd "$(dirname "$0")/.."

SKIP_BROWSER=0
[ "${1:-}" = "--skip-browser" ] && SKIP_BROWSER=1

step() {
  printf '\n=== %s ===\n' "$1"
  shift
  "$@"
}

step "1/8 合成音频（确定性，同一 seed 同一份字节）" node scripts/synth-track.mjs
step "2/8 Node 侧第二解析器（自写 FFT → 逐帧真值）" node scripts/analyze-node.mjs
step "3/8 组装三页（模板 + 宿主 + 皮肤 + 内联音频）" node scripts/build.mjs
step "4/8 静态判据 check-node" node scripts/check-node.mjs
if [ "$SKIP_BROWSER" = "0" ]; then
  step "5/8 真浏览器判据 check-browser（SwiftShader）" node scripts/check-browser.mjs
else
  printf '\n=== 5/8 check-browser 被跳过（--skip-browser）===\n'
fi
step "6/8 对抗性变异 mutate（每个变异都必须被指名抓住，然后还原）" node scripts/mutate.mjs
step "7/8 生成总览页 index.html（数字全部从证据转写）" node scripts/make-styles.mjs
step "8/8 清理判据 check-clean + 汇总断言总量" sh -c 'node scripts/check-clean.mjs && node scripts/summarize.mjs'

printf '\n全部通过。产物：preview/visualizer-{colonnade,ripple,thermal}.html，总览 index.html\n'
