#!/usr/bin/env python3
"""三风格派生器：同一份 DOM 只换 CSS。

基准 = 模板的 theme-swiss.css（它定义了整套类名与 --token 层）。
每个主题 = 替换 :root 的 token 块 + 追加"本主题专属规则"。
共用组件（房态日历、掩码徽章、选中态）只用 token 写一遍，追加在中间，
所以三主题的差异全部来自 token 与末尾的专属覆盖，绝不复制三份 DOM。

用法：python3 scripts/derive-themes.py
基准文件在本仓库 templates/go-gin-react/web/src/styles/theme-swiss.css。
"""

import io
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
BASE = os.path.join(ROOT, 'templates', 'go-gin-react', 'web', 'src', 'styles', 'theme-swiss.css')
OUT = os.path.join(ROOT, 'sites', 'homestay-booking-calendar', 'web', 'src', 'styles')


def tokens(block):
    out = [':root {', '  /* 本主题的 token 块：换风格只动这里 + 末尾专属规则 */']
    out += ['  %s: %s;' % (k, v) for k, v in block]
    out.append('}')
    return '\n'.join(out)


SKEUO = [
    ('color-scheme', 'light'),
    ('--font-body', "'Avenir Next', 'PingFang SC', 'Hiragino Sans GB', sans-serif"),
    ('--font-display', "'Songti SC', Georgia, 'PingFang SC', serif"),
    ('--font-mono', "'SFMono-Regular', Menlo, Consolas, monospace"),
    ('--bg', '#d8c5a4'),
    ('--bg2', '#f7f0e1'),
    ('--fg', '#3b2a1a'),
    ('--muted', '#7c6449'),
    ('--accent', '#8c4a2f'),
    ('--accent-fg', '#fdf6ea'),
    ('--border', '#6b5238'),
    ('--row-line', '#cbb79a'),
    ('--head-bg', '#5b4630'),
    ('--head-fg', '#f6efe2'),
    ('--sel-bg', '#8c4a2f'),
    ('--sel-fg', '#fff8ec'),
    ('--radius', '14px'),
    ('--radius-sm', '9px'),
    ('--sp-1', '6px'),
    ('--sp-2', '12px'),
    ('--sp-3', '22px'),
    ('--sp-4', '40px'),
    ('--sp-5', '72px'),
    ('--cell-pad', '12px 14px'),
    ('--gap', '18px'),
    ('--fs-body', '15px'),
    ('--fs-h2', '20px'),
    ('--fs-kpi', '38px'),
    ('--lh', '1.68'),
    ('--track', '#cbb79a'),
    ('--ok', '#2f6b45'),
    ('--err', '#a3271f'),
    ('--label-size', '11px'),
    ('--label-transform', 'none'),
    ('--label-style', 'normal'),
    ('--kpi-weight', '700'),
    ('--value-size', '16px'),
    ('--value-weight', '600'),
]

ISO = [
    ('color-scheme', 'dark'),
    ('--font-body', "'Avenir Next', 'PingFang SC', sans-serif"),
    ('--font-display', "'Futura', 'Avenir Next Condensed', 'PingFang SC', sans-serif"),
    ('--font-mono', "'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, monospace"),
    ('--bg', '#0c2340'),
    ('--bg2', '#113255'),
    ('--fg', '#dbe9f5'),
    ('--muted', '#8fb0c9'),
    ('--accent', '#f2a900'),
    ('--accent-fg', '#10233a'),
    ('--border', '#4e86b8'),
    ('--row-line', '#1d4468'),
    ('--head-bg', '#0a1c31'),
    ('--head-fg', '#7fd4ff'),
    ('--sel-bg', '#f2a900'),
    ('--sel-fg', '#0c2340'),
    ('--radius', '2px'),
    ('--radius-sm', '2px'),
    ('--sp-1', '5px'),
    ('--sp-2', '10px'),
    ('--sp-3', '18px'),
    ('--sp-4', '30px'),
    ('--sp-5', '54px'),
    ('--cell-pad', '8px 10px'),
    ('--gap', '10px'),
    ('--fs-body', '13px'),
    ('--fs-h2', '17px'),
    ('--fs-kpi', '32px'),
    ('--lh', '1.5'),
    ('--track', '#1d4468'),
    ('--ok', '#6fd08c'),
    ('--err', '#ff6b6b'),
    ('--label-size', '10px'),
    ('--label-transform', 'uppercase'),
    ('--label-style', 'normal'),
    ('--kpi-weight', '500'),
    ('--value-size', '14px'),
    ('--value-weight', '500'),
]

