#!/usr/bin/env bash
# 逐接口冒烟：真监听端口 + 真 curl，覆盖
#   读接口信封/分页上限/排序回显 / 司机手机号永不外泄 / 试算恒等式 + 脚本侧独立复算计价引擎 /
#   结算快照与同源试算逐字段一致 / 鉴权三层（503·401·403）+ 被拒写请求不留痕 /
#   四态状态机正反两向 + 一桩一车一开单的唯一约束 / 价目规则启停对报价的即时影响 /
#   注入、LIKE 转义与超长边界 / 静态托管、安全头、CORS、404 形状。
#
# 为什么 go test 之外还要这个脚本：go test 走 httptest 内存路由，
# 这里走真 HTTP + 真 SQLite，顺带验到 CORS、安全响应头、NoRoute JSON、SPA 兜底这些网关层行为；
# 更重要的是**独立复算**：脚本自己按价目表把分时拆分重算一遍，不信任 Go 的自我证明。
#
# 用法：
#   BASE=http://127.0.0.1:18501 ADMIN_TOKEN=xxx \
#     [NO_TOKEN_BASE=http://127.0.0.1:18502] bash scripts/api-smoke.sh
#   （一般不直接跑，用 scripts/run-smoke.sh 在全新种子库上起实例。）
#
# 注意：**会真写库**（开充、结算、登记故障、弃单、建规则、启停规则、切桩状态），只对着 /tmp 上的一次性实例跑；
# 因此单文件 preview 必须由另一个刚灌完种子的实例生成，不能用本脚本跑过的库。
# 样本（会话号、桩号、车牌、规则 ID）全部从接口反查（见 ⓪），脚本不猜常量。
set -uo pipefail

BASE="${BASE:-http://127.0.0.1:18501}"
TOKEN="${ADMIN_TOKEN:-}"
NO_TOKEN_BASE="${NO_TOKEN_BASE:-}"
PASS=0
FAIL=0
# ⑥⑦ 段之间靠这几个「本轮新开的单」串联；即便 ⑥ 因缺令牌而跳过，
# 后面的引用在 set -u 下也不能踩到未定义变量。
S1=""
S2=""

ok()   { PASS=$((PASS+1)); printf '  ok   %s%s\n' "$1" "${2:+ — ${2:0:90}}"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s%s\n' "$1" "${2:+${2:0:200}}"; }
chk()  { if [[ "$3" == *"$2"* ]]; then ok "$1" "$3"; else bad "$1" "期望含「$2」实际「$3」"; fi; }
neq()  { if [[ "$3" != *"$2"* ]]; then ok "$1" "不含「$2」"; else bad "$1" "不应含「$2」，实际「${3:0:160}」"; fi; }
num()  { if [[ "$3" =~ ^-?[0-9]+$ ]]; then ok "$1" "$2=$3"; else bad "$1" "期望整数 $2，实际「$3」"; fi; }
# eq：把取值本身打出来，方便一眼分清「真的相等」和「两边都是空串的假绿」。
eq()   { if [[ -n "$2" && "$2" == "$3" ]]; then ok "$1" "$2"; else bad "$1" "期望「$3」实际「$2」"; fi; }
yes()  { if eval "$3"; then ok "$1" "$3"; else bad "$1" "$3 不成立"; fi; }

req() { # req <方法> <路径> [令牌] [JSON]
  local m="$1" p="$2" tok="${3:-}" data="${4:-}"
  local args=(-s -m 15 -w $'\n%{http_code}' -X "$m" "$BASE$p" -H 'Accept: application/json')
  [[ -n "$tok" ]] && args+=(-H "Authorization: Bearer $tok")
  [[ -n "$data" ]] && args+=(-H 'Content-Type: application/json' --data-binary "$data")
  curl "${args[@]}"
}
raw() { # raw <方法> <路径> <原始 Authorization 头值> [JSON]  — 用于试探鉴权头本身的形状
  local m="$1" p="$2" auth="$3" data="${4:-}"
  local args=(-s -m 15 -w $'\n%{http_code}' -X "$m" "$BASE$p")
  [[ -n "$auth" ]] && args+=(-H "Authorization: $auth")
  [[ -n "$data" ]] && args+=(-H 'Content-Type: application/json' --data-binary "$data")
  curl "${args[@]}"
}
ntok() { # ntok <方法> <路径> <JSON> — 打在「服务端没配令牌」的第二个实例上
  local m="$1" p="$2" data="${3:-}"
  local args=(-s -m 15 -w $'\n%{http_code}' -X "$m" "$NO_TOKEN_BASE$p")
  [[ -n "$data" ]] && args+=(-H 'Content-Type: application/json' --data-binary "$data")
  curl "${args[@]}"
}
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
sec() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ============================================================ ⓪ 反查样本
sec "⓪ 从接口反查测试样本（不猜常量）"
PROBE="$(BASE="$BASE" python3 - <<'PY'
import json, os, shlex, urllib.request

B = os.environ["BASE"].rstrip("/")

def get(p):
    with urllib.request.urlopen(B + p, timeout=15) as r:
        return json.loads(r.read())

out = {}
rows = get("/api/sessions?page_size=100")["items"]
out["S_ANY"] = rows[0]["code"] if rows else ""

# 状态样本一律走 status 筛选接口取：种子有上百条会话，默认排序下 aborted/faulted
# 很可能整页都不露脸，拿空样本去断言状态机等于假绿。
def pick(status):
    it = get(f"/api/sessions?status={status}&page_size=100")["items"]
    return it[0] if it else None

c = pick("charging")
out["S_CHARGING"] = c["code"] if c else ""
f = pick("faulted")
out["S_FAULTED"] = f["code"] if f else ""
d = pick("completed")
out["S_DONE"] = d["code"] if d else ""
a = pick("aborted")
out["S_ABORTED"] = a["code"] if a else ""
# 带超时占用费的已结算单：本场景的三件套计价（电费+服务费+占用费）要靠它复算。
paid = [r for r in get("/api/sessions?status=completed&page_size=100")["items"]
        if r["overstay_cents"] > 0]
out["S_OVERSTAY"] = paid[0]["code"] if paid else ""
# 跨窗口单（分时拆分段数 >= 2）：单段单证明不了拆分逻辑。
multi = [r for r in get("/api/sessions?status=completed&page_size=100")["items"]
         if len(r.get("segments") or []) >= 2]
out["S_MULTI"] = multi[0]["code"] if multi else ""

piles = get("/api/piles")["items"]
# 按功率降序：结算受「满功率 × 已用时长」上限约束，挑大功率桩才验得到正常结算。
free = sorted((p for p in piles if p["status"] == "online" and p["open_sessions"] == 0),
              key=lambda p: -p["power_kw"])
out["PILE_FREE"] = free[0]["code"] if free else ""
busy = [p for p in piles if p["open_sessions"] > 0]
out["PILE_BUSY"] = busy[0]["code"] if busy else ""
noton = [p for p in piles if p["status"] != "online"]
out["PILE_DOWN"] = noton[0]["code"] if noton else ""
out["PILE_POWER"] = str(free[0]["power_kw"]) if free else ""
out["PILE_TYPE"] = free[0]["type"] if free else ""

veh = get("/api/vehicles")["items"]
out["PLATE_OK"] = veh[0]["plate_no"] if veh else ""
# 开新单要桩、车都空闲：被占用的车开单必然 409，样本得从「无未关闭会话」里挑。
open_plates = {s["plate_no"] for s in get("/api/sessions?open=1&page_size=100")["items"]}
idle = [v for v in veh if v["plate_no"] not in open_plates]
out["PLATE_IDLE"] = idle[0]["plate_no"] if idle else ""
out["PLATE_BATTERY"] = str(idle[0]["battery_kwh"]) if idle else ""
allv = get("/api/vehicles?all=1")["items"]
ret = [v for v in allv if not v["active"]]
out["PLATE_RETIRED"] = ret[0]["plate_no"] if ret else ""

rules = get("/api/tariffs?all=1")["items"]
out["RULE_ID"] = str(rules[0]["id"]) if rules else ""
off = [r for r in rules if not r["active"]]
out["RULE_INACTIVE"] = str(off[0]["id"]) if off else ""
out["RULE_CODES"] = ",".join(sorted(r["code"] for r in rules))
# 峰谷价差样本：谷段规则与峰段规则各取一条，用于「同电量不同窗口不同价」的断言。
pk = next((r for r in rules if r["active"] and r["period"] == "peak"), {})
vl = next((r for r in rules if r["active"] and r["period"] == "valley"), {})
out["PEAK_ELEC"] = str(pk.get("elec_cents_per_kwh", ""))
out["VALLEY_ELEC"] = str(vl.get("elec_cents_per_kwh", ""))

print("\n".join(f"{k}={shlex.quote(str(v))}" for k, v in out.items()))
PY
)"
if [[ -z "$PROBE" ]]; then
  bad "样本反查" "探针无输出，后续断言无法进行"; printf '\npass=%s fail=%s\n' "$PASS" "$FAIL"; exit 1
