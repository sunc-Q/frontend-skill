// 极简 Chrome DevTools Protocol 客户端：只依赖 Node 内置 WebSocket（Node 22+），
// 用于在无头 Chrome 里导航 + 求值取回 JSON，替代经常 15s 超时的浏览器面板工具。
export function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  const handlers = new Map();
  let nextId = 1;

  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')));
  });

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (p === undefined) return;
      if (msg.error !== undefined) p.reject(new Error(`CDP ${String(msg.id)}: ${msg.error.message}`));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method !== undefined) {
      for (const h of handlers.get(msg.method) ?? []) h(msg.params ?? {});
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails !== undefined) {
      throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    }
    return r.result?.value;
  };

  return {
    ready: opened,
    on: (method, handler) => {
      const list = handlers.get(method) ?? [];
      list.push(handler);
      handlers.set(method, list);
    },
    send: async (method, params) => {
      await opened;
      return send(method, params);
    },
    evaluate: async (expression) => {
      await opened;
      return evaluate(expression);
    },
    close: () => {
      try {
        ws.close();
      } catch {
        /* 已关闭 */
      }
    },
  };
}
