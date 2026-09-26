// PoC-A：对第 4 轮交付的检索 CLI demos/20260925-1845-sqlite-database-expert/query.mjs 做黑盒输入测试。
// 只读（该 CLI 以 readOnly:true 打开 lab.db），只用 spawnSync 参数数组，不经 shell。
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const WHICH = process.env.TARGET_NAME || '../20260925-1845-sqlite-database-expert/query.mjs';
const TARGET = path.resolve(import.meta.dirname, WHICH);
const CASES = [
  ['H0 基线（正常词）', ['安全闸门', '3'], '对照组'],
  ['C1 未闭合引号', ['"'], '期望：解析错误文本外泄'],
  ['C2 裸 AND（残缺布尔式）', ['安全 AND'], '期望：FTS5 语法错误全文'],
  ['C3 布尔式改写（引号配对逃逸）', ['闸门") OR ("src'], '期望：改变检索语义'],
  ['C4 逻辑扩权（把窄查询变全表）', ['安全" OR "闸门" OR "无肌肉'], '期望：命中集 ≠ 字面短语'],
  ['C5 LIMIT 参数未校验', ['安全闸门', 'abc'], '期望：Number() → NaN 直接进入绑定'],
  ['C6 LIMIT 负数/超大', ['安全闸门', '-1'], '期望：无上限约束'],
  ['C7 超长查询串', ['安'.repeat(20000)], '期望：无长度上限'],
  ['C8 列名/权重注入尝试', ['安全" NEAR/99 "闸门'], '期望：列权重语法被接受（bm25 可被操纵）'],
];

let bad = 0;
for (const [name, args, expect] of CASES) {
  const r = spawnSync(process.execPath, [TARGET, ...args], { encoding: 'utf8', timeout: 20000 });
  const out = (r.stdout || '').trim();
  const err = (r.stderr || '').trim();
  const first = out.split('\n')[0] || '(无 stdout)';
  const errLine = err.split('\n').find(l => l && !l.startsWith('(node:') && !l.includes('ExperimentalWarning') && !l.includes('Use `node --trace') && !l.includes('--no-warnings'));
  console.log('\n=== ' + name + '  argv=' + JSON.stringify(args.map(a => a.length > 40 ? a.slice(0, 40) + '…(' + a.length + ' chars)' : a)) + ' ===');
  console.log('  expect : ' + expect);
  console.log('  exit   : ' + r.status + (r.signal ? ' signal=' + r.signal : '') + (r.error ? ' spawnError=' + r.error.message : ''));
  console.log('  stdout : ' + first + (out.split('\n').length > 1 ? '  (+' + (out.split('\n').length - 1) + ' 行)' : ''));
  console.log('  stderr : ' + (errLine ? errLine.slice(0, 240) : '(无)'));
  const leaked = /SqliteError|fts5: syntax|datatype mismatch|no such|Parse error|at file:\/\/|at ModuleJob\.run/i.test(err);
  const crashed = r.status !== 0;
  const clean = /search failed:/.test(out);
  if (leaked || (crashed && !clean)) bad++;
  console.log('  判定   : ' + (crashed ? (clean ? '拒绝并退出码 2，仅固定文案（安全失败）' : '未捕获异常 → 崩溃') : '零退出') + (leaked ? '  << stderr 含原始 SQLite/FTS5 错误 + 源码绝对路径（信息泄露）' : ''));
}
console.log('\n汇总：' + CASES.length + ' 例中 ' + bad + ' 例为「未捕获异常崩溃 / 错误文本外泄」（不含被干净拒绝的用例）');
