#!/usr/bin/env python3
"""按证号列出该读者当前的在借单 ID（空格分隔，供 shell 循环归还）。

冒烟脚本的配额段落需要「借到上限」，同一个库重跑时该读者可能已经借满，
所以先把旧单归还再重放。用法：
  BASE=http://127.0.0.1:18401 CARD=R-2026-0007 python3 scripts/list-active-loans.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request

BASE = os.environ.get("BASE", "http://127.0.0.1:18401")
CARD = os.environ.get("CARD", "")


def main() -> int:
    if not CARD:
        print("缺少 CARD", file=sys.stderr)
        return 2
    url = BASE + "/api/loans?q=" + urllib.parse.quote(CARD) + "&status=active&page_size=100"
    with urllib.request.urlopen(url, timeout=15) as resp:
        rows = json.loads(resp.read())["items"]
    # q 是跨表模糊检索，还要按证号本身过滤一遍，避免误还别人的单
    ids = [str(r["id"]) for r in rows if r.get("member_card") == CARD and r["status"] == "active"]
    print(" ".join(ids))
    return 0


if __name__ == "__main__":
    sys.exit(main())
