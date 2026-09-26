#!/usr/bin/env bash
# 逐接口冒烟：真监听端口 + 真 curl，覆盖
#   读接口信封/分页上限/排序回显 / 手机号永不外泄 / 报价恒等式与库内快照逐字段一致 /
#   独立复算（脚本自己按线路参数再算一遍，不信任 Go 的自我证明）/
#   鉴权三层（503·401·403）+ 被拒写请求不留痕 / 八态状态机正反两向 /
#   附加费规则的即时生效与启停 / 注入、LIKE 转义与超长边界 / 静态托管、安全头、CORS、404 形状。
#
# 为什么 go test 之外还要这个脚本：go test 走 httptest 内存路由，
# 这里走真 HTTP + 真 SQLite，顺带验到 CORS、安全响应头、NoRoute JSON、SPA 兜底这些网关层行为。
#
# 用法：
#   BASE=http://127.0.0.1:18501 ADMIN_TOKEN=xxx \
#     [NO_TOKEN_BASE=http://127.0.0.1:18502] bash scripts/api-smoke.sh
#   （一般不直接跑，用 scripts/run-smoke.sh 在全新种子库上起实例。）
#
# 注意：**会真写库**（开单、推进、登记异常、建规则、启停规则），只对着 /tmp 上的一次性实例跑；
# 因此单文件 preview 必须由另一个刚灌完种子的实例生成，不能用本脚本跑过的库。
# 样本（运单号、线路码、规则 ID）全部从接口反查（见 ⓪），脚本不猜常量。
set -uo pipefail

BASE="${BASE:-http://127.0.0.1:18501}"
TOKEN="${ADMIN_TOKEN:-}"
NO_TOKEN_BASE="${NO_TOKEN_BASE:-}"
PASS=0
FAIL=0
# ⑥⑦ 段之间靠这几个「本轮新开的单」串联；即便 ⑥ 因缺令牌而跳过，
# 后面的引用在 set -u 下也不能踩到未定义变量。
W1=""

ok()   { PASS=$((PASS+1)); printf '  ok   %s%s\n' "$1" "${2:+ — ${2:0:90}}"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s%s\n' "$1" "${2:+${2:0:200}}"; }
chk()  { if [[ "$3" == *"$2"* ]]; then ok "$1" "$3"; else bad "$1" "期望含「$2」实际「$3」"; fi; }
neq()  { if [[ "$3" != *"$2"* ]]; then ok "$1" "不含「$2」"; else bad "$1" "不应含「$2」，实际「${3:0:160}」"; fi; }
num()  { if [[ "$3" =~ ^-?[0-9]+$ ]]; then ok "$1" "$2=$3"; else bad "$1" "期望整数 $2，实际「$3」"; fi; }
# eq：把取值本身打出来，方便一眼分清「真的相等」和「两边都是空串的假绿」。
eq()   { if [[ -n "$2" && "$2" == "$3" ]]; then ok "$1" "$2"; else bad "$1" "期望「$3」实际「$2」"; fi; }
# yes：断言一个 shell 条件，成功/失败都打印判据。
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
# 布尔取值统一成 1/0：接口给的是 JSON true/false，直接拼进 querystring 会大小写不匹配。
jbool() { local v="${1//[[:space:]]/}"; case "$v" in true|True) printf 1;; *) printf 0;; esac; }
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
rows = get("/api/waybills?page_size=100")["items"]
out["WB_ANY"] = rows[0]["code"] if rows else ""

# 状态样本一律走 status 筛选接口取：种子有上百张单，默认排序下 delivered/returned
# 很可能整页都不露脸，拿空样本去断言状态机等于假绿。
def pick(status):
    it = get(f"/api/waybills?status={status}&page_size=100")["items"]
    return it[0] if it else None

d = pick("delivered")
out["WB_DELIVERED"] = d["code"] if d else ""
e = pick("exception")
out["WB_EXC"] = e["code"] if e else ""
out["WB_OPEN"] = ""
for st in ("in_transit", "arrived", "picked_up", "out_for_delivery", "booked"):
    r = pick(st)
    if r:
        out["WB_OPEN"] = r["code"]
        break

# 泡货样本：本场景的核心机制是「体积重参与计费」，没有它等于什么都没验到。
bulky = [r for r in rows if r["volumetric_grams"] > r["weight_grams"]]
out["WB_BULKY"] = bulky[0]["code"] if bulky else ""
capped = [r for r in rows if r["surcharge_capped"]]
out["WB_CAPPED"] = capped[0]["code"] if capped else ""

lanes = get("/api/lanes?all=1")["items"]
act = [l for l in lanes if l["active"]]
out["LANE_OK"] = act[0]["code"] if act else ""
rem = [l for l in act if l["remote_area"]]
out["LANE_REMOTE"] = rem[0]["code"] if rem else ""
off = [l for l in lanes if not l["active"]]
out["LANE_OFF"] = off[0]["code"] if off else ""
# 复算样本要连线路参数一起带走，才谈得上「独立验证」而不是复读接口结论。
lk = next((l for l in act if l["code"] == out["LANE_OK"]), {})
for k in ("first_kg", "first_cents", "half_kg_cents", "min_cents", "fuel_pct", "vol_divisor"):
    out["LANE_" + k.upper()] = str(lk.get(k, ""))

rules = get("/api/rules?all=1")["items"]
by_kind = {}
for r in rules:
    by_kind.setdefault(r["kind"], r)
out["RULE_ID"] = str(rules[0]["id"]) if rules else ""
out["RULE_KINDS"] = ",".join(sorted(by_kind))
out["RULE_INACTIVE"] = str(next((r["id"] for r in rules if not r["active"]), ""))

print("\n".join(f"{k}={shlex.quote(str(v))}" for k, v in out.items()))
PY
)"
if [[ -z "$PROBE" ]]; then
  bad "样本反查" "探针无输出，后续断言无法进行"; printf '\npass=%s fail=%s\n' "$PASS" "$FAIL"; exit 1
fi
eval "$PROBE"
MISSING=""
for kv in WB_ANY LANE_OK LANE_FIRST_KG LANE_FIRST_CENTS LANE_HALF_KG_CENTS LANE_MIN_CENTS \
          LANE_FUEL_PCT LANE_VOL_DIVISOR RULE_ID RULE_KINDS; do
  [[ -n "${!kv}" ]] || MISSING="$MISSING $kv"