ACID = [
    ('color-scheme', 'dark'),
    ('--font-body', "'Helvetica Neue', 'PingFang SC', sans-serif"),
    ('--font-display', "'Impact', 'Haettenschweiler', 'Arial Black', 'PingFang SC', sans-serif"),
    ('--font-mono', "'Courier New', Courier, monospace"),
    ('--bg', '#050406'),
    ('--bg2', '#0d0b12'),
    ('--fg', '#f4f1e8'),
    ('--muted', '#8a8598'),
    ('--accent', '#ccff00'),
    ('--accent-fg', '#0a0a0a'),
    ('--border', '#ff4d00'),
    ('--row-line', '#241f2b'),
    ('--head-bg', '#ccff00'),
    ('--head-fg', '#0a0a0a'),
    ('--sel-bg', '#ff4d00'),
    ('--sel-fg', '#08060a'),
    ('--radius', '22px'),
    ('--radius-sm', '6px'),
    ('--sp-1', '8px'),
    ('--sp-2', '16px'),
    ('--sp-3', '28px'),
    ('--sp-4', '52px'),
    ('--sp-5', '96px'),
    ('--cell-pad', '10px 12px'),
    ('--gap', '20px'),
    ('--fs-body', '15px'),
    ('--fs-h2', '30px'),
    ('--fs-kpi', '52px'),
    ('--lh', '1.62'),
    ('--track', '#1a1620'),
    ('--ok', '#ccff00'),
    ('--err', '#ff2d6b'),
    ('--label-size', '12px'),
    ('--label-transform', 'uppercase'),
    ('--label-style', 'italic'),
    ('--kpi-weight', '400'),
    ('--value-size', '15px'),
    ('--value-weight', '700'),
]

