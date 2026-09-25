#!/usr/bin/env bash
# 从零重建三风格页面并跑全部断言。
# 唯一外部依赖 jsdom 装在仓库根的 .tmp/jsdom（收尾按任务规范会删除，本脚本可自我重建）。
set -euo pipefail
cd "$(dirname "$0")/.."
pwd

node build.mjs > /dev/null && echo "build: ok"

JSDOM_HOME="$(cd ../../. && pwd)/.tmp/jsdom"
if [ ! -d "$JSDOM_HOME/node_modules/jsdom" ]; then
  echo "install: jsdom -> $JSDOM_HOME"
  mkdir -p "$JSDOM_HOME"
  ( cd "$JSDOM_HOME" && printf 'registry=https://registry.npmmirror.com\n' > .npmrc \
      && npm init -y > /dev/null && npm i jsdom --silent > /dev/null 2>&1 )
fi
node scripts/check.mjs
