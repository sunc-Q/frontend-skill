#!/bin/sh
# 从零复现本轮：克隆仓库后在仓库根执行 `sh artifacts/20260926-15-ascii-project-dashboard-progress-board/scripts/verify.sh`
# 全程零依赖（只用 Node 内置模块 + 本机 Chrome），不会生成 node_modules。
set -eu
cd "$(dirname "$0")/../../.."       # scripts -> 本轮目录 -> artifacts -> 仓库根（LAB）
S="artifacts/20260926-15-ascii-project-dashboard-progress-board/scripts"
echo "== 1) 取数：只读台账与磁盘，写 facts.json"
node "$S/facts.mjs"
echo "== 2) 渲染：三风格 .md + 三份单文件预览"
node "$S/build.mjs"
echo "== 3) 断言卡：技能条款 / 可移植 / 同构互斥 / 现读 / 反手抄"
node "$S/check-node.mjs"
echo "== 4) 变异卡：给每条判据注入缺陷，验证判据真的有獠牙"
node "$S/check-mutate.mjs"
echo "== 5) 清理卡：本轮目录磁盘卫生"
node "$S/check-clean.mjs"
echo "== 6) 浏览器卡：本机 Chrome 无头量真实等宽步进与列对齐（缺 Chrome 则记未验项）"
node "$S/check-browser.mjs" || echo "[verify] 浏览器卡未通过，已记为未验项，不阻塞其余判据"
echo "== 7) 对照入口页：把上面各卡的读数汇进 preview/styles.html"
node "$S/index-page.mjs"
