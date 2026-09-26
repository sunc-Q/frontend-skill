#!/usr/bin/env sh
# 一条命令复现本轮全部验证。顺序不是随便排的，三处先后是有因果的：
#   1) cli-probe 早于 check-node —— A 组读它的 evidence；
#   2) make-styles 必须晚于「最后一次会刷新 evidence 的步骤」—— 软件 GL 的像素读数每帧都有噪声，
#      任何一次 check-browser 重跑都会让已生成的对照页数字过期（N 组当场把它判红，这是设计而非事故）；
#   3) make-styles 之后必须再跑一遍 check-node —— 那一遍才是「页面数字 == 现算数字」的终局闸。
# 另外 check-node 的断言总数被页脚引用（只引用总数、不引用通过数：通过数会被这次运行自己改变，会奇偶振荡）。
# 用法：sh scripts/verify.sh   （全绿退出码 0；两次 check-browser + mutate 里的多次重跑，全程约 8 分钟）
set -eu
cd "$(dirname "$0")/.."

say() { printf '\n=== %s\n' "$1"; }

say "1/9 build.mjs：src 的三份着色器 + 两份 CSS 组装成 preview/exhibit-*.html"
node scripts/build.mjs

say "2/9 cli-probe.mjs：把 shader 技能自带的 CLI 命令真跑一遍，读数落 evidence/cli-probe.json"
node scripts/cli-probe.mjs

say "3/9 check-browser.mjs（第一遍）：无头 Chrome + SwiftShader 真帧像素 + 10 条对照臂"
node scripts/check-browser.mjs

say "4/9 make-styles.mjs：先按当前 evidence 生成对照页，好让下一遍 check-node 有东西可验"
node scripts/make-styles.mjs

say "5/9 check-node.mjs：结构与条款落地 + N 组数字溯源复算（静态，毫秒级）"
node scripts/check-node.mjs

say "6/9 mutate.mjs：12 例注入，逐例还原，最后复跑双套确认无残渣（会再刷 evidence）"
node scripts/mutate.mjs

say "7/9 make-styles.mjs（第二遍）：拿 mutate 还原后的 evidence 重新生成对照页与溯源"
node scripts/make-styles.mjs

say "8/9 check-node.mjs（终局闸）：页面每个数字都要能按指针从 evidence/src 现算出来"
node scripts/check-node.mjs

say "9/9 check-clean.mjs：磁盘纪律（无构建残渣/无空目录/引用可达/零外链）+ 凭据形状扫描"
node scripts/check-clean.mjs

printf '\nverify: 全绿\n'