done
for kv in WB_DELIVERED WB_EXC WB_OPEN LANE_REMOTE; do
  [[ -n "${!kv}" ]] && ok "样本 $kv" "${!kv}" || bad "样本 $kv 为空" "种子覆盖不足或接口异常"
done
for kv in WB_BULKY WB_CAPPED LANE_OFF RULE_INACTIVE; do
  [[ -n "${!kv}" ]] && ok "加分样本 $kv" "${!kv}" || bad "加分样本 $kv 为空" "该机制在种子里没有实例，相关断言会打在空集上"
done
if [[ -n "$MISSING" ]]; then
  bad "必需样本缺失" "缺：$MISSING，后续断言无意义"; printf '\npass=%s fail=%s\n' "$PASS" "$FAIL"; exit 1
fi
for k in remote_pct heavy_piece fragile_flat long_haul_flat; do
  chk "四类规则齐全：$k" "$k" "$RULE_KINDS"
done

# ============================================================ ① 读接口骨架
sec "① 读接口：信封键名、分页上限、排序回显、统计口径"
RESP="$(req GET /api/health)"; eq "GET /api/health 200" "$(printf '%s' "$RESP" | status_of)" "200"
B="$(printf '%s' "$RESP" | body_of)"
chk "health 含 status ok" '"status":"ok"' "$B"
# /health 的时间是 UTC，不能拿它当业务日断言的依据（口径差 8 小时）。
chk "health 时间是 RFC3339 UTC" "Z" "$B"

B="$(req GET '/api/lanes' | body_of)"
chk "lanes 用 items 信封" '"items":[' "$B"
num "lanes total 是整数" "total" "$(printf '%s' "$B" | jget total)"
A_CNT="$(printf '%s' "$B" | jlen items)"
ALL_CNT="$(req GET '/api/lanes?all=1' | body_of | jlen items)"
if [[ -n "$LANE_OFF" ]]; then
  yes "有停售线路时默认列表更短" "" "[[ $A_CNT -lt $ALL_CNT ]]"
else
  eq "无停售线路时两个列表等长" "$A_CNT" "$ALL_CNT"
fi
chk "停售线路只出现在 all=1" "$LANE_OFF" "$(req GET '/api/lanes?all=1' | body_of)"
neq "默认列表不含停售线路" "$LANE_OFF" "$(req GET '/api/lanes' | body_of)"

B="$(req GET '/api/waybills?page_size=9999&sort=total&dir=asc' | body_of)"
eq "page_size 封顶 100" "$(printf '%s' "$B" | jget page_size)" "100"
# 回显必须是白名单键而不是内部列名：把 w.total_cents 发出去等于替攻击者画库表。
chk "排序回显为键名" '"sort":"total"' "$B"
neq "排序回显不含内部列名" '"sort":"w.' "$B"
chk "方向回显" '"dir":"asc"' "$B"
eq "page_size=0 回落默认 20" "$(req GET '/api/waybills?page=0&page_size=0' | body_of | jget page_size)" "20"
eq "page=0 回落第 1 页" "$(req GET '/api/waybills?page=0' | body_of | jget page)" "1"

# 种子不得写未来时刻：清晨跑最容易露馅——「今天 8~18 点」整段还在未来，
# 按下单时间倒序时新开的真单会被未来种子单压住，看板的「最近更新」也会显示明天。
FUUT="$(req GET '/api/waybills?page_size=100&sort=booked&dir=desc' | body_of | python3 -c '
import json,sys,datetime
d=json.loads(sys.stdin.read())
now=datetime.datetime.now(datetime.timezone.utc)
rs=[datetime.datetime.fromisoformat(r["booked_at"].replace("Z","+00:00")) for r in d["items"]]
future=[r.isoformat() for r in rs if r>now]
print("OK" if not future else "未来单: %s" % future[:3])')"
eq "列表里没有未来下单时间" "$FUUT" "OK"

# 每个排序键都要真执行且结果有序：指错列名会是 500，而「200 但没排序」是最常见的假绿。
for k in code total chargeable weight booked promised status lane pieces id; do
  ORDERED="$(req GET "/api/waybills?sort=$k&dir=desc&page_size=50" | body_of | python3 -c '
import json,sys
key={"code":"code","total":"total_cents","chargeable":"chargeable_grams","weight":"weight_grams",
     "promised":"promised_at","status":"status","lane":"lane_code","pieces":"piece_count",
     "booked":"booked_at","id":"id"}["'"$k"'"]
its=json.loads(sys.stdin.read())["items"]
vals=[r[key] for r in its]
srt=sorted(vals,reverse=True)
print("OK" if len(its)>1 and vals==srt else f"未降序：{vals[:3]} vs {srt[:3]}")')"
  eq "排序 $k 降序有效" "$ORDERED" "OK"
done

B="$(req GET '/api/stats?days=14' | body_of)"
chk "stats 含恒等式结论" '"identity_ok":true' "$B"
eq "stats 恒等式无告警" "$(printf '%s' "$B" | jget identity_issues)" "[]"
num "营收总额" "revenue_cents" "$(printf '%s' "$B" | jget revenue_cents)"
num "今日营收" "revenue_today_cents" "$(printf '%s' "$B" | jget revenue_today_cents)"
num "轨迹打卡总数" "event_count" "$(printf '%s' "$B" | jget event_count)"
num "泡货单数" "bulky_count" "$(printf '%s' "$B" | jget bulky_count)"
yes "泡货单数 > 0（体积计费真的在生效）" "" "[[ $(printf '%s' "$B" | jget bulky_count) -gt 0 ]]"
eq "趋势按天稠密补齐" "$(printf '%s' "$B" | jlen daily)" "14"
chk "口径说明写明剔除已退回" "剔除已退回" "$B"
# 状态分布必须覆盖八态（含 0 单的状态也要出现），否则前端图例会缺项。
ST="$(printf '%s' "$B" | jget by_status)"
for s in booked picked_up in_transit arrived out_for_delivery delivered exception returned; do
  chk "状态分布含 $s" "\"$s\"" "$ST"
