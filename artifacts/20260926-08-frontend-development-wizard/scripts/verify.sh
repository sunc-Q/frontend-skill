#!/usr/bin/env bash
# Zero-to-green reproduction for 20260926-08: frontend-development × 表单密集多步向导.
# Everything below is relative to this directory. The only reads outside it are the previous
# round's artifact (the cost baseline in group J) and the lab ledger (group I); the only writes
# are inside ./. Chromium for check-browser comes from the local ~/Library/Caches/ms-playwright.
set -euo pipefail
cd "$(dirname "$0")/.."

npm install --no-audit --no-fund
./node_modules/.bin/tsc --noEmit                              # 严格模式，零 : any
./node_modules/.bin/vite build                                # dist/        主臂（__FD_MEMO__=true）
./node_modules/.bin/vite build -c vite.control.config.ts      # dist-plain/  消融臂（同源码，__FD_MEMO__=false）
./node_modules/.bin/vite build -c vite.split.config.ts        # dist-split/  证据构建（保留真实 chunk 边界）
node scripts/build-inline.mjs                                 # preview/wizard-*.html + scripts/build-inline-meta.json
node scripts/check-node.mjs                                   # A 技能条款 / B 自包含 / C 三风格主张 / E 事实源同源 / J 成本 / L 分包证据 / I 台账锁
node scripts/check-dom.mjs                                    # F 首屏窗口与 single-flight / H 交互全链路（三页各一遍）/ N memo 双臂消融
node scripts/check-browser.mjs                                # D 计算样式与对比度 / G ?api=1 逐帧骨架与位移 / K 真实提交 / M 持久化跨载体
node scripts/make-styles.mjs                                  # styles.html —— 页面数字全部取自 .tmp-check/assertions-*.json，零手写

# 以下两条跑在「删掉构建中间物之后」，与本脚本前半段互斥，故注释在这里：
#   rm -rf node_modules dist dist-plain dist-split .tmp-check .tmp-* && node scripts/check-clean.mjs
#   node scripts/verify-ledger.mjs        # 台账复查卡：只读 JSON/MD，清理与两次推送之后仍可复跑

# 台账写回（一次性，快照先行；收尾字段由回灌卡补写，不手改 JSON）：
#   node scripts/ledger-snapshot.mjs                          # 写回前快照，I 组与 verify-ledger 都对着它比
#   FD_LEDGER_UPDATED="$(date +%Y-%m-%dT%H:00+08:00)" FD_SEEN_STATUS='frontend-development（…第 3 次使用…）' node scripts/ledger-apply.mjs
#   node scripts/ledger-refill.mjs      # 补记：artifact_size / cleanup / push 与 work-log 末行都从 round-facts.mjs 回灌

echo "see reports/20260926-08-frontend-development-wizard.md in the lab root for the write-up"
