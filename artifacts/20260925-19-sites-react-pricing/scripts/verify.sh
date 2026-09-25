#!/usr/bin/env bash
# 从零复现本轮：装依赖 → 类型检查 → 两种构建 → 三个单文件页 → 三套断言。
# 前提：能访问 registry.npmmirror.com（官方 registry 与 GitHub 在本机不可达）。
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  echo '==> npm install（npmmirror）'
  npm install --ignore-scripts --no-audit --no-fund
fi

echo '==> tsc --noEmit（strict + noUncheckedIndexedAccess）'
./node_modules/.bin/tsc --noEmit

echo '==> vite build（lib-IIFE + inlineDynamicImports，供单文件预览）'
./node_modules/.bin/vite build

echo '==> vite build --config vite.split.config.ts（保留 chunk 边界，供 bundle 断言）'
./node_modules/.bin/vite build --config vite.split.config.ts

echo '==> 生成 preview/pricing-{bauhaus,chrome,blueprint}.html'
node scripts/inline.mjs

echo '==> 账目断言（纯函数，独立算法交叉核对）'
node scripts/pricing-check.mjs

echo '==> 交互断言（jsdom，三页各跑一遍）'
node scripts/jsdom-check.mjs

echo '==> 风格 / 分层 / bundle 断言'
node scripts/style-check.mjs

echo '==> 全部通过'
