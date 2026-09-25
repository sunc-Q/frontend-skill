#!/usr/bin/env bash
# 椒麻快送 · 逐接口冒烟：断言每个接口的状态码与关键字段口径。
# 用法：BASE=http://127.0.0.1:8093/api TOKEN=xxx bash scripts/api-smoke.sh
# 注意：本脚本会向运行库写入数据（下单/状态推进/售罄切换），跑完需重置库再生成 preview。
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

GOOD='{"recipient":"冒烟顾客","phone":"13712340001","zone":"near","address":"天府大道 500 号 1 栋 1 单元 101","note":"多加辣","items":[{"code":"HOT-011","qty":1},{"code":"STP-034","qty":2}]}'

echo "== 读接口 =="
chk health 200 "$(req GET /health)"
chk stats 200 "$(req GET /stats)"
chk "菜品26/在售23" "26 23" "$(python3 -c "import json;d=json.load(open('/tmp/smoke.body'));print(d['dishes_total'],d['dishes_available'])")"
chk "GMV>0" True "$(python3 -c "import json;d=json.load(open('/tmp/smoke.body'));print(d['gmv_cents']>0)")"
chk "by_status之和=总数" True "$(python3 -c "import json;d=json.load(open('/tmp/smoke.body'));print(sum(d['by_status'].values())==d['orders_total'])")"
chk "Top菜6行" 6 "$(jget "['top_dishes'].__len__()" < /tmp/smoke.body)"
chk menu 200 "$(req GET '/menu?page_size=100')"
chk "菜单恒等式" True "$(python3 -c "import json;d=json.load(open('/tmp/smoke.body'));print(all(i['price_cents']>0 and i['sold_total']>=0 for i in d['items']))")"
chk "分类过滤hot纯净" True "$(req GET '/menu?category=hot&page_size=100' >/dev/null; python3 -c "import json;d=json.load(open('/tmp/smoke.body'));print(all(i['category']=='hot' for i in d['items']) and d['total']==10)")"
chk "available=1得23" 23 "$(req GET '/menu?available=1&page_size=100' >/dev/null; jget "['total']" < /tmp/smoke.body)"
chk "搜索 LIKE% 转义" 0 "$(req GET '/menu?q=%25' >/dev/null; jget "['total']" < /tmp/smoke.body)"
chk "中文菜名搜索" 1 "$(req GET '/menu?q=%E9%BA%BB%E5%A9%86%E8%B1%86%E8%85%90' >/dev/null; jget "['total']" < /tmp/smoke.body)"
chk zones 200 "$(req GET /zones)"
chk "zones=4(不含停用)" 4 "$(jget "['total']" < /tmp/smoke.body)"
chk orders 200 "$(req GET '/orders?page_size=10')"
chk "page_size钳制100" 100 "$(req GET '/orders?page_size=99999' >/dev/null; jget "['page_size']" < /tmp/smoke.body)"
chk "非法sort收敛200" 200 "$(req GET '/orders?sort=;DROP%20TABLE')"
chk "status=cooking纯净" True "$(req GET '/orders?status=cooking&page_size=100' >/dev/null; python3 -c "import json;d=json.load(open('/tmp/smoke.body'));print(all(i['status']=='cooking' for i in d['items']))")"
chk "列表无raw-phone" True "$(req GET '/orders?page_size=100' >/dev/null; python3 -c "import json;d=json.load(open('/tmp/smoke.body'));print(all('phone' not in i and '138' not in str(i.get('masked_phone',''))[3:] for i in d['items']))")"
chk "列表金额恒等式" True "$(python3 -c "import json;d=json.load(open('/tmp/smoke.body'));print(all(i['total_cents']==i['subtotal_cents']+i['delivery_fee_cents'] for i in d['items']))")"
chk "单号搜索命中" True "$(req GET '/orders?q=FD2026' >/dev/null; python3 -c "import json;d=json.load(open('/tmp/smoke.body'));print(d['total']>0)")"
chk 未知api404json 404 "$(req GET /nope)"
chk "404是JSON" not_found "$(jget "['code']" < /tmp/smoke.body)"