done
P="$(printf '%s' "$B" | jget on_time_pct)"
awk -v p="$P" 'BEGIN{exit !(p>=0 && p<=100)}' && ok "准点率在 0-100" "$P" || bad "准点率越界" "$P"
for bad_days in 0 -5 abc 99999; do
  R="$(req GET "/api/stats?days=$bad_days" | status_of)"
  D="$(req GET "/api/stats?days=$bad_days" | body_of | jlen daily)"
  yes "days=$bad_days 被夹到合理区间" "" "[[ $R == 200 && $D -ge 7 && $D -le 30 ]]"
done

# ============================================================ ② 隐私
sec "② 手机号：只出掩码，原文永不出接口"
B="$(req GET '/api/waybills?page_size=100' | body_of)"
neq "列表不含 phone 字段" '"phone":' "$B"
M="$(printf '%s' "$B" | jget 'items.0.phone_masked')"
if [[ "$M" =~ ^1[0-9]{2}\*{4}[0-9]{4}$ ]]; then ok "掩码形状正确" "$M"; else bad "掩码形状异常" "$M"; fi
neq "列表不给轨迹明细（那是另一个接口）" '"events":' "$B"
D="$(req GET "/api/waybills/$WB_ANY" | body_of)"
neq "详情不含 phone 字段" '"phone":' "$D"
chk "详情含 events" '"events":[' "$D"
chk "详情含掩码" '"phone_masked"' "$D"
# 掩码必须与库内原文对得上：只能靠新建单已知手机号来验。

# ============================================================ ③ 报价：恒等式 + 快照一致 + 独立复算
sec "③ 报价与落库快照同源（单一定价引擎）"
Q_W="$(printf '%s' "$D" | jget weight_grams)"
Q_V="$(printf '%s' "$D" | jget volume_cm3)"
Q_H="$(printf '%s' "$D" | jget heaviest_piece_g)"
Q_C="$(printf '%s' "$D" | jget declared_cents)"
Q_L="$(printf '%s' "$D" | jget lane_code)"
Q_F="$(jbool "$(printf '%s' "$D" | jget fragile)")"
Q="$(req GET "/api/quote?lane=$Q_L&weight_g=$Q_W&volume_cm3=$Q_V&heaviest_g=$Q_H&declared_cents=$Q_C&fragile=$Q_F" | body_of)"
for f in volumetric_grams chargeable_grams freight_cents fuel_cents insurance_cents surcharge_cents total_cents; do
  eq "试算与快照一致：$f" "$(printf '%s' "$Q" | jget $f)" "$(printf '%s' "$D" | jget $f)"
done
SUM=$(( $(printf '%s' "$Q" | jget freight_cents) + $(printf '%s' "$Q" | jget fuel_cents) \
      + $(printf '%s' "$Q" | jget insurance_cents) + $(printf '%s' "$Q" | jget surcharge_cents) ))
eq "恒等式：四项之和=总额" "$SUM" "$(printf '%s' "$Q" | jget total_cents)"
eq "报价自带 identity_ok" "$(printf '%s' "$Q" | jget identity_ok)" "True"

# 独立复算：脚本自己按线路参数再算一遍，不引用 Go 的任何结论。
RECALC="$(BASE="$BASE" python3 - "$LANE_OK" "$LANE_FIRST_KG" "$LANE_FIRST_CENTS" "$LANE_HALF_KG_CENTS" \
  "$LANE_MIN_CENTS" "$LANE_FUEL_PCT" "$LANE_VOL_DIVISOR" <<'PY'
import json, math, os, sys, urllib.request

lane = sys.argv[1]
fk, fc, half, mn, fuel_pct, div = (int(x) for x in sys.argv[2:8])
B = os.environ["BASE"].rstrip("/")
w = 7300                                    # 实际重量（克）
vol = 3 * w * div // 1000                   # 临界体积的 3 倍：必然按体积计费
q = json.loads(urllib.request.urlopen(
    f"{B}/api/quote?lane={lane}&weight_g={w}&volume_cm3={vol}&heaviest_g=3000", timeout=15).read())
step = 500
volumetric = math.ceil(vol * 1000 / div)
chargeable = int(math.ceil(max(w, volumetric) / step) * step)
first_g = fk * 1000
freight = fc if chargeable <= first_g else fc + math.ceil((chargeable - first_g) / step) * half
freight = max(freight, mn)
fuel = (freight * fuel_pct + 50) // 100     # 整数算法复现「四舍五入、.5 远离零」
want = {"volumetric_grams": volumetric, "chargeable_grams": chargeable,
        "freight_cents": freight, "fuel_cents": fuel,
        "insurance_cents": 0, "total_cents": freight + fuel}
bad = [f"{k}: 复算 {v} vs 接口 {q[k]}" for k, v in want.items() if q[k] != v]
print("OK" if not bad else "; ".join(bad))
PY
)"
eq "独立复算（体积重/取整/首重/续重/最低运费/燃油）" "$RECALC" "OK"

# 泡货必须按体积计费，否则本场景的核心机制只是文档里的故事。
D2="$(req GET "/api/waybills/$WB_BULKY" | body_of)"
yes "泡货体积重大于实际重" "" "(( $(printf '%s' "$D2" | jget volumetric_grams) > $(printf '%s' "$D2" | jget weight_grams) ))"
MOD=$(( $(printf '%s' "$D2" | jget chargeable_grams) % 500 ))
eq "计费重按 500g 向上取整（余数为 0）" "$MOD" "0"
yes "计费重不低于体积重" "" "(( $(printf '%s' "$D2" | jget chargeable_grams) >= $(printf '%s' "$D2" | jget volumetric_grams) ))"
eq "泡货按体积重计费" "$(printf '%s' "$D2" | python3 -c '
import json,sys
d=json.loads(sys.stdin.read())
print("OK" if d["chargeable_grams"]>=d["volumetric_grams"] and d["chargeable_grams"]>=d["weight_grams"] else "计费重取小了")')" "OK"