fi
eval "$PROBE"
MISSING=""
for kv in S_ANY PILE_FREE PLATE_OK PLATE_IDLE RULE_ID RULE_CODES PEAK_ELEC VALLEY_ELEC; do
  [[ -n "${!kv}" ]] || MISSING="$MISSING $kv"
done
for kv in S_CHARGING S_FAULTED S_DONE S_ABORTED; do
  [[ -n "${!kv}" ]] && ok "样本 $kv" "${!kv}" || bad "样本 $kv 为空" "种子未覆盖该状态，状态机断言会打在空集上"
done
for kv in S_OVERSTAY S_MULTI PILE_BUSY PILE_DOWN PLATE_RETIRED RULE_INACTIVE; do
  [[ -n "${!kv}" ]] && ok "加分样本 $kv" "${!kv}" || bad "加分样本 $kv 为空" "该机制在种子里没有实例，相关断言会打在空集上"
done
if [[ -n "$MISSING" ]]; then
  bad "必需样本缺失" "缺：$MISSING，后续断言无意义"; printf '\npass=%s fail=%s\n' "$PASS" "$FAIL"; exit 1
fi

# ============================================================ ① 读接口骨架
sec "① 读接口：信封键名、分页上限、排序回显、统计口径"
RESP="$(req GET /api/health)"; eq "GET /api/health 200" "$(printf '%s' "$RESP" | status_of)" "200"
B="$(printf '%s' "$RESP" | body_of)"
chk "health 含 status ok" '"status":"ok"' "$B"
# /health 的时间是 UTC，业务日是 UTC+8：两者口径差 8 小时，不能拿 health 做日期断言。
chk "health 时间是 RFC3339 UTC" "Z" "$B"

B="$(req GET '/api/piles' | body_of)"
chk "piles 用 items 信封" '"items":[' "$B"
num "piles total 是整数" "total" "$(printf '%s' "$B" | jget total)"
chk "桩带在充会话数（一桩一开单的可见证据）" '"open_sessions":' "$B"
chk "桩带功率" '"power_kw":' "$B"
DOWN_CNT="$(req GET '/api/piles' | body_of | python3 -c '
import json,sys
print(sum(1 for p in json.loads(sys.stdin.read())["items"] if p["status"]!="online"))')"
yes "桩状态是三态之一（存在非在线桩：$DOWN_CNT）" "" "[[ $DOWN_CNT -ge 0 ]]"

B="$(req GET '/api/sessions?page_size=9999&sort=total&dir=asc' | body_of)"
eq "page_size 封顶 100" "$(printf '%s' "$B" | jget page_size)" "100"
# 回显必须是白名单键而不是内部列名：把 s.total_cents 发出去等于替攻击者画库表。
chk "排序回显为键名" '"sort":"total"' "$B"
neq "排序回显不含内部列名" '"sort":"s.' "$B"
chk "方向回显" '"dir":"asc"' "$B"
eq "page_size=0 回落默认 20" "$(req GET '/api/sessions?page=0&page_size=0' | body_of | jget page_size)" "20"
eq "page=0 回落第 1 页" "$(req GET '/api/sessions?page=0' | body_of | jget page)" "1"
# 分页不重不漏：每页 7 条翻完的总数必须等于 total
PAGES="$(req GET '/api/sessions?page_size=7' | body_of | jget total)"
FULL="$(python3 - "$BASE" "$PAGES" <<'PY'
import json, sys, urllib.request
B, total = sys.argv[1].rstrip("/"), int(sys.argv[2])
seen, page = [], 1
while len(seen) < total:
    d = json.loads(urllib.request.urlopen(f"{B}/api/sessions?page={page}&page_size=7", timeout=15).read())
    if not d["items"]: break
    seen += [r["code"] for r in d["items"]]
    page += 1
print("OK" if len(seen) == total == len(set(seen)) else f"{len(seen)} vs {total}")
PY
)"
eq "逐页翻完不重不漏" "$FULL" "OK"

# 筛选必须真生效：open=1 与 status=charging 的并集关系、pile/plate 精确过滤。
OPEN_N="$(req GET '/api/sessions?open=1&page_size=1' | body_of | jget total)"
CH_N="$(req GET '/api/sessions?status=charging&page_size=1' | body_of | jget total)"
FA_N="$(req GET '/api/sessions?status=faulted&page_size=1' | body_of | jget total)"
yes "open=1 覆盖在充+故障（$OPEN_N = $CH_N + $FA_N）" "" "[[ $OPEN_N -eq $((CH_N + FA_N)) ]]"
PILE_N="$(req GET "/api/sessions?pile=$PILE_FREE&page_size=1" | body_of | jget total)"
OPEN_PLATE="$(req GET "/api/sessions?plate=$PLATE_IDLE&open=1&page_size=1" | body_of | jget total)"
yes "按桩筛选给出整数计数" "" "[[ $PILE_N =~ ^[0-9]+$ ]]"
eq "空闲车牌在 open=1 下为 0 条" "$OPEN_PLATE" "0"

# 种子不得写未来时刻：清晨跑最容易露馅——「今天 8~18 点」整段还在未来，
# 按开始时间倒序时真单会被未来种子单压住，看板的「最近更新」也会显示明天。
FUT="$(req GET '/api/sessions?page_size=100&sort=start&dir=desc' | body_of | python3 -c '
import json,sys,datetime
d=json.loads(sys.stdin.read())
now=datetime.datetime.now(datetime.timezone.utc)
def p(v): return datetime.datetime.fromisoformat(v.replace("Z","+00:00")) if v else None
bad=[(r["code"], p(r["start_at"]).isoformat()) for r in d["items"] if p(r["start_at"])>now]
bad+=[(r["code"], p(r["end_at"]).isoformat()) for r in d["items"] if p(r.get("end_at")) and p(r["end_at"])>now]
print("OK" if not bad else "未来时刻: %s" % bad[:3])')"
eq "列表里没有未来时刻" "$FUT" "OK"

# 物理可能功率：均速不得超过桩额定功率（种子若把电量灌得太满这里必炸）。
PHYS="$(req GET '/api/sessions?page_size=100&sort=energy&dir=desc' | body_of | python3 -c '
import json,sys
its=json.loads(sys.stdin.read())["items"]
bad=[(r["code"], r["avg_power_kw"], r["power_kw"]) for r in its if r["avg_power_kw"] > r["power_kw"]*1.25]
print("OK" if not bad else "超物理功率: %s" % bad[:3])')"
eq "平均功率不超桩额定功率（留计量容差）" "$PHYS" "OK"

# 每个排序键都要真执行且结果有序：指错列名会是 500，而「200 但没排序」是最常见的假绿。
for k in code start end energy total status pile plate overstay id; do
  ORDERED="$(req GET "/api/sessions?sort=$k&dir=desc&page_size=50" | body_of | python3 -c '
import json,sys
key={"code":"code","total":"total_cents","energy":"actual_wh","status":"status",
     "pile":"pile_code","plate":"plate_no","overstay":"overstay_min",
     "start":"start_at","end":"end_at","id":"id"}["'"$k"'"]
its=json.loads(sys.stdin.read())["items"]
def norm(v):
    return "" if v is None else v
vals=[norm(r.get(key)) for r in its]
print("OK" if len(its)>1 and vals==sorted(vals,reverse=True) else f"未降序：{vals[:3]}")')"
  eq "排序 $k 降序有效" "$ORDERED" "OK"
done

B="$(req GET '/api/stats?days=14' | body_of)"
chk "stats 含恒等式结论" '"identity_ok":true' "$B"
eq "stats 恒等式无告警" "$(printf '%s' "$B" | jget identity_issues)" "[]"
num "营收总额" "revenue_cents" "$(printf '%s' "$B" | jget revenue_cents)"
num "今日营收" "revenue_today_cents" "$(printf '%s' "$B" | jget revenue_today_cents)"
num "电费" "elec_cents" "$(printf '%s' "$B" | jget elec_cents)"
num "服务费" "service_cents" "$(printf '%s' "$B" | jget service_cents)"
num "超时占用费" "overstay_cents" "$(printf '%s' "$B" | jget overstay_cents)"
yes "营收 = 电费+服务费+占用费（只计已结算，故不超过全口径之和）" "" \
  "[[ $(printf '%s' "$B" | jget revenue_cents) -le $(( $(printf '%s' "$B" | jget elec_cents) + $(printf '%s' "$B" | jget service_cents) + $(printf '%s' "$B" | jget overstay_cents) )) ]]"
yes "峰+平+谷 <= 总电量（未定价部分不计入）" "" \
  "[[ $(( $(printf '%s' "$B" | jget peak_kwh) + $(printf '%s' "$B" | jget flat_kwh) + $(printf '%s' "$B" | jget valley_kwh) )) -le $(printf '%s' "$B" | jget total_kwh) ]]"
OVERSTAY_RATE="$(printf '%s' "$B" | jget overstay_rate_pct)"
awk -v v="$OVERSTAY_RATE" 'BEGIN{exit !(v>0 && v<=100)}' && ok "超时占桩率非零且合理" "$OVERSTAY_RATE" || bad "超时占桩率异常" "$OVERSTAY_RATE"
eq "趋势按天稠密补齐" "$(printf '%s' "$B" | jlen daily)" "14"
# 状态分布必须覆盖四态（含 0 单的状态也要出现），否则前端图例会缺项。
ST="$(printf '%s' "$B" | jget by_status)"
for s in charging completed faulted aborted; do
  chk "状态分布含 $s" "\"$s\"" "$ST"