# 三类共用的新组件：房态日历、掩码/状态徽章、选中态。只用 token，不写死颜色。
SHARED = """
/* ── 结构修正：模板的固定栏数与内联 span 在本页会挤爆，三风格共用同一条规则 ──
   1) KPI 三件套是 <span>，基线排一行会让 52px 大数字压住说明文字；
   2) .form-row 继承自模板的 5 栏网格，两个日期框各占 1/5 宽必然溢出；
   3) .field 的 108px 下限在窄侧栏里会把网格撑破。 */
.kpi-label,
.kpi-value,
.kpi-hint {
  display: block;
}
.form-row {
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
}
.field {
  min-width: 0;
}
.input[type='date'],
.input[type='datetime-local'] {
  min-width: 0;
}
.brand {
  flex-wrap: wrap;
  min-width: 0;
}
.brand-sub {
  flex-basis: 100%;
}

/* ── 房态日历：三种风格共用同一套结构与 token ─────────────────────── */
.cal {
  display: flex;
  flex-direction: column;
  gap: var(--gap);
  overflow-x: auto;
  padding-bottom: var(--sp-2);
}
.cal-head,
.cal-row {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 58px;
  gap: var(--gap);
  align-items: stretch;
}
.cal-head > .cal-name,
.cal-row > .cal-name {
  /* 名字列跨 3 个 58px 轨道（≈184px）：定宽 168px 会溢出到相邻格子下面。 */
  grid-column: span 3;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: var(--cell-pad);
  border-inline-end: 1px solid var(--row-line);
}
.cal-head {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--bg);
}
.cal-date {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  font: var(--label-size)/1.3 var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: var(--label-transform);
  font-style: var(--label-style);
  color: var(--muted);
}
.cal-num {
  color: var(--fg);
  font-weight: 600;
}
.cal-week {
  opacity: 0.8;
}
.cal-cell {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: space-between;
  gap: 3px;
  min-height: 62px;
  padding: 6px;
  border: 1px solid var(--row-line);
  border-radius: var(--radius-sm);
  background: var(--bg2);
  color: var(--fg);
  font: 500 11px/1.25 var(--font-mono);
  cursor: pointer;
  text-align: center;
}
.cal-cell:hover {
  border-color: var(--accent);
}
.cal-price {
  font-weight: 700;
  letter-spacing: 0.02em;
}
.cal-avail {
  color: var(--muted);
  font-size: 10px;
}
.cal-bar {
  display: block;
  height: 4px;
  background: var(--track);
  overflow: hidden;
}
.cal-fill {
  display: block;
  height: 100%;
  background: var(--accent);
}
.cal-cell[data-kind='holiday'] {
  border-color: var(--err);
}
.cal-cell[data-kind='holiday'] .cal-fill {
  background: var(--err);
}
.cal-cell[data-kind='weekend'] .cal-fill {
  background: var(--ok);
}
.cal-cell[data-kind='promo'] {
  border-style: dashed;
  border-color: var(--accent);
}
.cal-cell[data-kind='closed'] {
  background: var(--row-line);
  color: var(--muted);
  cursor: not-allowed;
}
.cal-cell[data-kind='closed'] .cal-fill {
  background: var(--muted);
}
.cal-cell[data-full='yes'] {
  box-shadow: inset 0 0 0 2px var(--sel-bg);
}
.cal-cell[data-sel='yes'] {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.cal-legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2) var(--sp-3);
  margin: var(--sp-2) 0 var(--sp-3);
  font-size: var(--label-size);
  letter-spacing: 0.08em;
  color: var(--muted);
}
.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.legend-dot {
  width: 12px;
  height: 12px;
  border: 1px solid var(--border);
  background: var(--bg2);
}
.legend-item[data-kind='weekend'] .legend-dot {
  background: var(--ok);
}
.legend-item[data-kind='holiday'] .legend-dot {
  background: var(--err);
}
.legend-item[data-kind='promo'] .legend-dot {
  border-style: dashed;
  border-color: var(--accent);
}
.legend-item[data-kind='closed'] .legend-dot {
  background: var(--row-line);
}
.legend-item[data-kind='full'] .legend-dot {
  box-shadow: inset 0 0 0 2px var(--sel-bg);
}

/* 订单状态徽章：值来自后端 domain 的六种状态，别处不再另起名字。 */
.badge[data-status='pending'] {
  border-color: var(--muted);
  color: var(--muted);
}
.badge[data-status='confirmed'] {
  border-color: var(--accent);
  color: var(--accent);
}
.badge[data-status='checked_in'] {
  background: var(--accent);
  color: var(--accent-fg);
  border-color: var(--accent);
}
.badge[data-status='checked_out'] {
  background: var(--head-bg);
  color: var(--head-fg);
  border-color: var(--head-bg);
}
.badge[data-status='cancelled'] {
  border-color: var(--err);
  color: var(--err);
  text-decoration: line-through;
}
.badge[data-status='no_show'] {
  border-style: dashed;
  border-color: var(--err);
  color: var(--err);
}
.badge[data-kind='weekend'] {
  border-color: var(--ok);
  color: var(--ok);
}
.badge[data-kind='holiday'],
.badge[data-kind='closed'] {
  border-color: var(--err);
  color: var(--err);
}
.badge[data-kind='promo'] {
  border-style: dashed;
  border-color: var(--accent);
  color: var(--accent);
}

/* 选中态与体检行的属性钩子（模板只写了 data-active，这里补看板用的）。 */
.theme-btn[aria-pressed='true'] {
  background: var(--sel-bg);
  color: var(--sel-fg);
  border-color: var(--sel-bg);
}
.theme-btn[aria-pressed='true'] .swatch-alt {
  fill: var(--sel-fg);
}
.table tbody tr[data-sel='yes'],
.table tbody tr[data-sel='yes']:hover {
  background: var(--sel-bg);
  color: var(--sel-fg);
}
.table tbody tr[data-sel='yes'] .cell-sub,
.table tbody tr[data-sel='yes'] .cell-strong {
  color: var(--sel-fg);
}
.fact[data-ok='true'] {
  border-color: var(--ok);
}
.fact[data-ok='false'] {
  border-color: var(--err);
  color: var(--err);
}
.err ul,
ul.err {
  margin: 0;
  padding-inline-start: 1.2em;
}
"""

