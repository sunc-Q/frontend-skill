#!/usr/bin/env bash
# 接口冒烟：7 个端点 + 写接口鉴权/校验/库存矩阵。
# 只读接口打印关键统计，写接口断言 HTTP 状态码；任一断言失败即非 0 退出。
# 用法：API=http://127.0.0.1:8080 TOKEN="$ADMIN_TOKEN" bash scripts/api-smoke.sh
#       （TOKEN 只从你自己的 shell 环境传入，绝不写进文件或提交）
set -uo pipefail
API="${API:-http://127.0.0.1:8080}"
TOKEN="${TOKEN:-}"
export OUT=/tmp/smoke.$$.json
fails=0
trap 'rm -f "$OUT"' EXIT

q() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.env.OUT,"utf8"));console.log('"$1"')' ; }

check() {
  local want="$1" name="$2"; shift 2
  local code
  code="$(curl -s -o "$OUT" -w '%{http_code}' "$@")"
  if [ "$code" = "$want" ]; then
    printf '  ok    %-44s -> %s\n' "$name" "$code"
  else
    printf '  FAIL  %-44s -> %s (want %s) %s\n' "$name" "$code" "$want" "$(head -c 240 "$OUT")"
    fails=$((fails + 1))
  fi
}

jget() { # jget <说明> <JS 表达式>（对上一次 check 的响应求值）
  local v; v=$(q "$2")
  printf '  %-44s = %s\n' "$1" "$v"
  echo "$v" > /tmp/smoke.val.$$.txt
}
jval() { cat /tmp/smoke.val.$$.txt; }

echo "== 读接口 =="
code=$(curl -s -o "$OUT" -w '%{http_code}' "$API/api/health"); printf '  health %s status=%s\n' "$code" "$(q 'j.status')"

check 200 "meta" "$API/api/meta"
jget "meta: categories/regions/total/listed" '`${j.categories.length}/${j.regions.length}/${j.stats.total}/${j.stats.listed}`'
[ "$(jval)" = "5/5/18/17" ] || { echo "  FAIL meta 口径不符"; fails=$((fails+1)); }

check 200 "products 默认按 30 天销量降序" "$API/api/products?page_size=5"
jget "products total / 首行 / 销量序" '`${j.total}|${j.items[0].sku}|${j.items.map(p=>p.sold_30).join(",")}`'

check 200 "sort=price asc" "$API/api/products?sort=price&dir=asc&page_size=60"
jget "价格升序首末" '`${j.items[0].price_cents}..${j.items[17].price_cents}`'

check 200 "category=户外运动" "$API/api/products?category=%E6%88%B7%E5%A4%96%E8%BF%90%E5%8A%A8"
jget "户外运动总数" 'j.total'

check 200 "in_stock=1" "$API/api/products?in_stock=1&page_size=60"
jget "有货总数" 'j.total'

check 200 "q 注入串（应为 0 条）" "$API/api/products?q=x%27%20OR%20%271%27%3D%271"
jget "注入命中数" 'j.total'

check 200 "page_size 夹紧 60" "$API/api/products?page_size=999"
jget "实得行数上限" 'j.items.length<=60'

check 200 "详情 CB-HM-0011" "$API/api/products/CB-HM-0011"
jget "详情 sku/两路评价数一致" '`${j.product.sku}:${j.product.review_cnt===j.stats.count}`'

check 404 "详情 不存在 SKU" "$API/api/products/CB-ZZ-9999"
check 200 "评价列表" "$API/api/products/CB-EL-0003/reviews?page_size=5"
jget "评价分页条数" 'j.items.length'

echo; echo "== 购物车（读 + 公开写） =="
check 200 "cart region=US" "$API/api/cart?region=US"
jget "cart 行数/件数/US 总到手" '`${j.lines.length}|${j.item_qty}|${j.totals.find(t=>t.code==="US").total_cents}`'
usbefore=$(jval)

check 200 "cart region=jp（大小写不敏感）" "$API/api/cart?region=jp"
jget "JP 免税前关税" 'j.totals.find(t=>t.code==="JP").duty_cents'

check 400 "cart 未知目的国" "$API/api/cart?region=XX"