# 附加费封顶：封顶单的附加费不得超过运费（含燃油）的 80%。
CD="$(req GET "/api/waybills/$WB_CAPPED" | body_of)"
CF=$(( $(printf '%s' "$CD" | jget freight_cents) + $(printf '%s' "$CD" | jget fuel_cents) ))
CEIL=$(( CF * 80 / 100 ))
CS="$(printf '%s' "$CD" | jget surcharge_cents)"
eq "封顶单标记为已封顶" "$(printf '%s' "$CD" | jget surcharge_capped)" "True"
yes "封顶单附加费不超运费 80%（$CS <= $CEIL）" "" "[[ $CS -le $CEIL ]]"
# 保价下限 2 元：声明价值极低时仍收 200 分；不申报则一分不收。
LOW="$(req GET "/api/quote?lane=$LANE_OK&weight_g=2000&volume_cm3=0&heaviest_g=500&declared_cents=100" | body_of)"
eq "低声明价值仍按 200 分保底" "$(printf '%s' "$LOW" | jget insurance_cents)" "200"
HI="$(req GET "/api/quote?lane=$LANE_OK&weight_g=2000&volume_cm3=0&heaviest_g=500&declared_cents=1000000" | body_of)"
eq "高声明价值按 0.3% 计" "$(printf '%s' "$HI" | jget insurance_cents)" "3000"
ZERO="$(req GET "/api/quote?lane=$LANE_OK&weight_g=2000&volume_cm3=0&heaviest_g=500" | body_of)"
eq "无声明价值则无保价" "$(printf '%s' "$ZERO" | jget insurance_cents)" "0"
neq "报价响应不含内部字段" '"surcharge_detail"' "$Q"
chk "报价带泡重规则说明" "volumetric_rule" "$Q"
# fragile 的两种写法（1 / true）与省略必须都能用且同价：解析器认两种，
# 前端与冒烟各用一种时不能算出两个价。
FB="/api/quote?lane=$LANE_OK&weight_g=5000&volume_cm3=0&heaviest_g=1000"
F1="$(req GET "$FB&fragile=1" | body_of | jget total_cents)"
F2="$(req GET "$FB&fragile=true" | body_of | jget total_cents)"
F0="$(req GET "$FB" | body_of | jget total_cents)"
eq "fragile=1 与 fragile=true 同价" "$F1" "$F2"
yes "易碎比不易碎贵（$F0 → $F1）" "" "[[ $F1 -gt $F0 ]]"
# 偏远区规则只对偏远线路生效：拿同一组参数分别打两条线路，差异必须只在偏远费上。
if [[ -n "$LANE_REMOTE" ]]; then
  RR="$(req GET "/api/quote?lane=$LANE_REMOTE&weight_g=9000&volume_cm3=0&heaviest_g=2000" | body_of | jget surcharge_cents)"
  RC="$(req GET "/api/quote?lane=$LANE_REMOTE&weight_g=9000&volume_cm3=0&heaviest_g=2000&fragile=1" | body_of | jget surcharge_cents)"
  yes "偏远线路有附加费" "" "[[ $RR -ge 0 ]]"
  yes "易碎单附加费不低于普通单" "" "[[ $RC -ge $RR ]]"
fi

# ============================================================ ④ 试算参数校验
sec "④ 参数校验（逐字段回显，绝不 500）"
B="$(req GET '/api/quote?weight_g=5000' | body_of)"
chk "缺 lane 报 invalid_request" '"invalid_request"' "$B"
chk "缺 lane 定位到字段" '"lane"' "$B"
B="$(req GET "/api/quote?lane=$LANE_OK&weight_g=1000&heaviest_g=2000" | body_of)"
chk "最重单件超总重被拒" '"heaviest_g"' "$B"
B="$(req GET "/api/quote?lane=$LANE_OK&weight_g=-5" | body_of)"
chk "负重量被拒" '"weight_g"' "$B"
B="$(req GET "/api/quote?lane=$LANE_OK&weight_g=99999999999999" | body_of)"
chk "天文数字重量被拒（不溢出）" '"weight_g"' "$B"
B="$(req GET "/api/quote?lane=$LANE_OK&weight_g=1.5" | body_of)"
chk "小数克重被拒（单位必须整数）" '"weight_g"' "$B"
B="$(req GET "/api/quote?lane=$LANE_OK&weight_g=x" | body_of)"
chk "非数字克重被拒" '"weight_g"' "$B"
eq "不存在的线路 404" "$(req GET '/api/quote?lane=NO-SUCH-LANE&weight_g=1000' | status_of)" "404"
BADCODE="$(urlq "FY20260101-0001' OR '1'='1")"
B="$(req GET "/api/waybills/$BADCODE" | body_of)"
chk "运单号注入被白名单挡下" '"invalid_code"' "$B"
# 空运单号会被 Gin 归一化重定向（/api/waybills/ → /api/waybills），不是 500 也不是 404：
# 只要它不进 handler 拼出 `code = ''` 的全表查询就安全。
eq "空运单号被归一化重定向（不 500）" "$(raw GET '/api/waybills/' '' | status_of)" "301"

# ============================================================ ⑤ 鉴权三层
sec "⑤ 鉴权：503 / 401 / 403 三层各就各位"
WRITE='{"lane_code":"'"$LANE_OK"'","shipper_name":"鉴权探针","phone":"13800001111","piece_count":1,"weight_grams":2000,"volume_cm3":6000,"heaviest_piece_g":1000}'
BEFORE="$(req GET '/api/waybills?page_size=1' | body_of | jget total)"
if [[ -n "$NO_TOKEN_BASE" ]]; then
  RESP="$(ntok POST /api/admin/waybills "$WRITE")"
  chk "服务端未配令牌 → 503 server_misconfigured" '"server_misconfigured"' "$(printf '%s' "$RESP" | body_of)"
  eq "503 状态码" "$(printf '%s' "$RESP" | status_of)" "503"