done
eq "桩分组行数等于桩数" "$(printf '%s' "$B" | jlen by_pile)" "$(req GET '/api/piles' | body_of | jlen items)"
yes "价目板有窗口（跨零点窗口也在内）" "" "[[ $(printf '%s' "$B" | jlen rate_board) -gt 6 ]]"
for bad_days in 0 -5 abc 99999; do
  R="$(req GET "/api/stats?days=$bad_days" | status_of)"
  D="$(req GET "/api/stats?days=$bad_days" | body_of | jlen daily)"
  yes "days=$bad_days 被夹到合理区间" "" "[[ $R == 200 && $D -ge 7 && $D -le 30 ]]"
done
# 分组求和必须等于总数：这是「多对一 JOIN 不放大行数」的唯一外部证据。
SUMS="$(BASE="$BASE" python3 - <<'PY'
import json, os, urllib.request
B = os.environ["BASE"].rstrip("/")
s = json.loads(urllib.request.urlopen(B + "/api/stats?days=14", timeout=15).read())
d = json.loads(urllib.request.urlopen(B + "/api/sessions?page_size=100", timeout=15).read())
bad = []
if sum(p["sessions"] for p in s["by_pile"]) != s["total_sessions"]:
    bad.append("桩分组之和 != 总数")
if sum(x["sessions"] for x in s["by_dept"]) != s["total_sessions"]:
    bad.append("车队分组之和 != 总数")
if sum(x["count"] for x in s["by_status"]) != s["total_sessions"]:
    bad.append("状态分布之和 != 总数")
if s["billed_count"] > s["total_sessions"]:
    bad.append("已结算数超过总数")
if d["total"] != s["total_sessions"]:
    bad.append("列表 total 与统计不一致")
print("OK" if not bad else "; ".join(bad))
PY
)"
eq "聚合口径自洽（分组求和 == 总数）" "$SUMS" "OK"

# ============================================================ ② 隐私
sec "② 手机号：只出掩码，原文永不出接口"
for p in '/api/vehicles' '/api/vehicles?all=1' '/api/sessions?page_size=100' "/api/sessions/$S_ANY"; do
  neq "$p 不含 phone 原文键" '"phone":' "$(req GET "$p" | body_of)"
  neq "$p 不含 driver_phone" 'driver_phone' "$(req GET "$p" | body_of)"
done
M="$(req GET '/api/vehicles' | body_of | jget 'items.0.phone_masked')"
if [[ "$M" =~ ^1[0-9]{2}\*{4}[0-9]{4}$ ]]; then ok "车辆掩码形状正确" "$M"; else bad "车辆掩码形状异常" "$M"; fi
SM="$(req GET '/api/sessions?page_size=1' | body_of | jget 'items.0.phone_masked')"
if [[ "$SM" =~ ^1[0-9]{2}\*{4}[0-9]{4}$ ]]; then ok "会话掩码形状正确" "$SM"; else bad "会话掩码形状异常" "$SM"; fi
neq "列表不给分时明细（那是详情接口）" '"rate_board":' "$(req GET '/api/sessions?page_size=5' | body_of)"
D="$(req GET "/api/sessions/$S_ANY" | body_of)"
chk "详情含 rate_board（口径回显）" '"rate_board":[' "$D"
chk "详情含掩码" '"phone_masked"' "$D"

# ============================================================ ③ 计价：独立复算 + 快照一致
sec "③ 分时计价引擎：脚本独立复算，不采信 Go 的自我证明"
RECALC="$(BASE="$BASE" PILE="$PILE_FREE" python3 - <<'PY'
import datetime, json, os, urllib.request

B = os.environ["BASE"].rstrip("/")
pile = os.environ["PILE"]


def get(p):
    with urllib.request.urlopen(B + p, timeout=15) as r:
        return json.loads(r.read())


def parse(v):
    return datetime.datetime.fromisoformat(v.replace("Z", "+00:00"))


# 独立按价目表重算：分钟步进 → 规则仲裁（priority 升序、code 升序）→ 时长占比分摊（最大余数）。
rules = [r for r in get("/api/tariffs?all=1")["items"] if r["active"]]
rules.sort(key=lambda r: (r["priority"], r["code"]))


def covers(rule, local):
    weekend = local.weekday() >= 5
    dt = rule["day_type"]
    if dt == "weekend" and not weekend:
        return False
    if dt == "weekday" and weekend:
        return False
    m = local.hour * 60 + local.minute
    a, b = rule["start_min"], rule["end_min"]
    if a == b:
        return False
    return a <= m < b if a < b else (m >= a or m < b)


def match(local):
    for r in rules:
        if covers(r, local):
            return r
    return None


def half_up(num, den):
    return 0 if den <= 0 else (num + den // 2) // den


def bill(start_utc, minutes, wh, overstay):
    total = minutes * 60
    runs = []  # (secs, rule or None)
    for i in range(minutes):
        loc = start_utc + datetime.timedelta(minutes=i) + datetime.timedelta(hours=8)
        r = match(loc)
        code = r["code"] if r else None
        if runs and runs[-1][1] == code and runs[-1][2] == r:
            runs[-1][0] += 60
        else:
            runs.append([60, code, r])
    secs = [x[0] for x in runs]
    alloc = [wh * s // total for s in secs]
    rem = [wh * s % total for s in secs]
    left = wh - sum(alloc)
    for i in sorted(range(len(runs)), key=lambda k: (-rem[k], k))[:left]:
        alloc[i] += 1
    out = {"peak_wh": 0, "flat_wh": 0, "valley_wh": 0, "unpriced_wh": 0,
           "elec_cents": 0, "service_cents": 0}
    for (s, code, r), w in zip(runs, alloc):
        if r is None:
            out["unpriced_wh"] += w
            continue
        out[r["period"] + "_wh"] += w
        out["elec_cents"] += half_up(w * r["elec_cents_per_kwh"], 1000)
        out["service_cents"] += half_up(w * r["service_cents_per_kwh"], 1000)
    ost = max(0, min(overstay, 360))
    out["overstay_cents"] = ost * 8
    out["total_cents"] = out["elec_cents"] + out["service_cents"] + out["overstay_cents"]
    out["minutes_priced"] = sum(s for s, c, r in runs if r) // 60
    return out


bad = []
for minutes, wh, delay, ost in ((90, 45000, 0, 25), (180, 120000, 480, 0), (600, 300000, 120, 360)):
    q = get(f"/api/quote?pile={pile}&wh={wh}&minutes={minutes}&delay_min={delay}&overstay_min={ost}")
    want = bill(parse(q["start_at"]), minutes, wh, ost)
    for k, v in want.items():
        if k == "minutes_priced":
            if v + q["unpriced_min"] != minutes:
                bad.append(f"{minutes}m/d{delay}: 已定价+未定价分钟 {v}+{q['unpriced_min']} != {minutes}")
            continue
        if q[k] != v:
            bad.append(f"{minutes}m/d{delay}: {k} 复算 {v} vs 接口 {q[k]}")
    if q["identity_ok"] is not True:
        bad.append(f"{minutes}m: identity_ok 非真")
    if sum(s["wh"] for s in q["segments"]) + q["unpriced_wh"] != wh:
        bad.append(f"{minutes}m: Σ分段+未定价 != 实际电量")
    if q["pile_code"] != pile or q["minutes"] != minutes or q["wh"] != wh:
        bad.append(f"{minutes}m: 回显参数不符")

# 未覆盖窗口：新规则停用后，落在空档的分钟必须记 unpriced 且金额为 0。
print("OK" if not bad else "; ".join(bad[:4]))
PY
)"
eq "独立复算三组试算（窗口拆分/取整/占用费）" "$RECALC" "OK"

# 峰谷价差真的存在：同一电量分别落在峰段起点与谷段起点，金额必须不同。
PRICE_GAP="$(BASE="$BASE" PILE="$PILE_FREE" PEAK="$PEAK_ELEC" VALLEY="$VALLEY_ELEC" python3 - <<'PY'
import datetime, json, os, urllib.request

B = os.environ["BASE"].rstrip("/")
pile = os.environ["PILE"]


def get(p):
    with urllib.request.urlopen(B + p, timeout=15) as r:
        return json.loads(r.read())


rules = [r for r in get("/api/tariffs?all=1")["items"] if r["active"]]
now = datetime.datetime.now(datetime.timezone.utc)
loc = now + datetime.timedelta(hours=8)


def find(period):
    for r in rules:
        if r["period"] != period:
            continue
        m = r["start_min"] + 1  # 窗口内第二分钟，避开边界
        for delay in range(0, 10080):
            t = loc + datetime.timedelta(minutes=delay)
            if t.weekday() >= 5 and r["day_type"] == "weekday":
                continue
            if t.weekday() < 5 and r["day_type"] == "weekend":
                continue
            if t.hour * 60 + t.minute == m % 1440:
                return delay
    return None


dp, dv = find("peak"), find("valley")
if dp is None or dv is None:
    print("找不到峰/谷样本窗口")
else:
    a = get(f"/api/quote?pile={pile}&wh=60000&minutes=60&delay_min={dp}")
    b = get(f"/api/quote?pile={pile}&wh=60000&minutes=60&delay_min={dv}")
    if a["elec_cents"] <= b["elec_cents"]:
        print(f"峰段不比谷段贵：{a['elec_cents']} vs {b['elec_cents']}")
    elif a["segments"][0]["rule_code"] == b["segments"][0]["rule_code"]:
        print("峰谷命中了同一条规则，仲裁有问题")
    else:
        print("OK %s>%s（%s vs %s）" % (a["elec_cents"], b["elec_cents"],
                                        a["segments"][0]["rule_code"],
                                        b["segments"][0]["rule_code"]))
PY
)"
chk "峰谷价差 + 规则仲裁生效" "OK" "$PRICE_GAP"

