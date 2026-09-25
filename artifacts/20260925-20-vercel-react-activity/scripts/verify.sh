#!/usr/bin/env bash
# 一键复现：装依赖 → 类型检查 + 两种构建 → 生成单文件预览 → 起 mock 服务 → 三套断言
# 依赖：Node >= 20（本机 v22）、macOS/Linux curl。registry 走仓库内 .npmrc（npmmirror）。
set -euo pipefail
cd "$(dirname "$0")/.."

npm install --no-audit --no-fund
npm run build        # tsc --noEmit && vite build（IIFE 单文件 bundle → dist/soundisle.js）
npm run build:split  # tsc --noEmit && vite build --config vite.split.config.ts（分包证据 → dist-split/）
npm run inline       # scripts/inline.mjs → preview/activity-{deco,vapor,riso}.html

mkdir -p .tmp
node server/mock-api.mjs > .tmp/mock.log 2>&1 &
SRV=$!
trap 'kill "$SRV" 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  if curl -sf http://127.0.0.1:8141/api/logs > /dev/null; then break; fi
  sleep 0.2
done

node scripts/async-check.mjs    # 35 项：并行窗口/单飞/LRU/after()/鉴权与校验
node scripts/jsdom-check.mjs    # 130 项：三风格 DOM 行为（file:// fixture 路径）
node scripts/style-check.mjs    # 40 项：bundle 一致性/零外链/分层/级联/分包
echo 'verify: 全部通过'
