#!/usr/bin/env python3
"""从接口反查冒烟测试样本，输出可 eval 的 shell 赋值。

冒烟脚本因此不硬编码任何条码 / 证号 / 借阅 ID：样本全部由运行中的实例给出，
换一套种子数据脚本照样能跑。任一键为空即说明种子覆盖不足（api-smoke.sh 会断言）。

用法：BASE=http://127.0.0.1:18401 [TOKEN=xxx] python3 scripts/probe-samples.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

BASE = (os.environ.get("BASE") or "http://127.0.0.1:18401").rstrip("/")
TOKEN = os.environ.get("TOKEN") or os.environ.get("ADMIN_TOKEN") or ""


def get(path: str):
    with urllib.request.urlopen(BASE + path, timeout=10) as r:
        return json.loads(r.read())


def main() -> int:
    out: dict[str, str] = {}

    # 1) 一本有在架复本、且允许外借的书
    for it in get("/api/items?status=available&page_size=100")["items"]:
        if it["category"] == "reference":
            continue
        detail = get("/api/items/" + it["code"])
        free = [c["barcode"] for c in detail["copies"] if c["status"] == "available"]
        if free:
            out["ITEM_CODE"] = it["code"]
            out["BARCODE"] = free[0]
            break

    # 2) 参考工具书的在架复本（用于 409 reference_only）
    for it in get("/api/items?category=reference&page_size=50")["items"]:
        free = [c["barcode"] for c in get("/api/items/" + it["code"])["copies"] if c["status"] == "available"]
        if free:
            out["BARCODE_REF"] = free[0]
            break

    # 3) 证号空间扫描：可借的正常读者 / 停用 / 欠费超门槛 / 学生证
    ok_cards: list[tuple[str, str, int]] = []
    suspended: list[str] = []
    gated: list[str] = []
    for i in range(1, 61):
        card = "R-2026-%04d" % i
        try:
            m = get("/api/members/" + card)["member"]
        except urllib.error.HTTPError:
            continue
        except Exception:
            continue
        if m["status"] != "active":
            suspended.append(card)
            continue
        if m["outstanding_fine"] >= 3000:
            gated.append(card)
            continue
        if m["active_loans"] < m["quota"]:
            ok_cards.append((card, m["member_type"], m["quota"] - m["active_loans"]))
    if ok_cards:
        out["CARD"] = ok_cards[0][0]
        students = [c for c in ok_cards if c[1] == "student"]
        students.sort(key=lambda c: c[2])
        out["CARD_STUDENT"] = students[0][0] if students else ""
    out["CARD_SUSPENDED"] = suspended[0] if suspended else ""
    out["CARD_FINE"] = gated[0] if gated else ""

    # 4) 借阅样本：在借 / 逾期在借 / 已还且有罚金
    loans = get("/api/loans?page_size=100&sort=borrowed&dir=desc")["items"]
    out["LOAN_ACTIVE"] = next((str(l["id"]) for l in loans if l["status"] == "active"), "")
    out["LOAN_OVERDUE"] = next((str(l["id"]) for l in loans if l["status"] == "active" and l["overdue_days"] > 0), "")
    fined = [l for l in get("/api/loans?status=returned&page_size=100&sort=fine&dir=desc")["items"] if l["fine_cents"] > 0]
    out["LOAN_FINED"] = str(fined[0]["id"]) if fined else ""

    keys = ("ITEM_CODE", "BARCODE", "BARCODE_REF", "CARD", "CARD_STUDENT", "CARD_SUSPENDED",
            "CARD_FINE", "LOAN_ACTIVE", "LOAN_OVERDUE", "LOAN_FINED")
    for k in keys:
        v = out.get(k, "")
        # 输出会被 shell eval，因此只允许安全字符（条码/证号/ID 全部落在这个集合里）
        if any(ch not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for ch in v):
            v = ""
        print(f'{k}="{v}"')
    return 0


if __name__ == "__main__":
    sys.exit(main())
