#!/usr/bin/env bash
# 接口冒烟：7 个端点 + 写接口鉴权/校验矩阵。
# 只读接口打印关键统计，写接口断言 HTTP 状态码；任一断言失败即非 0 退出。
# 用法：API=http://127.0.0.1:8080 TOKEN="$ADMIN_TOKEN" bash scripts/api-smoke.sh
#       （TOKEN 只从你自己的 shell 环境传入，绝不写进文件或提交）
set -uo pipefail
API="${API:-http://127.0.0.1:8080}"
TOKEN="${TOKEN:-}"
export OUT=/tmp/smoke.$$.json
fails=0
trap 'rm -f "$OUT"' EXIT

# q <JS 表达式>：对 $OUT 里的 JSON 求值
q() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.env.OUT,"utf8"));console.log('"$1"')' ; }

# check <期望状态> <说明> <curl 参数...>
check() {
  local want="$1" name="$2"; shift 2
  local code
  code="$(curl -s -o "$OUT" -w '%{http_code}' "$@")"
  if [ "$code" = "$want" ]; then
    printf '  ok    %-40s -> %s\n' "$name" "$code"
  else
    printf '  FAIL  %-40s -> %s (want %s) %s\n' "$name" "$code" "$want" "$(head -c 200 "$OUT")"
    fails=$((fails + 1))
  fi
}

echo "== 读接口 =="
code=$(curl -s -o "$OUT" -w '%{http_code}' "$API/api/health"); printf '  health %s status=%s\n' "$code" "$(q 'j.status')"
curl -s -o "$OUT" "$API/api/stats?days=7"
printf '  stats  occupancy=%s%% waitlist=%s confirmed=%s no_show_rate=%s%% revenue=%s\n' \
  "$(q 'j.occupancy_pct')" "$(q 'j.waitlist_bookings')" "$(q 'j.confirmed_bookings')" "$(q 'j.no_show_rate_pct')" "$(q 'j.revenue_cents')"
curl -s -o "$OUT" "$API/api/schedule?page_size=100&sort=remaining&dir=asc"
printf '  schedule total=%s served=%s full=%s(with_waitlist=%s)\n' \
  "$(q 'j.total')" "$(q 'j.items.length')" "$(q 'j.items.filter(s=>s.remaining===0).length')" \
  "$(q 'j.items.filter(s=>s.remaining===0&&s.waitlist>0).length')"
curl -s -o "$OUT" "$API/api/classes"; printf '  classes total=%s active_only=%s\n' "$(q 'j.total')" "$(q 'j.items.every(c=>c.active)')"
curl -s -o "$OUT" "$API/api/schedule?page_size=1"
SID=$(q 'j.items[0].id')
curl -s -o "$OUT" "$API/api/sessions/$SID"
printf '  detail session=%s roster=%s seats=%s/%s\n' "$SID" "$(q 'j.roster.length')" "$(q 'j.session.confirmed')" "$(q 'j.session.capacity')"

echo "== 读接口边界 =="
check 200 "days=999 收敛到窗口上限"   "$API/api/stats?days=999"
check 200 "page_size=5000 收敛到上限" "$API/api/schedule?page_size=5000"
check 200 "sort 白名单外参数被忽略"     "$API/api/schedule?sort=s.id;DROP%20TABLE"
check 200 "date 非法时回落今天"          "$API/api/schedule?date=2026-13-45"
check 404 "不存在的课节"              "$API/api/sessions/999999"
check 404 "不存在的接口"              "$API/api/nope"
check 400 "非数字课节 ID"             "$API/api/sessions/1%20OR%201%3D1"
curl -s -o "$OUT" "$API/api/schedule?sort=s.id%3BDROP%20TABLE&date=2026-13-45&page_size=9999&days=99"
printf '  收敛结果 sort=%s from=%s page_size=%s days=%s（恶意/越界参数被丢弃而非报错）\n' \
  "$(q 'j.sort')" "$(q 'j.from')" "$(q 'j.page_size')" "$(q 'j.days')"

post() { curl -s -o "$OUT" -w '%{http_code}' -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$1" "$2"; }

echo "== 写接口鉴权矩阵（POST /api/admin/members）=="
BODY='{"name":"冒烟测试会员","phone":"13900001111","card_type":"trial","credits":3}'
check 401 "缺少 Authorization 头" -X POST -H 'Content-Type: application/json' -d "$BODY" "$API/api/admin/members"
check 401 "有令牌但缺 Bearer 前缀" -X POST -H "Authorization: ${TOKEN}" -H 'Content-Type: application/json' -d "$BODY" "$API/api/admin/members"
check 403 "令牌错误" -X POST -H "Authorization: Bearer wrong-token-1234567890" -H 'Content-Type: application/json' -d "$BODY" "$API/api/admin/members"
check 400 "非法 JSON 请求体" -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":' "$API/api/admin/members"
check 400 "手机号注入串" -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"张三","phone":"'"'"' OR 1=1--"}' "$API/api/admin/members"
LONG=$(node -e 'console.log("测".repeat(400))')
check 400 "姓名超长 400 字" -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"name\":\"$LONG\",\"phone\":\"13900002222\",\"card_type\":\"trial\"}" "$API/api/admin/members"
check 400 "卡种不在白名单" -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"张三","phone":"13900003333","card_type":"lifetime"}' "$API/api/admin/members"
check 403 "预约接口用错误令牌" -X POST -H "Authorization: Bearer nope-nope-nope-nope" -H 'Content-Type: application/json' -d '{"member_id":1}' "$API/api/admin/sessions/1/bookings"