fi
eq "无 Authorization → 401" "$(raw POST /api/admin/waybills "" "$WRITE" | status_of)" "401"
eq "只有方案名无令牌 → 401" "$(raw POST /api/admin/waybills "Bearer" "$WRITE" | status_of)" "401"
eq "非 Bearer 方案 → 401" "$(raw POST /api/admin/waybills "Basic Zm9vOmJhcg==" "$WRITE" | status_of)" "401"
eq "Bearer 后为空 → 401" "$(raw POST /api/admin/waybills "Bearer " "$WRITE" | status_of)" "401"
eq "Bearer 只有空格 → 401" "$(raw POST /api/admin/waybills "Bearer   " "$WRITE" | status_of)" "401"
eq "错令牌 → 403" "$(raw POST /api/admin/waybills "Bearer wrong-token-here" "$WRITE" | status_of)" "403"
chk "401 提示要 Bearer 形式" "unauthorized" "$(raw POST /api/admin/waybills "" "$WRITE" | body_of)"
chk "403 说令牌无效" "forbidden" "$(raw POST /api/admin/waybills "Bearer nope" "$WRITE" | body_of)"
AFTER="$(req GET '/api/waybills?page_size=1' | body_of | jget total)"
eq "被拒的写请求一张都没开成" "$AFTER" "$BEFORE"
if [[ -n "$TOKEN" ]]; then
  # RFC 7235：认证方案名大小写不敏感。当普通字段严格比会拒掉合法客户端。
  eq "小写 bearer 方案名可用" "$(raw POST /api/admin/rules "bearer $TOKEN" '{"code":"smoke-lower-case","name":"小写方案名探针","kind":"fragile_flat","amount_cents":100,"priority":9}' | status_of)" "201"
  eq "读接口不需要令牌" "$(raw GET '/api/waybills?page_size=1' 'Bearer wrong-token' | status_of)" "200"
else
  bad "缺少 ADMIN_TOKEN" "⑥⑦⑧ 段的写测试无法进行"
fi

# ============================================================ ⑥ 开单 → 全链推进
sec "⑥ 开单与八态状态机正向链路"
if [[ -n "$TOKEN" ]]; then
  BODY='{"lane_code":"'"$LANE_OK"'","shipper_name":"冒烟测试电子货运","phone":"13912345678","piece_count":2,"weight_grams":7300,"volume_cm3":120000,"heaviest_piece_g":4100,"declared_cents":80000,"fragile":true,"node":"北京马驹桥分拨中心"}'
  RESP="$(req POST /api/admin/waybills "$TOKEN" "$BODY")"
  eq "开单 201" "$(printf '%s' "$RESP" | status_of)" "201"
  B="$(printf '%s' "$RESP" | body_of)"
  W1="$(printf '%s' "$B" | jget code)"
  chk "运单号前缀 FY" "FY" "$W1"
  # 业务日历日是 UTC+8：UTC 16:00 之后开的单号段仍属「今天」，与统计口径一致。
  CST_DAY="$(python3 -c 'import datetime,zoneinfo;print(datetime.datetime.now(zoneinfo.ZoneInfo("Asia/Shanghai")).strftime("%Y%m%d"))')"
  chk "号段日期为业务日（UTC+8）" "FY$CST_DAY-" "$W1"
  eq "新单初始状态 booked" "$(printf '%s' "$B" | jget status)" "booked"
  eq "新单只有一条建单轨迹" "$(printf '%s' "$B" | jlen events)" "1"
  eq "首条轨迹 seq=1" "$(printf '%s' "$B" | jget 'events.0.seq')" "1"
  neq "开单响应不含手机号原文" '"phone":' "$B"
  chk "开单响应含掩码" '"phone_masked":"139****5678"' "$B"
  eq "开单后的报价恒等式" "$(printf '%s' "$B" | python3 -c '
import json,sys
d=json.loads(sys.stdin.read())
print("OK" if d["freight_cents"]+d["fuel_cents"]+d["insurance_cents"]+d["surcharge_cents"]==d["total_cents"] else "MISMATCH")')" "OK"
  chk "计费明细数组随单返回" '"surcharge_items":[' "$B"
  # 同一组参数再试算一次，必须与刚落库的快照逐分相等。
  AG="$(req GET "/api/quote?lane=$LANE_OK&weight_g=7300&volume_cm3=120000&heaviest_g=4100&declared_cents=80000&fragile=1" | body_of)"
  eq "开单价 == 试算价" "$(printf '%s' "$AG" | jget total_cents)" "$(printf '%s' "$B" | jget total_cents)"

  for st in picked_up in_transit arrived out_for_delivery delivered; do
    # 写接口把最新详情包在 waybill 里，取值路径要带前缀；先摘出来后面几行就不用重复解包。
    B="$(req POST "/api/admin/waybills/$W1/advance" "$TOKEN" '{"to":"'"$st"'","node":"'"$st"'网点","note":"冒烟链路"}' | body_of)"
    B="$(printf '%s' "$B" | jget waybill)"
    eq "推进到 $st" "$(printf '%s' "$B" | jget status)" "$st"
    num "轨迹 seq 递增（$st）" "seq" "$(printf '%s' "$B" | jget 'events.0.seq')"
    eq "打卡类型与目标状态一致" "$(printf '%s' "$B" | jget 'events.0.event_type')" "$st"
  done
  DEL="$(printf '%s' "$B" | jget delivered_at)"
  [[ "$DEL" != "<nil>" && -n "$DEL" ]] && ok "签收落 delivered_at" "${DEL:0:20}" || bad "签收未落时间" "$DEL"
  eq "全链共 6 条轨迹（建单+5 次推进）" "$(printf '%s' "$B" | jlen events)" "6"
  # 详情里轨迹按 seq 倒序（最新在前）：seq 必须严格递减且唯一，时间随之不前进。
  SEQ_OK="$(D="$B" python3 -c '
