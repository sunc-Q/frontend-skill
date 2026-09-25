#!/usr/bin/env bash
# 从零重建三风格页面并跑全部校验（约 30s，需要网络走 npmmirror，见 .npmrc）
set -euo pipefail
cd "$(dirname "$0")/.."

npm install --no-audit --no-fund
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vite build
node scripts/inline.mjs

for page in business mono win95; do
  echo "=== jsdom 交互断言：$page ==="
  node scripts/jsdom-check.mjs "preview/admin-$page.html" | grep -E '^(FAIL|RESULT|errors:)'
done
echo "=== 风格/级联断言 ==="
node scripts/style-check.mjs | tail -6
