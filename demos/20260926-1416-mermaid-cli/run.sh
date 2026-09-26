#!/bin/sh
# 从零复现本轮产物（需: python3, npm 镜像可达, /Applications/Google Chrome.app）
set -eu
D=$(cd "$(dirname "$0")" && pwd)
LAB=$(cd "$D/../.." && pwd)
# 1) 本地安装 mermaid-cli（SKILL.md 禁止全局安装；PUPPETEER_SKIP_DOWNLOAD 免下载浏览器）
mkdir -p "$LAB/.tmp/mmdc"
cd "$LAB/.tmp/mmdc"
PUPPETEER_SKIP_DOWNLOAD=true npm i @mermaid-js/mermaid-cli --registry=https://registry.npmmirror.com --no-audit --no-fund
MM="$LAB/.tmp/mmdc/node_modules/.bin/mmdc"
# 2) 从 state.json 现场生成 4 个 .mmd（不写死数据）
cd "$D"; python3 gen_mmd.py
# 3) 渲染：SVG×4 + PNG×1（系统 Chrome，无需 --no-sandbox）
for f in pipeline-flow rounds-timeline time-pie; do $MM -i $f.mmd -o $f.svg -p puppeteer-config.json -q; done
$MM -i dedup-contract.mmd -o dedup-contract.svg -p puppeteer-config.json -t neutral -q
$MM -i pipeline-flow.mmd -o pipeline-flow.png -p puppeteer-config.json -b white --size 1600 -q
# 4) 验证 + 负对照 + 变异
python3 verify.py