if [ -n "$TOKEN" ]; then
  echo "== 写接口正路 =="
  PHONE="139$(node -e 'console.log(String(10000000+Math.floor(Math.random()*89999999)))')"
  check 201 "新建会员" -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"name\":\"冒烟会员甲\",\"phone\":\"$PHONE\",\"card_type\":\"ten_session\",\"credits\":8}" "$API/api/admin/members"
  MID=$(q 'j.id')
  printf '  新会员 id=%s 到期=%s（次卡默认 180 天有效）\n' "$MID" "$(q 'j.expires_at.slice(0,10)')"
  check 409 "同手机号重复注册" -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"name\":\"冒烟会员乙\",\"phone\":\"$PHONE\",\"card_type\":\"trial\"}" "$API/api/admin/members"
  printf '  重复注册返回：%s\n' "$(q 'j.code + " / " + j.message')"

  curl -s -o "$OUT" "$API/api/schedule?page_size=100&sort=remaining&dir=asc"
  TARGET=$(q 'j.items.filter(s=>s.remaining>0&&new Date(s.start_at)>new Date()).slice(-1)[0].id')
  FULL=$(q 'j.items.filter(s=>s.remaining===0&&s.status==="open").slice(-1)[0].id')
  PAST=$(q 'j.items.filter(s=>new Date(s.start_at)<new Date()).slice(-1)[0].id')
  WPHONE="139$(node -e 'console.log(String(10000000+Math.floor(Math.random()*89999999)))')"
  ZPHONE="139$(node -e 'console.log(String(10000000+Math.floor(Math.random()*89999999)))')"
  check 201 "正常预约（按 member_id，扣次）" -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"member_id\":$MID,\"source\":\"front_desk\"}" "$API/api/admin/sessions/$TARGET/bookings"
  printf '  booking=%s status=%s seats=%s/%s credit_used=%s msg=%s\n' \
    "$(q 'j.booking.id')" "$(q 'j.booking.status')" "$(q 'j.session.session.confirmed')" "$(q 'j.session.session.capacity')" \
    "$(q 'j.credit_used')" "$(q 'j.message')"
  check 409 "同一会员重复预约同一课节" -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"member_id\":$MID}" "$API/api/admin/sessions/$TARGET/bookings"
  printf '  查重返回：%s\n' "$(q 'j.code + " / " + j.message')"
  check 404 "给不存在的课节预约" -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"member_id\":$MID}" "$API/api/admin/sessions/999999/bookings"
  check 404 "预约不存在的会员" -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"member_id":999999}' "$API/api/admin/sessions/$TARGET/bookings"
  check 404 "手机号未注册" -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"phone":"13900009999"}' "$API/api/admin/sessions/$TARGET/bookings"
  if [ -n "$PAST" ] && [ "$PAST" != "undefined" ]; then
    check 409 "已开课的课节不能补约" -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d "{\"member_id\":$MID}" "$API/api/admin/sessions/$PAST/bookings"
    printf '  补约返回：%s\n' "$(q 'j.code + " / " + j.message')"
  fi

  curl -s -o "$OUT" -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"name\":\"冒烟会员丙\",\"phone\":\"$WPHONE\",\"card_type\":\"monthly\"}" "$API/api/admin/members"
  if [ -n "$FULL" ] && [ "$FULL" != "undefined" ]; then
    check 409 "满座且未排队 -> session_full" -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d "{\"phone\":\"$WPHONE\"}" "$API/api/admin/sessions/$FULL/bookings"
    printf '  满座返回：%s\n' "$(q 'j.code + " / " + j.message')"
    curl -s -o "$OUT" -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d "{\"phone\":\"$WPHONE\",\"allow_waitlist\":true}" "$API/api/admin/sessions/$FULL/bookings"
    if [ "$(q 'j.booking.status')" = "waitlist" ]; then
      printf '  ok    满座课节带 allow_waitlist -> %s（%s）\n' "$(q 'j.booking.status')" "$(q 'j.message')"
    else
      printf '  FAIL  满座课节应转候补，实得 %s\n' "$(head -c 200 "$OUT")"; fails=$((fails + 1))
    fi
  fi
  curl -s -o "$OUT" -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"name\":\"无量会员\",\"phone\":\"$ZPHONE\",\"card_type\":\"ten_session\",\"credits\":0}" "$API/api/admin/members"
  check 409 "次卡余额为 0 时拒绝预约" -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"phone\":\"$ZPHONE\"}" "$API/api/admin/sessions/$TARGET/bookings"
  printf '  扣次门槛返回：%s\n' "$(q 'j.code + " / " + j.message')"
fi

echo
if [ "$fails" -gt 0 ]; then echo "FAILED: $fails 个断言未通过"; exit 1; fi
echo "全部断言通过"
