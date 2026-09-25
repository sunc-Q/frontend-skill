#!/usr/bin/env bash
# 接口全量冒烟：把 9 个读接口 + 4 个写接口 + 错误路径各过一遍并断言状态码。
#
# 为什么要有前置守卫：本脚本会真的写库（下单、停售、上下架），
# 所以只允许指向"临时实例"。跑之前必须显式声明目标库在临时目录里。
#
# 用法：
#   ADMIN_TOKEN=demo-admin-token-hs SMOKE_DB=/tmp/hs-run.db \
#     bash scripts/api-smoke.sh http://127.0.0.1:18261
#
# 鉴权约定：Authorization 头支持两种写法——
#   TOKEN          → 自动加 "Bearer " 前缀（正常路径）
#   RAW:内容       → 原样发送（用来测 "Token x"、空 Bearer 等畸形凭证）
set -euo pipefail

BASE="${1:-http://127.0.0.1:18261}"
API="$BASE/api"
TOKEN="${ADMIN_TOKEN:-}"
SMOKE_DB="${SMOKE_DB:-}"
PASS=0
FAIL=0

die() {
  echo "致命：$*" >&2
  exit 2
}

# ---------- 前置守卫 ----------
case "$BASE" in
  http://127.0.0.1:* | http://localhost:*) ;;
  *) die "只允许打本机回环地址（会写库），当前是 $BASE" ;;
