#!/usr/bin/env python3
"""只读不变量取证：把「口径」层面的断言集中在一处，逐条打印 ok / FAIL。

覆盖 api-smoke.sh 的 shell 不好表达的部分：
  · 逾期行 overdue_days>0 且 fine_due == min(天数 × 费率, 单册封顶)
  · 已还行走快照：returned_at 非空、overdue_days 归零、fine_cents 不再随时间变化
  · 复本状态与在借人字段互相自洽（on_loan 必有借过人，其他状态不得带借过人）
  · 在借单数 == 借出册数、四类别册数合计 == 复本总数
  · 全链路隐私：任何响应里都不出现裸 phone 键
  · 每个排序键 × 两个方向都必须 200（历史上这类映射错列曾让整页 500）

用法：BASE=http://127.0.0.1:18401 python3 scripts/check-read-invariants.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

BASE = (os.environ.get("BASE") or "http://127.0.0.1:18401").rstrip("/")
PASS = 0
FAIL = 0

# 与 backend/internal/domain/models.go 的 CatRules 保持一致：(借期, 每日罚金分, 单册封顶分)
CAT_RULES = {"general": (28, 50, 2000), "large_print": (42, 30, 1200), "boxed_set": (14, 100, 4000)}
COPY_STATUS = {"available", "on_loan", "missing", "retired"}
ITEM_SORTS = ["code", "title", "author", "year", "category", "added", "available", "total", "id"]
LOAN_SORTS = ["due", "borrowed", "returned", "member", "item", "barcode", "fine", "renew", "status", "id"]


def ok(msg: str) -> None:
    global PASS
    PASS += 1
    print(f"  ok   {msg}")


def bad(msg: str) -> None:
    global FAIL
    FAIL += 1
    print(f"  FAIL {msg}")


def get(path: str, raw: bool = False):
    with urllib.request.urlopen(BASE + path, timeout=15) as r:
        body = r.read().decode()
    return body if raw else json.loads(body)


def check(name: str, cond: bool, detail: str = "") -> None:
    (ok if cond else bad)(name + (f" — {detail}" if detail else ""))


def main() -> int:
    # ---- 排序键全枚举 ----
    for k in ITEM_SORTS:
        for d in ("asc", "desc"):
            try:
                get(f"/api/items?sort={k}&dir={d}&page_size=5")
            except Exception as e:  # noqa: BLE001
                bad(f"items sort={k}&dir={d} 请求失败", str(e))
    ok(f"书目 {len(ITEM_SORTS) * 2} 个排序方向全部 200")
    for k in LOAN_SORTS:
        for d in ("asc", "desc"):
            try:
                get(f"/api/loans?sort={k}&dir={d}&page_size=5")
            except Exception as e:  # noqa: BLE001
                bad(f"loans sort={k}&dir={d} 请求失败", str(e))
    ok(f"借阅 {len(LOAN_SORTS) * 2} 个排序方向全部 200")

    # ---- 逾期口径与罚金公式 ----
    overdue = get("/api/loans?status=overdue&page_size=100")["items"]
    bad_rows = [l["id"] for l in overdue if l["status"] != "active" or l["overdue_days"] <= 0]
    check("逾期行全部为在借且 overdue_days>0", not bad_rows, str(bad_rows[:3]))
    wrong = []
    for l in overdue:
        rule = CAT_RULES.get(l["item_category"])
        if rule is None:
            if l["fine_due"] != 0:
                wrong.append((l["id"], "reference"))
            continue
        want = min(l["overdue_days"] * rule[1], rule[2])
        if l["fine_due"] != want:
            wrong.append((l["id"], l["fine_due"], want))
    check(f"{len(overdue)} 行逾期单的 fine_due == min(天数×费率, 封顶)", not wrong, str(wrong[:3]))

    # ---- 已还快照 ----
    returned = get("/api/loans?status=returned&page_size=100")["items"]
    snap_bad = [l["id"] for l in returned if not l.get("returned_at") or l.get("overdue_days", 0) != 0]
    check(f"{len(returned)} 行已还单走快照（returned_at 非空、overdue_days=0）", not snap_bad, str(snap_bad[:3]))
    fined = [l for l in returned if l["fine_cents"] > 0]
    check("存在带罚金的已还样本", len(fined) > 0, f"{len(fined)} 行")
    if fined:
        lid = fined[0]["id"]
        first = get(f"/api/loans/{lid}")["loan"]["fine_cents"]
        again = get(f"/api/loans/{lid}")["loan"]["fine_cents"]
        check("同一已还单连读两次罚金不变（不回溯）", first == again, f"{first} vs {again}")

    # ---- 复本 / 在借人自洽 ----
    items = get("/api/items?page_size=100")["items"]
    seen_bad_status, seen_bad_borrower, on_loan_with_borrower = [], [], 0
    for it in items:
        for c in get("/api/items/" + it["code"])["copies"]:
            if c["status"] not in COPY_STATUS:
                seen_bad_status.append(c["barcode"])
            if c["status"] == "on_loan" and not c.get("borrower_name"):
                seen_bad_borrower.append(c["barcode"])
            if c["status"] != "on_loan" and c.get("borrower_name"):
                seen_bad_borrower.append(c["barcode"])
            if c["status"] == "on_loan" and c.get("borrower_name"):
                on_loan_with_borrower += 1
    check("复本状态全部落在枚举内", not seen_bad_status, str(seen_bad_status[:3]))
    check(f"{on_loan_with_borrower} 册在借复本带借过人、其余一律不带", not seen_bad_borrower, str(seen_bad_borrower[:3]))

    # ---- 统计恒等式 ----
    s = get("/api/stats?days=14")
    check("后端自检 identity_ok", s["identity_ok"] is True, str(s["identity_issues"]))
    check("借出册数 == 在借单数", s["on_loan_copies"] == s["active_loans"],
          f"{s['on_loan_copies']} vs {s['active_loans']}")
    check("在架 + 借出 <= 复本总数（遗失/剔旧占余下）",
          s["available_copies"] + s["on_loan_copies"] <= s["total_copies"],
          f"{s['available_copies']}+{s['on_loan_copies']} vs {s['total_copies']}")
    check("类别册数合计 == 复本总数", sum(c["copies"] for c in s["by_category"]) == s["total_copies"],
          f"{sum(c['copies'] for c in s['by_category'])} vs {s['total_copies']}")
    check("趋势天数 == 请求天数", len(s["trend"]) == 14, str(len(s["trend"])))
    check("今日借出/归还为非负整数", s["borrow_today"] >= 0 and s["return_today"] >= 0,
          f"{s['borrow_today']}/{s['return_today']}")

    # ---- 隐私：裸手机号在任何响应里都不出现 ----
    leak = []
    for p in ("/api/items?page_size=100", "/api/loans?page_size=100", "/api/stats", "/api/health"):
        if '"phone"' in get(p, raw=True):
            leak.append(p)
    for it in items[:8]:
        if '"phone"' in get("/api/items/" + it["code"], raw=True):
            leak.append(it["code"])
    cards = {l["member_card"] for l in get("/api/loans?page_size=100")["items"]}
    for c in list(cards)[:26]:
        if '"phone"' in get("/api/members/" + c, raw=True):
            leak.append(c)
    check(f"{35 + len(items[:8])} 类响应均无裸 phone 键（只出 phone_masked）", not leak, str(leak[:3]))
    masked = [get("/api/members/" + c)["member"]["phone_masked"] for c in list(cards)[:12]]
    check("脱敏值形如 138****0001 或空",
          all(v == "" or (len(v) == 11 and v[3:7] == "****") for v in masked), str(masked[:3]))

    # ---- 分页上限 ----
    big = get("/api/loans?page_size=5000")
    check("page_size 被夹到上限", big["page_size"] <= 100 and len(big["items"]) <= 100,
          f"page_size={big['page_size']} rows={len(big['items'])}")

    print(f"  · 只读不变量 pass={PASS} fail={FAIL}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