SKEUO_EXTRA = """
/* ── 拟物工艺台历专属：皮革底、凸起面板、缝线卡片、按压反馈 ─────────── */
.shell {
  position: relative;
}
.shell::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(120% 70% at 8% -10%, rgba(255, 246, 226, 0.7), transparent 60%),
    repeating-linear-gradient(45deg, rgba(107, 82, 56, 0.05) 0 2px, transparent 2px 7px),
    repeating-linear-gradient(-45deg, rgba(59, 42, 26, 0.04) 0 2px, transparent 2px 9px),
    var(--bg);
}
.topbar,
.panel,
.kpi,
.cal-cell,
.table th,
.table td,
.pager,
.banner {
  box-shadow:
    0 1px 0 rgba(255, 252, 244, 0.9) inset,
    0 -2px 0 rgba(107, 82, 56, 0.18) inset,
    0 10px 22px rgba(59, 42, 26, 0.24);
}
.topbar {
  background: linear-gradient(180deg, #efe3ca, #ded0b1);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--sp-3);
}
.panel {
  background:
    repeating-linear-gradient(0deg, rgba(107, 82, 56, 0.035) 0 1px, transparent 1px 30px),
    var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--sp-3);
}
.brand-name {
  font-family: var(--font-display);
  font-size: 30px;
  letter-spacing: 0.01em;
  color: #4a3218;
  text-shadow: 0 1px 0 rgba(255, 250, 238, 0.9), 0 3px 6px rgba(74, 50, 24, 0.25);
}
.section-title,
.form-title {
  font-family: var(--font-display);
  padding-bottom: var(--sp-2);
  border-bottom: 2px dashed rgba(107, 82, 56, 0.4);
}
.btn {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: linear-gradient(180deg, #fbf4e6, #e3d4b6);
  box-shadow: 0 2px 0 #a98d68, 0 6px 12px rgba(59, 42, 26, 0.22), 0 1px 0 rgba(255, 255, 255, 0.8) inset;
  padding: 10px 18px;
  font-weight: 700;
}
.btn:active {
  transform: translateY(2px);
  box-shadow: 0 0 0 #a98d68, 0 3px 8px rgba(59, 42, 26, 0.25) inset;
}
.btn-primary {
  background: linear-gradient(180deg, #a8583a, #7c3f26);
  color: #fdf6ea;
  border-color: #5b2c17;
}
.input {
  border-radius: var(--radius-sm);
  background: #fffaf0;
  border: 1px solid #b39a76;
  box-shadow: 0 2px 5px rgba(59, 42, 26, 0.2) inset;
  padding: 10px 12px;
}
.cal-cell {
  border: 1px dashed #a98d68;
  border-radius: 10px;
  background: linear-gradient(180deg, #fffaf0, #efe4cd);
}
.cal-cell[data-sel='yes'] {
  box-shadow: 0 6px 14px rgba(59, 42, 26, 0.3), 0 0 0 2px var(--accent) inset;
}
.kpi {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: linear-gradient(160deg, #fffaf0, #e8dcc3);
}
.kpi-value {
  font-family: var(--font-display);
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.85);
}
.badge {
  border-radius: 999px;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.7) inset;
}
.table thead th {
  background: linear-gradient(180deg, #6b5238, #4c3825);
  color: #f6efe2;
}
.footnote,
.pagefoot {
  border-top: 2px dashed rgba(107, 82, 56, 0.35);
}
"""

