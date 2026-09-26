// 无头 Chrome 会话：负责拉起本机 Chrome（独立 profile + 独立调试端口）、
// 导航并等页面就绪、顺带收集 console/异常/CSP 拒绝，供各断言脚本复用。
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { connect } from './cdp-client.mjs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function openSession({ port = Number(process.env.CDP_PORT || 19821), profileDir }) {
  await mkdir(profileDir, { recursive: true });
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--window-size=1440,1600',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  proc.unref();

  let target = null;
  for (let i = 0; i < 80 && target === null; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page') ?? null;
    } catch {
      /* 端口还没起来 */
    }
    if (target === null) await new Promise((r) => setTimeout(r, 250));
  }
  if (target === null) {
    proc.kill('SIGKILL');
    throw new Error('Chrome 无头调试端口未就绪');
  }

  const conn = await connect(target.webSocketDebuggerUrl);
  const noise = [];
  await conn.send('Runtime.enable');
  await conn.send('Log.enable');
  await conn.send('Page.enable');
  conn.on('Runtime.consoleAPICalled', (e) => {
    if (e.type === 'error' || e.type === 'warning') {
      noise.push('console.' + e.type + ': ' + (e.args ?? []).map((a) => String(a.value ?? a.description ?? '')).join(' '));
    }
  });
  conn.on('Runtime.exceptionThrown', (e) => {
    noise.push('exception: ' + String(e.exceptionDetails?.exception?.description ?? e.exceptionDetails?.text));
  });
  conn.on('Log.entryAdded', (e) => {
    const entry = e.entry ?? {};
    if (entry.level === 'error') noise.push(`${entry.source ?? 'log'}: ${entry.text ?? ''}`);
  });

  const goto = async (url) => {
    await conn.send('Page.navigate', { url });
  };
  const waitFor = async (expr, tries = 60, ms = 200) => {
    for (let i = 0; i < tries; i++) {
      const v = await conn.evaluate(expr);
      if (v) return v;
      await new Promise((r) => setTimeout(r, ms));
    }
    return null;
  };

  return {
    conn,
    noise,
    goto,
    waitFor,
    evaluate: (expression) => conn.evaluate(expression),
    close: () => {
      conn.close();
      proc.kill('SIGKILL');
    },
  };
}