check 200 "加购 CB-OU-0021 x1" -X POST "$API/api/cart/items?region=US" -H 'Content-Type: application/json' -d '{"sku":"CB-OU-0021","qty":1}'
jget "加购后行数" 'j.lines.length'

check 200 "覆盖数量 CB-OU-0021 x2" -X POST "$API/api/cart/items" -H 'Content-Type: application/json' -d '{"sku":"CB-OU-0021","qty":2}'
jget "覆盖后行数（应仍为 4）" 'j.lines.length'

check 409 "加购零库存 CB-EL-0004" -X POST "$API/api/cart/items" -H 'Content-Type: application/json' -d '{"sku":"CB-EL-0004","qty":1}'
check 409 "加购已下架 CB-AP-0034" -X POST "$API/api/cart/items" -H 'Content-Type: application/json' -d '{"sku":"CB-AP-0034","qty":1}'
check 409 "超库存 CB-HM-0013 x33" -X POST "$API/api/cart/items" -H 'Content-Type: application/json' -d '{"sku":"CB-HM-0013","qty":33}'
check 404 "加购不存在 SKU" -X POST "$API/api/cart/items" -H 'Content-Type: application/json' -d '{"sku":"CB-NO-0000","qty":1}'
check 400 "数量为负" -X POST "$API/api/cart/items" -H 'Content-Type: application/json' -d '{"sku":"CB-EL-0001","qty":-1}'
check 400 "sku 含非法字符" -X POST "$API/api/cart/items" -H 'Content-Type: application/json' -d '{"sku":"CB EL 0001","qty":1}'

check 200 "移除 CB-OU-0021（qty=0）" -X POST "$API/api/cart/items" -H 'Content-Type: application/json' -d '{"sku":"CB-OU-0021","qty":0}'
check 200 "收敛：US 购物车回到初始" "$API/api/cart?region=US"
usafter=$(q '`${j.lines.length}|${j.item_qty}|${j.totals.find(t=>t.code==="US").total_cents}`')
if [ "$usafter" = "$usbefore" ]; then
  printf '  ok    %-44s = %s\n' "失败矩阵未污染购物车" "$usafter"
else
  printf '  FAIL  购物车被污染：%s -> %s\n' "$usbefore" "$usafter"; fails=$((fails+1))
fi

echo; echo "== 管理写接口（鉴权矩阵） =="
BODY='{"sku":"CB-QA-7001","name":"冒烟测试品","name_en":"Smoke Test Item","category":"消费电子","brand":"冒烟牌","price_cents":1234,"stock":7,"weight_g":150,"hs_code":"8517.62","origin":"中国·测试","lead_min_days":1,"lead_max_days":2}'
check 401 "无 Authorization" -X POST "$API/api/admin/products" -H 'Content-Type: application/json' -d "$BODY"
check 401 "缺 Bearer 前缀" -X POST "$API/api/admin/products" -H "Authorization: $TOKEN" -H 'Content-Type: application/json' -d "$BODY"
check 403 "错误令牌" -X POST "$API/api/admin/products" -H 'Authorization: Bearer wrong-token' -H 'Content-Type: application/json' -d "$BODY"
if [ -n "$TOKEN" ]; then
  check 201 "正确令牌上新" -X POST "$API/api/admin/products" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$BODY"
  check 409 "重复 SKU" -X POST "$API/api/admin/products" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$BODY"
  check 400 "字段全非法（逐字段回显）" -X POST "$API/api/admin/products" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"sku":"ab","name":"灯","category":"军火","price_cents":0,"stock":-1,"weight_g":0,"hs_code":"x1","lead_min_days":5,"lead_max_days":2}'
  jget "字段错误数" 'Object.keys(j.fields).length'
  check 200 "上新后可见（total=19）" "$API/api/products?page_size=60"
  jget "商品总数" 'j.total'
  [ "$(jval)" = "19" ] || { echo "  FAIL 上新未入库"; fails=$((fails+1)); }
else
  echo "  skip  TOKEN 未提供，跳过写入分支（503 fail-closed 由独立实例验证）"
fi

echo
if [ "$fails" -eq 0 ]; then echo "ALL PASS"; else echo "$fails FAILURES"; exit 1; fi
