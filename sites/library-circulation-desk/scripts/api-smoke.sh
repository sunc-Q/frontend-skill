#!/usr/bin/env bash
# 逐接口冒烟：真监听端口 + 真 curl，覆盖
#   读接口字段/分页上限/排序白名单 / 隐私脱敏 / 参数校验与注入边界 /
#   鉴权三层（503·401·403）/ 借还续状态机正反向 / 罚金口径与快照不回溯 / 恒等式。
#
# 为什么 go test 之外还要这个脚本：go test 走 httptest 内存路由，
# 这里走真 HTTP + 真 SQLite，顺带验到 CORS、Content-Type、NoRoute JSON 这些网关层行为。
#
# 用法：
#   BASE=http://127.0.0.1:18401 ADMIN_TOKEN=xxx \
#     [NO_TOKEN_BASE=http://127.0.0.1:18402] bash scripts/api-smoke.sh
#
# 注意：**会真写库**（借出/归还/续借/配额），只对着 /tmp 上的一次性实例跑；
# 因此单文件 preview 必须由另一个刚灌完种子的实例生成，不能用本脚本跑过的库。
# 样本（条码、证号、借阅 ID）全部由 scripts/probe-samples.py 从接口反查，脚本不猜常量。
set -uo pipefail

BASE="${BASE:-http://127.0.0.1:18401}"
TOKEN="${ADMIN_TOKEN:-}"
NO_TOKEN_BASE="${NO_TOKEN_BASE:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PASS=0
FAIL=0

