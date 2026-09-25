#!/usr/bin/env python3
"""派生三种前端风格的 CSS 产物（乐高积木块面 / Risograph 孔版印刷 / 解构主义拼版）。

约定（写死在流程里，避免手改产物）：
  web/src/styles/base.css          —— 共享结构层，只允许 var(--token)，不含色值
  web/src/styles/tokens-<id>.css   —— 该风格的设计令牌 + 最多几条气质补丁
  →  web/src/styles/theme-<id>.css —— 拼接产物，前端 import 的就是它

三风格 = 同一份 DOM + 同一份 JS，只有这三个 theme-*.css 不同。
用法：python3 scripts/derive-themes.py
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
STYLES = ROOT / "web" / "src" / "styles"
IDS = ["lego", "riso", "decon"]

TOKEN_RE = re.compile(r"var\((--[a-z0-9-]+)")
DECL_RE = re.compile(r"^\s*(--[a-z0-9-]+)\s*:", re.M)


def strip_comments(css: str) -> str:
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def main() -> int:
    base = strip_comments((STYLES / "base.css").read_text(encoding="utf-8"))
    needed = {m for m in TOKEN_RE.findall(base)}
    # 结构层自己定义的局部变量（--tone/--row-bg/--badge-ink/...）不需要主题提供
    local = {m for m in DECL_RE.findall(base)}
    required = needed - local

    failures: list[str] = []
    for tid in IDS:
        tokens_path = STYLES / f"tokens-{tid}.css"
        if not tokens_path.exists():
            failures.append(f"缺少令牌文件 {tokens_path.name}")
            continue
        tokens = tokens_path.read_text(encoding="utf-8")
        provided = {m for m in DECL_RE.findall(strip_comments(tokens))}
        missing = sorted(required - provided)
        if missing:
            failures.append(f"{tid} 缺 token：{', '.join(missing)}")
            continue
        out = (
            f"/* 由 scripts/derive-themes.py 生成，请勿手改。\n"
            f"   来源：web/src/styles/base.css + web/src/styles/tokens-{tid}.css */\n\n"
            + tokens.rstrip() + "\n\n" + base.rstrip() + "\n"
        )
        (STYLES / f"theme-{tid}.css").write_text(out, encoding="utf-8")
        print(f"  ✓ theme-{tid}.css  {len(out.splitlines())} 行 / {len(out.encode()):,} 字节")

    # 结构层不得出现裸色值：出现了就说明风格差异漏进了共享层
    stray = re.findall(r"#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(", base)
    if stray:
        failures.append(f"base.css 里出现了 {len(stray)} 处裸色值，风格会互相污染：{sorted(set(stray))[:6]}")

    if failures:
        for f in failures:
            print(f"  ✗ {f}", file=sys.stderr)
        return 1
    print(f"  · 共享结构 {len(required)} 个 token，三套全部覆盖")
    return 0


if __name__ == "__main__":
    sys.exit(main())
