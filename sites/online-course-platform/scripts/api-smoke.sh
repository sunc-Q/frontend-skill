#!/usr/bin/env bash
# 学阶公开课 · 逐接口冒烟：断言每个接口的状态码与关键字段口径。
# 用法：BASE=http://127.0.0.1:8093/api TOKEN=dev-admin-token-2026 bash scripts/api-smoke.sh
# 注意：本脚本会向运行库写入数据（报名/进度/状态迁移），跑完需重置库再生成 preview。
set -euo pipefail
BASE="${BASE:-http://127.0.0.1:8093/api}"
TOKEN="${TOKEN:?需要 TOKEN}"
pass=0; fail=0

chk() { # chk <名称> <期望> <实际>
  if [[ "$2" == "$3" ]]; then pass=$((pass+1)); echo "ok   $1 ($3)";
  else fail=$((fail+1)); echo "FAIL $1: want $2 got $3"; fi
}
jget() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(\"d$1\"))" 2>/dev/null; }

req() { # req METHOD PATH [token] [json]
  local m=$1 p=$2 t=${3:-} b=${4:-}
  if [[ -n $b ]]; then
    curl -sS -o /tmp/smoke.body -w '%{http_code}' -X "$m" "$BASE$p" \
      ${t:+-H "Authorization: Bearer $t"} -H 'Content-Type: application/json' -d "$b"
  else
    curl -sS -o /tmp/smoke.body -w '%{http_code}' -X "$m" "$BASE$p" ${t:+-H "Authorization: Bearer $t"}
  fi
}

echo "== 读接口 =="
chk health 200 "$(req GET /health)"
chk stats 200 "$(req GET /stats)"
chk "在售=13" 13 "$(jget "['published_courses']" < /tmp/smoke.body)"
chk "GMV>0" True "$(python3 -c "import json;d=json.load(open('/tmp/smoke.body'));print(d['gmv_cents']>0)")"
chk courses默认 200 "$(req GET '/courses?page_size=8&sort=fill&dir=desc')"
chk "首行满座" True "$(python3 -c "import json;d=json.load(open('/tmp/smoke.body'));print(d['items'][0]['fill_pct']>=100)")"
chk page_size大值仍200 200 "$(req GET '/courses?page_size=99999')"
chk "钳制值=100" 100 "$(jget "['page_size']" < /tmp/smoke.body)"
chk "非法sort收敛仍200" 200 "$(req GET '/courses?sort=;DROP%20TABLE')"
chk early过滤 200 "$(req GET '/courses?early=1')"
chk "early全在跑" True "$(python3 -c "import json;d=json.load(open('/tmp/smoke.body'));print(all(i['early_now'] for i in d['items']))")"
chk 域过滤 200 "$(req GET '/courses?domain=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD')"
chk "域过滤纯净" True "$(python3 -c "import json;d=json.load(open('/tmp/smoke.body'));print(all(i['domain']=='人工智能' for i in d['items']))")"
chk 搜索LIKE转义 200 "$(req GET '/courses?q=%25')"
chk "LIKE未逃逸" "0" "$(jget "['total']" < /tmp/smoke.body)"
chk 详情DS-101 200 "$(req GET /courses/DS-101)"
chk "详情无raw-phone" 0 "$(python3 -c "import json;d=json.load(open('/tmp/smoke.body'));print(sum(1 for e in d['recent_enrollments'] if 'phone' in e and 'masked_phone' not in e and e.get('phone')))")"
chk "详情有脱敏" 12 "$(python3 -c "import json;d=json.load(open('/tmp/smoke.body'));print(len(d['recent_enrollments']))" )"
chk 注入code404 404 "$(req GET "/courses/DS';DROP")"
chk 未知api404json 404 "$(req GET /nope)"
chk instructors 200 "$(req GET /instructors)"
chk "讲师=6" 6 "$(jget "['total']" < /tmp/smoke.body)"

echo "== 鉴权矩阵 =="
chk "无token401" 401 "$(req POST /admin/enrollments '' '{"course_code":"FE-120","name":"甲","phone":"13700000001","source":"official"}')"
chk "错token403" 403 "$(req POST /admin/enrollments WRONG '{"course_code":"FE-120","name":"甲","phone":"13700000001","source":"official"}')"

echo "== 校验边界 =="
chk "坏手机号400" 400 "$(req POST /admin/enrollments "$TOKEN" '{"course_code":"FE-120","name":"边界甲","phone":"13800000000 OR 1=1--","source":"official"}')"
chk "回显phone" phone "$(python3 -c "import json;d=json.load(open('/tmp/smoke.body'));print('phone' in d['fields'])" | sed 's/True/phone/;s/False/missing/')"
chk "姓名超长400" 400 "$(req POST /admin/enrollments "$TOKEN" "{\"course_code\":\"FE-120\",\"name\":\"$(python3 -c "print('赵'*40)")\",\"phone\":\"13700000002\",\"source\":\"official\"}")"
chk "渠道注入400" 400 "$(req POST /admin/enrollments "$TOKEN" '{"course_code":"FE-120","name":"边界乙","phone":"13700000003","source":"%$&"}')"
chk "进度越界400" 400 "$(req POST /admin/enrollments/1/progress "$TOKEN" '{"progress_pct":101}')"

echo "== 正常业务流 =="
code=$(req POST /admin/enrollments "$TOKEN" '{"course_code":"FE-260","name":"冒烟学员","phone":"13700000011","source":"official"}')
chk "报名201" 201 "$code"
EID=$(jget "['enrollment']['id']" < /tmp/smoke.body)
chk "价格恒等" True "$(python3 -c "import json;e=json.load(open('/tmp/smoke.body'))['enrollment'];print(e['paid_cents']==e['list_price']-e['discount'])")"
chk "重复409" 409 "$(req POST /admin/enrollments "$TOKEN" '{"course_code":"FE-260","name":"冒烟学员","phone":"13700000011","source":"official"}')"
chk "满座→候补" 201 "$(req POST /admin/enrollments "$TOKEN" '{"course_code":"DS-101","name":"候补甲","phone":"13700000012","source":"campus"}')"
chk "候补零扣费" "waitlist 0" "$(python3 -c "import json;e=json.load(open('/tmp/smoke.body'))['enrollment'];print(e['status'],e['paid_cents'])")"
chk "推进度200" 200 "$(req POST "/admin/enrollments/$EID/progress" "$TOKEN" '{"progress_pct":88}')"
req POST "/admin/enrollments/$EID/progress" "$TOKEN" '{"progress_pct":100}' >/dev/null
chk "100自动结课" completed "$(jget "['enrollment']['status']" < /tmp/smoke.body)"
chk "结课后409" 409 "$(req POST "/admin/enrollments/$EID/progress" "$TOKEN" '{"progress_pct":50}')"
chk "草稿上架200" 200 "$(req POST /admin/courses/SEC-310/status "$TOKEN" '{"to":"published"}')"
chk "重复上架409" 409 "$(req POST /admin/courses/SEC-310/status "$TOKEN" '{"to":"published"}')"
req GET /stats >/dev/null
chk "在售变14" 14 "$(jget "['published_courses']" < /tmp/smoke.body)"
chk "归档200" 200 "$(req POST /admin/courses/AI-380/status "$TOKEN" '{"to":"archived"}')"
chk "非法to400" 400 "$(req POST /admin/courses/PM-130/status "$TOKEN" '{"to":"draft"}')"

echo
echo "pass=$pass fail=$fail"
[[ $fail -eq 0 ]]
