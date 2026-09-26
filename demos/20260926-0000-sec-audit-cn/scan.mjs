// sec-audit-cn 静态审计阶段：对本 LAB 的 7 轮产物 + 第三方技能包做规则扫描。
// 只读，不执行被扫描代码；命中一律带 file:line 供人工复核。
import fs from 'node:fs';
import path from 'node:path';

const LAB = path.resolve(import.meta.dirname, '../..');
const MINIFIED_OVER = 400;

const RULES = [
  { id: 'R01', owasp: 'A03 注入', hint: '高', re: /\b(exec|execSync|spawn|spawnSync|execFile|execFileSync)\w*\s*\(\s*[`'"][^`'"]*\$\{/, why: '命令名/参数由模板字符串插值 → 参数注入面' },
  { id: 'R02', owasp: 'A03 注入', hint: '高', re: /\bSQL\s*=|\bSELECT\b[^;]*\$\{|\bWHERE\b[^;]*\$\{/, why: 'SQL 文本中插值外部变量' },
  { id: 'R03', owasp: 'A03 注入', hint: '严重', re: /(^|[^.\w])(eval|new Function)\s*\(/, why: '动态代码执行' },
  { id: 'R04', owasp: 'A03 XSS', hint: '高', re: /\.(innerHTML|outerHTML|insertAdjacentHTML)\s*=|document\.write\s*\(/, why: 'HTML 汇点，数据注入即脚本执行' },
  { id: 'R05', owasp: 'A02/A05 密钥', hint: '严重', re: /(api[_-]?key|secret|token|passwd|password|private[_-]?key)\s*[:=]\s*['"][A-Za-z0-9_+\/\-.]{12,}['"]|ghp_[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}|xox[baprs]-|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY/, why: '硬编码凭据 / 私钥' },
  { id: 'R06', owasp: 'A08 完整性', hint: '高', re: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|)sh/, why: '未校验远程脚本直接执行' },
  { id: 'R07', owasp: 'A05 配置', hint: '中', re: /--no-sandbox|--disable-web-security|--ignore-certificate-errors|allowMixedContent\s*:\s*true|rejectUnauthorized\s*:\s*false/, why: '关闭浏览器/TLS 安全默认' },
  { id: 'R08', owasp: 'A01/A05 调试面', hint: '中', re: /^\s*window\.(__game|advanceTime|render_game_to_text|state|DEBUG)\b/, why: '发布产物中保留可改内部状态的全局调试钩子' },
  { id: 'R09', owasp: 'A01 访问控制', hint: '中', re: /localStorage\.setItem\([^)]*(score|best|high)/i, why: '分数/资格由客户端裁定并持久化' },
  { id: 'R10', owasp: 'A06 依赖', hint: '中', re: /(<script[^>]*\bsrc=|@import|href=)["']https?:\/\/|from\s+['"]https?:\/\//, why: '运行期从外链加载代码（本沙箱 TLS 还会被重置）' },
  { id: 'R11', owasp: 'A03/A08 查询语法', hint: '中', re: /MATCH\s+\?|MATCH\s+[`'"]/, why: '全文检索查询串若含用户输入未转义 → 检索语法注入' },
  { id: 'R12', owasp: 'A05 信息泄露', hint: '低', re: /console\.error\s*\(\s*(e|err|error)\s*\)|err(or)?\.stack/, why: '原始异常/栈直接落盘或回显' },
  { id: 'R13', owasp: 'A08 完整性', hint: '低', re: /\.replace\([^)]*,\s*(?!\s*\(\s*\w|\s*function)[^)]*\$|<%|\$\{[^}]*\}[\s\S]{0,40}(innerHTML|sql|SQL)/, why: '字符串型替换值里的 $& / $\' 会二次展开被插入内容' },
];

const SKILL_RULES = [
  { id: 'S01', re: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|)sh/, why: '要求代理执行未校验远程脚本' },
  { id: 'S02', re: /\brm\s+-rf\s+(?!.*(node_modules|\.tmp|build|dist|tmp))/i, why: 'rm -rf 且目标不在常见构建产物白名单内' },
  { id: 'S03', re: /(\.ssh\b|id_rsa|known_hosts|\.aws\/credentials|\.npmrc|browser.*(cookie|password))/i, why: '触碰私钥/凭据文件' },
  { id: 'S04', re: /(POST|upload|发送|上传)[^。\n]{0,40}(http|API|接口|endpoint)/i, why: '把本地内容外发到远端' },
  { id: 'S05', re: /(sudo|chmod \+s|chown root|launchctl|crontab)/, why: '提权/持久化' },
  { id: 'S06', re: /(export\s+|API_KEY|TOKEN|SECRET|password)\s*=?\s*['"]?[A-Za-z0-9_\-]{16,}/, why: '包内含疑似凭据' },
  { id: 'S07', re: /(git push --force|--no-verify|reset --hard)/, why: '破坏性 git 操作' },
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'shots' || e.name === 'sample-frames') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const EXT = new Set(['.mjs', '.js', '.py', '.sh', '.html', '.md', '.json', '.yaml', '.txt']);
const SELF = import.meta.dirname + path.sep;
const targets = [
  ...walk(path.join(LAB, 'demos')),
  ...walk(path.join(LAB, '.tmp')),
  ...walk(path.join(LAB, 'state')),
  ...walk(path.join(LAB, 'records')),
  path.join(LAB, '.gitignore'),
].filter(p => EXT.has(path.extname(p)) && fs.existsSync(p));

const findings = [];
const metrics = [];
for (const p of targets) {
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  let opaque = 0, opaqueBytes = 0;
  lines.forEach((L, i) => {
    if (L.length > MINIFIED_OVER) { opaque++; opaqueBytes += Buffer.byteLength(L); return; }
    for (const r of RULES) {
      if (!r.re.test(L)) continue;
      if (r.id === 'R03' && /\.md$/.test(p)) continue;           // 报告/纪要里的举例文本不算
      if (r.id === 'R06' && /\.md$/.test(p)) continue;
      if (path.resolve(p).startsWith(SELF)) continue;  // 扫描器自身的规则字面量不是漏洞
      if (p.endsWith('.css') || /animation\.html|blueprint\.html/.test(p) && r.id === 'R12') continue;
      findings.push({ rule: r.id, owasp: r.owasp, sev: r.hint, file: path.relative(LAB, p), line: i + 1, why: r.why, snip: L.trim().slice(0, 150) });
    }
  });
  const bytes = fs.statSync(p).size;
  metrics.push({ file: path.relative(LAB, p), bytes, lines: lines.length, opaqueLines: opaque, opaqueBytes, opaqueShare: +(opaqueBytes / (bytes || 1)).toFixed(3) });
}

const skillFiles = [];
for (const root of [path.join(LAB, '.skills'), '/Users/apple/.qoder-cn/skills']) {
  if (!fs.existsSync(root)) continue;
  for (const p of walk(root)) if (/SKILL\.md$/.test(p)) skillFiles.push(p);
}
const skillFindings = [];
for (const p of skillFiles) {
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  const isDoc = true; // SKILL.md 是散文+示例代码混合体，命中须人工分诊，见 report 的 FP 说明
  lines.forEach((L, i) => {
    for (const r of SKILL_RULES) if (r.re.test(L)) skillFindings.push({ rule: r.id, file: path.resolve(p).startsWith(LAB) ? path.relative(LAB, p) : 'GLOBAL ' + p.split('/skills/').pop(), line: i + 1, why: r.why, snip: L.trim().slice(0, 160) });
  });
}

const agg = {};
for (const f of findings) agg[f.rule] = (agg[f.rule] || 0) + 1;
const report = {
  scannedFiles: targets.length,
  scannedBytes: metrics.reduce((a, m) => a + m.bytes, 0),
  rules: RULES.map(r => ({ id: r.id, owasp: r.owasp, sev: r.hint, why: r.why, hits: agg[r.id] || 0 })),
  findings,
  opaque: metrics.filter(m => m.opaqueLines > 0).sort((a, b) => b.opaqueBytes - a.opaqueBytes),
  thirdPartySkillPackages: skillFiles.length,
  skillFindings,
};
fs.writeFileSync(path.join(import.meta.dirname, 'findings.json'), JSON.stringify(report, null, 1));

const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
console.log('扫描 ' + report.scannedFiles + ' 个文件 / ' + report.scannedBytes + ' B；第三方技能包 ' + report.thirdPartySkillPackages + ' 个');
console.log('\n规则命中汇总');
for (const r of report.rules) console.log('  ' + pad(r.id, 5) + pad(r.owasp, 22) + pad('预设' + r.sev, 8) + 'hits=' + r.hits);
console.log('\n明细');
for (const f of findings) console.log('  ' + pad(f.rule, 5) + pad(f.file, 62) + pad(':' + f.line, 6) + f.snip);
console.log('\n不可读（压缩/内联）行统计 >400 字符的行');
for (const m of report.opaque) console.log('  ' + pad(m.file, 62) + 'lines=' + m.opaqueLines + ' bytes=' + m.opaqueBytes + ' share=' + (m.opaqueShare * 100).toFixed(1) + '%');
console.log('\n第三方 SKILL.md 面向代理的危险指令');
for (const f of skillFindings) console.log('  ' + pad(f.rule, 5) + pad(f.file, 78) + ':' + f.line + '  ' + f.snip);