import json,os
d=json.loads(os.environ["D"])
s=[e["seq"] for e in d["events"]]
t=[e["occurred_at"] for e in d["events"]]
ok = s == list(range(len(s), 0, -1)) and all(x >= y for x, y in zip(t, t[1:]))
print("OK" if ok else "seq=%s 时间=%s" % (s, t))')"
  eq "轨迹 seq 连续唯一且时间不倒流（倒序返回）" "$SEQ_OK" "OK"
  eq "开单让总数 +1" "$(req GET '/api/waybills?page_size=1' | body_of | jget total)" "$((BEFORE + 1))"
  eq "新单出现在默认列表首页（按下单时间倒序）" \
     "$(req GET '/api/waybills?page_size=1&sort=booked&dir=desc' | body_of | jget 'items.0.code')" "$W1"

  # 终态拒绝任何再推进；异常也不能打在已结案的单上。
  B="$(req POST "/api/admin/waybills/$W1/advance" "$TOKEN" '{"to":"in_transit","node":"乱序网点"}')"
  eq "已签收不能再推进 409" "$(printf '%s' "$B" | status_of)" "409"
  chk "非法跃迁回 invalid_transition" '"invalid_transition"' "$(printf '%s' "$B" | body_of)"
  neq "非法跃迁不回显 SQL/驱动细节" "no such" "$(printf '%s' "$B" | body_of)"
  eq "已签收不能登记异常 409" \
     "$(req POST "/api/admin/waybills/$W1/exception" "$TOKEN" '{"node":"乱序网点","reason":"已结案还想报异常"}' | status_of)" "409"
  chk "倒退跃迁同样被拒" '"invalid_transition"' \
     "$(req POST "/api/admin/waybills/$W1/advance" "$TOKEN" '{"to":"booked","node":"乱序网点"}' | body_of)"
  chk "不存在的运单号 404" '"not_found"' "$(req POST "/api/admin/waybills/FY19990101-9999/advance" "$TOKEN" '{"to":"picked_up","node":"不存在网点"}' | body_of)"
else
  bad "无令牌，跳过开单与状态机链路" "⑥ 整段未验证"
fi

# ============================================================ ⑦ 异常与退回
sec "⑦ 异常挂起、恢复与退回"
if [[ -n "$TOKEN" && -n "$WB_OPEN" ]]; then
  B="$(req GET "/api/waybills/$WB_OPEN" | body_of)"
  N0="$(printf '%s' "$B" | jlen events)"
  ST0="$(printf '%s' "$B" | jget status)"
  RESP="$(req POST "/api/admin/waybills/$WB_OPEN/exception" "$TOKEN" '{"node":"太原中转场","reason":"地址不详，收件人电话无法接通"}')"
  chk "异常接口给出 message" '"message"' "$(printf '%s' "$RESP" | body_of)"
  B="$(printf '%s' "$RESP" | body_of | jget waybill)"
  eq "在途单可登记异常" "$(printf '%s' "$B" | jget status)" "exception"
  eq "异常多一条轨迹" "$(printf '%s' "$B" | jlen events)" "$((N0 + 1))"
  chk "异常原因进备注" "地址不详" "$(printf '%s' "$B" | jget 'events.0.note')"
  chk "备注带异常前缀" "异常：" "$(printf '%s' "$B" | jget 'events.0.note')"
  eq "异常事件类型" "$(printf '%s' "$B" | jget 'events.0.event_type')" "exception"
  eq "重复异常 409" \
     "$(req POST "/api/admin/waybills/$WB_OPEN/exception" "$TOKEN" '{"node":"太原中转场","reason":"重复登记"}' | status_of)" "409"
  B="$(req POST "/api/admin/waybills/$WB_OPEN/advance" "$TOKEN" '{"to":"out_for_delivery","node":"太原中转场","note":"已联系上收件人"}' | body_of | jget waybill)"
  eq "异常可恢复到派送中" "$(printf '%s' "$B" | jget status)" "out_for_delivery"
  B="$(req POST "/api/admin/waybills/$WB_OPEN/advance" "$TOKEN" '{"to":"returned","node":"太原中转场"}' | body_of | jget waybill)"
  eq "在途单可退回" "$(printf '%s' "$B" | jget status)" "returned"
  eq "退回为终态 409" \
     "$(req POST "/api/admin/waybills/$WB_OPEN/advance" "$TOKEN" '{"to":"delivered","node":"某网点"}' | status_of)" "409"
  ok "原状态可复核" "$WB_OPEN: $ST0"
  # 退回单不计营收：这条口径必须能从统计里读出来。
  RET="$(req GET '/api/stats?days=14' | body_of | jget returned)"
  num "统计里的退回单数" "returned" "$RET"
else
  bad "缺令牌或在途样本，跳过异常链路" "WB_OPEN=${WB_OPEN:-}"
fi
[[ -n "$WB_EXC" ]] && eq "种子异常单状态可读" "$(req GET "/api/waybills/$WB_EXC" | body_of | jget status)" "exception"

# ============================================================ ⑧ 规则
sec "⑧ 附加费规则：校验、新建、启停、对报价的即时影响"
if [[ -z "$TOKEN" ]]; then
  bad "无令牌，跳过规则写测试" "⑧ 未验证"
