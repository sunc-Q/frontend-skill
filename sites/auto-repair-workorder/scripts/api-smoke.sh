#!/usr/bin/env bash
# 逐接口冒烟：真监听端口 + 真 curl，覆盖
#   读接口字段/分页上限/排序白名单 / 手机号脱敏 / 参数校验与注入边界 /
#   鉴权三层（503·401·403）/ 工单状态机正反向与业务门 / FIFO 出库与作废退料 /
#   入库建批 / 恒等式与账实相符 / 错误响应不泄露内部信息。
#
# 为什么 go test 之外还要这个脚本：go test 走 httptest 内存路由，
# 这里走真 HTTP + 真 SQLite，顺带验到 CORS、安全响应头、NoRoute JSON、SPA 兜底这些网关层行为。
#
# 用法：
#   BASE=http://127.0.0.1:18401 ADMIN_TOKEN=xxx \
#     [NO_TOKEN_BASE=http://127.0.0.1:18402] bash scripts/api-smoke.sh
#   （一般不直接跑，用 scripts/run-smoke.sh 在全新库上起实例。）
#
# 注意：**会真写库**（开单、加行、出库、入库、推进状态），只对着 /tmp 上的一次性实例跑；
# 因此单文件 preview 必须由另一个刚灌完种子的实例生成，不能用本脚本跑过的库。
# 样本（工单号、配件编码、价格）全部从接口反查（见 ⓪），脚本不猜常量。
set -uo pipefail

BASE="${BASE:-http://127.0.0.1:18401}"
TOKEN="${ADMIN_TOKEN:-}"
NO_TOKEN_BASE="${NO_TOKEN_BASE:-}"
PASS=0
FAIL=0
# ⑦⑧⑩ 段落之间靠这三个「本轮新开的单」串联；即便 ⑦ 因缺令牌而跳过，
# 后面的 [[ -n "$W1" ]] 在 set -u 下也不能踩到未定义变量。
W1=""; W2=""; W3=""

ok()   { PASS=$((PASS+1)); printf '  ok   %s%s\n' "$1" "${2:+ — ${2:0:90}}"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s%s\n' "$1" "${2:+${2:0:200}}"; }
chk()  { if [[ "$3" == *"$2"* ]]; then ok "$1" "$3"; else bad "$1" "期望含「$2」实际「$3」"; fi; }
neq()  { if [[ "$3" != *"$2"* ]]; then ok "$1" "不含「$2」"; else bad "$1" "不应含「$2」，实际「${3:0:160}」"; fi; }
num()  { if [[ "$3" =~ ^-?[0-9]+$ ]]; then ok "$1" "$2=$3"; else bad "$1" "期望整数 $2，实际「$3」"; fi; }

req() { # req <方法> <路径> [令牌] [JSON]
  local m="$1" p="$2" tok="${3:-}" data="${4:-}"
  local args=(-s -m 15 -w $'\n%{http_code}' -X "$m" "$BASE$p" -H 'Accept: application/json')
  [[ -n "$tok" ]] && args+=(-H "Authorization: Bearer $tok")
  [[ -n "$data" ]] && args+=(-H 'Content-Type: application/json' --data "$data")
  curl "${args[@]}"
}
raw() { # raw <方法> <路径> <原始 Authorization 头值> [JSON]  — 用于试探鉴权头本身的形状
  local m="$1" p="$2" auth="$3" data="${4:-}"
  local args=(-s -m 15 -w $'\n%{http_code}' -X "$m" "$BASE$p")
  [[ -n "$auth" ]] && args+=(-H "Authorization: $auth")
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
urlq() { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$1"; }
# hours_between：把「承诺时长随优先级」这条口径做成跨字段断言，
# 单看 promised_at 有没有值是不够的——本地时区/UTC 混用时会差出 8 小时。
hours_between() {
  python3 -c '
import sys,datetime
a,b=sys.argv[1],sys.argv[2]
p=lambda s:datetime.datetime.fromisoformat(s.replace("Z","+00:00"))
print(round((p(b)-p(a)).total_seconds()/3600,3))
' "$1" "$2"
}
sec() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ============================================================ ⓪ 反查样本
sec "⓪ 从接口反查测试样本（不猜常量）"
PROBE="$(BASE="$BASE" python3 - <<'PY'
import json, os, urllib.request

B = os.environ["BASE"].rstrip("/")

def get(p):
    with urllib.request.urlopen(B + p, timeout=15) as r:
        return json.loads(r.read())

def firstwo(rows):
    return rows[0]["wo_no"] if rows else ""

out = {}
o = get("/api/work-orders?page_size=100")
rows = o["items"]
out["WO_ANY"] = firstwo(rows)
# 样本一律走 status 筛选接口取，别在「第一页 100 条」里挑：
# 种子有上百张单，默认排序下 settled/cancelled 很可能整页都不露脸，
# 拿空样本去断言等于把 ④ 整段变成 follow 301 后的假绿/假红。
out["WO_SETTLED"] = firstwo(get("/api/work-orders?status=settled&page_size=5")["items"])
# 作废样本要挑「真的退过料」的那一张：只开过工时没出过件的作废单没有 return 流水，
# 拿它去断言退料相抵等于打在空集上。
canx = [r["wo_no"] for r in get("/api/work-orders?status=cancelled&page_size=100")["items"]]
picked_ret = ""
for no in canx:
    det = get("/api/work-orders/" + no)
    if any(m["kind"] == "return" for m in det["moves"]):
        picked_ret = no
        break
out["WO_CANCELLED"] = picked_ret or (canx[0] if canx else "")
out["WO_PICKED"] = firstwo(get("/api/work-orders?status=picked_up&page_size=5")["items"])

p = get("/api/parts?status=active&stock=ok&page_size=100")
cands = [r for r in p["items"] if r["on_hand"] >= 6 and r["lot_count"] >= 1]
# 出库样本要「批次不止一个、余量够扣两次」，否则 FIFO 与退料断言都打在边缘数据上。
best = next((r for r in cands if r["lot_count"] >= 2), cands[0] if cands else None)
out["PART_OK"] = best["code"] if best else ""
out["PRICE_OK"] = str(best["list_price_cents"]) if best else ""

z = get("/api/parts?status=active&stock=out&page_size=5")
out["PART_ZERO"] = (z["items"][0]["code"] if z["items"] else "")
l = get("/api/parts?status=active&stock=low&page_size=5")
out["PART_LOW"] = (l["items"][0]["code"] if l["items"] else "")
d = get("/api/parts?status=discontinued&page_size=5")
out["PART_DC"] = (d["items"][0]["code"] if d["items"] else "")

print("\n".join(f"{k}={v}" for k, v in out.items()))
PY
)"
if [[ -z "$PROBE" ]]; then
  bad "样本反查" "探针无输出，后续断言无法进行"; printf '\npass=%s fail=%s\n' "$PASS" "$FAIL"; exit 1
fi
eval "$PROBE"
for kv in WO_ANY WO_SETTLED WO_CANCELLED PART_OK PRICE_OK PART_ZERO PART_DC; do
  if [[ -n "${!kv}" ]]; then ok "样本 $kv" "$kv=${!kv}"; else bad "样本 $kv 为空" "种子覆盖不足或接口异常"; fi
done
[[ -n "$PART_LOW" ]] && ok "样本 PART_LOW" "PART_LOW=$PART_LOW" || bad "样本 PART_LOW 为空" "低库存桶无样本"
# 必需样本缺失就当场收工：后面的段落全是拿这些变量拼 URL 的，
# 空串会让 /api/work-orders/ 被 301 兜走，一条环境问题刷出十条「断言失败」。
MISSING=""
for kv in WO_ANY WO_SETTLED WO_CANCELLED WO_PICKED PART_OK PRICE_OK PART_ZERO PART_DC; do
  [[ -n "${!kv}" ]] || MISSING="$MISSING $kv"
done
if [[ -n "$MISSING" ]]; then
  bad "必需样本缺失" "缺：$MISSING，后续断言无意义"
  printf '\npass=%s fail=%s\n' "$PASS" "$FAIL"
  exit 1
fi

# ============================================================ ① 健康、响应头与路由兜底
sec "① /api/health、安全响应头与路由兜底"
r=$(req GET /api/health); b=$(body_of "$r")
chk "health 200" "200" "$(status_of "$r")"
chk "health status=ok" '"status":"ok"' "$b"
chk "时间为 UTC RFC3339" 'Z"' "$b"
hdr=$(curl -s -m 15 -D - -o /dev/null "$BASE/api/stats")
chk "Content-Type JSON" 'Content-Type: application/json' "$hdr"
chk "X-Content-Type-Options" 'nosniff' "$hdr"
chk "X-Frame-Options" 'DENY' "$hdr"
chk "Referrer-Policy" 'no-referrer' "$hdr"
chk "Permissions-Policy" 'camera=()' "$hdr"
chk "接口 no-store" 'cache-control: no-store' "$(printf '%s' "$hdr" | tr 'A-Z' 'a-z')"
code=$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$BASE/api/work-orders/")
[[ "$code" != "500" ]] && ok "带斜杠路径不 500（$code）" || bad "带斜杠路径 500" ""
r=$(req GET /api/nope); b=$(body_of "$r")
chk "未知接口回 JSON 404" '"code":"not_found"' "$b"
chk "未知接口状态码" "404" "$(status_of "$r")"
neq "未知接口不回 HTML" "<!doctype" "$b"
r=$(req GET '/api/work-orders/%2E%2E%2F%2E%2E%2Fetc%2Fpasswd'); b=$(body_of "$r")
neq "编码穿越不返回文件内容" "root:" "$b"
neq "编码穿越不泄露前端 HTML" "<!doctype" "$b"
r=$(req GET '/api/work-orders/SMOKE-NO-SUCH-ORDER-99999'); b=$(body_of "$r")
chk "不存在工单号 404" '"code":"not_found"' "$b"
neq "超长 ID 路径不 500" 'goroutine' "$(body_of "$(req GET "/api/parts/$(printf 'X%.0s' {1..200})")")"
# SPA：后端托管 dist/ 时，根路径与前端深链都应回 HTML 而不是 JSON 404。
spa=$(curl -s -m 15 -o /dev/null -w '%{http_code}:%{content_type}' "$BASE/")
case "$spa" in
  *text/html*) ok "根路径回 SPA HTML" "$spa" ;;
  *) bad "根路径未回 SPA HTML" "$spa（未设 STATIC_DIR/构建产物缺失？看 scripts/run-smoke.sh）" ;;
