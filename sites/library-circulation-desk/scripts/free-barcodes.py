#!/usr/bin/env python3
"""列出可用于连续借出的复本条码（每行一个）。

配额类断言需要「一直借到上限」，而单本书的在架复本撑不起学生证 5 册的配额，
所以这里跨书目取样：只取非参考工具书（reference 一律不外借）且当前在架的复本。

用法：BASE=http://127.0.0.1:18401 [COUNT=12] python3 scripts/free-barcodes.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

BASE = os.environ.get("BASE", "http://127.0.0.1:18401")
COUNT = int(os.environ.get("COUNT", "12"))


def get(path: str) -> dict:
    with urllib.request.urlopen(BASE + path, timeout=15) as resp:
        return json.loads(resp.read())


def main() -> int:
    items = get("/api/items?page_size=100")["items"]
    pool = [i for i in items if i["category"] != "reference" and i["available_copies"] > 0]
    pool.sort(key=lambda i: -i["available_copies"])
    got = 0
    for it in pool:
        if got >= COUNT:
            break
        for c in get("/api/items/" + it["code"])["copies"]:
            if c["status"] == "available":
                print(c["barcode"])
                got += 1
                if got >= COUNT:
                    break
    if got == 0:
        print("没有可用复本", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
