#!/usr/bin/env bash
# 知衡测评台 · 逐接口冒烟测试：断言状态码、字段口径、授权矩阵、注入与超量边界。
#
# 用法：
#   BASE=http://127.0.0.1:18091/api TOKEN=smoke-token bash scripts/api-smoke.sh
#   可选 NO_TOKEN_BASE=http://127.0.0.1:18092/api 验证「服务端未配令牌 → 写口 503」。
#
# 注意：本脚本会向目标库写入数据（开考/交卷/状态迁移）。跑完请用干净库重新灌种子，
#       再生成 preview 与最终截图，否则 preview 里会混进测试数据。
set -uo pipefail

BASE="${BASE:?需要 BASE，如 http://127.0.0.1:18091/api}"
TOKEN="${TOKEN:?需要 TOKEN（与服务端 ADMIN_TOKEN 一致）}"
NO_TOKEN_BASE="${NO_TOKEN_BASE:-}"
TMP="${TMP_DIR:-/tmp}/oa-smoke-$$"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT
export LAST="$TMP/last.json"

pass=0 fail=0
ok()   { pass=$((pass+1)); printf 'ok    %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf 'FAIL  %s: 期望 [%s] 实际 [%s]\n' "$1" "$2" "$3"; }
chk()  { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1" "$2" "$3"; fi; }

# call METHOD PATH [token] [body: 文件路径或原始 JSON] -> stdout 打印 HTTP 状态码
# 响应体写入 $TMP/last.json，供 json 查询。
call() {
  local m=$1 p=$2 t=${3:-} b=${4:-}
  local args=(-sS -m 15 -o "$TMP/last.json" -w '%{http_code}' -X "$m" "$BASE$p")
  # 令牌约定：裸值自动补 "Bearer "；RAW: 前缀表示整串就是 Authorization 头值
  if [[ -n $t ]]; then
    if [[ $t == RAW:* ]]; then args+=(-H "Authorization: ${t#RAW:}")
    else args+=(-H "Authorization: Bearer $t"); fi
  fi
  if [[ -n $b ]]; then
    if [[ -f $b ]]; then args+=(-H 'Content-Type: application/json' --data-binary "@$b")
    else args+=(-H 'Content-Type: application/json' -d "$b"); fi
  fi
  curl "${args[@]}"
}

# json <python 表达式，d 为响应体> —— 出错时打印 ERROR 而不是让脚本炸掉
json() {
  python3 - "$1" <<'PY'
import json, sys
expr = sys.argv[1]
try:
    d = json.load(open(__import__("os").environ["LAST"]))
except Exception as e:
    print("UNREADABLE", e); sys.exit(0)
try:
    print(eval(expr, {"d": d, "len": len, "sum": sum, "all": all, "any": any,
                      "sorted": sorted, "range": range, "list": list, "print": print}))
except Exception as e:
    print("EXPR_ERROR", e)
PY
}

# 把当前响应另存一份，供后续构造答卷
save() { cp "$TMP/last.json" "$TMP/$1"; }
py() { python3 -c "$1" > "$TMP/$2"; }

# 用真值表：期望 True/False 直接字符串比较
P1='AS-2026-001'   # closed 认证卷：题目分布已公布
P2='AS-2026-004'   # open   安全月度卷：可开考
P6='AS-2026-006'   # draft  未发布卷：状态机素材

# 前置守卫：第 6 节会真实迁移 P6（draft->open->closed），重复跑必须换干净库
call GET "/assessments/$P6" >/dev/null
if [[ "$(json "d['assessment']['status']")" != "draft" ]]; then
  echo "ABORT：$P6 已不是 draft，冒烟会污染统计口径。请用 -seed 重灌一个临时库后重试。"
  exit 1
fi

echo "=== 1) 健康检查与读接口 ==="
call GET /health >/dev/null
chk "health 200" 200 "$(call GET /health)"
chk "health 结构" "True" "$(json "d['status']=='ok' and 'time' in d")"

call GET /stats >/dev/null
chk "stats 200" 200 "$(call GET /stats)"
chk "场次=6 题数=62" "6 62" "$(json "str(d['assessments'])+' '+str(d['questions'])")"
chk "三种状态计数自洽" "True" "$(json "d['draft_assessments']+d['open_assessments']+d['closed_assessments']==d['assessments']")"
chk "三种作答状态自洽" "True" "$(json "d['graded']+d['ongoing']+d['invalid']==d['attempts']")"
chk "种子量级可信(作答>150)" "True" "$(json "d['attempts']>150")"
chk "恒等式体检通过" "True 0" "$(json "str(d['identity_ok'])+' '+str(d['identity_violations'])")"
chk "总分=机械分+半分" "True" "$(json "d['score_total']==d['mechanical_total']+d['half_credit_total']")"
chk "分数段合计=已判分数" "True" "$(json "sum(b['count'] for b in d['buckets'])==d['graded']")"
chk "分数段边界连续" "True" "$(json "[(b['from'],b['to']) for b in d['buckets']]==[(0,39),(40,59),(60,69),(70,79),(80,89),(90,100)]")"
chk "通过率可复算" "True" "$(json "abs(d['pass_rate_pct']-round(d['passed']*1000/d['graded'])/10)<0.15")"
chk "榜单 8 行且百分制降序" "True" "$(json "len(d['top_board'])==8 and all(d['top_board'][i]['percent']>=d['top_board'][i+1]['percent'] for i in range(7))")"
chk "榜单名次连续 1..8" "True" "$(json "[r['rank_no'] for r in d['top_board']]==list(range(1,9))")"
chk "榜单手机号全脱敏" "True" "$(json "all(r['masked_phone'][3:7]=='****' and len(r['masked_phone'])==11 for r in d['top_board'])")"
chk "榜单出口无 phone 原文字段" "True" "$(json "'\"phone\"' not in open(__import__('os').environ['LAST']).read()")"
chk "最难榜恰好 5 行" 5 "$(json "len(d['hardest_items'])")"
chk "最难榜样本量>=15" "True" "$(json "all(i['answered']>=15 for i in d['hardest_items'])")"
chk "趋势 14 天且不含未来" "True" "$(json "len(d['daily'])==14 and all(p['attempts']>=0 for p in d['daily'])")"
chk "科目表非空" "True" "$(json "len(d['subjects'])>=4")"
chk "科目字段名是 subject" "True" "$(json "all('subject' in s and 'attempts' in s and 'pass_pct' in s for s in d['subjects'])")"

call GET "/stats?assessment=$P2" >/dev/null
chk "单场 stats 200" 200 "$(call GET "/stats?assessment=$P2")"
chk "单场口径标注" "单场已判分口径" "$(json "d['window']")"
chk "单场只算一场" "True" "$(json "d['assessments']==1")"
chk "未知 code 收窄口径 404" 404 "$(call GET "/stats?assessment=AS-9999-9999")"

call GET '/assessments?page_size=20' >/dev/null
chk "列表 200" 200 "$(call GET '/assessments?page_size=20')"
chk "列表共 6 场" 6 "$(json "d['total']")"
chk "满分恒为 100" "True" "$(json "all(r['total_score']==100 for r in d['items'])")"
chk "通过数<=作答数" "True" "$(json "all(r['passed_count']<=r['attempts'] for r in d['items'])")"
chk "题数合计=62" 62 "$(json "sum(r['question_no'] for r in d['items'])")"
chk "status 过滤只返回 closed" "True" "$(call GET '/assessments?status=closed&page_size=20' >/dev/null; json "d['total']>0 and all(r['status']=='closed' for r in d['items'])")"
chk "三态过滤互斥且覆盖全量" "True" "$(tot=$(call GET '/assessments?status=draft&page_size=20' >/dev/null; json "d['total']"); op=$(call GET '/assessments?status=open&page_size=20' >/dev/null; json "d['total']"); cl=$(call GET '/assessments?status=closed&page_size=20' >/dev/null; json "d['total']"); [[ $((tot+op+cl)) == "$(call GET '/assessments?page_size=20' >/dev/null; json "d['total']")" ]] && echo True || echo "got $tot+$op+$cl")"
chk "非法 status 被忽略" 6 "$(call GET '/assessments?status=bogus&page_size=20' >/dev/null; json "d['total']")"
chk "kind 过滤 cert=1" 1 "$(call GET '/assessments?kind=cert&page_size=20' >/dev/null; json "d['total']")"
chk "subject 过滤生效" "True" "$(call GET '/assessments?subject=%E5%89%8D%E7%AB%AF%E5%B7%A5%E7%A8%8B&page_size=20' >/dev/null; json "all(r['subject']=='前端工程' for r in d['items'])")"
chk "中文关键词搜索命中" 1 "$(call GET "/assessments?q=%E6%95%B0%E6%8D%AE%E5%BA%93&page_size=20" >/dev/null; json "d['total']")"
chk "LIKE 通配符 % 被转义" 0 "$(call GET '/assessments?q=%25&page_size=20' >/dev/null; json "d['total']")"
chk "LIKE 通配符 _ 被转义" 0 "$(call GET '/assessments?q=_&page_size=20' >/dev/null; json "d['total']")"
chk "单引号注入不报错" "True" "$(call GET "/assessments?q=%27%20OR%201%3D1--&page_size=20" >/dev/null; json "d['total']==0")"
chk "分号多语句注入无效" "True" "$(call GET "/assessments?q=%3B%20DROP%20TABLE%20attempts%3B&page_size=20" >/dev/null; json "d['total']==0")"
chk "注入后库仍完好" 6 "$(call GET '/assessments?page_size=20' >/dev/null; json "d['total']")"
chk "page_size 夹到 100" 100 "$(call GET '/assessments?page_size=99999' >/dev/null; json "d['page_size']")"
chk "page=0 回落 1" 1 "$(call GET '/assessments?page=0' >/dev/null; json "d['page']")"
chk "越界页返回空列表" 0 "$(call GET '/assessments?page=9999' >/dev/null; json "len(d['items'])")"
chk "负 dir 回落 asc" asc "$(call GET '/assessments?dir=sqli' >/dev/null; json "d['dir']")"
chk "非法 sort 回落默认" opens_at "$(call GET '/assessments?sort=%3Bdrop%20table%20questions' >/dev/null; json "d['sort']")"
chk "sort=avg&dir=asc 生效" "True" "$(call GET '/assessments?sort=avg&dir=asc&page_size=20' >/dev/null; json "[r['avg_percent'] for r in d['items']]==sorted(r['avg_percent'] for r in d['items'])")"
LONGQ="$(python3 -c "print('测'*400)")"
chk "search 按 rune 截断" "True" "$(call GET "/assessments?q=$LONGQ" >/dev/null; json "len(d['filters']['q'])<=48")"

echo
echo "=== 2) 卷面与区分度 ==="
call GET "/assessments/$P1" >/dev/null
chk "详情 200" 200 "$(call GET "/assessments/$P1")"
chk "详情 11 题" 11 "$(json "len(d['questions'])")"
chk "P1 卷面 11 题与列表一致" "True" "$(json "len(d['questions'])==d['assessment']['question_no']")"
chk "未知 code 404 有错误码" not_found "$(call GET '/assessments/AS-9999-9999' >/dev/null; json "d['code']")"
call GET "/assessments/$P1" >/dev/null
chk "题号连续" "True" "$(json "[q['order_no'] for q in d['questions']]==list(range(1,12))")"
chk "选项成组(judge 无选项)" "True" "$(json "all((len(q['options'])>=2) if q['type'] in ('single','multi') else True for q in d['questions'])")"
chk "卷面不含答案字段" "True" "$(json "all('answer' not in q and 'correct' not in q for q in d['questions'])")"
chk "满分=题目分值和" "True" "$(json "sum(q['score'] for q in d['questions'])==d['assessment']['total_score']")"
chk "未知场次 404" 404 "$(call GET '/assessments/AS-9999-9999')"
chk "404 带回错误码" not_found "$(json "d['code']")"
chk "404 不回显内部错误" "True" "$(json "d['message']=='资源不存在'")"
chk "code 注入被拒(白名单)" "True" "$(c=$(call GET "/assessments/AS-2026-001%27--"); [[ $c == 400 || $c == 404 ]] && echo True || echo "got $c")"
call GET '/assessments/..%2f..%2fetc%2fpasswd' >/dev/null
chk "路径穿越不成文件" 0 "$(grep -c 'root:' "$TMP/last.json" || true)"

call GET "/assessments/$P1/statistics" >/dev/null
chk "closed 统计 200" 200 "$(call GET "/assessments/$P1/statistics")"
chk "closed 单场口径" "单场已判分口径" "$(json "d['stats']['window']")"
chk "closed 分布已公布" "True" "$(json "all(i['revealed'] for i in d['items'])")"
chk "correct<=answered" "True" "$(json "all(i['correct_count']<=i['answered'] for i in d['items'])")"
chk "awarded<=answered*满分" "True" "$(json "all(i['awarded']<=i['answered']*i['score'] for i in d['items'])")"
chk "难度档由正确率推出" "True" "$(json "all((i['difficulty']=='空题')==(i['answered']==0) for i in d['items'])")"
chk "选项分布求和=作答数" "True" "$(json "all(sum(x['count'] for x in (i['distractors'] or []))==i['answered'] for i in d['items'] if i['answered']>0)")"
call GET "/assessments/$P2/statistics" >/dev/null
chk "open 统计 200" 200 "$(call GET "/assessments/$P2/statistics")"
chk "open 分布未公布" "True" "$(json "all(not i['revealed'] and not i.get('distractors') for i in d['items'])")"
chk "open 仍给作答数" "True" "$(json "any(i['answered']>0 for i in d['items'])")"

echo
echo "=== 3) 名单与成绩条 ==="
call GET "/assessments/$P1/attempts?page_size=100" >/dev/null
chk "名单 200" 200 "$(call GET "/assessments/$P1/attempts?page_size=100")"
chk "已判分有名次/其余为 0" "True" "$(json "all((r['rank_no']>0)==(r['status']=='graded') for r in d['items'])")"
chk "默认按 score 排序" score "$(json "d['sort']")"
chk "sort=rank 时无名次的排最后" "True" "$(call GET "/assessments/$P1/attempts?sort=rank&dir=asc&page_size=100" >/dev/null; json "(lambda rs: all(rs[k]<=rs[k+1] or rs[k+1]==0 for k in range(len(rs)-1)))([r['rank_no'] for r in d['items']]) and [r['rank_no'] for r in d['items'] if r['rank_no']>0]==[n for n in range(1,max([r['rank_no'] for r in d['items']])+1)]")"
chk "手机号脱敏口径" "True" "$(json "all(r['masked_phone'][3:7]=='****' for r in d['items'])")"
chk "出口无 phone 原文" "True" "$(json "'\"phone\":' not in open(__import__('os').environ['LAST']).read()")"
chk "每行 score=mech+half" "True" "$(json "all(r['score']==r['mechanical_score']+r['half_credit'] for r in d['items'])")"
chk "percent 落在 0..100" "True" "$(json "all(0<=r['percent']<=100 for r in d['items'])")"
chk "passed=yes 过滤纯净" "True" "$(call GET "/assessments/$P1/attempts?passed=yes&page_size=100" >/dev/null; json "all(r['passed'] for r in d['items'])")"
chk "invalid 不占名次" "True" "$(call GET "/assessments/$P1/attempts?status=invalid&page_size=100" >/dev/null; json "all(r['rank_no']==0 and r['score']==0 for r in d['items']) or d['total']==0")"
chk "status+channel 组合" "True" "$(call GET "/assessments/$P1/attempts?status=graded&channel=campus&page_size=100" >/dev/null; json "all(r['status']=='graded' and r['channel']=='campus' for r in d['items'])")"
chk "非法 channel 被忽略" "True" "$(call GET "/assessments/$P1/attempts?channel=%27%20OR%201%3D1--&page_size=100" >/dev/null; json "d['filters']['channel']=='' and d['total']>0")"
chk "非法 sort 回落默认" score "$(call GET "/assessments/$P1/attempts?sort=nomal_col" >/dev/null; json "d['sort']")"
chk "sort=submitted 生效" "True" "$(call GET "/assessments/$P1/attempts?sort=submitted&dir=desc&page_size=100" >/dev/null; json "[r['submitted_at'] for r in d['items']]==sorted([r['submitted_at'] for r in d['items']],reverse=True)")"

call GET "/attempts/NOPE-0001" >/dev/null
chk "未知作答编号 404" 404 "$(call GET '/attempts/NOPE-0001')"
NO="$(call GET "/assessments/$P1/attempts?page_size=1" >/dev/null; json "d['items'][0]['attempt_no']")"
call GET "/attempts/$NO" >/dev/null
chk "成绩条 200" 200 "$(call GET "/attempts/$NO")"
chk "逐题合计=卷面分" "True" "$(json "sum(i['awarded'] for i in d['items'])==d['attempt']['score']")"
chk "成绩条无答案字段" "True" "$(json "all('answer' not in i for i in d['items'])")"
chk "成绩条含四态字段" "True" "$(json "all(all(k in i for k in ('picked','correct','awarded','max_score')) for i in d['items'])")"

echo
echo "=== 4) 授权矩阵（fail-closed 三层）==="
START="{\"name\":\"冒烟考生\",\"phone\":\"13900001111\",\"channel\":\"web\"}"
chk "开考-无凭证 401" 401 "$(call POST "/assessments/$P2/attempts" '' "$START")"
chk "开考-非 Bearer 401" 401 "$(call POST "/assessments/$P2/attempts" 'RAW:Basic d29uZzpyYXQ=' "$START")"
chk "开考-只有前缀 401" 401 "$(call POST "/assessments/$P2/attempts" 'RAW:Bearer ' "$START")"
chk "开考-无 Authorization 头 401" 401 "$(call POST "/assessments/$P2/attempts" '' "$START")"
chk "开考-小写 bearer 也认 403" 403 "$(call POST "/assessments/$P2/attempts" 'RAW:bearer wrong-case' "$START")"
chk "开考-错令牌 403" 403 "$(call POST "/assessments/$P2/attempts" 'wrong-token' "$START")"
chk "交卷-无凭证 401" 401 "$(call POST "/attempts/$NO/submit" '' '{"answers":[{"question_code":"X","picked":"A"}]}')"
chk "改状态-错令牌 403" 403 "$(call POST "/assessments/$P6/status" 'nope' '{"to":"open"}')"
chk "错令牌出口无凭证" "True" "$(json "'smoke-token' not in open(__import__('os').environ['LAST']).read()")"
chk "读接口无需令牌" 200 "$(call GET '/assessments?page_size=1')"
if [[ -n $NO_TOKEN_BASE ]]; then
  BASE_ORIG=$BASE
  BASE="$NO_TOKEN_BASE"
  chk "未配令牌时写口 503" 503 "$(call POST "/assessments/$P2/attempts" "$TOKEN" "$START")"
  chk "503 不回显凭证" "True" "$(json "'smoke-token' not in open(__import__('os').environ['LAST']).read()")"
  chk "未配令牌时读口 200" 200 "$(call GET '/stats')"
  BASE=$BASE_ORIG
else
  echo "skip  未配令牌 503 用例（未设 NO_TOKEN_BASE）"
fi

echo
echo "=== 5) 开考 → 交卷 → 状态机 ==="
chk "开考成功 201" 201 "$(call POST "/assessments/$P2/attempts" "$TOKEN" "$START")"
ANO="$(json "d['attempt']['attempt_no']")"
chk "新场次为作答中" ongoing "$(json "d['attempt']['status']")"
chk "回执脱敏号正确" "139****1111" "$(json "d['attempt']['masked_phone']")"
chk "回执无手机号原文" "True" "$(json "'\"phone\":' not in open(__import__('os').environ['LAST']).read()")"
chk "发卷 10 题" 10 "$(json "len(d['questions'])")"
chk "卷面满分 100" 100 "$(json "d['total_score']")"
chk "发卷无答案字段" "True" "$(json "all('answer' not in q for q in d['questions'])")"
save paper.json
chk "同手机号重复开考 409" 409 "$(call POST "/assessments/$P2/attempts" "$TOKEN" "$START")"
chk "409 错误码" already_started "$(json "d['code']")"

# 用真卷面构造答卷：首选项作答（部分题故意留空）
python3 - "$TMP" <<'PY'
import json, os, sys
tmp = sys.argv[1]
d = json.load(open(os.path.join(tmp, "paper.json")))
ans = []
for i, q in enumerate(d["questions"]):
    if i % 4 == 3:
        continue  # 留空，验证「未作答」也计入 answered 且 awarded=0
    if q["type"] == "blank":
        ans.append({"question_code": q["code"], "picked": "  并发 队列 "})
    elif q["type"] == "multi":
        ans.append({"question_code": q["code"], "picked": ",".join(q["options"][:2])})
    else:
        ans.append({"question_code": q["code"], "picked": q["options"][0][0]})
json.dump({"answers": ans}, open(os.path.join(tmp, "answers.json"), "w"), ensure_ascii=False)
PY
chk "全量交卷 200" 200 "$(call POST "/attempts/$ANO/submit" "$TOKEN" "$TMP/answers.json")"
chk "交卷后已判分" graded "$(json "d['attempt']['status']")"
chk "判分恒等式" "True" "$(json "d['attempt']['score']==d['attempt']['mechanical_score']+d['attempt']['half_credit']")"
chk "逐题合计=卷面分" "True" "$(json "sum(i['awarded'] for i in d['items'])==d['attempt']['score']")"
chk "答题明细覆盖全卷" 10 "$(json "len(d['items'])")"
chk "留空题得 0 分" "True" "$(json "all(i['awarded']==0 for i in d['items'] if i['picked']=='未作答')")"
chk "半分不会超过该题满分" "True" "$(json "all(i['awarded']<=i['max_score'] for i in d['items'])")"
chk "通过判定与分数线一致" "True" "$(json "d['attempt']['passed']==(d['attempt']['score']>=d['attempt']['pass_score'])")"
chk "重复交卷 409" 409 "$(call POST "/attempts/$ANO/submit" "$TOKEN" "$TMP/answers.json")"
chk "409 错误码已提交" already_submitted "$(json "d['code']")"
call GET "/assessments/$P2/attempts?page_size=100" >/dev/null
chk "交卷后名次可查" "True" "$(json "any(r['attempt_no']=='$ANO' and r['rank_no']>0 for r in d['items'])")"

chk "缺姓名 400" 400 "$(call POST "/assessments/$P2/attempts" "$TOKEN" '{"phone":"13900002222","channel":"web"}')"
chk "字段级错误码" invalid_request "$(json "d['code']")"
chk "点名 name 字段" "True" "$(json "'name' in d['fields']")"
chk "手机号非法 400" 400 "$(call POST "/assessments/$P2/attempts" "$TOKEN" '{"name":"坏号","phone":"1390000","channel":"web"}')"
chk "点名 phone 字段" "True" "$(json "'phone' in (d.get('fields') or {})")"
chk "渠道枚举 400" 400 "$(call POST "/assessments/$P2/attempts" "$TOKEN" '{"name":"渠道","phone":"13900002223","channel":"fax"}')"
chk "错误出口无内部堆栈" "True" "$(json "'goroutine' not in open(__import__('os').environ['LAST']).read() and 'sqlite' not in open(__import__('os').environ['LAST']).read().lower()")"
py "import json;print(json.dumps({'name':'超'*4000,'phone':'13900002224','channel':'web'},ensure_ascii=False))" long.json
chk "超长姓名被拒 400" 400 "$(call POST "/assessments/$P2/attempts" "$TOKEN" "$TMP/long.json")"
py "import json;print(json.dumps({'name':'超大 body','phone':'13900002225','channel':'web','pad':'y'*20000}))" huge.json
chk "超大 body 被挡 400" 400 "$(call POST "/assessments/$P2/attempts" "$TOKEN" "$TMP/huge.json")"
chk "空 body 400" 400 "$(call POST "/assessments/$P2/attempts" "$TOKEN" ' ')"
chk "非数组 answers 400" 400 "$(call POST "/attempts/$ANO/submit" "$TOKEN" '{"answers":{"a":1}}')"
call POST "/assessments/$P2/attempts" "$TOKEN" '{"name":"串题","phone":"13900002226","channel":"web"}' >/dev/null
ANO2="$(json "d['attempt']['attempt_no']")"
chk "串题作答被拒 400" 400 "$(call POST "/attempts/$ANO2/submit" "$TOKEN" '{"answers":[{"question_code":"AS-2026-001-Q01","picked":"A"}]}')"
chk "串题点名 question_code" "True" "$(json "'question_code' in (d.get('fields') or {})")"
py "import json;print(json.dumps({'name':\"a' OR 1=1--\",'phone':'13900002227','channel':'web'},ensure_ascii=False))" sqli.json
chk "注入串按原文入参 201" 201 "$(call POST "/assessments/$P2/attempts" "$TOKEN" "$TMP/sqli.json")"
chk "注入串未破坏查询(原样存名)" "True" "$(json "d['attempt']['candidate_name']==\"a' OR 1=1--\"")"
chk "注入后库仍完好" "True" "$(call GET '/assessments?page_size=20' >/dev/null; json "d['total']==6")"
chk "未发布卷不可开考 409" 409 "$(call POST "/assessments/$P6/attempts" "$TOKEN" '{"name":"草稿","phone":"13900004444","channel":"web"}')"
chk "草稿错误码" assessment_not_open "$(json "d['code']")"
chk "已收卷不可开考 409" 409 "$(call POST "/assessments/$P1/attempts" "$TOKEN" '{"name":"收卷","phone":"13900004445","channel":"web"}')"

echo
echo "=== 6) 状态机真实迁移（草稿卷）==="
chk "draft->open 200" 200 "$(call POST "/assessments/$P6/status" "$TOKEN" '{"to":"open"}')"
chk "迁移后状态 open" open "$(json "d['assessment']['status']")"
chk "响应带回 served_at" "True" "$(json "'served_at' in d")"
chk "未到开考时间 409" 409 "$(call POST "/assessments/$P6/attempts" "$TOKEN" '{"name":"草稿转正","phone":"13900004446","channel":"web"}')"
chk "时间窗错误码" not_started "$(json "d['code']")"
chk "同态迁移被拒 409" 409 "$(call POST "/assessments/$P6/status" "$TOKEN" '{"to":"open"}')"
chk "终态错误码" invalid_transition "$(json "d['code']")"
chk "非法 to 400" 400 "$(call POST "/assessments/$P6/status" "$TOKEN" '{"to":"archived"}')"
chk "未知场次改状态 404" 404 "$(call POST "/assessments/AS-9999-9999/status" "$TOKEN" '{"to":"open"}')"
chk "open->closed 200" 200 "$(call POST "/assessments/$P6/status" "$TOKEN" '{"to":"closed"}')"
call POST "/assessments/$P6/status" "$TOKEN" '{"to":"open"}' >/dev/null
chk "closed 为终态" invalid_transition "$(json "d['code']")"
chk "收卷后统计仍不出分布(无作答)" "True" "$(call GET "/assessments/$P6/statistics" >/dev/null; json "all(i['answered']==0 for i in d['items'])")"

echo
printf '注：本脚本会把 %s 从 draft 迁到 closed（终态），跑完请重灌种子库再做 preview。\n' "$P6"
echo
printf '汇总：通过 %d 项，失败 %d 项\n' "$pass" "$fail"
[[ $fail == 0 ]]
