#!/usr/bin/env bash
# Zero-to-green reproduction for this round (frontend-development × 管理后台, 2026-09-26 07:00).
# Everything below is relative to this directory; nothing writes outside it except the two
# read-only things the checks need: the previous round's artifact (byte baseline) and the lab
# ledger (group I). Chromium for check-browser comes from the local ms-playwright cache.
set -euo pipefail
cd "$(dirname "$0")/.."

npm install --no-audit --no-fund
npx tsc --noEmit
npx vite build                                # dist/assets/main.js  —— the shipped single-file bundle
npx vite build --config vite.split.config.ts  # dist-split/          —— evidence build, real chunk boundaries
node scripts/build-inline.mjs                 # preview/admin-*.html + scripts/build-inline-meta.json
node scripts/check-node.mjs                   # A 技能条款 / B 自包含一致性 / C 三风格主张 / E 事实源同源 / J 成本 / L 分包证据 / I 台账锁
node scripts/check-dom.mjs                    # F single-flight 与无早期 return / H 交互全链路（三页各一遍）
node scripts/check-browser.mjs                # D 计算样式与对比度 / G ?control=early 消融 / K 真实提交 / M 持久化跨载体
node scripts/make-styles.mjs                  # index.html —— 数字全部来自 .tmp-check/assertions-*.json

# 收尾后再跑这条（它断言的是「删掉构建中间物之后」的目录形态，与本脚本前半段互斥）：
#   rm -rf node_modules dist dist-split .tmp-check && node scripts/check-clean.mjs

echo "see reports/20260926-07-frontend-development-admin.md in the lab root for the write-up"
