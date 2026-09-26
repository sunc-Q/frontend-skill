#!/usr/bin/env sh
# 一条命令复现本轮全部验证。顺序有因果，不能随便排：
#   1) check-node 先跑「--skip-styles」那一遍：对照页此刻还不存在，N 组只能跳过；
#   2) check-browser 必须早于 make-styles：软件 GL 像素读数有噪声，每重跑一次 evidence 就换一批数字，
#      对照页要是先生成，就会被下一次运行判红（这是设计，不是事故）；
#   3) mutate 在 make-styles 之前：它是唯一会「改源码再改回来」的步骤，放在后面会让对照页数字过期；
#   4) make-styles 之后再跑一遍不带开关的 check-node —— 那一遍才是「页面每个数字都能按指针现算」的终局闸。
# 台账（state.json / work-log.md）的写回校验不在这里：那是收尾步骤，用
#   node scripts/ledger-snapshot.mjs          （写回前拍快照）
#   node scripts/ledger-snapshot.mjs --verify （写回后对账，红了就不许提交）
# 用法：sh scripts/verify.sh   （全绿退出码 0；含 4 次浏览器套件，本机约 6~9 分钟）
set -eu
cd "$(dirname "$0")/.."

say() { printf '\n=== %s\n' "$1"; }

say "1/7 build.mjs：src/(body+skins+shaders+host+product.json) 组装成 preview/showcase-*.html"
node scripts/build.mjs

say "2/7 check-node.mjs --skip-styles：结构、条款落地、GLSL↔JSON 镜像、WCAG（A–M 组）"
node scripts/check-node.mjs --skip-styles

say "3/7 check-browser.mjs：无头 Chrome + SwiftShader 真帧像素，12 方位扫描 + 三向核对"
node scripts/check-browser.mjs

say "4/7 mutate.mjs：8 例注入（6 例必须被抓住，2 例是记在账上的判据盲区）"
node scripts/mutate.mjs

say "5/7 make-styles.mjs：按当前 evidence 生成三风格数字对照页 preview/styles.html"
node scripts/make-styles.mjs

say "6/7 check-node.mjs（终局闸）：对照页每个数字都要能从 src/evidence 现算出来（N 组）"
node scripts/check-node.mjs

say "7/7 check-clean.mjs：磁盘纪律（≤50MB、无残渣、引用可达、零外链）+ 凭据形状扫描"
node scripts/check-clean.mjs

printf '\nverify: 全绿\n'