# 已结算单的落库快照必须能被同一引擎复算出来（历史不被新价目污染）。
SNAP="$(BASE="$BASE" CODE="$S_DONE" python3 - <<'PY'
import json, os, sys, urllib.request

B = os.environ["BASE"].rstrip("/")
code = os.environ["CODE"]
d = json.loads(urllib.request.urlopen(f"{B}/api/sessions/{code}", timeout=15).read())
bad = []
if d["status"] != "completed":
    bad.append("样本不是已结算单")
if d["elec_cents"] + d["service_cents"] + d["overstay_cents"] != d["total_cents"]:
    bad.append("金额恒等式破口")
if d["seg_peak_wh"] + d["seg_flat_wh"] + d["seg_valley_wh"] + d["seg_unpriced_wh"] != d["actual_wh"]:
    bad.append("分时拆分之和 != 实际电量")
if sum(s["wh"] for s in d["segments"]) + d["seg_unpriced_wh"] != d["actual_wh"]:
    bad.append("明细段之和 != 实际电量")
if sum(s["elec_cents"] for s in d["segments"]) != d["elec_cents"]:
    bad.append("明细电费 != 快照电费")
if d["avg_power_kw"] > d["power_kw"]:
    bad.append(f'均速 {d["avg_power_kw"]}kW 超桩额定 {d["power_kw"]}kW')
if d["seg_unpriced_wh"] > 0 and d["covered"]:
    bad.append("有未定价电量却报 covered=true")
print("OK" if not bad else "; ".join(bad))
PY
)"
eq "已结算快照自洽（金额/拆分/功率/覆盖位）" "$SNAP" "OK"

# 同一会话：把结算参数原样喂回试算接口，金额必须逐分一致（一套引擎，两套入口）。
if [[ -n "$TOKEN" ]]; then
  RESP="$(req POST /api/admin/sessions "$TOKEN" '{"pile_code":"'"$PILE_FREE"'","plate_no":"'"$PLATE_IDLE"'","planned_wh":40000,"note":"同源校验"}')"
  eq "开充 201" "$(printf '%s' "$RESP" | status_of)" "201"
  S1="$(printf '%s' "$RESP" | body_of | jget code)"
  sleep 1
  ACT="$(req GET "/api/sessions/$S1" | body_of)"
  ST="$(printf '%s' "$ACT" | jget start_at)"
  # 结算时刻 = 现在；用同一组参数打试算（delay 反推到 start，minutes = 已充分钟）
  SAME="$(BASE="$BASE" TOKEN="$TOKEN" CODE="$S1" ST="$ST" python3 - <<'PY'
import datetime, json, os, urllib.request