esac
deep=$(curl -s -m 15 -o /dev/null -w '%{http_code}:%{content_type}' "$BASE/work-orders")
case "$deep" in
  200*text/html*) ok "前端深链回 SPA 壳" "$deep" ;;
  *) bad "前端深链未回 SPA 壳" "$deep" ;;
esac
# CORS：本机 http 来源放行；前缀匹配型伪装域名（localhost.evil.com）必须被拒。
pre=$(curl -s -m 15 -D - -o /dev/null -X OPTIONS "$BASE/api/admin/work-orders" \
  -H 'Origin: http://127.0.0.1:5599' -H 'Access-Control-Request-Method: POST')
chk "本机来源预检 204" "204" "$(printf '%s' "$pre" | head -n1 | tr -d '\r' | awk '{print $2}')"
chk "本机来源发放 Allow-Origin" 'access-control-allow-origin: http://127.0.0.1:5599' "$(printf '%s' "$pre" | tr 'A-Z' 'a-z')"
chk "预检允许 Authorization 头" 'access-control-allow-headers: authorization, content-type' "$(printf '%s' "$pre" | tr 'A-Z' 'a-z')"
for evil in 'http://localhost.evil.com' 'https://evil.example' 'null' 'http://127.0.0.1.evil.com'; do
  e=$(curl -s -m 15 -D - -o /dev/null -X OPTIONS "$BASE/api/admin/work-orders" -H "Origin: $evil" \
    -H 'Access-Control-Request-Method: POST' | tr 'A-Z' 'a-z')
  neq "来源 $evil 不发放行头" "access-control-allow-origin" "$e"
done

# ============================================================ ② 统计与恒等式
sec "② /api/stats：口径、窗口夹逼与恒等式"
r=$(req GET '/api/stats?days=14'); b=$(body_of "$r")
chk "stats 200" "200" "$(status_of "$r")"
chk "账实相符不变量" '"stock_invariant_ok":true' "$b"
chk "库存差异列表为空" '"stock_issues":[]' "$b"
chk "金额恒等式不变量" '"amount_invariant_ok":true' "$b"
chk "金额违例为零" '"identity_violations":0' "$b"
chk "批次余量越界为零" '"lot_overflow":0' "$b"
chk "趋势 14 点" "14" "$(printf '%s' "$b" | jlen trend)"
chk "状态桶覆盖 8 态" "8" "$(printf '%s' "$b" | jlen by_status)"
chk "类别桶覆盖 7 类" "7" "$(printf '%s' "$b" | jlen by_category)"
REV=$(printf '%s' "$b" | jget revenue_cents); LAB=$(printf '%s' "$b" | jget labor_cents); PRT=$(printf '%s' "$b" | jget parts_cents)
chk "营收 == 工时 + 配件" "$((LAB + PRT))" "revenue=$REV labor=$LAB parts=$PRT"
num "已结算样本数" "checked_orders" "$(printf '%s' "$b" | jget checked_orders)"
num "在办单数" "open_orders" "$(printf '%s' "$b" | jget open_orders)"
# 跨视图对表：stats.today 必须等于趋势最后一个点，否则两套时钟（Go 与 SQL）差了一天，
# 「今日进厂/今日出库」的口径就会和折线末端对不上。
TODAY=$(printf '%s' "$b" | jget today)
LASTDAY=$(printf '%s' "$b" | jget 'trend.[13].day')
chk "today == 趋势末点" "$LASTDAY" "today=$TODAY trend_last=$LASTDAY"
GEN=$(printf '%s' "$b" | jget generated_at)
[[ "$GEN" == *"Z" ]] && ok "generated_at 为 UTC" "$GEN" || bad "generated_at 非 UTC" "$GEN"
chk "days 上限夹到 45" "45" "$(req GET '/api/stats?days=99999' | body_of | jlen trend)"
chk "days 下限夹到 3" "3" "$(req GET '/api/stats?days=1' | body_of | jlen trend)"
chk "days 非数字回落 7" "7" "$(req GET '/api/stats?days=abc' | body_of | jlen trend)"
chk "days 负数回落 7" "7" "$(req GET '/api/stats?days=-5' | body_of | jlen trend)"
chk "窗口文案与实际天数一致" "近 45 天" "$(req GET '/api/stats?days=99999' | body_of)"
chk "days 注入串不 500" "7" "$(req GET '/api/stats?days=%3B%20DROP%20TABLE--' | body_of | jlen trend)"

# ============================================================ ③ 工单列表
sec "③ /api/work-orders：排序白名单、分页、状态与优先级筛选"
for k in no plate opened promised updated total tech priority status id; do
  for d in asc desc; do
    chk "orders sort=$k&dir=$d" "200" "$(status_of "$(req GET "/api/work-orders?sort=$k&dir=$d&page_size=3")")"
  done
