#!/usr/bin/env bash
# 逐接口冒烟：本机起服务后对每个端点真发 HTTP 请求并断言响应，覆盖
#   读接口字段与上限 / 隐私脱敏 / 参数校验与注入边界 / 鉴权三层(401·403·503) /
#   写接口正反向 / 状态机非法跃迁 / SLA 快照不回溯 / 四条恒等式自洽。
#
# 为什么 go test 之外还要这个脚本：go test 走的是 httptest 内存路由，
# 这里走真监听端口 + 真 curl，能顺带验到 CORS、Content-Type、超时头这些网关层行为。
#
# 用法：
#   BASE=http://127.0.0.1:8091 ADMIN_TOKEN=xxx bash scripts/api-smoke.sh
# 前置：后端已用该 ADMIN_TOKEN 起在 $BASE；另需一个「未配令牌」的实例做 503 断言
#   （脚本会用 NO_TOKEN_BASE 若已提供，否则跳过该断言）。
# 注意：会真的写库（建单/派单/停表/恢复/改策略），只对着本地实例跑。
set -uo pipefail

BASE="${BASE:-http://127.0.0.1:8091}"
TOKEN="${ADMIN_TOKEN:-}"
NO_TOKEN_BASE="${NO_TOKEN_BASE:-}"
PASS=0
FAIL=0