ISO_EXTRA = """
/* ── 等距轴测工业风专属：轴测网格、挤出体、斜切标注、安全黄高光 ───────── */
.shell {
  position: relative;
}
.shell::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    linear-gradient(rgba(127, 212, 255, 0.1) 1px, transparent 1px) 0 0 / 100% 24px,
    linear-gradient(90deg, rgba(127, 212, 255, 0.1) 1px, transparent 1px) 0 0 / 24px 100%,
    linear-gradient(30deg, transparent 49.6%, rgba(242, 169, 0, 0.16) 49.6% 50.4%, transparent 50.4%) 0 0 / 120px 208px,
    linear-gradient(-30deg, transparent 49.6%, rgba(78, 134, 184, 0.28) 49.6% 50.4%, transparent 50.4%) 0 0 / 120px 208px,
    var(--bg);
}
.topbar {
  border: 1px solid var(--border);
  background: linear-gradient(180deg, #14375c, #0d2744);
  box-shadow: 6px 6px 0 rgba(4, 15, 27, 0.6);
}
.brand-name {
  font-family: var(--font-mono);
  font-size: 22px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--head-fg);
}
.brand-sub::before {
  content: 'SPEC / ';
  color: var(--accent);
}
.panel {
  position: relative;
  border: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(20, 55, 92, 0.92), rgba(12, 35, 64, 0.92));
  box-shadow: 10px 10px 0 rgba(4, 15, 27, 0.55), 12px 12px 0 rgba(242, 169, 0, 0.35);
}
.section-head {
  border-bottom: 1px dashed var(--border);
}
.section-title::after {
  content: '◤';
  margin-inline-start: 8px;
  color: var(--accent);
}
.section-note,
.caption,
.kpi-label,
.cal-date {
  font-family: var(--font-mono);
}
.kpi {
  border: 1px solid var(--border);
  background: #0a1f38;
  box-shadow: 5px 5px 0 rgba(4, 15, 27, 0.6);
}
.kpi-value {
  font-family: var(--font-mono);
  color: var(--accent);
  letter-spacing: -0.01em;
}
.btn {
  border: 1px solid var(--border);
  background: #12355b;
  color: var(--fg);
  box-shadow: 3px 3px 0 rgba(4, 15, 27, 0.75);
  font-family: var(--font-mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.btn:active {
  transform: translate(3px, 3px);
  box-shadow: none;
}
.btn-primary {
  background: var(--accent);
  color: var(--accent-fg);
  border-color: #b57c00;
}
.input {
  background: #081b30;
  border: 1px solid var(--border);
  font-family: var(--font-mono);
  border-radius: 2px;
}
.cal-date {
  border-top: 1px solid var(--border);
}
.cal-cell {
  border: 1px solid var(--border);
  background: #0b2542;
  box-shadow: 3px 3px 0 rgba(4, 15, 27, 0.65);
  border-radius: 0;
}
.cal-cell[data-kind='holiday'] {
  background: #3a1c12;
}
.cal-cell[data-kind='closed'] {
  background: repeating-linear-gradient(45deg, #12314f 0 4px, #0a1f38 4px 8px);
  color: var(--muted);
}
.cal-fill {
  background: repeating-linear-gradient(90deg, var(--accent) 0 3px, transparent 3px 6px);
}
.legend-dot {
  border-radius: 0;
}
.table thead th {
  font-family: var(--font-mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-bottom: 2px solid var(--accent);
}
.table tbody tr:hover {
  background: rgba(242, 169, 0, 0.09);
}
.bar-track {
  border: 1px solid var(--border);
}
.bar-fill {
  background: repeating-linear-gradient(45deg, var(--accent) 0 4px, #c98a00 4px 8px);
}
.stamp {
  border: 1px dashed var(--accent);
  color: var(--accent);
}
"""