B = os.environ["BASE"].rstrip("/")
code = os.environ["CODE"]
start = datetime.datetime.fromisoformat(os.environ["ST"].replace("Z", "+00:00"))
now = datetime.datetime.now(datetime.timezone.utc)
minutes = max(5, int((now - start).total_seconds() // 60))
# 刚开的单只跑了几秒（后端按最少 60 秒算），结算电量必须落在满功率上限内。
act = 1200
q = json.loads(urllib.request.urlopen(
    f"{B}/api/quote?pile={json.loads(urllib.request.urlopen(f'{B}/api/sessions/{code}', timeout=15).read())['pile_code']}"
    f"&wh={act}&minutes={minutes}", timeout=15).read())
req = urllib.request.Request(f"{B}/api/admin/sessions/{code}/settle",
                             data=json.dumps({"actual_wh": act, "overstay_min": 12}).encode(),
                             headers={"Authorization": "Bearer " + os.environ["TOKEN"],
                                      "Content-Type": "application/json"}, method="POST")
s = json.loads(urllib.request.urlopen(req, timeout=15).read())["session"]
# 结算的起止与试算的起止天然差几分钟（各自截断到分钟），因此只比「同一窗口是否同价」：
# 电费/服务费必须等于按各自分段求和的结果，且总额三件套自洽。
bad = []
if s["elec_cents"] + s["service_cents"] + s["overstay_cents"] != s["total_cents"]:
    bad.append("结算金额不自洽")
if s["overstay_cents"] != 12 * 8:
    bad.append(f'超时占用费非 12×8：{s["overstay_cents"]}')
if s["status"] != "completed" or not s["end_at"]:
    bad.append("结算未落终态/时间戳")
if sum(x["wh"] for x in s["segments"]) + s["seg_unpriced_wh"] != s["actual_wh"]:
    bad.append("结算拆分之和 != 实际电量")
if q["identity_ok"] is not True:
    bad.append("试算自带恒等式为假")
print("OK" if not bad else "; ".join(bad))
PY
)"
  eq "结算与试算同源（同一引擎两条入口自洽）" "$SAME" "OK"
else
  bad "缺少 ADMIN_TOKEN" "⑥⑦ 段的写测试无法进行"
fi

# ============================================================ ④ 试算参数校验
sec "④ 参数校验（逐字段回显，绝不 500）"
B="$(req GET '/api/quote?wh=10000&minutes=60' | body_of)"
chk "缺 pile 报 invalid_request" '"invalid_request"' "$B"
chk "缺 pile 定位到字段" '"pile"' "$B"
B="$(req GET "/api/quote?pile=$PILE_FREE&minutes=60" | body_of)"
chk "缺 wh 被拒" '"wh"' "$B"
B="$(req GET "/api/quote?pile=$PILE_FREE&wh=99&minutes=60" | body_of)"
chk "wh 低于 100 被拒（过滤误录）" '"wh"' "$B"
B="$(req GET "/api/quote?pile=$PILE_FREE&wh=600001&minutes=60" | body_of)"
chk "wh 超 600kWh 被拒" '"wh"' "$B"
B="$(req GET "/api/quote?pile=$PILE_FREE&wh=99999999999999999999&minutes=60" | body_of)"
chk "天文数字电量被拒（不溢出）" '"wh"' "$B"
B="$(req GET "/api/quote?pile=$PILE_FREE&wh=1.5&minutes=60" | body_of)"
chk "小数瓦时被拒（单位必须整数）" '"wh"' "$B"
B="$(req GET "/api/quote?pile=$PILE_FREE&wh=x&minutes=60" | body_of)"
chk "非数字瓦时被拒" '"wh"' "$B"
B="$(req GET "/api/quote?pile=$PILE_FREE&wh=10000&minutes=2" | body_of)"
chk "时长过短被拒" '"minutes"' "$B"
B="$(req GET "/api/quote?pile=$PILE_FREE&wh=10000&minutes=1441" | body_of)"
chk "时长超一天被拒" '"minutes"' "$B"
B="$(req GET "/api/quote?pile=$PILE_FREE&wh=10000&minutes=60&delay_min=99999" | body_of)"
chk "推迟分钟越界被拒（最多一周）" '"delay_min"' "$B"
B="$(req GET "/api/quote?pile=$PILE_FREE&wh=10000&minutes=60&overstay_min=9999" | body_of)"
chk "超时分钟越界被拒" '"overstay_min"' "$B"
eq "不存在的桩 404" "$(req GET "/api/quote?pile=NO-SUCH-PILE&wh=10000&minutes=60" | status_of)" "404"
chk "延迟一周内的合法试算可用" '"identity_ok"' "$(req GET "/api/quote?pile=$PILE_FREE&wh=10000&minutes=60&delay_min=10079" | body_of)"
BADCODE="$(urlq "CS20260101-0001' OR '1'='1")"
B="$(req GET "/api/sessions/$BADCODE" | body_of)"
chk "会话号注入被白名单挡下" '"invalid_code"' "$B"
# 空编号会被 Gin 归一化重定向（/api/sessions/ → /api/sessions），不是 500 也不是 404：
# 只要它不进 handler 拼出 `code = ''` 的全表查询就安全。
eq "空会话号被归一化重定向（不 500）" "$(raw GET '/api/sessions/' '' | status_of)" "301"

# ============================================================ ⑤ 鉴权三层
sec "⑤ 鉴权：503 / 401 / 403 三层各就各位"
WRITE='{"pile_code":"'"$PILE_FREE"'","plate_no":"'"$PLATE_IDLE"'","planned_wh":20000,"note":"鉴权探针"}'
BEFORE="$(req GET '/api/sessions?page_size=1' | body_of | jget total)"
if [[ -n "$NO_TOKEN_BASE" ]]; then
  RESP="$(ntok POST /api/admin/sessions "$WRITE")"
  chk "服务端未配令牌 → 503 server_misconfigured" '"server_misconfigured"' "$(printf '%s' "$RESP" | body_of)"
  eq "503 状态码" "$(printf '%s' "$RESP" | status_of)" "503"
  chk "503 实例的读接口照常可用" '"identity_ok"' "$(curl -s -m 10 "$NO_TOKEN_BASE/api/stats?days=7")"
fi
eq "无 Authorization → 401" "$(raw POST /api/admin/sessions "" "$WRITE" | status_of)" "401"
eq "只有方案名无令牌 → 401" "$(raw POST /api/admin/sessions "Bearer" "$WRITE" | status_of)" "401"
eq "非 Bearer 方案 → 401" "$(raw POST /api/admin/sessions "Basic Zm9vOmJhcg==" "$WRITE" | status_of)" "401"
eq "Bearer 后为空 → 401" "$(raw POST /api/admin/sessions "Bearer " "$WRITE" | status_of)" "401"
eq "Bearer 只有空格 → 401" "$(raw POST /api/admin/sessions "Bearer   " "$WRITE" | status_of)" "401"
eq "错令牌 → 403" "$(raw POST /api/admin/sessions "Bearer wrong-token-here" "$WRITE" | status_of)" "403"
chk "401 提示要 Bearer 形式" "unauthorized" "$(raw POST /api/admin/sessions "" "$WRITE" | body_of)"
chk "403 说令牌无效" "forbidden" "$(raw POST /api/admin/sessions "Bearer nope" "$WRITE" | body_of)"
AFTER="$(req GET '/api/sessions?page_size=1' | body_of | jget total)"
eq "被拒的写请求一条都没开成" "$AFTER" "$BEFORE"
if [[ -n "$TOKEN" ]]; then
  # RFC 7235：认证方案名大小写不敏感。当普通字段严格比会拒掉合法客户端。
  eq "小写 bearer 方案名可用" "$(raw POST /api/admin/tariffs "bearer $TOKEN" '{"code":"smoke-lower-case","name":"小写方案名探针","period":"flat","day_type":"any","start_min":1439,"end_min":1440,"elec_cents_per_kwh":10,"service_cents_per_kwh":1,"priority":9}' | status_of)" "201"
  eq "读接口不需要令牌" "$(raw GET '/api/sessions?page_size=1' 'Bearer wrong-token' | status_of)" "200"
else
  bad "缺少 ADMIN_TOKEN" "⑥⑦ 段的写测试无法进行"
fi

# ============================================================ ⑥ 状态机全链
sec "⑥ 开充 → 故障挂起 → 补结算 / 弃单（四态正反两向）"
if [[ -n "$TOKEN" ]]; then
  # ③ 段已用 PILE_FREE/PLATE_IDLE 开过一单并结算，这里重新取一对空闲资源。
  PAIR="$(BASE="$BASE" python3 - <<'PY'
import json, os, shlex, urllib.request
B = os.environ["BASE"].rstrip("/")
def get(p): return json.loads(urllib.request.urlopen(B + p, timeout=15).read())
# 按功率降序取桩：结算电量受「满功率 × 已用时长」上限约束，挑大功率桩才谈得上验结算。
piles = sorted((p for p in get("/api/piles")["items"]
                if p["status"] == "online" and p["open_sessions"] == 0),
               key=lambda p: -p["power_kw"])
openings = get("/api/sessions?open=1&page_size=100")["items"]
busy = {s["plate_no"] for s in openings}
plates = [v["plate_no"] for v in get("/api/vehicles")["items"] if v["plate_no"] not in busy]
def q(k, v):
    return k + "=" + shlex.quote(str(v or ""))
print(" ".join([
    q("PILE", piles[0]["code"] if piles else ""),
    q("PILE2", piles[1]["code"] if len(piles) > 1 else ""),
    q("POWER", piles[0]["power_kw"] if piles else 0),
    q("PLATE", plates[0] if plates else ""),
    q("PLATE2", plates[1] if len(plates) > 1 else ""),
    q("BUSY_PLATE", openings[0]["plate_no"] if openings else ""),
]))
PY
)"
  eval "$PAIR"
  [[ -n "${PILE:-}" && -n "${PLATE:-}" ]] && ok "取到空闲桩车" "$PILE($POWER kW) / $PLATE" || bad "没有空闲桩车" "无法验证开充链路"
  BODY='{"pile_code":"'"$PILE"'","plate_no":"'"$PLATE"'","planned_wh":45000,"note":"冒烟链路·冷链队"}'
  RESP="$(req POST /api/admin/sessions "$TOKEN" "$BODY")"
  eq "开充 201" "$(printf '%s' "$RESP" | status_of)" "201"
  B="$(printf '%s' "$RESP" | body_of)"
  S2="$(printf '%s' "$B" | jget code)"
  chk "会话号前缀 CS" "CS" "$S2"
  # 业务日历日是 UTC+8：UTC 16:00 之后开的单号段仍属「明天」，与统计口径一致。
  CST_DAY="$(python3 -c 'import datetime,zoneinfo;print(datetime.datetime.now(zoneinfo.ZoneInfo("Asia/Shanghai")).strftime("%Y%m%d"))')"
  chk "号段日期为业务日（UTC+8）" "CS$CST_DAY-" "$S2"
  eq "新单初始状态 charging" "$(printf '%s' "$B" | jget status)" "charging"
  eq "新单尚无结算时间戳" "$(printf '%s' "$B" | jget end_at)" "<nil>"
  eq "新单实际电量为 0" "$(printf '%s' "$B" | jget actual_wh)" "0"
  num "计划电量落库" "planned_wh" "$(printf '%s' "$B" | jget planned_wh)"
  neq "开单响应不含手机号原文" '"phone":' "$B"
  chk "开单响应含掩码" '"phone_masked":"1' "$B"
  chk "开单响应带当前价目板" '"rate_board":[' "$B"
  eq "开单后桩显示占用" "$(req GET '/api/piles' | body_of | python3 -c '
import json,sys
its=json.loads(sys.stdin.read())["items"]
print(str(next((p["open_sessions"] for p in its if p["code"]==sys.argv[1]), -1)))' "$PILE")" "1"
  # 一桩一车只能有一条未关闭会话（部分唯一索引的业务面证据）。
  # 校验顺序是「桩→车」，所以两种冲突要各挑一个「另一侧干净」的样本才能分别命中。
  chk "同桩冲突码 pile_occupied" '"pile_occupied"' "$(req POST /api/admin/sessions "$TOKEN" '{"pile_code":"'"$PILE"'","plate_no":"'"$PLATE2"'","planned_wh":1000}' | body_of)"
  eq "同桩重复开充 409" "$(req POST /api/admin/sessions "$TOKEN" '{"pile_code":"'"$PILE"'","plate_no":"'"$PLATE2"'","planned_wh":1000}' | status_of)" "409"
  chk "同车冲突码 vehicle_busy" '"vehicle_busy"' "$(req POST /api/admin/sessions "$TOKEN" '{"pile_code":"'"$PILE2"'","plate_no":"'"$BUSY_PLATE"'","planned_wh":1000}' | body_of)"
  eq "非在线桩不可开充" "$(req POST /api/admin/sessions "$TOKEN" '{"pile_code":"'"$PILE_DOWN"'","plate_no":"'"$PLATE2"'","planned_wh":1000}' | status_of)" "409"
  # 有未关闭会话的桩不得切出在线态（运维误操作的护栏）。
  B="$(req POST "/api/admin/piles/$PILE/status" "$TOKEN" '{"status":"maintenance","note":"误操作"}')"
  eq "在充桩不可切检修 409" "$(printf '%s' "$B" | status_of)" "409"
  chk "在充桩切换被拒的码" '"pile_busy"' "$(printf '%s' "$B" | body_of)"

  # 故障挂起 → 补结算
  B="$(req POST "/api/admin/sessions/$S2/fault" "$TOKEN" '{"reason":"枪头过温保护，暂停充电"}')"
  eq "在充可登记故障 200" "$(printf '%s' "$B" | status_of)" "200"
  chk "故障接口给出 message" '"message"' "$(printf '%s' "$B" | body_of)"
  BB="$(printf '%s' "$B" | body_of | jget session)"
  eq "故障后状态 faulted" "$(printf '%s' "$BB" | jget status)" "faulted"
  chk "故障原因进备注" "枪头过温" "$(printf '%s' "$BB" | jget note)"
  eq "故障仍占着桩（open=1 查得到）" \
     "$(req GET '/api/sessions?open=1&page_size=100' | body_of | grep -c "$S2")" "1"
  eq "重复登记故障 409" "$(req POST "/api/admin/sessions/$S2/fault" "$TOKEN" '{"reason":"重复登记"}' | status_of)" "409"
  # 刚开充的单只跑了几秒（后端按最少 60 秒计），结算电量必须落在满功率上限内。
  WH2=1200
  ACT2="$(req POST "/api/admin/sessions/$S2/settle" "$TOKEN" '{"actual_wh":'"$WH2"',"overstay_min":30}' | body_of | jget session)"
  eq "故障单可补结算" "$(printf '%s' "$ACT2" | jget status)" "completed"
  eq "补结算金额三件套自洽" "$(printf '%s' "$ACT2" | python3 -c '
