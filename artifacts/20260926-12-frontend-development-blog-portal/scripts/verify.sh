#!/usr/bin/env bash
# Zero-to-green reproduction for 20260926-12: frontend-development × 博客内容门户（路由与代码分割密集场景）.
# Everything below is relative to this directory. The only reads outside it are the two earlier
# rounds' artifacts (the cost baseline in group J) and the lab ledger (group I); the only writes
# are inside ./. Chromium for check-browser comes from the local ~/Library/Caches/ms-playwright.
set -euo pipefail
cd "$(dirname "$0")/.."

npm install --no-audit --no-fund
./node_modules/.bin/tsc --noEmit                                        # 严格模式（noUncheckedIndexedAccess 等），零隐式 any
./node_modules/.bin/vite build                                          # dist/            主臂 __FD_ARM__={virtual,memo,stableKey}=true
FD_ARM=nomemo     ./node_modules/.bin/vite build -c vite.ablation.config.ts   # dist-nomemo/     只关掉 React.memo 行组件
FD_ARM=novirtual  ./node_modules/.bin/vite build -c vite.ablation.config.ts   # dist-novirtual/  只关掉虚拟滚动
FD_ARM=unstablekey ./node_modules/.bin/vite build -c vite.ablation.config.ts  # dist-unstablekey/ 只把 queryKey 变成每渲染新建
./node_modules/.bin/vite build -c vite.split.config.ts                   # dist-split/      证据构建：保留真实 chunk 图（ES 输出）
node scripts/build-inline.mjs                                           # preview/portal-*.html + 三消融臂 + split-host + meta.json
node scripts/dump-facts.mjs > /dev/null                                 # scripts/.facts.mjs：Node 与浏览器共用的同一份事实源
node scripts/check-node.mjs                                              # A 技能条款 / B 自包含不变式 / C 三皮肤令牌 / E 事实源同源 / L 分包证据 / J 成本对照 / I 台账锁
node scripts/check-dom.mjs                                               # F 首屏窗口与 single-flight / H 交互全链路 / M 偏好消毒 / N 四臂消融
node scripts/check-browser.mjs                                           # D 计算样式与对比度 / G 真 HTTP+真 chunk 台账与逐帧位移 / K 真实滚动键盘点击 / M 双载体持久化
node scripts/make-styles.mjs                                              # styles.html —— 页面数字全部取自 .tmp-check/assertions-*.json，零手写

# 以下两条跑在「删掉构建中间物之后」，与本脚本前半段互斥，故注释在这里：
#   rm -rf node_modules dist dist-* .tmp-check .tmp-* scripts/.facts*.mjs && node scripts/check-clean.mjs
#   node scripts/verify-ledger.mjs      # 台账复查卡：只读 JSON/MD，清理与两次推送之后仍可复跑

# 台账写回（一次性，快照先行；收尾字段由回灌卡补写，不手改 JSON）：
#   node scripts/ledger-snapshot.mjs                          # 写回前快照，I 组与 verify-ledger 都对着它比
#   FD_LEDGER_UPDATED="$(date +%Y-%m-%dT%H:00+08:00)" FD_SEEN_STATUS='frontend-development（…第 4 次使用…）' node scripts/ledger-apply.mjs
#   node scripts/ledger-refill.mjs    # 补记：artifact_size / cleanup / push 与 work-log 末行都从 round-facts.mjs 回灌

echo "see reports/20260926-12-frontend-development-blog-portal.md in the lab root for the write-up"
