# 第 11 轮产物 · webapp-testing（2026-09-26 10:37）

先看这两个：
- `download-golden.png` — 1200×1200 真图，由页面自己的 downloadPNG() 按钮经 Playwright 捕获落盘（2,023,119B）
- `shots/` 与 `shots-mutant-wiring/` — 断言用的画布截图；`shots-mutant-wiring/03-cadence0.png` 与
  `shots/02-color1-red.png` **sha256 相同**，这就是「滑杆拖了但画面没重绘」的变异体铁证

跑法与结论见 `../../reports/20260926-1037-webapp-testing.md`。
机读结果：`result-golden.json` / `result-mutant_seed.json` / `result-mutant_wiring.json`；
全部原始输出（含服务端 404 日志与 PNG 完整性复核）：`output.log`。
从零复现：`python3 demos/.../build_mutants.py` 后用技能自带的
`scripts/with_server.py` 双服务模式执行 `sh demos/.../run_all.sh`（详见纪要「复现步骤」）。