echo "== 订单详情 =="
OID=$(req GET '/orders?status=delivered&page_size=1' >/dev/null; jget "['items'][0]['id']" < /tmp/smoke.body)
chk 详情200 200 "$(req GET "/orders/$OID")"
chk "详情含明细" True "$(python3 -c "import json;d=json.load(open('/tmp/smoke.body'));s=sum(i['line_cents'] for i in d['items']);print(s==d['order']['subtotal_cents'] and len(d['items'])>0)")"
chk "详情脱敏形态" True "$(python3 -c "import json,re;d=json.load(open('/tmp/smoke.body'));print(bool(re.fullmatch(r'1\d{2}\*{4}\d{4}',d['order']['masked_phone'])) and 'phone' not in d['order'])")"
chk 注入单号404 404 "$(req GET "/orders/99999999")"
chk 非法id400 400 "$(req GET '/orders/abc')"

echo "== 公开下单（金额口径） =="
chk "合法下单201" 201 "$(req POST /orders '' "$GOOD")"
chk "实付=小计+配送费" True "$(python3 -c "import json;d=json.load(open('/tmp/smoke.body'));o=d['order'];print(o['total_cents']==o['subtotal_cents']+o['delivery_fee_cents'])")"
chk "金额=2800+600+0" 3400 "$(jget "['order']['total_cents']" < /tmp/smoke.body)"
chk "新单placed" placed "$(jget "['order']['status']" < /tmp/smoke.body)"
chk "脱敏137****0001" "137****0001" "$(jget "['order']['masked_phone']" < /tmp/smoke.body)"
NEWID=$(jget "['order']['id']" < /tmp/smoke.body)
NEWNO=$(req GET "/orders/$NEWID" >/dev/null; jget "['order']['order_no']" < /tmp/smoke.body)
chk "单号FD前缀" True "$(python3 -c "print('$NEWNO'.startswith('FD2026'))")"
chk "中域配送费300且恒等" True "$(req POST /orders '' '{"recipient":"冒烟乙","phone":"13712340010","zone":"mid","address":"天府大道 600 号 2 栋 1 单元 202","items":[{"code":"HOT-011","qty":1},{"code":"STP-034","qty":2}]}' >/dev/null; python3 -c "import json;d=json.load(open('/tmp/smoke.body'));o=d['order'];print(o['delivery_fee_cents']==300 and o['total_cents']==o['subtotal_cents']+300)")"