else
  chk "非法 kind 被拒" '"kind"' "$(req POST /api/admin/rules "$TOKEN" '{"code":"bad-kind","name":"错类型","kind":"percent","amount_cents":100,"priority":9}' | body_of)"
  chk "超重门槛低于 10kg 被拒" '"threshold_g"' "$(req POST /api/admin/rules "$TOKEN" '{"code":"low-th","name":"门槛过低","kind":"heavy_piece","threshold_g":1000,"amount_cents":500,"priority":9}' | body_of)"
  chk "缺固定金额被拒" '"amount_cents"' "$(req POST /api/admin/rules "$TOKEN" '{"code":"no-amount","name":"缺金额","kind":"fragile_flat","priority":9}' | body_of)"
  chk "费率型无费率无最低额被拒" '"rate_pct"' "$(req POST /api/admin/rules "$TOKEN" '{"code":"pct-none","name":"费率型缺参数","kind":"remote_pct","priority":9}' | body_of)"
  chk "priority=0 被拒" '"priority"' "$(req POST /api/admin/rules "$TOKEN" '{"code":"pri-0","name":"优先级越界","kind":"fragile_flat","amount_cents":100,"priority":0}' | body_of)"
  chk "priority=100 被拒" '"priority"' "$(req POST /api/admin/rules "$TOKEN" '{"code":"pri-99","name":"优先级越界","kind":"fragile_flat","amount_cents":100,"priority":100}' | body_of)"
  RNAME="$(python3 -c 'print("名"*50)')"
  chk "超长 name 被拒" '"name"' "$(req POST /api/admin/rules "$TOKEN" '{"code":"long-name","name":"'"$RNAME"'","kind":"fragile_flat","amount_cents":100,"priority":9}' | body_of)"
  eq "非法 code 形状 → 400" "$(req POST /api/admin/rules "$TOKEN" '{"code":"a b;DROP","name":"非法 code","kind":"fragile_flat","amount_cents":100,"priority":9}' | status_of)" "400"

  CODE="smoke-fragile-$(date +%s)"
  B="$(req POST /api/admin/rules "$TOKEN" '{"code":"'"$CODE"'","name":"冒烟易碎加固","kind":"fragile_flat","amount_cents":137,"priority":9}' | body_of)"
  RID="$(printf '%s' "$B" | jget id)"
  num "新建规则返回 id" "id" "$RID"
  eq "新规则默认启用" "$(printf '%s' "$B" | jget active)" "True"
  eq "重复规则标识 → 409" "$(req POST /api/admin/rules "$TOKEN" '{"code":"'"$CODE"'","name":"重复标识","kind":"fragile_flat","amount_cents":100,"priority":9}' | status_of)" "409"

  # 新规则必须立刻改变报价：这是「规则表参与仲裁」的唯一硬证据。
  QFRAG="/api/quote?lane=$LANE_OK&weight_g=5000&volume_cm3=0&heaviest_g=2000&fragile=1"
  S1="$(req GET "$QFRAG" | body_of | jget surcharge_cents)"
  B="$(req POST "/api/admin/rules/$RID/toggle" "$TOKEN" '' | body_of)"
  eq "停用后 active=false" "$(printf '%s' "$B" | jget active)" "False"
  S2="$(req GET "$QFRAG" | body_of | jget surcharge_cents)"
  yes "停用规则立刻少收附加费（$S1 → $S2）" "" "[[ $S1 -gt $S2 ]]"
  B="$(req POST "/api/admin/rules/$RID/toggle" "$TOKEN" '' | body_of)"
  eq "再启用 active=true" "$(printf '%s' "$B" | jget active)" "True"
  S3="$(req GET "$QFRAG" | body_of | jget surcharge_cents)"
  eq "启用后附加费回到原值" "$S3" "$S1"
  # 非易碎单的报价不应被易碎规则污染（同线路同重量，只差 fragile 参数）。
  SNF="$(req GET "/api/quote?lane=$LANE_OK&weight_g=5000&volume_cm3=0&heaviest_g=2000" | body_of | jget surcharge_cents)"
  yes "易碎费只加在易碎单上（普通=$SNF 易碎=$S3）" "" "[[ $SNF -le $S3 ]]"
  # 停用规则不参与仲裁：默认列表必须看不到它。
  DEF="$(req GET '/api/rules' | body_of)"
  ALLR="$(req GET '/api/rules?all=1' | body_of)"
  yes "默认列表长度 <= all 列表" "" "[[ $(printf '%s' "$DEF" | jlen items) -le $(printf '%s' "$ALLR" | jlen items) ]]"
  chk "all=1 能看到刚启用的规则" "$CODE" "$ALLR"
  eq "规则 id=0 → 400" "$(req POST '/api/admin/rules/0/toggle' "$TOKEN" '' | status_of)" "400"
  eq "规则 id 非数字 → 400" "$(req POST '/api/admin/rules/abc/toggle' "$TOKEN" '' | status_of)" "400"
  eq "不存在的规则 id → 404" "$(req POST '/api/admin/rules/999999999/toggle' "$TOKEN" '' | status_of)" "404"
  # 收工前把探针规则停掉，避免污染后续统计断言。
  eq "探针规则可停用于收尾" "$(req POST "/api/admin/rules/$RID/toggle" "$TOKEN" '' | status_of)" "200"
fi

# ============================================================ ⑨ 注入与边界
sec "⑨ 注入、LIKE 转义与畸形输入"
for payload in "' OR '1'='1" "%' UNION SELECT id,code FROM lanes--" "a;b=c" "'--" "1' AND SLEEP(3)--" "<script>alert(1)</script>"; do
  # macOS 自带 bash 3.2 会把「"$(cmd "$(cmd2 "$x")")"」这种三层嵌套解析错，一律先算好再拼。
  ENC="$(urlq "$payload")"
  RESP="$(req GET "/api/waybills?q=$ENC&page_size=5")"
  C="$(printf '%s' "$RESP" | status_of)"; T="$(printf '%s' "$RESP" | body_of | jget total)"
  eq "注入串查不到数据：$payload" "$T" "0"
  neq "注入响应不含 SQL 细节" "no such table" "$RESP"
done
# LIKE 通配符必须被转义：不转义时 q=% 会命中全部，等于把「检索」变成「拖库」。
PC="$(req GET "/api/waybills?q=%25&page_size=5" | body_of | jget total)"
eq "裸 % 作为字面量匹配（0 条）" "$PC" "0"
US="$(req GET "/api/waybills?q=%5F&page_size=5" | body_of | jget total)"
eq "下划线同样按字面量" "$US" "0"
if [[ -n "$W1" ]]; then
  QNAME="$(urlq "冒烟测试电子货运")"
  B="$(req GET "/api/waybills?q=$QNAME" | body_of)"
  chk "按寄件人中文检索命中新单" "$W1" "$B"
  QMASK="$(urlq "139****5678")"
  B="$(req GET "/api/waybills?q=$QMASK" | body_of | jget total)"
  eq "掩码不参与检索（原文列不出接口）" "$B" "0"
  QW1="$(urlq "$W1")"
  B="$(req GET "/api/waybills?q=$QW1" | body_of)"
  chk "按运单号精确检索命中" "$W1" "$B"
