#!/usr/bin/env bash
# 从零复现本轮：装依赖 → 类型检查 → 构建 → 生成三个单文件页 → 两套断言。
# 前提：能访问 registry.npmmirror.com（官方 registry 与 GitHub 在本机不可达）。
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  echo '==> npm install'
  npm install --ignore-scripts --no-audit --no-fund
fi

echo '==> tsc --noEmit'
./node_modules/.bin/tsc --noEmit

echo '==> vite build (lib IIFE)'
./node_modules/.bin/vite build

echo '==> 生成 preview/*.html（单文件，双击可开）'
node scripts/inline.mjs

echo '==> jsdom 交互断言'
node scripts/jsdom-check.mjs

echo '==> 风格 / 级联 / bundle 一致性断言'
node scripts/style-check.mjs

echo '==> 全部通过'