done
chk "注入型 sort 回落默认" "200" "$(status_of "$(req GET '/api/work-orders?sort=;DROP%20TABLE--&page_size=3')")"
neq "sort 注入不回显 SQL" "SQL" "$(body_of "$(req GET '/api/work-orders?sort=w.grand_total_cents%3B--')")"
r=$(req GET '/api/work-orders?page_size=5000')
chk "page_size 上限收口 100" "100" "$(printf '%s' "$(body_of "$r")" | jget page_size)"
ROWS=$(printf '%s' "$(body_of "$r")" | jlen items)
[[ "$ROWS" -le 100 ]] && ok "返回行数 $ROWS ≤ 100" || bad "返回行数超过 page_size 上限" "$ROWS"
r=$(req GET '/api/work-orders?page_size=abc&page=xyz')
chk "非数字分页参数不 500" "200" "$(status_of "$r")"
chk "非数字分页回落 page=1" "1" "$(printf '%s' "$(body_of "$r")" | jget page)"
chk "非数字分页回落 page_size=20" "20" "$(printf '%s' "$(body_of "$r")" | jget page_size)"
chk "page 超大不 500" "200" "$(status_of "$(req GET '/api/work-orders?page=999999999999')")"
chk "非法 status 回落全部" "200" "$(status_of "$(req GET '/api/work-orders?status=bogus')")"
for st in received diagnosed awaiting_parts repairing qc settled picked_up cancelled; do
  r=$(req GET "/api/work-orders?status=$st&page_size=5")
  chk "状态筛选 $st 200" "200" "$(status_of "$r")"
  BAD=$(printf '%s' "$(body_of "$r")" | python3 -c '
import json,sys
d=json.loads(sys.stdin.read())
print(sum(1 for x in d["items"] if x["status"]!=sys.argv[1]))' "$st")
  chk "状态筛选 $st 行内状态一致" "0" "off=$BAD"
done
r=$(req GET '/api/work-orders?status=open&page_size=100'); b=$(body_of "$r")
chk "open 口径 200" "200" "$(status_of "$r")"
OFF=$(printf '%s' "$b" | python3 -c '
import json,sys
OPEN={"received","diagnosed","awaiting_parts","repairing","qc","settled"}
d=json.loads(sys.stdin.read())
print(sum(1 for x in d["items"] if x["status"] not in OPEN))')
chk "open 桶只含在厂状态" "0" "off=$OFF"
OPENT=$(printf '%s' "$b" | jget total)
ALLT=$(req GET '/api/work-orders?status=all' | body_of | jget total)
[[ "$OPENT" -le "$ALLT" && "$OPENT" -gt 0 ]] && ok "open($OPENT) ≤ all($ALLT) 且非空" || bad "open/all 总数关系异常" "open=$OPENT all=$ALLT"
for pr in normal urgent warranty; do
  chk "优先级筛选 $pr" "200" "$(status_of "$(req GET "/api/work-orders?priority=$pr&page_size=5")")"
done
chk "非法优先级回落全部" "200" "$(status_of "$(req GET '/api/work-orders?priority=vip')")"

sec "③b 检索：LIKE 通配符、注入、超长与脱敏"
r=$(req GET '/api/work-orders?q=%25')
chk "LIKE 通配符按字面匹配（零命中）" '"total":0' "$(body_of "$r")"
r=$(req GET '/api/work-orders?q=%5F%5F')
chk "下划线通配同样被转义" '"total":0' "$(body_of "$r")"
chk "引号+注入检索不 500" "200" "$(status_of "$(req GET "/api/work-orders?q=$(urlq "' OR 1=1 --")")")"
chk "注入检索零命中" '"total":0' "$(body_of "$(req GET "/api/work-orders?q=$(urlq "' OR 1=1 --")")")"
chk "超长检索按 rune 截断不 500" "200" "$(status_of "$(req GET "/api/work-orders?q=$(urlq "$(python3 -c 'print("长"*2000)')")")")"
r=$(req GET "/api/work-orders?q=$(urlq "$WO_ANY")&page_size=5"); b=$(body_of "$r")
chk "按工单号精确检索有命中" '"total":1' "$b"
chk "检索命中的正是该单" "\"wo_no\":\"$WO_ANY\"" "$b"
r=$(req GET '/api/work-orders?page_size=20'); b=$(body_of "$r")
neq "列表不泄露裸手机号键" '"customer_phone"' "$b"
chk "列表给脱敏手机号" '"phone_masked"' "$b"
if printf '%s' "$b" | grep -Eq '1[0-9]{10}'; then bad "列表出现 11 位明文手机号" ""; else ok "列表无 11 位明文手机号"; fi
MASK=$(printf '%s' "$b" | jget 'items.0.phone_masked')
if [[ "$MASK" =~ ^1[0-9]{2}\*{4}[0-9]{4}$ ]]; then ok "脱敏形状正确" "$MASK"; else bad "脱敏形状异常" "$MASK"; fi
chk "派生字段：可推进状态" '"next_statuses":[' "$b"
chk "派生字段：等待时长" '"wait_minutes"' "$b"
chk "派生字段：是否超承诺" '"promise_overdue"' "$b"

# ============================================================ ④ 工单详情
sec "④ /api/work-orders/:no 详情与账目自洽"
r=$(req GET "/api/work-orders/$WO_SETTLED"); b=$(body_of "$r")
chk "详情 200" "200" "$(status_of "$r")"
chk "详情含 order/lines/moves" '"moves":[' "$b"
chk "详情含 lines" '"lines":[' "$b"
chk "工单号一致" "\"wo_no\":\"$WO_SETTLED\"" "$b"
BAD=$(printf '%s' "$b" | python3 -c '
import json,sys
d=json.loads(sys.stdin.read())
o=d["order"]
s=sum(l["amount_cents"] for l in d["lines"])
print(0 if (o["grand_total_cents"]==o["labor_total_cents"]+o["parts_total_cents"] and o["grand_total_cents"]==s) else 1)')
chk "已结算单：总额 == 工时+配件 == Σ行金额" "0" "off=$BAD"
LINEBAD=$(printf '%s' "$b" | python3 -c '
import json,sys
d=json.loads(sys.stdin.read())
lp={p["code"]:p["list_price_cents"] for p in json.loads(sys.argv[1])["items"]}
bad=[l["part_code"] for l in d["lines"] if l["kind"]=="part"
     and l["part_code"] in lp and l["amount_cents"]!=lp[l["part_code"]]*l["qty"]]
print(len(bad))' "$(req GET '/api/parts?page_size=100' | body_of)")
chk "已结算单：配件行金额 == 数量 × 挂牌价" "0" "bad_lines=$LINEBAD"
LABBAD=$(printf '%s' "$b" | python3 -c '
import json,sys
RATE={"junior":18000,"middle":26000,"master":38000}
d=json.loads(sys.stdin.read())
def half(v): 
    import math; return int(math.floor(v+0.5))
bad=[l["id"] for l in d["lines"] if l["kind"]=="labor"
     and l["amount_cents"]!=half(l["duration_min"]*RATE[l["grade"]]/60)]
print(len(bad))')
chk "已结算单：工时行金额 == 分钟 × 等级费率" "0" "bad_lines=$LABBAD"
chk "已结算单的可推进目标只有 picked_up" '["picked_up"]' "$(printf '%s' "$b" | jget order.next_statuses)"
if [[ -n "$WO_CANCELLED" ]]; then
  cb=$(req GET "/api/work-orders/$WO_CANCELLED" | body_of)
  chk "作废单详情含退料流水" '"kind":"return"' "$cb"
  RETSUM=$(printf '%s' "$cb" | python3 -c '
import json,sys
d=json.loads(sys.stdin.read())
mv=d["moves"]
iss=sum(-m["qty_delta"] for m in mv if m["kind"]=="issue")
ret=sum(m["qty_delta"] for m in mv if m["kind"]=="return")
print(0 if iss==ret and iss>0 else 1)')
  chk "作废单：出库量与退料量相抵" "0" "net_off=$RETSUM"
  chk "作废单金额为 0（未结算）" '"grand_total_cents":0' "$cb"
fi
r=$(req GET '/api/work-orders/SMOKE-NOPE-404'); chk "不存在工单详情 404" "404" "$(status_of "$r")"
r=$(req GET "/api/work-orders/$(printf 'Z%.0s' {1..80})"); chk "超长工单号详情不 500" "404" "$(status_of "$r")"
neq "详情无裸手机号键" '"customer_phone"' "$(body_of "$r")"

sec "④b /api/parts/:code 批次与流水"
pr=$(req GET "/api/parts/$PART_OK"); pb=$(body_of "$pr")
chk "配件详情 200" "200" "$(status_of "$pr")"
chk "详情含 part/lots/moves" '"moves":[' "$pb"
chk "编码一致" "\"code\":\"$PART_OK\"" "$pb"
chk "最老批次日期字段存在" 'oldest_lot_at' "$pb"
NEGS=$(printf '%s' "$pb" | python3 -c '
import json,sys
d=json.loads(sys.stdin.read())
print(sum(1 for l in d["lots"] if l["qty_remaining"]<0))')
chk "无负余量批次" "0" "negs=$NEGS"
OVER=$(printf '%s' "$pb" | python3 -c '
import json,sys
d=json.loads(sys.stdin.read())
print(sum(1 for l in d["lots"] if l["qty_remaining"]>l["qty_received"]))')
chk "批次余量不超过入库量" "0" "over=$OVER"
FIFO=$(printf '%s' "$pb" | python3 -c '
import json,sys
d=json.loads(sys.stdin.read())
t=[l["received_at"] for l in d["lots"]]
print("asc" if t==sorted(t) else "unsorted")')
chk "批次按入库时间升序（FIFO 口径）" "asc" "order=$FIFO"
BAL=$(printf '%s' "$pb" | python3 -c '
import json,sys
d=json.loads(sys.stdin.read())
print(0 if sum(l["qty_remaining"] for l in d["lots"])==d["part"]["on_hand"] else 1)')
chk "part.on_hand == Σ批次余量" "0" "off=$BAL"

# ============================================================ ⑤ 配件列表
sec "⑤ /api/parts：排序、库存口径、类别与停用件"
for k in code name category price onhand value lot cost id; do
  for d in asc desc; do
    chk "parts sort=$k&dir=$d" "200" "$(status_of "$(req GET "/api/parts?sort=$k&dir=$d&page_size=3")")"
  done
done
chk "注入型 parts sort 回落默认" "200" "$(status_of "$(req GET '/api/parts?sort=p.code%3B--&page_size=3')")"
for s in low out ok all; do
  chk "库存口径 $s" "200" "$(status_of "$(req GET "/api/parts?stock=$s&page_size=5")")"
done
chk "非法库存口径回落" "200" "$(status_of "$(req GET '/api/parts?stock=bogus')")"
for c in engine brake filter electrical suspension consumable transmission; do
  r=$(req GET "/api/parts?category=$c&page_size=5"); b=$(body_of "$r")
  chk "类别筛选 $c 有样本" "\"category\":\"$c\"" "$b"
done
chk "非法类别回落全部" "200" "$(status_of "$(req GET '/api/parts?category=bogus')")"
chk "超长类别串不 500" "200" "$(status_of "$(req GET "/api/parts?category=$(urlq "$(python3 -c 'print("x"*80)')")")")"
chk "停用件筛选 200" "200" "$(status_of "$(req GET '/api/parts?status=discontinued')")"
if [[ -n "$PART_DC" ]]; then
  r=$(req GET "/api/parts?status=discontinued&page_size=20")
  chk "停用样本在筛选结果内" "\"code\":\"$PART_DC\"" "$(body_of "$r")"
fi
r=$(req GET '/api/parts?stock=out&status=active&page_size=5'); b=$(body_of "$r")
chk "零库存 active 件有样本" "\"on_hand\":0" "$b"
chk "按编码检索命中" "\"code\":\"$PART_OK\"" "$(req GET "/api/parts?q=$(urlq "$PART_OK")&page_size=5" | body_of)"
chk "注入型配件检索零命中" '"total":0' "$(body_of "$(req GET "/api/parts?q=$(urlq "%' or 1=1--")")")"
chk "不存在配件编码 404" "404" "$(status_of "$(req GET '/api/parts/NOPE-9999')")"
chk "空白编码不 500" "404" "$(status_of "$(req GET '/api/parts/%20%20')")"

# ============================================================ ⑥ 鉴权三层
sec "⑥ 写接口鉴权矩阵（503 · 401 · 403）"
NEWBODY="{\"plate_no\":\"沪A·SMOKE1\",\"model\":\"冒烟测试车 1.6L\",\"customer_name\":\"测试客户\",\"phone\":\"13900002222\",\"mileage_km\":48000,\"symptom\":\"冒烟用例专用工单\",\"priority\":\"normal\",\"technician\":\"测试顾问\"}"
if [[ -n "$NO_TOKEN_BASE" ]]; then
  code=$(curl -s -m 15 -o /dev/null -w '%{http_code}' -X POST "$NO_TOKEN_BASE/api/admin/work-orders" \
    -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" --data "$NEWBODY")
  chk "未配 ADMIN_TOKEN → 503 fail-closed" "503" "$code"
  nt=$(curl -s -m 15 -X POST "$NO_TOKEN_BASE/api/admin/work-orders" -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $TOKEN" --data "$NEWBODY" | jget code)
  chk "503 错误码 server_misconfigured" "server_misconfigured" "$nt"
  rc=$(curl -s -m 15 -o /dev/null -w '%{http_code}' -X POST "$NO_TOKEN_BASE/api/admin/receipts" \
    -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
    --data "{\"part_code\":\"$PART_OK\",\"lot_no\":\"LOT-NOPE-001\",\"qty\":1,\"unit_cost_cents\":100,\"supplier\":\"无令牌实例\"}")
  chk "入库同样 fail-closed 503" "503" "$rc"
  cnt=$(req GET "/api/work-orders/$WO_ANY" | body_of | jget line_count)
else
  bad "缺少 NO_TOKEN_BASE" "无法断言 503 层"
fi
chk "缺令牌 → 401" "401" "$(status_of "$(req POST /api/admin/work-orders "" "$NEWBODY")")"
chk "非 Bearer 头 → 401" "401" "$(status_of "$(raw POST /api/admin/work-orders "Basic zz" "$NEWBODY")")"
chk "只有 Bearer 前缀 → 401" "401" "$(status_of "$(raw POST /api/admin/work-orders "Bearer " "$NEWBODY")")"
chk "Bearer 后多空格仍为空 → 401" "401" "$(status_of "$(raw POST /api/admin/work-orders "Bearer    " "$NEWBODY")")"
chk "Authorization 为空串 → 401" "401" "$(status_of "$(raw POST /api/admin/work-orders "" "$NEWBODY")")"
# Bearer 方案名按 RFC 7235 大小写不敏感（实现用 EqualFold）。
# 拿一个不存在的工单号试探：走到业务层才是 404，被鉴权拦下才是 401/403——
# 这样既断言了大小写不敏感，又不会真的写数据把后面的断言带偏。
chk "小写 bearer 通过鉴权（走到业务层 404）" "404" \
  "$(status_of "$(raw POST "/api/admin/work-orders/SMOKE-NOPE-1/transition" "bearer $TOKEN" '{"to":"diagnosed"}')")"
chk "错令牌 → 403" "403" "$(status_of "$(req POST /api/admin/work-orders "wrong-token-here" "$NEWBODY")")"
chk "令牌前缀子串 → 403" "403" "$(status_of "$(req POST /api/admin/work-orders "${TOKEN:0:6}" "$NEWBODY")")"
chk "错令牌推进状态 → 403" "403" "$(status_of "$(req POST "/api/admin/work-orders/$WO_ANY/transition" "wrong-token-here" '{"to":"diagnosed"}')")"
# 这条断言的「期望值」本身就是令牌，绝不能用 neq/chk 打印（它们会把 needle 写进日志），
# 否则冒烟报告等于在文件里回显了一次密钥。结论只报「含/不含」，不报内容。
if [[ "$(body_of "$(req POST /api/admin/work-orders "wrong-token-here" "$NEWBODY")")" == *"$TOKEN"* ]]; then
  bad "403 回显了期望令牌" "响应体里出现令牌的常量时间比较目标"
else
  ok "403 不回显期望令牌" "(needle 已脱敏)"
fi
chk "401 错误码 unauthorized" '"unauthorized"' "$(body_of "$(req POST /api/admin/receipts "" '{}')")"
chk "403 错误码 forbidden" '"forbidden"' "$(body_of "$(req POST /api/admin/receipts "nope" '{}')")"

# ============================================================ ⑦ 开单
sec "⑦ POST /api/admin/work-orders：校验顺序、脱敏落库与承诺时长"
if [[ -z "$TOKEN" ]]; then
  bad "ADMIN_TOKEN 未提供" "写接口段落全部跳过"
else
  OPENT_BEFORE=$(req GET '/api/work-orders?status=open' | body_of | jget total)
  r=$(req POST /api/admin/work-orders "$TOKEN" "$NEWBODY"); b=$(body_of "$r")
  chk "开单成功 → 201" "201" "$(status_of "$r")"
  chk "201 返回工单头" '"order":{' "$b"
  chk "新单状态 received" '"status":"received"' "$b"
  W1=$(printf '%s' "$b" | jget order.wo_no)
  [[ "$W1" == WO-* ]] && ok "工单号形如 WO-YYYYMMDD-NNNN" "$W1" || bad "工单号前缀异常" "$W1"
  chk "车牌回显" '"plate_no":"沪A·SMOKE1"' "$b"
  neq "响应无裸手机号键" '"customer_phone"' "$b"
  chk "手机号已脱敏" '139****2222' "$b"
  OPENED=$(printf '%s' "$b" | jget order.opened_at); PROMI=$(printf '%s' "$b" | jget order.promised_at)
  chk "普通单承诺 30 小时" "30.0" "$(hours_between "$OPENED" "$PROMI")"
  chk "初始可推进到 diagnosed" 'diagnosed' "$(printf '%s' "$b" | jget order.next_statuses)"
  r=$(req POST /api/admin/work-orders "$TOKEN" \
    '{"plate_no":"京B·URGENT1","model":"冒烟加急车","customer_name":"测试客户二","phone":"13911112222","mileage_km":100,"symptom":"加急用例","priority":"urgent","technician":"测试顾问"}')
  b2=$(body_of "$r"); W2=$(printf '%s' "$b2" | jget order.wo_no)
  chk "加急单开单 201" "201" "$(status_of "$r")"
  chk "加急单承诺 6 小时" "6.0" \
    "$(hours_between "$(printf '%s' "$b2" | jget order.opened_at)" "$(printf '%s' "$b2" | jget order.promised_at)")"
  OPENT_AFTER=$(req GET '/api/work-orders?status=open' | body_of | jget total)
  chk "在办单数 +2" "$((OPENT_BEFORE + 2))" "before=$OPENT_BEFORE after=$OPENT_AFTER"

  # 逐字段校验：每个错误行都必须点名对应字段
  declare -a BADROWS=(
    '注入型车牌|{"plate_no":"沪A'"'"' OR 1=1--","model":"车型","customer_name":"客户","phone":"13800001111","mileage_km":1,"symptom":"描述","technician":"顾问"}|plate_no'
    'XSS 车型|{"plate_no":"沪A·OK","model":"<script>alert(1)</script>","customer_name":"客户","phone":"13800001111","mileage_km":1,"symptom":"描述","technician":"顾问"}|model'
    '纯空白姓名|{"plate_no":"沪A·OK","model":"车型","customer_name":"   ","phone":"13800001111","mileage_km":1,"symptom":"描述","technician":"顾问"}|customer_name'
    '十位手机号|{"plate_no":"沪A·OK","model":"车型","customer_name":"客户","phone":"1380000111","mileage_km":1,"symptom":"描述","technician":"顾问"}|phone'
    '里程越界|{"plate_no":"沪A·OK","model":"车型","customer_name":"客户","phone":"13800001111","mileage_km":99999999,"symptom":"描述","technician":"顾问"}|mileage_km'
    '非法优先级|{"plate_no":"沪A·OK","model":"车型","customer_name":"客户","phone":"13800001111","mileage_km":1,"symptom":"描述","priority":"vip","technician":"顾问"}|priority'
    '超长顾问名|{"plate_no":"沪A·OK","model":"车型","customer_name":"客户","phone":"13800001111","mileage_km":1,"symptom":"描述","technician":"'"$(python3 -c 'print("顾"*60)')"'"}|technician'
    '分号注入描述|{"plate_no":"沪A·OK","model":"车型","customer_name":"客户","phone":"13800001111","mileage_km":1,"symptom":"异响;DROP TABLE work_orders","technician":"顾问"}|symptom'
  )
  for row in "${BADROWS[@]}"; do
    IFS='|' read -r label payload field <<<"$row"
    rr=$(req POST /api/admin/work-orders "$TOKEN" "$payload")
    bb=$(body_of "$rr")
    if [[ "$(status_of "$rr")" == "400" && "$bb" == *"\"$field\""* ]]; then
      ok "开单校验「$label」→ 400 且点名 $field" ""
    else
      bad "开单校验「$label」" "状态=$(status_of "$rr") 体=${bb:0:160}"
    fi
  done
  neq "400 不回显数据库细节" "sqlite" "$(body_of "$(req POST /api/admin/work-orders "$TOKEN" '{"plate_no":"a'"'"'","model":"b","customer_name":"c","phone":"1","mileage_km":-9,"symptom":"d","technician":"e"}')")"
  neq "400 不回显注入内容" "DROP TABLE" \
    "$(body_of "$(req POST /api/admin/work-orders "$TOKEN" '{"plate_no":"沪A·OK","model":"车型","customer_name":"客户","phone":"13800001111","mileage_km":1,"symptom":"异响;DROP TABLE work_orders","technician":"顾问"}')")"
  r=$(req POST /api/admin/work-orders "$TOKEN" '{"bad json')
  chk "畸形 JSON → 400" "400" "$(status_of "$r")"
  chk "畸形 JSON 错误码" '"invalid_request"' "$(body_of "$r")"
  BIG=$(printf '{"plate_no":"沪A·BIG","model":"超长车型","customer_name":"客户","phone":"13800001111","mileage_km":1,"symptom":"%s","technician":"顾问"}' "$(python3 -c 'print("大"*400000)')")
  rc=$(printf '%s' "$BIG" | curl -s -m 30 -o - -w $'\n%{http_code}' -X POST "$BASE/api/admin/work-orders" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data-binary @-)
  chk "1MB+ 请求体 → 413" "413" "$(status_of "$rc")"
  chk "413 错误码 body_too_large" '"body_too_large"' "$(body_of "$rc")"
  # 校验失败绝不能留下半成品：被拒的 10 次尝试之后，在办单数仍应停在 +2 的位置。
  OPENT_REJECT=$(req GET '/api/work-orders?status=open' | body_of | jget total)
  chk "校验失败不留半成品（在办单数仍为 +2）" "$((OPENT_BEFORE + 2))" "after_rejects=$OPENT_REJECT"
fi

# ============================================================ ⑧ 明细行：工时与 FIFO 出库
sec "⑧ POST /api/admin/work-orders/:no/lines：工时口径、缺件回滚与锁定"
if [[ -n "$TOKEN" && -n "$W1" && -n "$PRICE_OK" ]]; then
  ONHAND_BEFORE=$(req GET "/api/parts/$PART_OK" | body_of | jget part.on_hand)
  r=$(req POST "/api/admin/work-orders/$W1/lines" "$TOKEN" \
    '{"kind":"labor","operation":"更换机油机滤","grade":"middle","duration_min":90}')
  b=$(body_of "$r")
  chk "工时行 → 201" "201" "$(status_of "$r")"
  chk "工时金额 = 90min × 26000/60 = 39000 分" '"amount_cents":39000' "$b"
  chk "工时行挂等级" '"grade":"middle"' "$b"
  chk "工时行无物料成本" '"cost_cents":0' "$b"
  r=$(req POST "/api/admin/work-orders/$W1/lines" "$TOKEN" \
    "{\"kind\":\"part\",\"part_code\":\"$PART_OK\",\"qty\":2}")
  b=$(body_of "$r")
  chk "出库行 → 201" "201" "$(status_of "$r")"
  chk "行售价 = 2 × 挂牌价" "\"amount_cents\":$((2 * PRICE_OK))" "$b"
  chk "出库行为 part" '"kind":"part"' "$b"
  ONHAND_AFTER=$(req GET "/api/parts/$PART_OK" | body_of | jget part.on_hand)
  chk "库存恰少 2 件" "$((ONHAND_BEFORE - 2))" "before=$ONHAND_BEFORE after=$ONHAND_AFTER"
  # 出库可能跨多个批次（FIFO），所以断言「本单相关流水净额 == -2」而不是盯第一条。
  MOV=$(req GET "/api/parts/$PART_OK" | body_of | python3 -c '
import json,sys
d=json.loads(sys.stdin.read())
print(sum(m["qty_delta"] for m in d["moves"] if m["wo_no"]==sys.argv[1]))' "$W1")
  chk "本单出库流水净额为 -2" "-2" "net=$MOV"
  chk "流水挂本工单号" "\"wo_no\":\"$W1\"" "$(req GET "/api/parts/$PART_OK" | body_of)"
  LOTBAD=$(req GET "/api/parts/$PART_OK" | body_of | python3 -c '
import json,sys
d=json.loads(sys.stdin.read())
print(sum(1 for l in d["lots"] if l["qty_remaining"]<0))')
  chk "出库后仍无负余量批次" "0" "negs=$LOTBAD"
  HEAD=$(req GET "/api/work-orders/$W1" | body_of)
  LSUM=$(printf '%s' "$HEAD" | python3 -c '
import json,sys
d=json.loads(sys.stdin.read())
print(sum(l["amount_cents"] for l in d["lines"]))')
  chk "明细行数 = 2" "2" "$(printf '%s' "$HEAD" | jget order.line_count)"
  chk "Σ明细行金额 = 39000 + 2×挂牌" "$((39000 + 2 * PRICE_OK))" "line_sum=$LSUM"
  # 单头金额是「结算时才快照」的字段：在制单必须仍为 0，
  # 否则统计里的 revenue 会把没开票的算进来。
  SNAP_L=$(printf '%s' "$HEAD" | jget order.labor_total_cents)
  SNAP_P=$(printf '%s' "$HEAD" | jget order.parts_total_cents)
  SNAP_G=$(printf '%s' "$HEAD" | jget order.grand_total_cents)
  if [[ "$SNAP_L" == 0 && "$SNAP_P" == 0 && "$SNAP_G" == 0 ]]; then
    ok "在制单单头快照仍为零（结算才记账）" "labor=$SNAP_L parts=$SNAP_P grand=$SNAP_G"
  else
    bad "在制单不应已有金额快照" "labor=$SNAP_L parts=$SNAP_P grand=$SNAP_G"
  fi

  # 缺件：库存不足必须整单回滚（行数不变、库存不变）
  if [[ -n "$PART_ZERO" ]]; then
    r=$(req POST "/api/admin/work-orders/$W1/lines" "$TOKEN" "{\"kind\":\"part\",\"part_code\":\"$PART_ZERO\",\"qty\":1}")
    chk "零库存件出库 → 409" "409" "$(status_of "$r")"
    chk "错误码 insufficient_stock" '"insufficient_stock"' "$(body_of "$r")"
    chk "缺件消息给出需/可用" "可用" "$(body_of "$r")"
    chk "缺件回滚：行数仍为 2" "2" "$(req GET "/api/work-orders/$W1" | body_of | jget order.line_count)"
    chk "缺件回滚：库存未变" "$ONHAND_AFTER" "$(req GET "/api/parts/$PART_OK" | body_of | jget part.on_hand)"
  else
    bad "无零库存 active 件" "缺件分支无法验证"
  fi
  if [[ -n "$PART_DC" ]]; then
    r=$(req POST "/api/admin/work-orders/$W1/lines" "$TOKEN" "{\"kind\":\"part\",\"part_code\":\"$PART_DC\",\"qty\":1}")
    chk "停用件出库 → 409" "409" "$(status_of "$r")"
    chk "错误码 part_discontinued" '"part_discontinued"' "$(body_of "$r")"
  fi
  r=$(req POST "/api/admin/work-orders/$W1/lines" "$TOKEN" '{"kind":"part","part_code":"NOPE-9999","qty":1}')
  chk "不存在配件出库 → 404" "404" "$(status_of "$r")"
  declare -a LINEROWS=(
    '非法 kind|{"kind":"drink","qty":1}|kind'
    '工时等级非法|{"kind":"labor","operation":"项目","grade":"expert","duration_min":30}|grade'
    '工时为零|{"kind":"labor","operation":"项目","grade":"middle","duration_min":0}|duration_min'
    '工时超一天|{"kind":"labor","operation":"项目","grade":"middle","duration_min":2000}|duration_min'
    '工时项目为空|{"kind":"labor","operation":"  ","grade":"middle","duration_min":30}|operation'
    '编码注入|{"kind":"part","part_code":"X'"'"' OR 1=1--","qty":1}|part_code'
    '数量为零|{"kind":"part","part_code":"'"$PART_OK"'","qty":0}|qty'
    '数量超限|{"kind":"part","part_code":"'"$PART_OK"'","qty":5000}|qty'
    '备注含尖括号|{"kind":"labor","operation":"项目","grade":"middle","duration_min":30,"note":"<b>加粗</b>"}|note'
    '备注超长|{"kind":"labor","operation":"项目","grade":"middle","duration_min":30,"note":"'"$(python3 -c 'print("注"*80)')"'"}|note'
  )
  for row in "${LINEROWS[@]}"; do
    IFS='|' read -r label payload field <<<"$row"
    rr=$(req POST "/api/admin/work-orders/$W1/lines" "$TOKEN" "$payload")
    bb=$(body_of "$rr")
    if [[ "$(status_of "$rr")" == "400" && "$bb" == *"\"$field\""* ]]; then
      ok "行校验「$label」→ 400 且点名 $field" ""
    else
      bad "行校验「$label」" "状态=$(status_of "$rr") 体=${bb:0:160}"
    fi
  done
  chk "校验失败行数未变" "2" "$(req GET "/api/work-orders/$W1" | body_of | jget order.line_count)"
  r=$(req POST "/api/admin/work-orders/SMOKE-NOPE-2/lines" "$TOKEN" '{"kind":"labor","operation":"项目","grade":"middle","duration_min":30}')
  chk "不存在工单加行 → 404" "404" "$(status_of "$r")"
  r=$(req POST "/api/admin/work-orders/$(printf 'Y%.0s' {1..40})/lines" "$TOKEN" '{"kind":"labor","operation":"项目","grade":"middle","duration_min":30}')
  chk "超长工单号加行不 500" "404" "$(status_of "$r")"
fi

# ============================================================ ⑨ 入库建批
sec "⑨ POST /api/admin/receipts：建批、唯一性与停用件"
if [[ -n "$TOKEN" && -n "$PART_OK" ]]; then
  LOT="SMOKE-LOT-$$"
  PB=$(req GET "/api/parts/$PART_OK" | body_of)
  BEFORE=$(printf '%s' "$PB" | jget part.on_hand)
  LC_BEFORE=$(printf '%s' "$PB" | jget part.lot_count)
  r=$(req POST /api/admin/receipts "$TOKEN" \
    "{\"part_code\":\"$PART_OK\",\"lot_no\":\"$LOT\",\"qty\":7,\"unit_cost_cents\":12345,\"supplier\":\"冒烟供应商\"}")
  b=$(body_of "$r")
  chk "入库 → 201" "201" "$(status_of "$r")"
  chk "返回批次号" "\"lot_no\":\"$LOT\"" "$b"
  chk "批次余量 = 入库量" '"qty_remaining":7' "$b"
  chk "成本快照落批" '"unit_cost_cents":12345' "$b"
  PA=$(req GET "/api/parts/$PART_OK" | body_of)
  AFTER=$(printf '%s' "$PA" | jget part.on_hand)
  LC_AFTER=$(printf '%s' "$PA" | jget part.lot_count)
  chk "库存 +7" "$((BEFORE + 7))" "before=$BEFORE after=$AFTER"
  chk "批次数 +1" "$((LC_BEFORE + 1))" "before=$LC_BEFORE after=$LC_AFTER"
  chk "入库流水为正 delta" '"qty_delta":7' "$PA"
  # 重复批次与缺件这两个断言的入参里都带嵌套引号，必须先把请求体和响应各自落成变量，
  # 不能把 req 直接塞进 status_of 的子 shell 里——那样引号会被吞掉，JSON 变成畸形，
  # 409 就永远等不来，只会拿到 400「请求体无法解析」。
  DUPPAYLOAD="{\"part_code\":\"$PART_OK\",\"lot_no\":\"$LOT\",\"qty\":1,\"unit_cost_cents\":100,\"supplier\":\"重复批次\"}"
  DUP=$(req POST /api/admin/receipts "$TOKEN" "$DUPPAYLOAD")
  chk "重复批次号 → 409" "409" "$(status_of "$DUP")"
  chk "错误码 lot_exists" '"lot_exists"' "$(body_of "$DUP")"
  chk "重复批次被拒后库存未变" "$AFTER" "$(req GET "/api/parts/$PART_OK" | body_of | jget part.on_hand)"
  NXTPAYLOAD='{"part_code":"NOPE-9999","lot_no":"SMOKE-X-1","qty":1,"unit_cost_cents":100,"supplier":"无"}'
  NXT=$(req POST /api/admin/receipts "$TOKEN" "$NXTPAYLOAD")
  chk "不存在配件入库 → 404" "404" "$(status_of "$NXT")"
  if [[ -n "$PART_DC" ]]; then
    rr=$(req POST /api/admin/receipts "$TOKEN" "{\"part_code\":\"$PART_DC\",\"lot_no\":\"SMOKE-X-2\",\"qty\":1,\"unit_cost_cents\":100,\"supplier\":\"停用件\"}")
    chk "停用件入库 → 409" "409" "$(status_of "$rr")"
    chk "错误码 part_discontinued" '"part_discontinued"' "$(body_of "$rr")"
  fi
  declare -a RECVROWS=(
    '数量为零|{"part_code":"'"$PART_OK"'","lot_no":"SMOKE-R-3","qty":0,"unit_cost_cents":100,"supplier":"供"}|qty'
    '数量超限|{"part_code":"'"$PART_OK"'","lot_no":"SMOKE-R-4","qty":200000,"unit_cost_cents":100,"supplier":"供"}|qty'
    '成本为零|{"part_code":"'"$PART_OK"'","lot_no":"SMOKE-R-5","qty":1,"unit_cost_cents":0,"supplier":"供"}|unit_cost_cents'
    '批次号注入|{"part_code":"'"$PART_OK"'","lot_no":"L'"'"' OR 1=1--","qty":1,"unit_cost_cents":100,"supplier":"供"}|lot_no'
    '供应商为空|{"part_code":"'"$PART_OK"'","lot_no":"SMOKE-R-6","qty":1,"unit_cost_cents":100,"supplier":"  "}|supplier'
    '有效期格式错|{"part_code":"'"$PART_OK"'","lot_no":"SMOKE-R-7","qty":1,"unit_cost_cents":100,"supplier":"供","expires_on":"2028/01/01"}|expires_on'
  )
  for row in "${RECVROWS[@]}"; do
    IFS='|' read -r label payload field <<<"$row"
    rr=$(req POST /api/admin/receipts "$TOKEN" "$payload")
    bb=$(body_of "$rr")
    if [[ "$(status_of "$rr")" == "400" && "$bb" == *"\"$field\""* ]]; then
      ok "入库校验「$label」→ 400 且点名 $field" ""
    else
      bad "入库校验「$label」" "状态=$(status_of "$rr") 体=${bb:0:160}"
    fi
  done
  # 带合规有效期的批次（耗材类必须能写 expires_on）
  rr=$(req POST /api/admin/receipts "$TOKEN" "{\"part_code\":\"$PART_OK\",\"lot_no\":\"SMOKE-R-EXP\",\"qty\":1,\"unit_cost_cents\":100,\"supplier\":\"供\",\"expires_on\":\"2028-01-01\"}")
  chk "合规有效期入库 → 201" "201" "$(status_of "$rr")"
  chk "有效期落库" '"expires_at":"2028-01-01' "$(body_of "$rr")"
fi

# ============================================================ ⑩ 状态机
sec "⑩ POST /api/admin/work-orders/:no/transition：跃迁表与业务门"
if [[ -n "$TOKEN" && -n "$W2" ]]; then
  r=$(req POST "/api/admin/work-orders/$W2/transition" "$TOKEN" '{"to":"bogus"}')
  chk "未知目标状态 → 400" "400" "$(status_of "$r")"
  chk "错误点名 to" '"to"' "$(body_of "$r")"
  r=$(req POST "/api/admin/work-orders/$W2/transition" "$TOKEN" '{"to":"settled"}')
  chk "接车直接结算 → 409" "409" "$(status_of "$r")"
  chk "错误码 invalid_transition" '"invalid_transition"' "$(body_of "$r")"
  r=$(req POST "/api/admin/work-orders/SMOKE-NOPE-3/transition" "$TOKEN" '{"to":"diagnosed"}')
  chk "不存在工单推进 → 404" "404" "$(status_of "$r")"
  r=$(req POST "/api/admin/work-orders/$W2/transition" "$TOKEN" '{"to":"diagnosed"}'); b=$(body_of "$r")
  chk "received → diagnosed 200" "200" "$(status_of "$r")"
  chk "状态已改" '"status":"diagnosed"' "$b"
  chk "diagnosed 无工时进质检 → 409" "409" \
    "$(status_of "$(req POST "/api/admin/work-orders/$W2/transition" "$TOKEN" '{"to":"qc"}')")"
  chk "错误码 no_labor" '"no_labor"' "$(body_of "$(req POST "/api/admin/work-orders/$W2/transition" "$TOKEN" '{"to":"qc"}')")"
  req POST "/api/admin/work-orders/$W2/lines" "$TOKEN" '{"kind":"labor","operation":"全车检测","grade":"junior","duration_min":60}' >/dev/null
  chk "补工时后 diagnosed → repairing" "200" \
    "$(status_of "$(req POST "/api/admin/work-orders/$W2/transition" "$TOKEN" '{"to":"repairing"}')")"
  chk "repairing 仍可加行" "201" \
    "$(status_of "$(req POST "/api/admin/work-orders/$W2/lines" "$TOKEN" '{"kind":"labor","operation":"补充工时","grade":"junior","duration_min":30}')")"
  r=$(req POST "/api/admin/work-orders/$W2/transition" "$TOKEN" '{"to":"qc"}')
  chk "repairing → qc 200" "200" "$(status_of "$r")"
  r=$(req POST "/api/admin/work-orders/$W2/lines" "$TOKEN" '{"kind":"labor","operation":"质后进补","grade":"junior","duration_min":30}')
  chk "质检后加行 → 409 lines_locked" "409" "$(status_of "$r")"
  chk "错误码 lines_locked" '"lines_locked"' "$(body_of "$r")"
  r=$(req POST "/api/admin/work-orders/$W2/transition" "$TOKEN" '{"to":"settled"}'); b=$(body_of "$r")
  chk "qc → settled 200" "200" "$(status_of "$r")"
  chk "结算金额快照 = 60min+30min junior（18000+9000）" '"grand_total_cents":27000' "$b"
  chk "结算时间落表" '"settled_at":"20' "$b"
  SNAP=$(printf '%s' "$b" | jget order.grand_total_cents)
  chk "结算后不可作废 → 409" "409" \
    "$(status_of "$(req POST "/api/admin/work-orders/$W2/transition" "$TOKEN" '{"to":"cancelled","reason":"改期"}')")"
  chk "settled → picked_up 200" "200" \
    "$(status_of "$(req POST "/api/admin/work-orders/$W2/transition" "$TOKEN" '{"to":"picked_up"}')")"
  TERM=$(req GET "/api/work-orders/$W2" | body_of | jget order.next_statuses)
  chk "已提车为终态（无可推进目标）" "[]" "$TERM"
  chk "终态再推进 → 409" "409" \
    "$(status_of "$(req POST "/api/admin/work-orders/$W2/transition" "$TOKEN" '{"to":"received"}')")"
  AFTER_SNAP=$(req GET "/api/work-orders/$W2" | body_of | jget order.grand_total_cents)
  chk "结算快照不回溯（推进终态后金额不变）" "$SNAP" "again=$AFTER_SNAP"
  chk "推进终态后不可加行" '"lines_locked"' \
    "$(body_of "$(req POST "/api/admin/work-orders/$W2/lines" "$TOKEN" '{"kind":"labor","operation":"再补","grade":"junior","duration_min":30}')")"
fi

sec "⑩b 作废退料：出库的料必须按原批次原量回到货架"
if [[ -n "$TOKEN" && -n "$PART_OK" ]]; then
  r=$(req POST /api/admin/work-orders "$TOKEN" \
    '{"plate_no":"沪A·CANC1","model":"冒烟作废车","customer_name":"退料客户","phone":"13777778888","mileage_km":900,"symptom":"作废退料用例","priority":"normal","technician":"测试顾问"}')
  W3=$(printf '%s' "$(body_of "$r")" | jget order.wo_no)
  chk "作废用例开单 201" "201" "$(status_of "$r")"
  B0=$(req GET "/api/parts/$PART_OK" | body_of | jget part.on_hand)
  req POST "/api/admin/work-orders/$W3/lines" "$TOKEN" "{\"kind\":\"part\",\"part_code\":\"$PART_OK\",\"qty\":3}" >/dev/null
  B1=$(req GET "/api/parts/$PART_OK" | body_of | jget part.on_hand)
  chk "出库后库存 -3" "$((B0 - 3))" "before=$B0 issued=$B1"
  rr=$(req POST "/api/admin/work-orders/$W3/transition" "$TOKEN" '{"to":"cancelled","reason":"客户改期"}')
  chk "在制单作废 → 200" "200" "$(status_of "$rr")"
  chk "作废原因落表" '"cancel_reason":"客户改期"' "$(body_of "$rr")"
  B2=$(req GET "/api/parts/$PART_OK" | body_of | jget part.on_hand)
  chk "作废退料后库存复原" "$B0" "issued=$B1 returned=$B2"
  # 出库可能跨批次（FIFO），退料也就可能有多条：比对「出库净额 == 退料净额」，不数条数。
  RET=$(req GET "/api/work-orders/$W3" | body_of | python3 -c '
import json,sys
d=json.loads(sys.stdin.read())
mv=d["moves"]
iss=sum(-m["qty_delta"] for m in mv if m["kind"]=="issue")
ret=sum(m["qty_delta"] for m in mv if m["kind"]=="return")
print("%d/%d" % (iss, ret))')
  chk "作废单：出库量与退料量相抵（3/3）" "3/3" "issue/return=$RET"
  chk "作废单为终态" "[]" "$(req GET "/api/work-orders/$W3" | body_of | jget order.next_statuses)"
  chk "作废后不可加行" '"lines_locked"' \
    "$(body_of "$(req POST "/api/admin/work-orders/$W3/lines" "$TOKEN" '{"kind":"labor","operation":"补","grade":"junior","duration_min":30}')")"
fi

# ============================================================ ⑪ 写后不变量与错误响应面
sec "⑪ 写后恒等式复验与错误响应不泄露内部信息"
r=$(req GET '/api/stats'); b=$(body_of "$r")
chk "写操作后账实仍相符" '"stock_invariant_ok":true' "$b"
chk "写操作后库存差异仍为空" '"stock_issues":[]' "$b"
chk "写操作后金额恒等式仍成立" '"amount_invariant_ok":true' "$b"
chk "写操作后批次余量仍不越界" '"lot_overflow":0' "$b"
chk "写操作后营收仍可分解" \
  "$(( $(printf '%s' "$b" | jget labor_cents) + $(printf '%s' "$b" | jget parts_cents) ))" \
  "revenue=$(printf '%s' "$b" | jget revenue_cents)"
# 本轮新开的单进了趋势：今日点数必须随之增大（种子与线上写同一张表）。
TODAY_OPENED=$(printf '%s' "$b" | jget today_opened)
num "今日进厂单数" "today_opened" "$TODAY_OPENED"
(( TODAY_OPENED >= 3 )) && ok "本轮开单计入今日口径" "today_opened=$TODAY_OPENED" || bad "今日开单口径未反映写入" "today_opened=$TODAY_OPENED"

sec "⑪b 错误响应面：任何入口都不能回显 SQL/驱动/栈信息"
for p in '/api/work-orders/%2E%2E' '/api/parts/%00bad' '/api/work-orders/undefined' \
         '/api/stats?days=%3B%20DROP--' '/api/parts?sort=nonexistent&dir=%24%7B%7D' \
         '/api/work-orders?q=%2527' '/api/parts?category=%27' '/api/work-orders/SMOKE-X/lines' \
         '/api/health/../../etc/passwd' '/api/admin/work-orders'; do
  rr=$(curl -s -m 15 -w $'\n%{http_code}' "$BASE$p")
  code=$(status_of "$rr"); bb=$(body_of "$rr")
  if [[ "$code" == "500" ]]; then bad "$p 触发 500" "$bb"; else ok "$p → $code 非 500"; fi
  LEAK=""
  for needle in 'SQL logic' 'unsupported Scan' 'no such column' 'no such table' 'UNIQUE constraint' 'gorm' 'goroutine' 'SELECT' 'internal/repository' '服务内部错误'; do
    [[ "$bb" == *"$needle"* ]] && LEAK="$needle" && break
  done
  if [[ -n "$LEAK" ]]; then bad "$p 泄露内部信息" "含「$LEAK」：${bb:0:160}"; else ok "$p 无内部信息泄露"; fi
done

# ============================================================ 汇总
printf '\n\033[1mpass=%s fail=%s\033[0m\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]] || exit 1