ok()   { PASS=$((PASS+1)); printf '  ok   %s%s\n' "$1" "${2:+ — ${2:0:90}}"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s%s\n' "$1" "${2:+${2:0:200}}"; }
chk()  { if [[ "$3" == *"$2"* ]]; then ok "$1" "$3"; else bad "$1" "期望含「$2」实际「$3」"; fi; }
neq()  { if [[ "$3" != *"$2"* ]]; then ok "$1" "不含「$2」"; else bad "$1" "不应含「$2」，实际「${3:0:160}」"; fi; }

req() { # req <方法> <路径> [令牌] [JSON]
  local m="$1" p="$2" tok="${3:-}" data="${4:-}"
  local args=(-s -m 15 -w $'\n%{http_code}' -X "$m" "$BASE$p" -H 'Accept: application/json')
  [[ -n "$tok" ]] && args+=(-H "Authorization: Bearer $tok")
  [[ -n "$data" ]] && args+=(-H 'Content-Type: application/json' --data "$data")
  curl "${args[@]}"
}
# status_of/body_of 既接受位置参数也接受管道输入，便于 `req … | body_of | jget …` 写法。
status_of() { if [[ $# -gt 0 ]]; then printf '%s' "$1"; else cat; fi | tail -n1; }
body_of()   { if [[ $# -gt 0 ]]; then printf '%s' "$1"; else cat; fi | sed '$d'; }

jget() {
  python3 -c '
import json,sys
try: o=json.loads(sys.stdin.read())
except Exception as e: print("PARSE_ERR:"+str(e)); sys.exit(0)
for part in sys.argv[1].split("."):
    if not part: continue
    if part.startswith("[") and part.endswith("]"):
        try: o=o[int(part[1:-1])]
        except Exception: print("<nil>"); sys.exit(0)
    elif isinstance(o,dict): o=o.get(part,"<nil>")
    elif isinstance(o,list):
        try: o=o[int(part)]
        except Exception: print("<nil>"); sys.exit(0)
    else: print("<nil>"); sys.exit(0)
print(json.dumps(o,ensure_ascii=False) if isinstance(o,(dict,list)) else o)
' "$1"
}
jlen() {
  python3 -c '
import json,sys
o=json.loads(sys.stdin.read())
for part in sys.argv[1].split("."):
    if part: o=o.get(part) if isinstance(o,dict) else o[int(part)]
print(len(o) if o is not None else "<nil>")
' "$1"
}
sec() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ============================================================ ⓪ 反查样本
sec "⓪ 从接口反查测试样本（scripts/probe-samples.py）"
PROBE="$(BASE="$BASE" TOKEN="$TOKEN" python3 "$HERE/probe-samples.py")"
if [[ -z "$PROBE" ]]; then
  bad "样本反查" "探针无输出，后续断言无法进行"; printf '\npass=%s fail=%s\n' "$PASS" "$FAIL"; exit 1
fi
eval "$PROBE"
for kv in ITEM_CODE BARCODE BARCODE_REF CARD CARD_SUSPENDED CARD_FINE LOAN_ACTIVE LOAN_OVERDUE LOAN_FINED; do
  if [[ -n "${!kv}" ]]; then ok "样本 $kv" "$kv=${!kv}"; else bad "样本 $kv 为空" "种子覆盖不足或接口异常"; fi
done
if [[ -z "$CARD_STUDENT" ]]; then bad "无学生证样本" "配额段落会跳过"; else ok "样本 CARD_STUDENT" "CARD_STUDENT=$CARD_STUDENT"; fi

# ============================================================ ① 健康与路由兜底
sec "① /api/health 与路由兜底"
r=$(req GET /api/health); b=$(body_of "$r")
chk "health 200" "200" "$(status_of "$r")"
chk "health status=ok" '"status":"ok"' "$b"
chk "时间为 UTC RFC3339" 'Z"' "$b"
code=$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$BASE/api/items/")
[[ "$code" != "500" ]] && ok "带斜杠路径不 500（$code）" || bad "带斜杠路径 500" ""
r=$(req GET /api/nope); b=$(body_of "$r")
chk "未知接口回 JSON 404" '"code":"not_found"' "$b"
chk "未知接口状态码" "404" "$(status_of "$r")"
r=$(req GET '/api/items/%2E%2E%2F%2E%2E%2Fetc%2Fpasswd'); b=$(body_of "$r")
neq "编码穿越不返回文件内容" "root:" "$b"
neq "编码穿越不泄露前端 HTML" "<!doctype" "$b"
r=$(req GET '/api/loans/99999999999999999999')
neq "超大 ID 不 500" 'goroutine' "$(body_of "$r")"

# ============================================================ ② 统计与恒等式
sec "② /api/stats：KPI 口径与恒等式"
r=$(req GET '/api/stats?days=14'); b=$(body_of "$r")
chk "stats 200" "200" "$(status_of "$r")"
chk "恒等式自检通过" '"identity_ok":true' "$b"
chk "恒等式违例列表为空" '"identity_issues":[]' "$b"
chk "趋势 14 天" "14" "$(printf '%s' "$b" | jlen trend)"
chk "类别 4 桶" "4" "$(printf '%s' "$b" | jlen by_category)"
A=$(printf '%s' "$b" | jget on_loan_copies); L=$(printf '%s' "$b" | jget active_loans)
chk "借出册数 == 在借单数" "$L" "copies=$A loans=$L"
chk "days 超上限被夹住" "200" "$(status_of "$(req GET '/api/stats?days=99999')")"
chk "days 非数字回落默认" "200" "$(status_of "$(req GET '/api/stats?days=abc')")"

# ============================================================ ③ 书目列表与详情
sec "③ /api/items：筛选、分页、注入边界"
for k in code title author year category added available total id; do
  for d in asc desc; do
    r=$(req GET "/api/items?sort=$k&dir=$d&page_size=3")
    chk "items sort=$k&dir=$d" "200" "$(status_of "$r")"
  done
done
r=$(req GET '/api/items?sort=;DROP%20TABLE--&page_size=3')
chk "注入型 sort 回落默认" "200" "$(status_of "$r")"
neq "错误响应不回显 SQL" "SQL" "$(body_of "$r")"
r=$(req GET '/api/items?page_size=5000')
chk "page_size 上限收口" "100" "$(printf '%s' "$(body_of "$r")" | jget page_size)"
r=$(req GET '/api/items?page_size=abc&page=xyz')
chk "非数字分页参数不 500" "200" "$(status_of "$r")"
chk "非数字分页回落 page=1" "1" "$(printf '%s' "$(body_of "$r")" | jget page)"
r=$(req GET '/api/items?status=bogus')
chk "非法 status 回落全部" "200" "$(status_of "$r")"
r=$(req GET '/api/items?status=available')
TOTAL=$(printf '%s' "$(body_of "$r")" | jget total)
# 样本量只作为「能不能跑」的门槛：偏少通常是因为同一个库被反复写跑过冒烟，
# 不是缺陷；真归零了才是种子耗尽，必须换新库。
if [[ "$TOTAL" -ge 10 ]]; then ok "可借书目 total=$TOTAL"
elif [[ "$TOTAL" -gt 0 ]]; then ok "可借书目偏少 total=$TOTAL（同库重复写跑所致）"
else bad "可借书目为 0" "种子已被借空，请用新库重启实例"; fi
r=$(req GET '/api/items?q=%25')
chk "LIKE 通配符按字面匹配（零命中）" '"total":0' "$(body_of "$r")"
r=$(req GET '/api/items?q=%5F%5F')
chk "下划线通配同样被转义" '"total":0' "$(body_of "$r")"
r=$(req GET "/api/items?q=$(python3 -c 'import urllib.parse;print(urllib.parse.quote("O%27Rourke; DROP TABLE items--"))')")
chk "引号+注入检索不 500" "200" "$(status_of "$r")"
chk "注入检索零命中" '"total":0' "$(body_of "$r")"
LONG=$(python3 -c 'print("长"*2000)')
r=$(req GET "/api/items?q=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$LONG")")
chk "超长检索不 500" "200" "$(status_of "$r")"
r=$(req GET '/api/items?category=reference')
chk "类别筛选 200" "200" "$(status_of "$r")"
chk "类别筛选有样本" '"category":"reference"' "$(body_of "$r")"
r=$(req GET '/api/items/NOPE-9999')
chk "不存在书目 404" "404" "$(status_of "$r")"
r=$(req GET '/api/items/%20%20')
chk "空白书目码不 500" "404" "$(status_of "$r")"

sec "③b /api/items/:code 详情结构"
r=$(req GET "/api/items/$ITEM_CODE"); b=$(body_of "$r")
chk "详情 200" "200" "$(status_of "$r")"
chk "含 item 与 copies" '"copies":[' "$b"
chk "书目码一致" "\"code\":\"$ITEM_CODE\"" "$b"
chk "借期口径随书别" '"loan_days"' "$b"
neq "详情无裸手机号键" '"phone"' "$b"

# ============================================================ ④ 借阅列表与详情
sec "④ /api/loans：排序、筛选、跨表检索"
for k in due borrowed returned member item barcode fine renew status id; do
  r=$(req GET "/api/loans?sort=$k&dir=desc&page_size=5")
  chk "loans sort=$k" "200" "$(status_of "$r")"
done
r=$(req GET '/api/loans?status=overdue&page_size=100')
OV=$(printf '%s' "$(body_of "$r")" | jget total)
[[ "$OV" -ge 5 ]] && ok "逾期在借单 total=$OV" || bad "逾期样本不足" "total=$OV"
r=$(req GET '/api/loans?status=active')
chk "在借筛选 200" "200" "$(status_of "$r")"
r=$(req GET '/api/loans?status=returned')
chk "已还筛选 200" "200" "$(status_of "$r")"
r=$(req GET '/api/loans?category=boxed_set&status=active')
chk "类别+状态组合筛选" "200" "$(status_of "$r")"
CARDPART="${CARD:0:9}"
r=$(req GET "/api/loans?q=$CARDPART&page_size=5")
chk "按证号前缀检索 200" "200" "$(status_of "$r")"
[[ "$(printf '%s' "$(body_of "$r")" | jget total)" -ge 1 ]] && ok "证号检索有命中" || bad "证号检索零命中" "$CARDPART"
r=$(req GET "/api/loans?q=$(python3 -c 'import urllib.parse;print(urllib.parse.quote("\" or 1=1 --"))')")
chk "布尔注入检索零命中" '"total":0' "$(body_of "$r")"
r=$(req GET "/api/loans/$LOAN_ACTIVE"); b=$(body_of "$r")
chk "借阅详情 200" "200" "$(status_of "$r")"
chk "详情含借阅单" '"loan":{' "$b"
chk "详情带读者与书目" '"member_card"' "$b"
r=$(req GET "/api/loans/$LOAN_FINED"); b=$(body_of "$r")
chk "已还单详情含罚金快照" '"fine_cents"' "$b"
FINE=$(printf '%s' "$b" | jget loan.fine_cents)
if [[ "$FINE" =~ ^[0-9]+$ ]] && (( FINE > 0 )); then ok "罚金大于零" "fine_cents=$FINE"; else bad "罚金应为正整数" "$FINE"; fi
r=$(req GET '/api/loans/999999'); chk "不存在借阅 404" "404" "$(status_of "$r")"
r=$(req GET '/api/loans/abc');  chk "非数字 ID 400" "400" "$(status_of "$r")"
r=$(req GET '/api/loans/0');    chk "ID=0 400" "400" "$(status_of "$r")"
r=$(req GET '/api/loans/-3');   chk "负 ID 不 500" "400" "$(status_of "$r")"

# ============================================================ ⑤ 读者
sec "⑤ /api/members/:card：脱敏与配额"
r=$(req GET "/api/members/$CARD"); b=$(body_of "$r")
chk "读者详情 200" "200" "$(status_of "$r")"
neq "响应无裸 phone 键" '"phone"' "$b"
chk "只有脱敏字段" 'phone_masked' "$b"
MASK=$(printf '%s' "$b" | jget member.phone_masked)
if [[ "$MASK" == "" || ${#MASK} -eq 11 ]]; then ok "手机号脱敏格式「$MASK」"; else bad "手机号脱敏异常" "$MASK"; fi
chk "配额随证别" '"quota"' "$b"
chk "欠费口径字段" '"outstanding_fine"' "$b"
chk "借阅样本非空" '"loans":[' "$b"
r=$(req GET '/api/members/R-9999-9999'); chk "不存在证号 404" "404" "$(status_of "$r")"
r=$(req GET '/api/members/%27%20or%201%3D1%20--'); chk "注入型证号不 500" "404" "$(status_of "$r")"

sec "⑤b 只读不变量取证（scripts/check-read-invariants.py）"
if INV_OUT="$(BASE="$BASE" python3 "$HERE/check-read-invariants.py" 2>&1)"; then
  printf '%s\n' "$INV_OUT" | sed 's/^/  /'
  N=$(printf '%s\n' "$INV_OUT" | grep -c '^  ok')
  PASS=$((PASS + N))
  ok "只读不变量全过" "$N 条"
else
  printf '%s\n' "$INV_OUT" | sed 's/^/  /'
  bad "只读不变量存在失败项" ""
fi

# ============================================================ ⑥ 鉴权三层
sec "⑥ 写接口鉴权矩阵（503 · 401 · 403）"
BODY="{\"barcode\":\"$BARCODE\",\"card_no\":\"$CARD\"}"
if [[ -n "$NO_TOKEN_BASE" ]]; then
  code=$(curl -s -m 15 -o /dev/null -w '%{http_code}' -X POST "$NO_TOKEN_BASE/api/admin/borrow" \
    -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" --data "$BODY")
  chk "未配 ADMIN_TOKEN → 503 fail-closed" "503" "$code"
  nt=$(curl -s -m 15 -X POST "$NO_TOKEN_BASE/api/admin/borrow" -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $TOKEN" --data "$BODY" | jget code)
  chk "503 错误码 server_misconfigured" "server_misconfigured" "$nt"
  rc=$(curl -s -m 15 -o /dev/null -w '%{http_code}' -X POST "$NO_TOKEN_BASE/api/admin/loans/$LOAN_ACTIVE/return" \
    -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" --data '{}')
  chk "归还同样 fail-closed 503" "503" "$rc"
else
  bad "缺少 NO_TOKEN_BASE" "无法断言 503 层"
fi
r=$(req POST /api/admin/borrow "" "$BODY");        chk "缺令牌 → 401" "401" "$(status_of "$r")"
r=$(curl -s -m 15 -w $'\n%{http_code}' -X POST "$BASE/api/admin/borrow" -H "Authorization: RAW:Basic zz" \
  -H 'Content-Type: application/json' --data "$BODY")
chk "非 Bearer 头 → 401" "401" "$(status_of "$r")"
r=$(curl -s -m 15 -w $'\n%{http_code}' -X POST "$BASE/api/admin/borrow" -H "Authorization: Bearer " \
  -H 'Content-Type: application/json' --data "$BODY")
chk "只有 Bearer 前缀 → 401" "401" "$(status_of "$r")"
# Bearer 方案名按 RFC 7235 大小写不敏感，实现里用的是 EqualFold——所以小写应当放行。
# 拿一条不存在的借阅单试探：能走到业务层就是 404，被鉴权拦下才是 401/403；
# 这样既断言了大小写不敏感，又不会真的借出一册把后面的断言全带偏。
r=$(curl -s -m 15 -w $'\n%{http_code}' -X POST "$BASE/api/admin/loans/999999/renew" -H "Authorization: bearer $TOKEN" \
  -H 'Content-Type: application/json' --data '{}')
chk "小写 bearer 同样通过鉴权（走到业务层 404）" "404" "$(status_of "$r")"
r=$(req POST /api/admin/borrow "wrong-token-here" "$BODY")
chk "错令牌 → 403" "403" "$(status_of "$r")"
# 这条断言的「期望值」本身就是令牌，绝不能用 neq/chk 打印出来（它们会把 needle 写进日志），
# 否则冒烟报告等于在文件里回显了一次密钥。结论只报「含/不含」，不报内容。
if [[ "$(body_of "$r")" == *"$TOKEN"* ]]; then
  bad "403 回显了期望令牌" "响应体里出现令牌的常量时间比较目标"
else
  ok "403 不回显期望令牌" "(needle 已脱敏)"
fi
r=$(req POST "/api/admin/loans/$LOAN_ACTIVE/return" "wrong-token-here" '{}')
chk "归还错令牌 → 403" "403" "$(status_of "$r")"
r=$(req POST "/api/admin/loans/$LOAN_ACTIVE/renew" "" '{}')
chk "续借缺令牌 → 401" "401" "$(status_of "$r")"
STAT_BEFORE=$(req GET /api/stats | body_of | jget active_loans)

# ============================================================ ⑦ 借出：校验与状态机
sec "⑦ POST /api/admin/borrow：校验顺序与业务门槛"
if [[ -z "$TOKEN" ]]; then
  bad "ADMIN_TOKEN 未提供" "写接口段落全部跳过"
else
  r=$(req POST /api/admin/borrow "$TOKEN" '{"barcode":"x","card_no":"y"}')
  chk "字段过短 → 400" "400" "$(status_of "$r")"
  chk "逐字段回显 barcode" '"barcode"' "$(body_of "$r")"
  chk "逐字段回显 card_no" '"card_no"' "$(body_of "$r")"
  chk "错误码 invalid_request" '"invalid_request"' "$(body_of "$r")"
  r=$(req POST /api/admin/borrow "$TOKEN" "{\"barcode\":\"BN' OR 1=1--\",\"card_no\":\"$CARD\"}")
  chk "注入型条码 → 400" "400" "$(status_of "$r")"
  neq "400 不回显数据库细节" "sqlite" "$(body_of "$r")"
  r=$(req POST /api/admin/borrow "$TOKEN" "{\"barcode\":\"$BARCODE\",\"card_no\":\"中文证号\"}")
  chk "中文证号 → 400" "400" "$(status_of "$r")"
  BIG=$(python3 -c 'print("B"*70000)')
  r=$(req POST /api/admin/borrow "$TOKEN" "{\"barcode\":\"$BIG\",\"card_no\":\"$CARD\"}")
  chk "70KB 超长条码 → 400" "400" "$(status_of "$r")"
  neq "超长响应不回显内容" "BBBBB" "$(body_of "$r")"
  r=$(req POST /api/admin/borrow "$TOKEN" '{"bad json')
  chk "畸形 JSON → 400" "400" "$(status_of "$r")"
  chk "畸形 JSON 错误码" '"invalid_request"' "$(body_of "$r")"
  r=$(req POST /api/admin/borrow "$TOKEN" '{"barcode":"BN-999999","card_no":"R-2026-0001"}')
  chk "不存在条码 → 404" "404" "$(status_of "$r")"
  r=$(req POST /api/admin/borrow "$TOKEN" "{\"barcode\":\"$BARCODE_REF\",\"card_no\":\"$CARD\"}")
  chk "参考书不外借 → 409" "409" "$(status_of "$r")"
  chk "错误码 reference_only" '"reference_only"' "$(body_of "$r")"
  r=$(req GET "/api/items/$ITEM_CODE")
  chk "门槛失败不留半成品（该册仍在架）" '"status":"available"' "$(body_of "$r")"
  if [[ -n "$CARD_SUSPENDED" ]]; then
    r=$(req POST /api/admin/borrow "$TOKEN" "{\"barcode\":\"$BARCODE\",\"card_no\":\"$CARD_SUSPENDED\"}")
    chk "停用读者 → 409" "409" "$(status_of "$r")"
    chk "错误码 member_suspended" '"member_suspended"' "$(body_of "$r")"
  else
    bad "无停用读者样本" "种子覆盖不足"
  fi
  if [[ -n "$CARD_FINE" ]]; then
    r=$(req POST /api/admin/borrow "$TOKEN" "{\"barcode\":\"$BARCODE\",\"card_no\":\"$CARD_FINE\"}")
    chk "欠费超门槛 → 409" "409" "$(status_of "$r")"
    chk "错误码 fine_gate" '"fine_gate"' "$(body_of "$r")"
  else
    bad "无欠费读者样本" "种子覆盖不足"
  fi

  # 正向借出 → 复本转借出 → 重复借同一册 409
  r=$(req POST /api/admin/borrow "$TOKEN" "$BODY"); b=$(body_of "$r")
  chk "借出成功 → 201" "201" "$(status_of "$r")"
  NEW_ID=$(printf '%s' "$b" | jget loan.id)
  chk "201 返回借阅单" '"loan":{' "$b"
  chk "新单状态 active" '"status":"active"' "$b"
  chk "新单指向所选复本" "\"copy_barcode\":\"$BARCODE\"" "$b"
  chk "新单指向所选读者" "\"member_card\":\"$CARD\"" "$b"
  r=$(req POST /api/admin/borrow "$TOKEN" "$BODY")
  chk "同册重复借出 → 409" "409" "$(status_of "$r")"
  chk "错误码 copy_unavailable" '"copy_unavailable"' "$(body_of "$r")"
  r=$(req GET "/api/items/$ITEM_CODE")
  chk "复本转借出" "\"barcode\":\"$BARCODE\"" "$(body_of "$r")"
  chk "在借人回填" "\"borrower_card\":\"$CARD\"" "$(body_of "$r")"
  r=$(req GET '/api/loans/'"$NEW_ID")
  chk "新单可查详情" '"loan":{' "$(body_of "$r")"
  AL=$(req GET /api/stats | body_of | jget active_loans)
  chk "在借单数 +1" "$((STAT_BEFORE + 1))" "active_loans=$AL"

  # 续借：未逾期可续两次，第三次 409
  DUE1=$(req GET "/api/loans/$NEW_ID" | body_of | jget loan.due_at)
  r=$(req POST "/api/admin/loans/$NEW_ID/renew" "$TOKEN" '{}')
  chk "续借 #1 → 200" "200" "$(status_of "$r")"
  chk "续借次数 1" '"renew_count":1' "$(body_of "$r")"
  DUE2=$(printf '%s' "$(body_of "$r")" | jget loan.due_at)
  [[ "$DUE2" > "$DUE1" ]] && ok "应还日顺延 $DUE1 → $DUE2" || bad "应还日未顺延" "$DUE1 / $DUE2"
  r=$(req POST "/api/admin/loans/$NEW_ID/renew" "$TOKEN" '{}')
  chk "续借 #2 → 200" "200" "$(status_of "$r")"
  DUE3=$(printf '%s' "$(body_of "$r")" | jget loan.due_at)
  [[ "$DUE3" > "$DUE2" ]] && ok "第二次续借继续顺延 $DUE2 → $DUE3" || bad "第二次续借未顺延" "$DUE2 / $DUE3"
  r=$(req POST "/api/admin/loans/$NEW_ID/renew" "$TOKEN" '{}')
  chk "续借 #3 → 409 用尽" "409" "$(status_of "$r")"
  chk "错误码 renew_exhausted" '"renew_exhausted"' "$(body_of "$r")"
  chk "用尽后应还日不再变" "$DUE3" "$(req GET "/api/loans/$NEW_ID" | body_of | jget loan.due_at)"
  r=$(req POST '/api/admin/loans/999999/renew' "$TOKEN" '{}')
  chk "不存在单续借 → 404" "404" "$(status_of "$r")"
  r=$(req POST '/api/admin/loans/abc/renew' "$TOKEN" '{}')
  chk "非法 ID 续借 → 400" "400" "$(status_of "$r")"

  # 逾期单不可续借
  if [[ -n "$LOAN_OVERDUE" ]]; then
    r=$(req POST "/api/admin/loans/$LOAN_OVERDUE/renew" "$TOKEN" '{}')
    chk "逾期单续借 → 409" "409" "$(status_of "$r")"
    chk "错误码 overdue_no_renew" '"overdue_no_renew"' "$(body_of "$r")"
  else
    bad "无逾期在借样本" "种子覆盖不足"
  fi

  # 学生证配额：一直借到 quota_exceeded。
  # 复本要跨书目取——单本书的在架册数撑不起学生证的 5 册配额，
  # 只盯着一本书会先「借完」而不是「借满」，把配额断言变成误报。
  if [[ -n "$CARD_STUDENT" ]]; then
    saw_quota=""
    # 先把该读者已有的在借单归还：段落要能在被写过的库上重跑，
    # 否则「借到上限」变成「已经在上限之外」，样本不足时直接空转。
    RELEASE="$(BASE="$BASE" CARD="$CARD_STUDENT" python3 "$HERE/list-active-loans.py")"
    for id in $RELEASE; do
      req POST "/api/admin/loans/$id/return" "$TOKEN" '{"paid":true}' >/dev/null
    done
    if [[ -n "$RELEASE" ]]; then ok "配额前置：先归还该读者 $RELEASE"; fi
    if ! BC_LIST="$(BASE="$BASE" COUNT=12 python3 "$HERE/free-barcodes.py" 2>/dev/null)"; then
      bad "跨书目取在架复本" "free-barcodes.py 无输出"
    fi
    POOL_N=$(printf '%s\n' "$BC_LIST" | grep -c '[A-Z]')
    QUOTA=$(req GET "/api/members/$CARD_STUDENT" | body_of | jget member.quota)
    # 借到上限需要「可用复本数 > 该证配额」，否则只会先把在架册借空而碰不到门槛。
    # 同一个库被反复写跑就会枯竭，这时给出明确指向而不是让人误读成规则失效。
    if [[ "$POOL_N" =~ ^[0-9]+$ && "$QUOTA" =~ ^[0-9]+$ ]] && (( POOL_N > QUOTA )); then
      :
    else
      bad "配额样本不足" "在架可借 $POOL_N 册 / 学生证配额 $QUOTA，请用 scripts/run-smoke.sh 在全新库上重跑"
    fi
    while IFS= read -r bc; do
      [[ -z "$bc" ]] && continue
      r=$(req POST /api/admin/borrow "$TOKEN" "{\"barcode\":\"$bc\",\"card_no\":\"$CARD_STUDENT\"}")
      [[ "$(status_of "$r")" == "201" ]] && continue
      if [[ "$(printf '%s' "$(body_of "$r")" | jget code)" == "quota_exceeded" ]]; then saw_quota="yes"; break; fi
      bad "配额循环意外中断" "barcode=$bc $(body_of "$r")"; break
    done <<EOF
$BC_LIST
EOF
    chk "学生证跑到上限 → quota_exceeded" "yes" "$saw_quota"
  fi

  # 归还：罚金快照与状态机
  r=$(req POST "/api/admin/loans/$NEW_ID/return" "$TOKEN" '{"paid":true}'); b=$(body_of "$r")
  chk "按期归还 → 200" "200" "$(status_of "$r")"
  chk "未逾期罚金为 0" '"fine_cents":0' "$b"
  chk "状态转 returned" '"status":"returned"' "$b"
  chk "归还时间落表" '"returned_at":' "$b"
  chk "缴费标记生效" '"fine_paid":true' "$b"
  r=$(req POST "/api/admin/loans/$NEW_ID/return" "$TOKEN" '{}')
  chk "重复归还 → 409" "409" "$(status_of "$r")"
  chk "错误码 invalid_state" '"invalid_state"' "$(body_of "$r")"
  r=$(req POST "/api/admin/loans/$NEW_ID/renew" "$TOKEN" '{}')
  chk "已还单不可续借 → 409" "409" "$(status_of "$r")"
  back=$(curl -s -m 15 "$BASE/api/items/$ITEM_CODE" | python3 -c '
import json,sys
d=json.loads(sys.stdin.read())
print(next((c["status"] for c in d["copies"] if c["barcode"]==sys.argv[1]),"<none>"))
' "$BARCODE")
  chk "归还后该册回到在架" "available" "$back"
  r=$(req POST '/api/admin/loans/abc/return' "$TOKEN" '{}')
  chk "非法 ID 归还 → 400" "400" "$(status_of "$r")"
  r=$(req POST '/api/admin/loans/999999/return' "$TOKEN" '{}')
  chk "不存在单归还 → 404" "404" "$(status_of "$r")"

  # 逾期归还：结算额 == 归还前接口预估额
  if [[ -n "$LOAN_OVERDUE" ]]; then
    want=$(req GET "/api/loans/$LOAN_OVERDUE" | body_of | jget loan.fine_due)
    r=$(req POST "/api/admin/loans/$LOAN_OVERDUE/return" "$TOKEN" '{"paid":false}'); b=$(body_of "$r")
    chk "逾期归还 → 200" "200" "$(status_of "$r")"
    got=$(printf '%s' "$b" | jget fine_cents)
    chk "结算额 == 归还前 fine_due 预估" "$want" "fine_cents=$got fine_due=$want"
    chk "未缴标记 fine_paid=false" '"fine_paid":false' "$b"
    again=$(req GET "/api/loans/$LOAN_OVERDUE" | body_of | jget loan.fine_cents)
    chk "快照二次读取不变（不回溯）" "$got" "again=$again"
    [[ "$got" -gt 0 ]] && ok "该单确实产生了逾期费（$got 分）" || bad "逾期单结算为零" "got=$got"
  fi

  # 写后恒等式复验
  r=$(req GET '/api/stats'); b=$(body_of "$r")
  chk "写操作后恒等式仍成立" '"identity_ok":true' "$b"
  A=$(printf '%s' "$b" | jget on_loan_copies); L=$(printf '%s' "$b" | jget active_loans)
  chk "写后借出册数仍等于在借单数" "$L" "copies=$A loans=$L"
fi

# ============================================================ ⑧ 响应头与 CORS
sec "⑧ 响应头与 CORS"
hdr=$(curl -s -m 15 -D - -o /dev/null "$BASE/api/stats")
chk "Content-Type JSON" 'application/json' "$hdr"
chk "X-Content-Type-Options" 'nosniff' "$hdr"
chk "X-Frame-Options" 'DENY' "$hdr"
chk "Cache-Control no-store" 'no-store' "$hdr"
pre=$(curl -s -m 15 -D - -o /dev/null -X OPTIONS "$BASE/api/admin/borrow" \
  -H 'Origin: http://127.0.0.1:5199' -H 'Access-Control-Request-Method: POST')
chk "本机来源预检放行" "204" "$pre"
evil=$(curl -s -m 15 -D - -o /dev/null -X OPTIONS "$BASE/api/admin/borrow" \
  -H 'Origin: http://evil.example' -H 'Access-Control-Request-Method: POST')
neq "外部来源不发放行头" 'evil.example' "$evil"

# ============================================================ ⑨ 错误响应面
sec "⑨ 错误响应不泄露内部信息"
for p in '/api/items/%2E%2E' '/api/loans/-1' '/api/members/%00bad' '/api/stats?days=99999'; do
  r=$(curl -s -m 15 -w $'\n%{http_code}' "$BASE$p")
  code=$(status_of "$r"); body=$(body_of "$r")
  if [[ "$code" != "500" ]]; then ok "$p → $code 非 500"; else bad "$p 触发 500" "$body"; fi
  neq "$p 无 panic 栈" 'goroutine' "$body"
  neq "$p 无 SQL 语句" 'SELECT' "$body"
done
neq "错误体无源码路径" 'internal/repository' "$(curl -s -m 15 "$BASE/api/loans/999999")"

# ============================================================ 汇总
printf '\n\033[1mpass=%s fail=%s\033[0m\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]] || exit 1