echo "== 下单校验边界 =="
chk "低于起送价409" 409 "$(req POST /orders '' '{"recipient":"甲","phone":"13712340002","zone":"near","address":"天府大道 1 号 1 栋","items":[{"code":"STP-034","qty":2}]}')"
chk "错误码below_min" below_min_order "$(jget "['code']" < /tmp/smoke.body)"
chk "售罄409" 409 "$(req POST /orders '' '{"recipient":"甲","phone":"13712340003","zone":"near","address":"天府大道 1 号 1 栋","items":[{"code":"HOT-020","qty":1},{"code":"STP-034","qty":2}]}')"
chk "错误码unavailable" dish_unavailable "$(jget "['code']" < /tmp/smoke.body)"
chk "菜品不存在404" 404 "$(req POST /orders '' '{"recipient":"甲","phone":"13712340004","zone":"near","address":"天府大道 1 号 1 栋","items":[{"code":"HOT-999","qty":1}]}')"
chk "停用区域400" 400 "$(req POST /orders '' '{"recipient":"甲","phone":"13712340005","zone":"campus","address":"天府大道 1 号 1 栋","items":[{"code":"STP-034","qty":2}]}')"
chk "回显zone字段" True "$(python3 -c "import json;d=json.load(open('/tmp/smoke.body'));print('zone' in d['fields'])")"
chk "注入编码400" 400 "$(req POST /orders '' '{"recipient":"甲","phone":"13712340006","zone":"near","address":"天府大道 1 号 1 栋","items":[{"code":"HOT\"; DROP","qty":1}]}')"
chk "坏手机号400" 400 "$(req POST /orders '' '{"recipient":"甲","phone":"13800000000 OR 1=1--","zone":"near","address":"天府大道 1 号 1 栋","items":[{"code":"STP-034","qty":2}]}')"
chk "地址XSS400" 400 "$(req POST /orders '' '{"recipient":"甲","phone":"13712340007","zone":"near","address":"<script>alert(1)</script> 号12345678","items":[{"code":"STP-034","qty":2}]}')"
chk "超长备注400" 400 "$(req POST /orders '' "{\"recipient\":\"甲\",\"phone\":\"13712340008\",\"zone\":\"near\",\"address\":\"天府大道 1 号 1 栋\",\"note\":\"$(python3 -c "print('辣'*250)")\",\"items\":[{\"code\":\"STP-034\",\"qty\":2}]}")"
chk "重复菜品行400" 400 "$(req POST /orders '' '{"recipient":"甲","phone":"13712340009","zone":"near","address":"天府大道 1 号 1 栋","items":[{"code":"STP-034","qty":10},{"code":"STP-034","qty":3}]}')"

echo "== 鉴权矩阵 =="
chk "推进无token401" 401 "$(req POST "/admin/orders/$NEWID/status" '' '{"to":"cooking"}')"
chk "推进错token403" 403 "$(req POST "/admin/orders/$NEWID/status" WRONG '{"to":"cooking"}')"
chk "推进正确200" 200 "$(req POST "/admin/orders/$NEWID/status" "$TOKEN" '{"to":"cooking"}')"
chk "已到cooking再推进409" 409 "$(req POST "/admin/orders/$NEWID/status" "$TOKEN" '{"to":"cooking"}')"
chk "跳级409(cooking→delivered)" 409 "$(req POST "/admin/orders/$NEWID/status" "$TOKEN" '{"to":"delivered"}')"
chk "非法to400" 400 "$(req POST "/admin/orders/$NEWID/status" "$TOKEN" '{"to":"teleport"}')"
for st in ready delivering delivered; do
  chk "顺流程→$st" 200 "$(req POST "/admin/orders/$NEWID/status" "$TOKEN" "{\"to\":\"$st\"}")"
done
chk "终态再推进409" 409 "$(req POST "/admin/orders/$NEWID/status" "$TOKEN" '{"to":"cooking"}')"

AVID=$(req GET '/menu?q=%E7%83%A7%E8%82%A5%E8%82%A0' >/dev/null; jget "['items'][0]['id']" < /tmp/smoke.body)
chk "售罄切换无token401" 401 "$(req POST "/admin/dishes/$AVID/availability" '' '{"available":true}')"
chk "恢复在售200" 200 "$(req POST "/admin/dishes/$AVID/availability" "$TOKEN" '{"available":true}')"
chk "在售计数24" 24 "$(req GET /stats >/dev/null; jget "['dishes_available']" < /tmp/smoke.body)"
chk "恢复售罄200" 200 "$(req POST "/admin/dishes/$AVID/availability" "$TOKEN" '{"available":false}')"
chk "缺available400" 400 "$(req POST "/admin/dishes/$AVID/availability" "$TOKEN" '{}')"

echo "== 下单→看板可见性 =="
chk "新单在placed列" True "$(req GET '/orders?status=placed&sort=placed&dir=desc' >/dev/null; python3 -c "import json;d=json.load(open('/tmp/smoke.body'));print(any(i['recipient']=='冒烟乙' for i in d['items']))")"

echo
echo "pass=$pass fail=$fail"
[[ $fail -eq 0 ]]