fi
LONGQ="$(python3 -c 'print("x"*400)')"
LONGE="$(urlq "$LONGQ")"
eq "超长搜索串不报错（服务端截断）" "$(req GET "/api/waybills?q=$LONGE&page_size=5" | status_of)" "200"
eq "翻页越界返回空列表而非报错" "$(req GET '/api/waybills?page=99999999&page_size=5' | body_of | jget items)" "[]"
eq "未知排序键回落默认" "$(req GET '/api/waybills?sort=nonexistent_column' | body_of | jget sort)" "booked"
eq "非法 status 被忽略（不过滤）" "$(req GET '/api/waybills?status=not_a_status' | body_of | jget page_size)" "20"
# 详情路径上的单段注入必须走 invalid_code 或 404，绝不能 500。
LONG40="$(python3 -c 'print("x"*40)')"
U1="$(urlq "a'b")"; U2="$(urlq 'a"b')"; U3="$(urlq 'a b')"; U4="$(urlq "a'--")"; U5="$(urlq "$LONG40")"
# 注意：这里刻意不用 $(urlq "$(…)") 这种三层嵌套——macOS 自带 bash 3.2 会把它解析错。
for p in "FY%27%20OR%201%3D1" "..%2f..%2fetc%2fpasswd" "$U1" "$U2" "$U3" "$U4" "$U5"; do
  C="$(curl -s -m 10 -o /tmp/fwt-inj-body -w '%{http_code}' "$BASE/api/waybills/$p")"
  BODY="$(cat /tmp/fwt-inj-body)"
  if [[ "$C" == 5* || "$C" == "200" ]]; then bad "路径注入未拒" "$p -> $C ${BODY:0:80}"; else ok "路径注入被拒" "$p -> $C"; fi
  neq "注入响应不含 SQL 细节" "SELECT" "$BODY"
done
rm -f /tmp/fwt-inj-body
BIGNAME="$(python3 -c 'print("名"*20000)')"
HUGE='{"lane_code":"'"$LANE_OK"'","shipper_name":"'"$BIGNAME"'","phone":"13800001111","piece_count":1,"weight_grams":1000,"volume_cm3":0,"heaviest_piece_g":1000}'
C="$(req POST /api/admin/waybills "$TOKEN" "$HUGE" | status_of)"
yes "超长请求体被拒（$C）" "" "[[ $C == 413 || $C == 400 ]]"
neq "超长请求体的响应不泄露内部文案" "request body too large" "$(req POST /api/admin/waybills "$TOKEN" "$HUGE" | body_of)"
eq "坏 JSON → 400" "$(req POST /api/admin/waybills "$TOKEN" 'not-json{' | status_of)" "400"
eq "空 body → 400" "$(req POST /api/admin/waybills "$TOKEN" '' | status_of)" "400"
eq "数组 body → 400" "$(req POST /api/admin/waybills "$TOKEN" '[]' | status_of)" "400"
B="$(req POST /api/admin/waybills "$TOKEN" '{"lane_code":"'"$LANE_OK"'","shipper_name":"字段校验","phone":"23800001111","piece_count":0,"weight_grams":0,"volume_cm3":-1,"heaviest_piece_g":0}' | body_of)"
for f in phone piece_count weight_grams volume_cm3 heaviest_piece_g; do
  chk "逐字段回显：$f" "\"$f\"" "$B"
done
B="$(req POST /api/admin/waybills "$TOKEN" '{"lane_code":"'"$LANE_OFF"'","shipper_name":"停售线路","phone":"13800001111","piece_count":1,"weight_grams":1000,"volume_cm3":0,"heaviest_piece_g":1000}' | body_of)"
chk "停售线路不能下单" '"lane_offline"' "$B"
B="$(req POST /api/admin/waybills "$TOKEN" '{"lane_code":"'"$LANE_OK"'","shipper_name":"非法 UTF-8","phone":"13800001111","piece_count":1,"weight_grams":1000,"volume_cm3":0,"heaviest_piece_g":1000,"node":"\ud800"}' | status_of)"
eq "非法代理对字符 → 400" "$B" "400"

# ============================================================ ⑩ 静态与网关层
sec "⑩ 静态托管、安全响应头、CORS、404 形状"
eq "根路径给出 SPA" "$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/")" "200"
SHELL_HTML="$(curl -s -m 10 "$BASE/")"
chk "SPA 有 #root 挂载点" 'id="root"' "$SHELL_HTML"
neq "SPA 不引外部资源" "https://" "$SHELL_HTML"
HDRS="$(curl -s -m 10 -D - -o /dev/null "$BASE/api/lanes" | tr 'A-Z' 'a-z')"
chk "禁缓存头" "cache-control: no-store" "$HDRS"
chk "nosniff" "x-content-type-options: nosniff" "$HDRS"
chk "frame deny" "x-frame-options: deny" "$HDRS"
chk "referrer policy" "referrer-policy: no-referrer" "$HDRS"
chk "permissions policy" "permissions-policy" "$HDRS"
chk "未知接口是 JSON 404" '"not_found"' "$(req GET '/api/no-such-endpoint' | body_of)"
eq "未知接口状态码 404" "$(req GET '/api/no-such-endpoint' | status_of)" "404"
neq "穿越路径不给 passwd" "root:" "$(req GET "$(urlq /../../etc/passwd)" | body_of)"
eq "外部 Origin 仍能应答（只是不给 ACAO）" \
   "$(curl -s -m 8 -o /dev/null -w '%{http_code}' -H 'Origin: https://evil.example' "$BASE/api/lanes")" "200"
for o in "https://evil.example" "null" "http://127.0.0.1.evil.example" ""; do
  N="$(curl -s -m 8 -D - -o /dev/null -H "Origin: $o" "$BASE/api/lanes" | tr 'A-Z' 'a-z' | grep -c 'access-control-allow-origin' || true)"
  eq "Origin=$o 不给 ACAO" "$N" "0"
done
for o in "http://127.0.0.1:18509" "http://localhost:5173" "http://[::1]:3000"; do
  # -F：放行用例里有 http://[::1]:3000，不加 -F 的话方括号会被当字符类，永远数不到。
  N="$(curl -s -m 8 -D - -o /dev/null -H "Origin: $o" "$BASE/api/lanes" | tr 'A-Z' 'a-z' | grep -F -c "access-control-allow-origin: $o" || true)"
  eq "本机 Origin 放行：$o" "$N" "1"
done
eq "OPTIONS 预检 204" "$(curl -s -m 8 -o /dev/null -w '%{http_code}' -X OPTIONS -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: POST' "$BASE/api/admin/waybills")" "204"
# 深链回落到 index.html：刷新 /waybills 之类的路径不能 404。
eq "前端深链回落 SPA" "$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/some/deep/link")" "200"

printf '\n\033[1mpass=%s fail=%s\033[0m\n' "$PASS" "$FAIL"
exit $(( FAIL > 0 ))