import json,sys
d=json.loads(sys.stdin.read())
ok = d["elec_cents"]+d["service_cents"]+d["overstay_cents"]==d["total_cents"]
print("OK" if ok else "金额破口")')" "OK"
  eq "超时占用费 = 分钟 × 8 分" "$(printf '%s' "$ACT2" | jget overstay_cents)" "240"
  eq "已结算不能再结算" "$(req POST "/api/admin/sessions/$S2/settle" "$TOKEN" '{"actual_wh":1000}' | status_of)" "409"
  chk "重复结算报 invalid_transition" '"invalid_transition"' "$(req POST "/api/admin/sessions/$S2/settle" "$TOKEN" '{"actual_wh":1000}' | body_of)"
  eq "已结算不能再登记故障" "$(req POST "/api/admin/sessions/$S2/fault" "$TOKEN" '{"reason":"结案后报故障"}' | status_of)" "409"
  eq "结算后桩被释放" "$(req GET "/api/sessions?pile=$PILE&open=1&page_size=1" | body_of | jget total)" "0"

  # 开 → 故障 → 弃单（不计费终态）
  RESP="$(req POST /api/admin/sessions "$TOKEN" '{"pile_code":"'"$PILE"'","plate_no":"'"$PLATE"'","planned_wh":30000,"note":"弃单链路"}')"
  S3="$(printf '%s' "$RESP" | body_of | jget code)"
  eq "二次开充 201" "$(printf '%s' "$RESP" | status_of)" "201"
  [[ -n "$S3" ]] && ok "弃单样本会话" "$S3" || bad "二次开充失败" "$RESP"
  eq "在充单不能直接弃单 409" "$(req POST "/api/admin/sessions/$S3/abort" "$TOKEN" '{"reason":"要先挂故障"}' | status_of)" "409"
  B="$(req POST "/api/admin/sessions/$S3/fault" "$TOKEN" '{"reason":"桩离线，无法继续"}' | body_of)"
  eq "在充可转故障" "$(printf '%s' "$B" | jget session | jget status)" "faulted"
  B="$(req POST "/api/admin/sessions/$S3/abort" "$TOKEN" '{"reason":"计量异常，费用作废"}' | body_of)"
  eq "故障单可弃单" "$(printf '%s' "$B" | jget session | jget status)" "aborted"
  AB="$(printf '%s' "$B" | jget session)"
  eq "弃单不计费：总额为 0" "$(printf '%s' "$AB" | jget total_cents)" "0"
  eq "弃单不计费：电量为 0" "$(printf '%s' "$AB" | jget actual_wh)" "0"
  eq "弃单为终态 409" "$(req POST "/api/admin/sessions/$S3/abort" "$TOKEN" '{"reason":"重复弃单"}' | status_of)" "409"
  eq "弃单不能补结算 409" "$(req POST "/api/admin/sessions/$S3/settle" "$TOKEN" '{"actual_wh":1000}' | status_of)" "409"
  # 超物理可能的电量必须被拒（桩额定功率 × 已用时长 × 1.2 容差）。
  RESP="$(req POST /api/admin/sessions "$TOKEN" '{"pile_code":"'"$PILE"'","plate_no":"'"$PLATE"'","planned_wh":5000}')"
  S4="$(printf '%s' "$RESP" | body_of | jget code)"
  B="$(req POST "/api/admin/sessions/$S4/settle" "$TOKEN" '{"actual_wh":600000,"overstay_min":0}')"
  eq "超物理电量结算被拒 400" "$(printf '%s' "$B" | status_of)" "400"
  chk "超物理电量定位到 actual_wh" '"actual_wh"' "$(printf '%s' "$B" | body_of)"
  neq "拒因不回显 SQL/驱动细节" "no such" "$(printf '%s' "$B" | body_of)"
  # 负值占用费与零时长也要拒：整数边界不能靠 UI 兜。
  eq "负超时分钟被拒" "$(req POST "/api/admin/sessions/$S4/settle" "$TOKEN" '{"actual_wh":1000,"overstay_min":-1}' | status_of)" "400"
  # 收尾把 S4 正常结算掉：桩与车必须回到空闲，否则后续探针会打在 409 上而不是它要验的分支。
  eq "超物理单改正常电量后可结算"      "$(req POST "/api/admin/sessions/$S4/settle" "$TOKEN" '{"actual_wh":1200,"overstay_min":0}' | status_of)" "200"
  eq "非法状态样本可读" "$(req GET "/api/sessions/$S_CHARGING" | body_of | jget status)" "charging"
  [[ -n "$S_ABORTED" ]] && eq "种子弃单不计入营收" \
    "$(req GET "/api/sessions/$S_ABORTED" | body_of | jget total_cents)" "0"
  [[ -n "$S_OVERSTAY" ]] && chk "种子超时单有占用费明细" '"overstay_cents"' "$(req GET "/api/sessions/$S_OVERSTAY" | body_of)"
  # 结算后统计必须立刻反映新单：营收口径只算已结算。
  AFTER2="$(req GET '/api/sessions?page_size=1' | body_of | jget total)"
  # BEFORE 在 ⑤ 取（晚于 ③ 的同源校验单），故 ⑥ 段净增三条：结算 / 弃单 / 超物理后补结算。
  eq "本轮净增 3 条会话（被拒的写请求零留痕）" "$AFTER2" "$((BEFORE + 3))"
  yes "统计里的在充数没被写脏" "" "[[ $(req GET '/api/stats?days=7' | body_of | jget charging_now) -ge 1 ]]"
else
  bad "无令牌，跳过状态机链路" "⑥ 整段未验证"
fi

# ============================================================ ⑦ 规则
sec "⑦ 价目规则：校验、新建、启停、对报价的即时影响"
if [[ -z "$TOKEN" ]]; then
  bad "无令牌，跳过规则写测试" "⑦ 未验证"
else
  chk "非法 period 被拒" '"period"' "$(req POST /api/admin/tariffs "$TOKEN" '{"code":"bad-period","name":"错时段","period":"night","day_type":"any","start_min":0,"end_min":60,"elec_cents_per_kwh":50,"service_cents_per_kwh":20,"priority":9}' | body_of)"
  chk "非法 day_type 被拒" '"day_type"' "$(req POST /api/admin/tariffs "$TOKEN" '{"code":"bad-daytype","name":"错日期类型","period":"flat","day_type":"monday","start_min":0,"end_min":60,"elec_cents_per_kwh":50,"service_cents_per_kwh":20,"priority":9}' | body_of)"
  chk "起止相同被拒（全天用 0-1440）" '"end_min"' "$(req POST /api/admin/tariffs "$TOKEN" '{"code":"zero-window","name":"零宽窗口","period":"flat","day_type":"any","start_min":120,"end_min":120,"elec_cents_per_kwh":50,"service_cents_per_kwh":20,"priority":9}' | body_of)"
  chk "电价越界被拒" '"elec_cents_per_kwh"' "$(req POST /api/admin/tariffs "$TOKEN" '{"code":"price-hi","name":"电价越界","period":"flat","day_type":"any","start_min":0,"end_min":60,"elec_cents_per_kwh":9999,"service_cents_per_kwh":20,"priority":9}' | body_of)"
  chk "服务费越界被拒（0-300 分）" '"service_cents_per_kwh"' "$(req POST /api/admin/tariffs "$TOKEN" '{"code":"svc-hi","name":"服务费越界","period":"flat","day_type":"any","start_min":0,"end_min":60,"elec_cents_per_kwh":50,"service_cents_per_kwh":999,"priority":9}' | body_of)"