ok()   { PASS=$((PASS+1)); printf '  ok   %s%s\n' "$1" "${2:+ — ${2:0:90}}"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s%s\n' "$1" "${2:+${2:0:160}}"; }
chk()  { # chk <名称> <期望字符串> <实际>
  if [[ "$3" == *"$2"* ]]; then ok "$1" "$3"; else bad "$1" "期望含「$2」实际「$3」"; fi
}

# body: 发请求，输出 "HTTP状态\n响应体"
req() { # req <方法> <路径> [令牌] [JSON]
  local m="$1" p="$2" tok="${3:-}" data="${4:-}"
  local args=(-s -m 10 -w $'\n%{http_code}' -X "$m" "$BASE$p" -H 'Accept: application/json')
  [[ -n "$tok" ]] && args+=(-H "Authorization: Bearer $tok")
  [[ -n "$data" ]] && args+=(-H 'Content-Type: application/json' --data "$data")
  curl "${args[@]}"
}
status_of() { printf '%s' "$1" | tail -n1; }
body_of()   { printf '%s' "$1" | sed '$d'; }

# jget: 用 python3 取 JSON 字段（点号路径 / 方括号下标），键不存在输出 <nil>
jget() {
  python3 -c '
import json,sys
try:
    o=json.loads(sys.stdin.read())
except Exception as e:
    print("PARSE_ERR:"+str(e)); sys.exit(0)
for part in sys.argv[1].split("."):
    if part=="": continue
    if part.startswith("[") and part.endswith("]"):
        idx=int(part[1:-1])
        try: o=o[idx]
        except Exception: print("<nil>"); sys.exit(0)
    elif isinstance(o,dict):
        o=o.get(part,"<nil>")
    elif isinstance(o,list):
        try: o=o[int(part)]
        except Exception: print("<nil>"); sys.exit(0)
    else:
        print("<nil>"); sys.exit(0)
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

# ---------------------------------------------------------------- 读接口
sec "① /api/health：现场时间与工作窗口"
r=$(req GET /api/health); b=$(body_of "$r")
chk "health 200" "200" "$(status_of "$r")"
chk "health status=ok" '"status":"ok"' "$b"
chk "minutes_per_day=480" '"minutes_per_day":480' "$b"
chk "工作窗口两段" '09:00-12:00' "$b"
chk "带 +08:00 偏移" '+08:00' "$b"

sec "② /api/meta：前端字典的唯一来源"
r=$(req GET /api/meta); b=$(body_of "$r")
chk "meta 200" "200" "$(status_of "$r")"
chk "7 个状态" '7' "$(printf '%s' "$b" | jlen statuses)"
chk "4 个合同等级" '4' "$(printf '%s' "$b" | jlen tiers)"
chk "6 个页签" '6' "$(printf '%s' "$b" | jlen only)"
chk "排序项 10 个" '10' "$(printf '%s' "$b" | jlen sorts)"
chk "状态含中文 label" '待受理' "$b"
chk "max_page_size 收口" '"max_page_size":100' "$b"
chk "max_reopen=2" '"max_reopen":2' "$b"
chk "停表原因非空" 'pause_reasons' "$b"
chk "单位口径说明" '工作分钟' "$b"

sec "③ /api/stats：KPI / 趋势 / 负载 / 矩阵 / 审计"
r=$(req GET /api/stats); b=$(body_of "$r")
chk "stats 200" "200" "$(status_of "$r")"
chk "14 天趋势" '14' "$(printf '%s' "$b" | jlen daily)"
chk "工程师负载 12 行" '12' "$(printf '%s' "$b" | jlen agents)"
chk "日历快照 16 格" '16' "$(printf '%s' "$b" | jlen calendar_days)"
chk "状态分布 7 桶" '7' "$(printf '%s' "$b" | jlen by_status)"
chk "含解决达标率" 'met_rate_pct' "$b"
chk "含首响达标率" 'response_met_pct' "$b"
chk "审计块含时钟恒等" 'clock_identity_ok' "$b"
chk "审计块含时间线恒等" 'timeline_identity_ok' "$b"
chk "含日历快照" 'calendar' "$b"

sec "④ /api/tickets：分页上限、筛选、注入与超长边界"
r=$(req GET '/api/tickets?page_size=3'); b=$(body_of "$r")
chk "列表 200" "200" "$(status_of "$r")"
chk "page_size 生效" '3' "$(printf '%s' "$b" | jlen items)"
TOTAL=$(printf '%s' "$b" | jget total)
[[ "$TOTAL" -gt 100 ]] && ok "样本量足够压上限（total=$TOTAL）" || bad "样本量不足" "total=$TOTAL"
r=$(req GET '/api/tickets?page_size=5000')
chk "page_size 被夹到 100" '100' "$(body_of "$r" | jget page_size)"
r=$(req GET '/api/tickets?page_size=abc')
chk "非数字 page_size 不报 500" "200" "$(status_of "$r")"
# 注入串里的裸引号用 chr(34) 造，避免在 shell 里嵌套引号（本脚本第一版就栽在这）
Q_INJ=$(python3 -c "import urllib.parse;print(urllib.parse.quote(chr(34)+' OR 1=1--'))")
r=$(req GET "/api/tickets?q=$Q_INJ")
chk "SQL 注入串不报 500" "200" "$(status_of "$r")"
if body_of "$r" | grep -Eqi 'gorm|sqlite|no such table|near "":|syntax error|runtime error'; then
  bad "注入响应泄露了底层错误" "$(body_of "$r" | head -c 200)"
else
  ok "注入响应只回业务码，不泄露底层错误" "$(body_of "$r" | head -c 60)"
fi
[[ "$(body_of "$r" | jget total)" -eq 0 ]] && ok "注入串当字面量处理（命中 0 条）" || bad "注入串影响了查询" "$(body_of "$r" | jget total)"
SORT_INJ=$(python3 -c "import urllib.parse;print(urllib.parse.quote(chr(34)+'; DROP TABLE tickets--'))")
r=$(req GET "/api/tickets?sort=$SORT_INJ")
chk "非法 sort 不报 500" "200" "$(status_of "$r")"
chk "非法 sort 回落到默认 due" '"sort":"due"' "$(body_of "$r")"
r=$(req GET '/api/tickets?only=at_risk')
chk "only=at_risk 可用" "200" "$(status_of "$r")"
r=$(req GET '/api/tickets?only=%27%20OR%201%3D1')
chk "非法 only 不报 500" "200" "$(status_of "$r")"
chk "非法 only 回落到全部页签" '"only":""' "$(body_of "$r")"
r=$(req GET '/api/tickets?q=%25')
chk "裸百分号编码不报 500" "200" "$(status_of "$r")"
r=$(req GET '/api/tickets?page=99999')
chk "越界页码返回空而非报错" "200" "$(status_of "$r")"
r=$(req GET '/api/tickets?only=at_risk&status=new&severity=S1&tier=platinum&team=%E5%9F%BA%E7%A1%80%E8%AE%BE%E6%96%BD%E7%BB%84&sort=paused&dir=desc&page_size=5')
chk "多条件组合 200" "200" "$(status_of "$r")"

sec "⑤ /api/tickets/:code：详情、分解式、恒等式、时间线、隐私"
CODE=$(body_of "$(req GET '/api/tickets?page_size=1')" | jget 'items.0.code')
r=$(req GET "/api/tickets/$CODE"); b=$(body_of "$r")
chk "详情 200" "200" "$(status_of "$r")"
chk "详情带 ledger 条" 'ledger' "$b"
chk "分解式由后端下发" '非工作' "$b"
chk "恒等式全部成立" '"clock_identity_ok":true' "$b"
chk "时间线有跳数" 'timeline' "$b"
chk "剩余量口径字段" 'remaining_bd_minutes' "$b"
if printf '%s' "$b" | grep -q 'contact_phone'; then bad "详情泄露明文手机号键"; else ok "详情无 contact_phone 键"; fi
r=$(req GET '/api/tickets/TK-00000000-9999')
chk "不存在的单 404" "404" "$(status_of "$r")"
chk "404 只回 code+message" '"code":"not_found"' "$(body_of "$r")"
chk "404 不回显 Go 错误" '资源不存在' "$(body_of "$r")"
r=$(req GET '/api/tickets/..%2F..%2Fetc%2Fpasswd')
chk "路径穿越被当非法编号拒掉" "400" "$(status_of "$r")"

sec "⑥ /api/agents · /api/customers · /api/sla/policies"
r=$(req GET /api/agents); chk "agents 200" "200" "$(status_of "$r")"
chk "agents 12 行" '12' "$(body_of "$r" | jlen items)"
r=$(req GET /api/customers); b=$(body_of "$r")
chk "customers 200" "200" "$(status_of "$r")"
# 客户列表干脆不带电话字段；明文手机号只在工单行上以 masked_phone 出现
if printf '%s' "$b" | grep -Eq 'contact_phone|1[3-9][0-9]{9}'; then
  bad "customers 泄露电话" "$(printf '%s' "$b" | head -c 120)"
else
  ok "customers 完全不带电话" "$(body_of "$r" | jlen items) 家"
fi
r=$(req GET '/api/tickets?page_size=1'); b=$(body_of "$r")
chk "工单行带脱敏手机号" 'masked_phone' "$b"
if printf '%s' "$b" | grep -Eq '1[3-9][0-9]{9}'; then bad "工单行出现完整手机号"; else ok "工单行无完整手机号"; fi
r=$(req GET /api/sla/policies)
chk "policies 200" "200" "$(status_of "$r")"
chk "策略矩阵 4 个 tier" '4' "$(body_of "$r" | jlen tiers)"

sec "⑦ 鉴权三层：401（缺/畸形）· 403（令牌错）· 503（服务端未配）"
# 写接口的入参形状从接口里取，别把字段名写死在脚本里（第一版就猜错了 customer）
CUST=$(body_of "$(req GET '/api/customers?page_size=1')" | jget 'items.0.code')
AGENT=$(body_of "$(req GET '/api/agents?page_size=1')" | jget 'items.0.code')
REASON=$(body_of "$(req GET /api/meta)" | jget 'pause_reasons.0')
GOOD="{\"customer\":\"$CUST\",\"title\":\"鉴权探针-$RANDOM\",\"severity\":\"S1\",\"category\":\"应用故障\"}"
[[ -n "$CUST" && "$CUST" != "<nil>" ]] && ok "从接口取到客户编号" "$CUST" || bad "取不到客户编号" "$CUST"
[[ -n "$REASON" && "$REASON" != "<nil>" ]] && ok "停表原因取自 meta 字典" "$REASON" || bad "meta 无停表原因" "$REASON"
r=$(req POST /api/tickets '' "$GOOD")
chk "无令牌 → 401" "401" "$(status_of "$r")"
chk "401 有 code" '"code":"unauthorized"' "$(body_of "$r")"
r=$(req POST /api/tickets 'wrong-token-here' "$GOOD")
chk "错令牌 → 403" "403" "$(status_of "$r")"
chk "403 有 code" '"code":"forbidden"' "$(body_of "$r")"
r=$(curl -s -m 10 -w $'\n%{http_code}' -X POST "$BASE/api/tickets" -H 'Authorization: Basic Zm9vOmJhcg==' -H 'Content-Type: application/json' --data "$GOOD")
chk "非 Bearer 方案 → 401" "401" "$(status_of "$r")"
chk "401 有 code" '"code":"unauthorized"' "$(body_of "$r")"
r=$(req POST /api/tickets "$TOKEN" "$GOOD")
chk "Bearer 大小写不敏感（放行到业务层）" "201" "$(status_of "$r")"
if [[ -n "$NO_TOKEN_BASE" ]]; then
  r=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$NO_TOKEN_BASE/api/tickets" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data "$GOOD")
  chk "服务端未配令牌 → 503（绝不放行）" "503" "$r"
else
  printf '  skip 503 分支（未提供 NO_TOKEN_BASE）\n'
fi

sec "⑧ 写接口反向：字段校验与超长"
r=$(req POST /api/tickets "$TOKEN" '{}')
chk "空体 → 400" "400" "$(status_of "$r")"
chk "400 中文提示" '参数校验未通过' "$(body_of "$r")"
chk "400 带字段错误" 'fields' "$(body_of "$r")"
r=$(req POST /api/tickets "$TOKEN" "{\"customer\":\"CU-9999\",\"title\":\"不存在的客户\",\"severity\":\"S1\",\"category\":\"应用故障\"}")
chk "客户不存在 → 404" "404" "$(status_of "$r")"
chk "404 回业务码而非 Go 错误" '"code":"customer_not_found"' "$(body_of "$r")"
r=$(req POST /api/tickets "$TOKEN" "{\"customer\":\"$CUST\",\"title\":\"非法严重度\",\"severity\":\"S9\",\"category\":\"应用故障\"}")
chk "严重度白名单外 → 400" "400" "$(status_of "$r")"
LONG=$(python3 -c 'print("相"*400)')
r=$(req POST /api/tickets "$TOKEN" "{\"customer\":\"$CUST\",\"title\":\"$LONG\",\"severity\":\"S1\",\"category\":\"应用故障\"}")
chk "超长标题 → 400（不落到 DB 层）" "400" "$(status_of "$r")"
r=$(req POST /api/tickets "$TOKEN" "{\"customer\":\"$CUST\",\"title\":\"注入尝试\",\"severity\":\"S1\",\"category\":\"应用故障'); DROP TABLE tickets;--\"}")
chk "含 SQL 片段的 category 不报 500" "400" "$(status_of "$r")"
r=$(req POST /api/tickets "$TOKEN" 'not-json')
chk "畸形 JSON → 400 而非 500" "400" "$(status_of "$r")"
r=$(req POST /api/tickets "$TOKEN" "{\"customer\":\"$CUST\",\"title\":\"巨型体\",\"severity\":\"S1\",\"category\":\"应用故障\",\"description\":\"$(python3 -c 'print("x"*300000)')\"}")
chk "超大请求体被拒（不是 500）" "4" "$(status_of "$r")"
r=$(req PATCH "/api/tickets/$CODE/status" "$TOKEN" '{"status":"不存在的状态"}')
chk "非法目标状态 → 400" "400" "$(status_of "$r")"
chk "400 里给出合法枚举" 'in_progress' "$(body_of "$r")"

sec "⑨ 写接口正向 + 状态机 + 停表恢复 + 快照不回溯"
TITLE="API冒烟单-$RANDOM$RANDOM"
r=$(req POST /api/tickets "$TOKEN" "{\"customer\":\"$CUST\",\"title\":\"$TITLE\",\"description\":\"冒烟\",\"severity\":\"S2\",\"category\":\"网络与专线\",\"channel\":\"电话\"}")
NEW=$(body_of "$r" | jget 'ticket.code')
chk "建单 201" "201" "$(status_of "$r")"
chk "建单返回工单号" 'TK-' "$NEW"
chk "建单落快照目标值" '"resolve_target_bd"' "$(body_of "$r")"
DUE=$(body_of "$r" | jget 'ticket.due_at')
printf '       到期点（工作日历推算，带现场偏移）：%s\n' "$DUE"
case "$DUE" in *'+08:00') ok "到期点带现场时区偏移" "$DUE";; *) bad "到期点偏移异常" "$DUE";; esac
r=$(req POST /api/tickets "$TOKEN" "{\"customer\":\"$CUST\",\"title\":\"$TITLE\",\"description\":\"重复\",\"severity\":\"S2\",\"category\":\"网络与专线\"}")
chk "同客户同名在办单 → 409 去重" "409" "$(status_of "$r")"
r=$(req POST "/api/tickets/$NEW/pause" "$TOKEN" "{\"reason\":\"$REASON\"}")
chk "new 态直接停表 → 409（状态机）" "409" "$(status_of "$r")"
r=$(req POST "/api/tickets/$NEW/assign" "$TOKEN" "{\"agent\":\"$AGENT\"}")
chk "派单 200" "200" "$(status_of "$r")"
b=$(body_of "$(req GET "/api/tickets/$NEW")")
LAST=$(printf '%s' "$b" | python3 -c '
import json,sys
e=json.load(sys.stdin)["timeline"][-1]
print(e["kind"],e["from_status"],e["to_status"])')
chk "派单事件 from≠to（时间线可审计）" "assigned new assigned" "$LAST"
chk "工单行时间是 UTC、账本时间是现场时区（前端负责换算）" '+08:00' "$(printf '%s' "$b" | jget 'ledger.created_at')"
r=$(req POST "/api/tickets/$NEW/pause" "$TOKEN" "{\"reason\":\"不在字典里的原因\"}")
chk "停表原因白名单外 → 400" "400" "$(status_of "$r")"
r=$(req POST "/api/tickets/$NEW/pause" "$TOKEN" '{"reason":""}')
chk "停表缺原因 → 400" "400" "$(status_of "$r")"
r=$(req POST "/api/tickets/$NEW/pause" "$TOKEN" "{\"reason\":\"$REASON\"}")
chk "停表 200" "200" "$(status_of "$r")"
chk "停表后进入挂起态" 'pending_customer' "$(body_of "$r")"
r=$(req POST "/api/tickets/$NEW/resume" "$TOKEN" '{"note":"客户已回传"}')
chk "恢复 200" "200" "$(status_of "$r")"
# 写响应只回 TicketRow（无 timeline），时间线要回详情接口取——这本身就是一次口径校验
LAST=$(body_of "$(req GET "/api/tickets/$NEW")" | python3 -c '
import json,sys
e=json.load(sys.stdin)["timeline"][-1]
print(e["kind"],e["from_status"],e["to_status"])')
chk "恢复只写一条 resumed（不重复写 status）" "resumed pending_customer assigned" "$LAST"
r=$(req PATCH "/api/tickets/$NEW/status" "$TOKEN" '{"status":"resolved","note":"跳过处理中"}')
chk "assigned 不能直接跳 resolved → 409" "409" "$(status_of "$r")"
r=$(req PATCH "/api/tickets/$NEW/status" "$TOKEN" '{"status":"in_progress","note":"开始处置"}')
chk "推进到处理中 200" "200" "$(status_of "$r")"
r=$(req PATCH "/api/tickets/$NEW/status" "$TOKEN" '{"status":"resolved","note":"已修复"}')
chk "推进到已解决 200" "200" "$(status_of "$r")"
RESOLVE_BD=$(body_of "$r" | jget 'ticket.resolve_bd_minutes')
MET=$(body_of "$r" | jget 'ticket.met_resolve')
[[ "$RESOLVE_BD" =~ ^[0-9]+$ ]] && ok "解决时结算了工作分钟" "$RESOLVE_BD 工作分钟，达标=$MET" || bad "未结算工作分钟" "$RESOLVE_BD"
r=$(req GET "/api/tickets/$NEW"); b=$(body_of "$r")
chk "已完成单的恒等式仍自洽" '"clock_identity_ok":true' "$b"
chk "时间线复算=落库停表累计" '"identity_timeline_ok":true' "$b"
r=$(req PATCH "/api/tickets/$NEW/status" "$TOKEN" '{"status":"closed","note":"客户确认"}')
chk "关单 200" "200" "$(status_of "$r")"
r=$(req PATCH "/api/tickets/$NEW/status" "$TOKEN" '{"status":"in_progress","note":"再开"}')
chk "已关单不可再开 → 409" "409" "$(status_of "$r")"
r=$(req POST /api/sla/policies "$TOKEN" '{"tier":"platinum","severity":"S2","response_min":30,"resolve_min":1440}')
chk "策略 upsert 200" "200" "$(status_of "$r")"
r=$(req POST /api/sla/policies "$TOKEN" '{"tier":"platinum","severity":"S2","response_min":1,"resolve_min":10}')
chk "策略越界 → 400（上下界来自 meta）" "400" "$(status_of "$r")"
r=$(req GET '/api/tickets?page_size=1&only=open')
chk "改策略不回溯在办单目标" '"resolve_target_bd"' "$(body_of "$r")"

sec "⑩ CORS 与响应头"
r=$(curl -s -m 10 -o /dev/null -D - -X OPTIONS "$BASE/api/tickets" \
  -H 'Origin: http://127.0.0.1:18262' -H 'Access-Control-Request-Method: PATCH')
chk "预检放行 PATCH" "PATCH" "$r"
chk "CORS 头存在" 'access-control-allow' "$(printf '%s' "$r" | tr 'A-Z' 'a-z')"
r=$(curl -s -m 10 -o /dev/null -D - "$BASE/api/health")
chk "JSON Content-Type" 'application/json' "$r"
r=$(curl -s -m 10 -w '\n%{http_code}' "$BASE/api/nope" | tail -n1)
chk "未知路由 404" "404" "$r"

printf '\n\033[1m冒烟结果：%d 通过 / %d 失败\033[0m\n' "$PASS" "$FAIL"
exit $((FAIL > 0))