esac
if [[ -n "$SMOKE_DB" ]]; then
  case "$SMOKE_DB" in
    /tmp/* | /var/folders/* | */T/*) ;;
    *) die "SMOKE_DB 必须落在临时目录（当前 $SMOKE_DB），避免污染真实数据" ;;
  esac
else
  die "必须设置 SMOKE_DB=<临时库路径> 以确认这是对临时实例的破坏性冒烟"
fi
[[ -n "$TOKEN" ]] || die "ADMIN_TOKEN 未设置：写接口全都会 401，冒烟没有意义"
command -v curl >/dev/null || die "缺 curl"

req() { # req METHOD PATH [auth] [body] -> "code|body"
  local method="$1" path="$2" auth="${3:-}" body="${4:-}"
  local tmp hdr code raw
  tmp="$(mktemp)"
  local -a args=(-s -o "$tmp" -w '%{http_code}' -X "$method" "$API$path" -H 'Accept: application/json')
  if [[ -n "$auth" ]]; then
    if [[ "$auth" == RAW:* ]]; then
      args+=(-H "Authorization: ${auth#RAW:}")
    else
      args+=(-H "Authorization: Bearer $auth")
    fi
  fi
  if [[ -n "$body" ]]; then
    args+=(-H 'Content-Type: application/json' --data "$body")
  fi
  code="$(curl "${args[@]}")"
  raw="$(tr -d '\n' <"$tmp" | head -c 200000)"
  rm -f "$tmp"
  printf '%s|%s' "$code" "$raw"
}

expect() { # expect 期望码 说明 实际码 实际体
  if [[ "$1" == "$3" ]]; then
    PASS=$((PASS + 1))
    printf '  ok   %-52s %s\n' "$2" "$3"
  else
    FAIL=$((FAIL + 1))
    printf '  FAIL %-52s 期望 %s 实际 %s ｜ %s\n' "$2" "$1" "$3" "$(cut160 "$4")"
  fi
}

cut160() { printf '%s' "${1:0:160}"; }
jget() { python3 -c "
import json,re,sys
d=json.loads(sys.stdin.read() or 'null')
for part in sys.argv[1].split('.'):
    if d is None: break
    m=re.fullmatch(r'(.+)\[(\d+)\]', part)
    key, idx = (m.group(1), int(m.group(2))) if m else (part, None)
    if isinstance(d, dict): d = d.get(key)
    elif isinstance(d, list) and key.isdigit(): d = d[int(key)]
    else: d = None
    if idx is not None:
        d = d[idx] if isinstance(d, list) and idx < len(d) else None
if isinstance(d,(dict,list)): print(json.dumps(d,ensure_ascii=False))
elif d is None: print('')
else: print(d)
" "$1"; }
code_of() { printf '%s' "${1%%|*}"; }
body_of() { printf '%s' "${1#*|}"; }

has() { # has 响应体 片段 说明
  if [[ "$1" == *"$2"* ]]; then
    PASS=$((PASS + 1))
    printf '  ok   %-52s 含 %s\n' "$3" "$2"
  else
    FAIL=$((FAIL + 1))
    printf '  FAIL %-52s 缺 %s ｜ %s\n' "$3" "$2" "$(cut160 "$1")"
  fi
}

room_count=0
pick_room() { # 从接口里挑一个可订房型与窗口，绝不硬编码种子编码
  local r body
  r="$(req GET '/rooms?status=active&page_size=100')"
  body="$(body_of "$r")"
  ROOM_CODE="$(printf '%s' "$body" | jget 'items[0].code')"
  # 今天只认 /stats 的口径（后端本地时区），health 的 time 是 UTC，跨日会差一天。
  TODAY="$(printf '%s' "$(body_of "$(req GET '/stats?days=1')")" | jget 'today')"
  [[ -n "$ROOM_CODE" && -n "$TODAY" ]] || die "接口里取不到房型/今天：$(cut160 "$body")"
}

date_add() { python3 -c "import datetime,sys;print((datetime.date.fromisoformat(sys.argv[1])+datetime.timedelta(days=int(sys.argv[2]))).isoformat())" "$1" "$2"; }

echo "目标：$API ｜ 临时库：$SMOKE_DB"
echo
echo "① 健康与读接口"
r="$(req GET '/health')"; expect 200 'GET /health' "$(code_of "$r")" "$(body_of "$r")"
r="$(req GET '/stats')"; expect 200 'GET /stats' "$(code_of "$r")" "$(body_of "$r")"
b="$(body_of "$r")"
has "$b" '"subtotal_matches":true' '恒等式：Σ逐夜=房费小计'
has "$b" '"revpar_identity_ok":true' '恒等式：RevPAR≈ADR×OCC'
has "$b" '"net_identity_ok":true' '恒等式：实收=成交+取消−退款'
has "$b" '"occ_bps"' '指标：入住率'
r="$(req GET '/properties')"; expect 200 'GET /properties' "$(code_of "$r")" "$(body_of "$r")"
r="$(req GET '/rooms?status=active&sort=revenue&dir=desc&page_size=6')"; expect 200 'GET /rooms（排序+分页）' "$(code_of "$r")" "$(body_of "$r")"
pick_room
prop="$(printf '%s' "$(body_of "$(req GET "/rooms?status=active&page_size=1")")" | jget 'items[0].property_code')"
r="$(req GET "/rooms?property=$prop")"; expect 200 "GET /rooms?property=$prop" "$(code_of "$r")" "$(body_of "$r")"

in="$(date_add "$TODAY" 24)"
out="$(date_add "$in" 2)"
r="$(req GET "/rooms/$ROOM_CODE?days=28")"; expect 200 "GET /rooms/$ROOM_CODE（日历）" "$(code_of "$r")" "$(body_of "$r")"
has "$(body_of "$r")" '"calendar"' '日历数组存在'
has "$(body_of "$r")" '"closed"' '日历格带停售标记'
r="$(req GET "/rooms/$ROOM_CODE/quote?check_in=$in&check_out=$out&units=1&guests=2")"
expect 200 "GET /rooms/$ROOM_CODE/quote" "$(code_of "$r")" "$(body_of "$r")"
q="$(body_of "$r")"
has "$q" '"nights_detail"' '试算含逐夜拆价'
has "$q" '"blockers"' '试算含不可订原因'
r="$(req GET '/bookings?horizon=inhouse')"; expect 200 'GET /bookings?horizon=inhouse' "$(code_of "$r")" "$(body_of "$r")"
r="$(req GET "/bookings?status=confirmed&sort=total&dir=desc&page=2&page_size=5")"
expect 200 'GET /bookings（状态+排序+翻页）' "$(code_of "$r")" "$(body_of "$r")"
first="$(printf '%s' "$(body_of "$r")" | jget 'items[0].code')"
r="$(req GET "/bookings/$first")"; expect 200 "GET /bookings/$first" "$(code_of "$r")" "$(body_of "$r")"
has "$(body_of "$r")" '"nights"' '订单详情含逐夜'
if [[ "$(body_of "$r")" == *'"phone":"1'* ]]; then
  FAIL=$((FAIL + 1)); echo '  FAIL 手机号明文出现在响应里'
else
  PASS=$((PASS + 1)); echo '  ok   手机号未明文外泄'
fi

echo
echo '② 错误路径'
r="$(req GET '/not-a-real-api')"; expect 404 '未知接口必须 JSON 404' "$(code_of "$r")" "$(body_of "$r")"
has "$(body_of "$r")" '"code":"not_found"' '未知接口返回 JSON 而非纯文本'
r="$(req GET '/rooms/NO-SUCH-ROOM')"; expect 404 '不存在的房型' "$(code_of "$r")" "$(body_of "$r")"
# 编码后的 X'<空格>DROP...：解码后不是合法房型编码，必须进不了 SQL。
r="$(req GET "/rooms/X%27%3B%20DROP%20TABLE%20bookings%3B--")"
expect 404 '路径注入必须被白名单挡在门口' "$(code_of "$r")" "$(body_of "$r")"
r="$(req GET '/rooms/..%2F..%2Fetc%2Fpasswd')"
# 转义斜杠在 Go 的 URL 解析层就被拒（400），到不了路由；两种拒绝都算合格，绝不能是 200。
case "$(code_of "$r")" in
  400|404) PASS=$((PASS + 1)); printf '  ok   %-52s %s\n' '编码穿越串被拒（400/404，不进 SQL）' "$(code_of "$r")" ;;
  *) expect 404 '编码穿越串被拒' "$(code_of "$r")" "$(body_of "$r")" ;;
esac
r="$(req GET '/stats?days=-1')"; expect 200 '非法 days 收敛而非 500' "$(code_of "$r")" "$(body_of "$r")"
r="$(req GET "/bookings?q=%25%25%25%3Bdrop%3B--")"; expect 200 'LIKE 通配符注入被转义' "$(code_of "$r")" "$(body_of "$r")"

echo
echo '③ 鉴权三层 fail-closed'
for p in "POST|/rooms/$ROOM_CODE/bookings|{}" "POST|/bookings/$first/status|{\"to\":\"confirmed\"}" "POST|/rooms/$ROOM_CODE/closure|{\"date\":\"$in\",\"closed\":true,\"label\":\"检修\"}" "POST|/rooms/$ROOM_CODE/status|{\"to\":\"inactive\"}"; do
  m="${p%%|*}"; rest="${p#*|}"; path="${rest%%|*}"; body="${rest#*|}"
  r="$(req "$m" "$path" 'RAW:Token abc' "$body")"
  expect 401 "畸形凭证（无 Bearer 方案）← $path" "$(code_of "$r")" "$(body_of "$r")"
  r="$(req "$m" "$path" "$TOKEN-nope" "$body")"
  expect 403 "令牌不符 ← $path" "$(code_of "$r")" "$(body_of "$r")"
  r="$(req "$m" "$path" 'RAW:Bearer ' "$body")"
  expect 401 "空 Bearer ← $path" "$(code_of "$r")" "$(body_of "$r")"
done

echo
echo '④ 写接口正向路径（会改临时库）'
payload='{"check_in":"'$in'","check_out":"'$out'","units":1,"guests":2,"guest_name":"冒烟测试","phone":"13900002222","channel":"direct","note":"api-smoke"}'
r="$(req POST "/rooms/$ROOM_CODE/bookings" "$TOKEN" "$payload")"
expect 201 'POST 下单（合法输入）' "$(code_of "$r")" "$(body_of "$r")"
new="$(printf '%s' "$(body_of "$r")" | jget 'booking.code')"
[[ -n "$new" ]] || die "下单后取不到订单号：$(cut160 "$(body_of "$r")")"
has "$(body_of "$r")" '"masked_phone"' '新单只回显掩码手机号'
bad='{"check_in":"'$in'","check_out":"'$out'","units":1,"guests":2,"guest_name":"","phone":"138'"'"' OR 1=1--","channel":"x"}'
r="$(req POST "/rooms/$ROOM_CODE/bookings" "$TOKEN" "$bad")"
expect 400 '字段校验（姓名空+手机号注入+渠道非法）' "$(code_of "$r")" "$(body_of "$r")"
b="$(body_of "$r")"
has "$b" '"guest_name"' '错误定位到姓名字段'
has "$b" '"phone"' '错误定位到手机号字段'
has "$b" '"channel"' '错误定位到渠道字段'
r="$(req POST "/rooms/$ROOM_CODE/bookings?now=$TODAY" "$TOKEN" '{"check_in":"2020-01-01","check_out":"2020-01-02","units":1,"guests":1,"guest_name":"甲","phone":"13800001111","channel":"direct"}')"
# 过去日期是业务态冲突（不是字段格式错），所以口径是 409 + 中文原因，而不是 400。
expect 409 '过去日期被拒（409 + 原因）' "$(code_of "$r")" "$(body_of "$r")"
has "$(body_of "$r")" '入住日不能早于今天' '过去日期给出可读原因'
prefix='{"check_in":"'"$in"'","check_out":"'"$out"'","units":1,"guests":1,"guest_name":"甲","phone":"13800001111","channel":"direct","note":"'
huge="$(python3 -c 'print("长"*9000)')"
r="$(req POST "/rooms/$ROOM_CODE/bookings" "$TOKEN" "$prefix$huge\"}")"
expect 400 '超过 16KB 的请求体' "$(code_of "$r")" "$(body_of "$r")"
r="$(req POST "/bookings/$new/status" "$TOKEN" '{"to":"confirmed","note":"冒烟确认"}')"
expect 200 '状态机 pending→confirmed' "$(code_of "$r")" "$(body_of "$r")"
r="$(req POST "/bookings/$new/status?now=$TODAY" "$TOKEN" '{"to":"checked_in"}')"
expect 409 '时间门：未到入住日不能提前入住' "$(code_of "$r")" "$(body_of "$r")"
has "$(body_of "$r")" '"code":"not_yet"' '时间门返回 not_yet 而非 500'
r="$(req POST "/bookings/$new/status?now=$in" "$TOKEN" '{"to":"checked_in"}')"
expect 200 '入住日当天可办理入住' "$(code_of "$r")" "$(body_of "$r")"
r="$(req POST "/bookings/$new/status" "$TOKEN" '{"to":"checked_out"}')"
expect 200 'confirmed/checked_in→checked_out' "$(code_of "$r")" "$(body_of "$r")"
r="$(req POST "/bookings/$new/status" "$TOKEN" '{"to":"pending"}')"
expect 409 '终态不得回退' "$(code_of "$r")" "$(body_of "$r")"
r="$(req POST "/rooms/$ROOM_CODE/closure" "$TOKEN" '{"date":"'"$(date_add "$TODAY" 40)"'","closed":true,"label":"冒烟检修"}')"
expect 200 '设停售' "$(code_of "$r")" "$(body_of "$r")"
r="$(req GET "/rooms/$ROOM_CODE/quote?check_in=$(date_add "$TODAY" 40)&check_out=$(date_add "$TODAY" 41)&units=1&guests=1")"
expect 200 '停售后该日仍可试算' "$(code_of "$r")" "$(body_of "$r")"
has "$(body_of "$r")" '停售' '试算 blockers 说明停售原因'
r="$(req POST "/rooms/$ROOM_CODE/closure" "$TOKEN" '{"date":"'"$(date_add "$TODAY" 40)"'","closed":false,"label":"冒烟检修"}')"
expect 200 '恢复售卖' "$(code_of "$r")" "$(body_of "$r")"
r="$(req POST "/rooms/$ROOM_CODE/status" "$TOKEN" '{"to":"inactive"}')"
expect 200 '房型下架' "$(code_of "$r")" "$(body_of "$r")"
r="$(req POST "/rooms/$ROOM_CODE/status" "$TOKEN" '{"to":"active"}')"
expect 200 '房型上架' "$(code_of "$r")" "$(body_of "$r")"
r="$(req POST "/rooms/$ROOM_CODE/status" "$TOKEN" '{"to":"sold-out"}')"
expect 400 '非法房型状态被拒' "$(code_of "$r")" "$(body_of "$r")"

echo
echo '⑤ 裸路径（未加 /api 前缀）不得命中接口'
tmp="$(mktemp)"
code="$(curl -s -o "$tmp" -w '%{http_code}' "$BASE/stats")"
if [[ "$code" == "200" ]] && grep -q '"code"' "$tmp"; then
  FAIL=$((FAIL + 1)); echo '  FAIL /stats 命中了后端接口'
else
  PASS=$((PASS + 1)); echo "  ok   /stats 走 SPA 兜底（$code，非接口 JSON）"
fi
code="$(curl -s -o "$tmp" -w '%{http_code}' "$BASE/api/../../etc/passwd")"
if grep -q 'root:' "$tmp"; then
  FAIL=$((FAIL + 1)); echo '  FAIL 目录穿越读到了系统文件'
else
  PASS=$((PASS + 1)); echo "  ok   目录穿越被拒（$code）"
fi
rm -f "$tmp"

echo
echo "通过 $PASS 项，失败 $FAIL 项"
[[ "$FAIL" == 0 ]] || exit 1