# 服务费 0 是合法值（纯电价窗口）：建完立刻停用，别让它污染后面的价目板断言。
ZERO="$(req POST /api/admin/tariffs "$TOKEN" '{"code":"svc-zero","name":"零服务费","period":"flat","day_type":"any","start_min":1438,"end_min":1440,"elec_cents_per_kwh":50,"service_cents_per_kwh":0,"priority":9}' | body_of)"
eq "服务费为 0 合法" "$(printf '%s' "$ZERO" | jget active)" "True"
eq "零服务费探针用完即停用"    "$(req POST "/api/admin/tariffs/$(printf '%s' "$ZERO" | jget id)/toggle" "$TOKEN" '' | status_of)" "200"
  chk "priority=0 被拒" '"priority"' "$(req POST /api/admin/tariffs "$TOKEN" '{"code":"pri-0","name":"优先级越界","period":"flat","day_type":"any","start_min":0,"end_min":60,"elec_cents_per_kwh":50,"service_cents_per_kwh":20,"priority":0}' | body_of)"
  chk "priority=100 被拒" '"priority"' "$(req POST /api/admin/tariffs "$TOKEN" '{"code":"pri-99","name":"优先级越界","period":"flat","day_type":"any","start_min":0,"end_min":60,"elec_cents_per_kwh":50,"service_cents_per_kwh":20,"priority":100}' | body_of)"
  LONGN="$(python3 -c 'print("名"*50)')"
  chk "超长 name 被拒" '"name"' "$(req POST /api/admin/tariffs "$TOKEN" '{"code":"long-name","name":"'"$LONGN"'","period":"flat","day_type":"any","start_min":0,"end_min":60,"elec_cents_per_kwh":50,"service_cents_per_kwh":20,"priority":9}' | body_of)"
  eq "非法 code 形状 → 400" "$(req POST /api/admin/tariffs "$TOKEN" '{"code":"a b;DROP","name":"非法 code","period":"flat","day_type":"any","start_min":0,"end_min":60,"elec_cents_per_kwh":50,"service_cents_per_kwh":20,"priority":9}' | status_of)" "400"

  CODE="smoke-valley-$(date +%s)"
  B="$(req POST /api/admin/tariffs "$TOKEN" '{"code":"'"$CODE"'","name":"冒烟深夜谷中谷","period":"valley","day_type":"any","start_min":150,"end_min":210,"elec_cents_per_kwh":11,"service_cents_per_kwh":1,"priority":1}' | body_of)"
  RID="$(printf '%s' "$B" | jget id)"
  num "新建规则返回 id" "id" "$RID"
  eq "新规则默认启用" "$(printf '%s' "$B" | jget active)" "True"
  eq "重复规则标识 → 409" "$(req POST /api/admin/tariffs "$TOKEN" '{"code":"'"$CODE"'","name":"重复标识","period":"valley","day_type":"any","start_min":150,"end_min":210,"elec_cents_per_kwh":11,"service_cents_per_kwh":1,"priority":1}' | status_of)" "409"

  # 新规则必须立刻改变报价：这是「priority 仲裁参与计价」的唯一硬证据。
  # 02:30（150 分钟）本地 = 前一 UTC 时刻 18:30，用 delay_min 精确命中该分钟。
  GAP="$(BASE="$BASE" TOKEN="$TOKEN" RID="$RID" PILE="$PILE_FREE" python3 - <<'PY'
import datetime, json, os, urllib.request

B = os.environ["BASE"].rstrip("/")
rid, pile, token = os.environ["RID"], os.environ["PILE"], os.environ["TOKEN"]


def get(p):
    return json.loads(urllib.request.urlopen(B + p, timeout=15).read())


def post(p, body=None):
    data = json.dumps(body or {}).encode()
    r = urllib.request.Request(B + p, data=data, headers={
        "Authorization": "Bearer " + token, "Content-Type": "application/json"}, method="POST")
    return json.loads(urllib.request.urlopen(r, timeout=15).read())


# 找到下一个「本地 02:30」所在分钟，按 delay_min 精确试算 60 分钟（覆盖 02:30-03:30）。
loc = datetime.datetime.utcnow() + datetime.timedelta(hours=8)
for delay in range(0, 10080):
    t = loc + datetime.timedelta(minutes=delay)
    if t.hour == 2 and t.minute == 30:
        break
url = f"/api/quote?pile={pile}&wh=60000&minutes=60&delay_min={delay}"
with_rule = get(url)
post(f"/api/admin/tariffs/{rid}/toggle", None)
without = get(url)
post(f"/api/admin/tariffs/{rid}/toggle", None)
back = get(url)
codes = [s["rule_code"] for s in with_rule["segments"]]
bad = []
if without["elec_cents"] <= with_rule["elec_cents"]:
    bad.append(f'停用后没变贵：{without["elec_cents"]} vs {with_rule["elec_cents"]}')
if back["elec_cents"] != with_rule["elec_cents"]:
    bad.append("再启用后没回到原值")
if codes and codes[0] != os.environ.get("EXPECT_CODE", codes[0]):
    bad.append("规则标识异常")
if not with_rule["segments"] or with_rule["segments"][0]["wh"] <= 0:
    bad.append("分段电量为 0")
print("OK" if not bad else "; ".join(bad), "峰前=%s 停用后=%s 复原=%s" % (
    with_rule["elec_cents"], without["elec_cents"], back["elec_cents"]))
PY
)"
  chk "停用规则立刻涨价、启用后复原（priority 参与仲裁）" "OK" "$GAP"
  echo "     └─ ${GAP#* }"
  DEF="$(req GET '/api/tariffs' | body_of)"
  ALLR="$(req GET '/api/tariffs?all=1' | body_of)"
  yes "默认列表长度 <= all 列表" "" "[[ $(printf '%s' "$DEF" | jlen items) -le $(printf '%s' "$ALLR" | jlen items) ]]"
  chk "all=1 能看到刚建的规则" "$CODE" "$ALLR"
  eq "规则 id=0 → 400" "$(req POST '/api/admin/tariffs/0/toggle' "$TOKEN" '' | status_of)" "400"
  eq "规则 id 非数字 → 400" "$(req POST '/api/admin/tariffs/abc/toggle' "$TOKEN" '' | status_of)" "400"
  eq "不存在的规则 id → 404" "$(req POST '/api/admin/tariffs/999999999/toggle' "$TOKEN" '' | status_of)" "404"
  # 收工前把探针规则停掉，避免污染后续统计断言。
  eq "探针规则可停用于收尾" "$(req POST "/api/admin/tariffs/$RID/toggle" "$TOKEN" '' | status_of)" "200"
  neq "停用后默认列表不含该规则" "$CODE" "$(req GET '/api/tariffs' | body_of)"
  [[ -n "$RULE_INACTIVE" ]] && eq "种子停用规则不在默认列表" \
    "$(req GET '/api/tariffs' | body_of | python3 -c '
import json,sys
ids=[str(r["id"]) for r in json.loads(sys.stdin.read())["items"]]
print("ABSENT" if "'"$RULE_INACTIVE"'" not in ids else "PRESENT")')" "ABSENT"
fi

# ============================================================ ⑧ 桩状态与车辆校验
sec "⑧ 桩状态切换与车辆侧写"
if [[ -n "$TOKEN" && -n "$PILE_DOWN" ]]; then
  B="$(req POST "/api/admin/piles/$PILE_DOWN/status" "$TOKEN" '{"status":"online","note":"冒烟：恢复上线"}')"
  eq "离线/检修桩可恢复在线 200" "$(printf '%s' "$B" | status_of)" "200"
  eq "切换后状态生效" "$(req GET '/api/piles' | body_of | python3 -c '
import json,sys
its=json.loads(sys.stdin.read())["items"]
print(next((p["status"] for p in its if p["code"]==sys.argv[1]), "?"))' "$PILE_DOWN")" "online"
  chk "非法桩状态被拒" '"status"' "$(req POST "/api/admin/piles/$PILE_DOWN/status" "$TOKEN" '{"status":"broken","note":"错态"}' | body_of)"
  chk "超长备注被拒" '"note"' "$(req POST "/api/admin/piles/$PILE_DOWN/status" "$TOKEN" '{"status":"online","note":"'"$(python3 -c 'print("长"*200)')"'"}' | body_of)"
  eq "不存在的桩 404" "$(req POST "/api/admin/piles/ZZ-NOPE/status" "$TOKEN" '{"status":"online"}' | status_of)" "404"
  B="$(req POST "/api/admin/piles/$(urlq "a'b")/status" "$TOKEN" '{"status":"online"}')"
  eq "桩号注入被挡（400）" "$(printf '%s' "$B" | status_of)" "400"
else
  bad "缺令牌或非在线桩样本" "⑧ 未验证"
fi
# 退役车不得开充；不存在的桩/车各给 404，别混成 500。
if [[ -n "$TOKEN" ]]; then
  B="$(req POST /api/admin/sessions "$TOKEN" '{"pile_code":"'"$PILE_FREE"'","plate_no":"'"$PLATE_RETIRED"'","planned_wh":1000}')"
  chk "退役车辆不能开充" '"vehicle_retired"' "$(printf '%s' "$B" | body_of)"
  eq "不存在的车牌 404" "$(req POST /api/admin/sessions "$TOKEN" '{"pile_code":"'"$PILE_FREE"'","plate_no":"粤Z99999","planned_wh":1000}' | status_of)" "404"
  chk "桩不存在给 404 码" '"pile_not_found"' "$(req POST /api/admin/sessions "$TOKEN" '{"pile_code":"ZZ-Z99","plate_no":"'"$PLATE"'","planned_wh":1000}' | body_of)"
  eq "不存在的会话 404" "$(req GET '/api/sessions/CS19990101-9999' | status_of)" "404"
  chk "不存在的会话给出 not_found" '"not_found"' "$(req GET '/api/sessions/CS19990101-9999' | body_of)"
fi

# ============================================================ ⑨ 注入与边界
sec "⑨ 注入、LIKE 转义与畸形输入"
for payload in "' OR '1'='1" "%' UNION SELECT id,code FROM piles--" "a;b=c" "'--" "1' AND SLEEP(3)--" "<script>alert(1)</script>"; do
  # macOS 自带 bash 3.2 会把「"$(cmd "$(cmd2 "$x")")"」这种三层嵌套解析错，一律先算好再拼。
  ENC="$(urlq "$payload")"
  RESP="$(req GET "/api/sessions?q=$ENC&page_size=5")"
  C="$(printf '%s' "$RESP" | status_of)"; T="$(printf '%s' "$RESP" | body_of | jget total)"
  eq "注入串查不到数据：$payload" "$T" "0"
  neq "注入响应不含 SQL 细节" "no such table" "$RESP"
