#!/usr/bin/env bash
# 一键冒烟：在两个全新的 /tmp 库上起实例，跑 api-smoke.sh，收尾杀进程。
#
# 为什么要包一层：api-smoke.sh 会真写库（开单、出库、推进状态），同一个库跑到第二轮
# 批次余量会被出空，缺件类断言就会「还没出就先空」而误报。
# 想要可重复的绿，就得每轮从种子库重新开始。
#
#   bash scripts/run-smoke.sh [api-smoke.sh 的额外参数…]
#   KEEP_RUNNING=1 bash scripts/run-smoke.sh   # 跑完不杀进程，便于手工复现
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
PORT="${PORT:-18501}"
NOTOK_PORT="${NOTOK_PORT:-18502}"
# 令牌只从环境进来，脚本与日志里都不留默认值（本地演示令牌也不该写进文件）。
TOKEN="${ADMIN_TOKEN:?请先 export ADMIN_TOKEN=<本地演示令牌> 再跑（文件里不留默认值）}"
DB1="/tmp/fwt-smoke/$PORT/api.db"
DB2="/tmp/fwt-smoke/$NOTOK_PORT/api.db"
BIN="/tmp/fwt-smoke/api"

rm -rf /tmp/fwt-smoke
mkdir -p /tmp/fwt-smoke

echo "· 构建后端…"
( cd "$ROOT/backend" && go build -o "$BIN" ./cmd/api ) || { echo "构建失败"; exit 1; }

STATIC_DIR="$ROOT/web/dist"
# 令牌显式传给主实例：不依赖调用方是否 export（下面那个「无令牌」实例正要靠 env -u 摘掉它）。
ADMIN_TOKEN="$TOKEN" GIN_MODE=release STATIC_DIR="$STATIC_DIR" \
  "$BIN" -db "$DB1" -addr ":$PORT" >/tmp/fwt-smoke/$PORT.log 2>&1 &
PID1=$!
# 第二个实例必须真的没有令牌：调用方往往把 ADMIN_TOKEN 一起 export 进来，
# 直接继承环境会让 503 fail-closed 断言变成 201（写进去了才发现自己在骗自己），
# 所以这里显式把变量从子进程环境里摘掉。
env -u ADMIN_TOKEN STATIC_DIR="$ROOT/web/dist" "$BIN" -db "$DB2" -addr ":$NOTOK_PORT" >/tmp/fwt-smoke/$NOTOK_PORT.log 2>&1 &
PID2=$!
# 无令牌实例只用于断言 503 这一层，它的存在与否不该左右结论，所以只等主实例。
for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -s -m 2 -o /dev/null "http://127.0.0.1:$PORT/api/health" && break
  sleep 1
done

echo "· 跑 api-smoke.sh（BASE=:${PORT}，未配令牌实例=:${NOTOK_PORT}）"
BASE="http://127.0.0.1:$PORT" ADMIN_TOKEN="$TOKEN" NO_TOKEN_BASE="http://127.0.0.1:$NOTOK_PORT" \
  bash "$HERE/api-smoke.sh" "$@"
RC=$?

echo "· 库文件权限（应为 0600）"
ls -l "$DB1" "$DB1-wal" "$DB1-shm" 2>/dev/null | awk '{print "   ", $1, $NF}'

if [[ "${KEEP_RUNNING:-}" == "1" ]]; then
  echo "KEEP_RUNNING=1：保留实例 pid=$PID1(:$PORT) pid=$PID2(:$NOTOK_PORT)"
else
  kill $PID1 $PID2 2>/dev/null
fi
exit $RC