ACID_EXTRA = """
/* ── 酸性夜场海报专属：纯黑底、荧光团块、变形大字、硬边错位块 ───────── */
.shell {
  position: relative;
}
.shell::before {
  content: '';
  position: fixed;
  inset: -20%;
  z-index: -1;
  pointer-events: none;
  background:
    conic-gradient(from 210deg at 18% 12%, rgba(204, 255, 0, 0.16), transparent 30%),
    conic-gradient(from 40deg at 84% 26%, rgba(255, 77, 0, 0.18), transparent 34%),
    radial-gradient(60% 40% at 50% 110%, rgba(124, 0, 255, 0.22), transparent 70%),
    var(--bg);
  filter: saturate(1.4);
}
.topbar {
  border: 2px solid var(--accent);
  background: #0a0810;
  box-shadow: 10px 10px 0 var(--border);
}
.brand-name {
  font-family: var(--font-display);
  font-size: 44px;
  font-style: italic;
  letter-spacing: -0.02em;
  text-transform: uppercase;
  color: var(--accent);
  text-shadow: 4px 4px 0 var(--border), -2px -2px 0 rgba(124, 0, 255, 0.9);
  transform: skewY(-2deg);
}
.brand-sub {
  font-family: var(--font-mono);
  color: var(--border);
}
.panel {
  border: 2px solid var(--row-line);
  background: rgba(10, 8, 16, 0.92);
  box-shadow: 12px 12px 0 rgba(204, 255, 0, 0.14), inset 0 0 60px rgba(255, 77, 0, 0.1);
}
.section-title,
.form-title {
  font-family: var(--font-display);
  font-size: 34px;
  font-style: italic;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: var(--fg);
  text-shadow: 3px 3px 0 var(--border);
}
.section-note,
.caption,
.footnote {
  font-family: var(--font-mono);
  color: var(--muted);
}
.kpi {
  border: 2px solid var(--accent);
  background: linear-gradient(150deg, #12100f, #050406 60%);
  box-shadow: 8px 8px 0 var(--border);
}
.kpi-label {
  font-family: var(--font-mono);
  color: var(--accent);
  letter-spacing: 0.24em;
}
.kpi-value {
  font-family: var(--font-display);
  font-size: 52px;
  text-shadow: 0 0 26px rgba(204, 255, 0, 0.55);
}
.btn {
  border: 2px solid var(--fg);
  background: transparent;
  color: var(--fg);
  border-radius: 999px;
  font-family: var(--font-mono);
  text-transform: uppercase;
  letter-spacing: 0.16em;
  box-shadow: 4px 4px 0 var(--accent);
}
.btn:hover {
  color: var(--accent);
  border-color: var(--accent);
  transform: translate(-2px, -2px);
  box-shadow: 7px 7px 0 var(--border);
}
.btn-primary {
  background: var(--accent);
  color: var(--accent-fg);
  border-color: var(--accent);
  box-shadow: 5px 5px 0 var(--border);
}
.input {
  background: #0a0810;
  border: 2px solid var(--row-line);
  border-radius: 999px;
  color: var(--fg);
  font-family: var(--font-mono);
}
.input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(204, 255, 0, 0.22);
}
.cal-cell {
  border: 2px solid var(--row-line);
  background: #0a0810;
  box-shadow: 4px 4px 0 rgba(204, 255, 0, 0.2);
}
.cal-cell[data-kind='holiday'] {
  border-color: var(--border);
  background: #1a0700;
}
.cal-cell[data-kind='promo'] {
  border-color: var(--accent);
  background: #0f1400;
}
.cal-cell[data-kind='closed'] {
  background: repeating-linear-gradient(135deg, #141018 0 6px, #050406 6px 12px);
  border-color: var(--err);
  color: var(--err);
}
.cal-price {
  font-family: var(--font-mono);
  color: var(--accent);
}
.cal-bar {
  height: 6px;
  background: #191521;
}
.cal-fill {
  background: linear-gradient(90deg, var(--accent), var(--border));
}
.table thead th {
  font-family: var(--font-display);
  font-size: 18px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: #100d14;
  color: var(--accent);
}
.table tbody tr:nth-child(odd) {
  background: rgba(255, 77, 0, 0.05);
}
.badge {
  border-radius: 999px;
  font-family: var(--font-mono);
  text-transform: uppercase;
}
.bar-fill {
  background: linear-gradient(90deg, var(--accent), var(--border));
}
.stamp {
  transform: rotate(-8deg);
  border: 2px solid var(--border);
  color: var(--border);
}
.pager,
.banner {
  border: 2px solid var(--border);
}
"""

THEMES = {
    'skeuo': ('拟物工艺台历：皮革纸纹底、凸起面板、缝线卡片、衬线大字', SKEUO, SKEUO_EXTRA),
    'iso': ('等距轴测工业风：轴测网格、挤出体硬阴影、等宽标注、安全黄', ISO, ISO_EXTRA),
    'acid': ('酸性夜场海报：纯黑底、荧光团块、变形斜体大字、硬边错位块', ACID, ACID_EXTRA),
}


def main() -> None:
    base = io.open(BASE, encoding='utf-8').read()
    lines = base.split('\n')
    start = next(i for i, ln in enumerate(lines) if ln.strip() == ':root {')
    end = next(i for i in range(start, len(lines)) if lines[i].strip() == '}')
    for tid, (label, toks, extra) in THEMES.items():
        body = '\n'.join(lines[:start]) + tokens(toks) + '\n' + '\n'.join(lines[end + 1:])
        # 模板里给旧场景（订阅后台）写的状态色钩子对本场景无效，删掉避免误导。
        for dead in ("active", "past_due", "trialing", "canceled"):
            body = body.replace(".badge[data-status='%s']" % dead, ".badge[data-status='_unused_%s']" % dead)
        out = '/* ── %s（由 templates/go-gin-react theme-swiss.css 派生：token 换皮 + 末尾专属规则）── */\n%s' % (label, body.rstrip() + '\n' + SHARED + extra)
        path = os.path.join(OUT, 'theme-%s.css' % tid)
        io.open(path, 'w', encoding='utf-8').write(out)
        print('wrote %s (%d bytes)' % (path, len(out)))


if __name__ == '__main__':
    main()