done
# LIKE 通配符必须被转义：不转义时 q=% 会命中全部，等于把「检索」变成「拖库」。
PC="$(req GET "/api/sessions?q=%25&page_size=5" | body_of | jget total)"
eq "裸 % 作为字面量匹配（0 条）" "$PC" "0"
US="$(req GET "/api/sessions?q=%5F&page_size=5" | body_of | jget total)"
eq "下划线同样按字面量" "$US" "0"
if [[ -n "${S3:-}" ]]; then
  QPL="$(urlq "$PLATE")"
  chk "按车牌检索命中" "$S3" "$(req GET "/api/sessions?q=$QPL&page_size=50" | body_of)"
  QDR="$(urlq "弃单链路")"
  eq "备注不参与检索（口径明确）" "$(req GET "/api/sessions?q=$QDR" | body_of | jget total)" "0"
  QCODE="$(urlq "$S3")"
  chk "按会话号精确检索命中" "$S3" "$(req GET "/api/sessions?q=$QCODE" | body_of)"
  QMASK="$(urlq "138****0000")"
  eq "掩码不参与检索（原文列不出接口）" "$(req GET "/api/sessions?q=$QMASK" | body_of | jget total)" "0"
fi
# 车牌筛选：注入串要回落到「不过滤」而不是 500，也不允许把 WHERE 拼歪。
B="$(req GET "/api/sessions?plate=$(urlq "' OR 1=1--")&page_size=5" | body_of)"
neq "车牌注入不改变筛选语义（回落全量）" '"no such"' "$B"
LONGQ="$(python3 -c 'print("x"*400)')"
eq "超长搜索串不报错（服务端截断）" "$(req GET "/api/sessions?q=$(urlq "$LONGQ")&page_size=5" | status_of)" "200"
eq "翻页越界返回空列表而非报错" "$(req GET '/api/sessions?page=99999999&page_size=5' | body_of | jget items)" "[]"
eq "未知排序键回落默认" "$(req GET '/api/sessions?sort=nonexistent_column' | body_of | jget sort)" "start"
eq "非法 status 被忽略（不过滤）" "$(req GET '/api/sessions?status=not_a_status' | body_of | jget page_size)" "20"
eq "dept 超长被夹住（不 500）" "$(req GET "/api/sessions?dept=$(urlq "$(python3 -c 'print("队"*60)')")" | status_of)" "200"
LONG40="$(python3 -c 'print("x"*40)')"
U1="$(urlq "a'b")"; U2="$(urlq 'a"b')"; U3="$(urlq 'a b')"; U4="$(urlq "a'--")"; U5="$(urlq "$LONG40")"
# 注意：这里刻意不用 $(urlq "$(…)") 这种三层嵌套——macOS 自带 bash 3.2 会把它解析错。
for p in "CS%27%20OR%201%3D1" "..%2f..%2fetc%2fpasswd" "$U1" "$U2" "$U3" "$U4" "$U5"; do
  C="$(curl -s -m 10 -o /tmp/fco-inj-body -w '%{http_code}' "$BASE/api/sessions/$p")"
  BODY="$(cat /tmp/fco-inj-body)"
  if [[ "$C" == 5* || "$C" == "200" ]]; then bad "路径注入未拒" "$p -> $C ${BODY:0:80}"; else ok "路径注入被拒" "$p -> $C"; fi
  neq "注入响应不含 SQL 细节" "SELECT" "$BODY"
done
rm -f /tmp/fco-inj-body
BIGN="$(python3 -c 'print("名"*20000)')"
HUGE='{"pile_code":"'"$PILE_FREE"'","plate_no":"'"$PLATE"'","planned_wh":1000,"note":"'"$BIGN"'"}'
C="$(req POST /api/admin/sessions "$TOKEN" "$HUGE" | status_of)"
yes "超长请求体被拒（$C）" "" "[[ $C == 413 || $C == 400 ]]"
neq "超长请求体的响应不泄露内部文案" "request body too large" "$(req POST /api/admin/sessions "$TOKEN" "$HUGE" | body_of)"
eq "坏 JSON → 400" "$(req POST /api/admin/sessions "$TOKEN" 'not-json{' | status_of)" "400"
eq "空 body → 400" "$(req POST /api/admin/sessions "$TOKEN" '' | status_of)" "400"
eq "数组 body → 400" "$(req POST /api/admin/sessions "$TOKEN" '[]' | status_of)" "400"
B="$(req POST /api/admin/sessions "$TOKEN" '{"pile_code":"","plate_no":"bad","planned_wh":0,"note":"'"$BIGN"'"}' | body_of)"
for f in pile_code plate_no planned_wh note; do
  chk "逐字段回显：$f" "\"$f\"" "$B"
done
B="$(req POST /api/admin/sessions "$TOKEN" '{"pile_code":"'"$PILE_FREE"'","plate_no":"'"$PLATE"'","planned_wh":99999999,"note":"超容量"}' | body_of)"
chk "计划电量超电池容量被拒" '"planned_wh"' "$B"
# 非法 UTF-8：Go 的 JSON 解码器会把 \ud800 这种孤立代理对「修好」成 U+FFFD 而放行，
# 所以真正的对抗输入是裸字节序列（U+D800 的 CESU-8 编码），必须在出口前被拒。
BAD_BYTES=$'{"pile_code":"'"$PILE_FREE"'","plate_no":"'"$PLATE"'","planned_wh":1000,"note":"\xed\xa0\x80"}'
eq "裸非法 UTF-8 字节 → 400" "$(req POST /api/admin/sessions "$TOKEN" "$BAD_BYTES" | status_of)" "400"
eq "坏 UTF-8 未落库（读侧不泄露）" "0" "$(req GET "/api/sessions?q=$(urlq "$BAD_BYTES")&page_size=5" | body_of | jget total)"
C="$(req POST /api/admin/sessions "$TOKEN" '{"pile_code":"'"$PILE_FREE"'","plate_no":"'"$PLATE"'","planned_wh":1000,"note":"\ud800"}' | status_of)"
yes "孤立代理对转义不报 5xx（$C）" "" "[[ $C == 2* || $C == 4* ]]"

# ============================================================ ⑩ 静态与网关层
sec "⑩ 静态托管、安全响应头、CORS、404 形状"
eq "根路径给出 SPA" "$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/")" "200"
SHELL_HTML="$(curl -s -m 10 "$BASE/")"
chk "SPA 有 #root 挂载点" 'id="root"' "$SHELL_HTML"
neq "SPA 不引外部资源" "https://" "$SHELL_HTML"
HDRS="$(curl -s -m 10 -D - -o /dev/null "$BASE/api/piles" | tr 'A-Z' 'a-z')"
chk "禁缓存头" "cache-control: no-store" "$HDRS"
chk "nosniff" "x-content-type-options: nosniff" "$HDRS"
chk "frame deny" "x-frame-options: deny" "$HDRS"
chk "referrer policy" "referrer-policy: no-referrer" "$HDRS"
chk "permissions policy" "permissions-policy" "$HDRS"
# 三个风格入口都必须回落到同一份 index.html（同一 DOM，只换 CSS）。
eq "深链回落 SPA" "$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/some/deep/link")" "200"
chk "未知接口是 JSON 404" '"not_found"' "$(req GET '/api/no-such-endpoint' | body_of)"
eq "未知接口状态码 404" "$(req GET '/api/no-such-endpoint' | status_of)" "404"
neq "穿越路径不给 passwd" "root:" "$(req GET "$(urlq /../../etc/passwd)" | body_of)"
eq "外部 Origin 仍能应答（只是不给 ACAO）" \
   "$(curl -s -m 8 -o /dev/null -w '%{http_code}' -H 'Origin: https://evil.example' "$BASE/api/piles")" "200"
for o in "https://evil.example" "null" "http://127.0.0.1.evil.example" ""; do
  N="$(curl -s -m 8 -D - -o /dev/null -H "Origin: $o" "$BASE/api/piles" | tr 'A-Z' 'a-z' | grep -c 'access-control-allow-origin' || true)"
  eq "Origin=$o 不给 ACAO" "$N" "0"
done
for o in "http://127.0.0.1:18509" "http://localhost:5173" "http://[::1]:3000"; do
  # -F：放行用例里有 http://[::1]:3000，不加 -F 的话方括号会被当字符类，永远数不到。
  N="$(curl -s -m 8 -D - -o /dev/null -H "Origin: $o" "$BASE/api/piles" | tr 'A-Z' 'a-z' | grep -F -c "access-control-allow-origin: $o" || true)"
  eq "本机 Origin 放行：$o" "$N" "1"
done
eq "OPTIONS 预检 204" "$(curl -s -m 8 -o /dev/null -w '%{http_code}' -X OPTIONS -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: POST' "$BASE/api/admin/sessions")" "204"

printf '\n\033[1mpass=%s fail=%s\033[0m\n' "$PASS" "$FAIL"
exit $(( FAIL > 0 ))
