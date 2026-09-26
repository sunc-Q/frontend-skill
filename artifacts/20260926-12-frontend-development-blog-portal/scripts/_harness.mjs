import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';

export const results = [];
let group = 'ungrouped';

export function Group(name) {
  group = name;
}

export function ok(id, cond, detail = '') {
  results.push({ group, id, pass: cond === true, detail: String(detail).slice(0, 240) });
  if (cond !== true) console.log(`FAIL [${group}] ${id} ${detail}`);
  return cond === true;
}

export function num(id, value, unit = '') {
  results.push({ group, id, pass: true, printed: `${value}${unit}` });
  console.log(`NUM  [${group}] ${id} = ${value}${unit}`);
}

export function bytes(n) {
  return Buffer.byteLength(typeof n === 'string' ? n : String(n), 'utf8');
}

export function dumpResults(file) {
  writeFileSync(file, JSON.stringify(results, null, 1) + '\n', 'utf8');
}

export function summary(label) {
  const failed = results.filter((r) => !r.pass);
  const total = results.filter((r) => r.pass !== undefined).length;
  console.log(`${label}: ${total - failed.length}/${total} assertions passed`);
  if (failed.length > 0) {
    console.log(failed.map((f) => `  - [${f.group}] ${f.id} ${f.detail}`).join('\n'));
    process.exitCode = 1;
  }
  return failed.length;
}

/** Run an async body, tagging every assertion with the page/style it belongs to. */
export async function each(items, labelOf, body) {
  for (const item of items) {
    const label = labelOf(item);
    Group(`${group.replace(/ · .*$/, '')} · ${label}`);
    await body(item, label);
  }
}

export function deepEq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
