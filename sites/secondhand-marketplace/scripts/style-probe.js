// 三风格计算样式探针：在页面里执行，返回可直接对比的扁平对象。
// 用法（browser-use MCP）：navigate_page 到 ?theme=xxx → evaluate_script({function: 本文件内容, filePath: /tmp/probe-xxx.json})
// 再用 scripts/style-diff.mjs 断言：DOM 同构（domHash 相等）+ 两两 ≥3 项计算样式差异 + 零外链。
() => {
  const cs = (sel, props) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    const c = getComputedStyle(el);
    const o = {};
    for (const p of props) o[p] = c[p];
    return o;
  };
  const hash = (s) => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h;
  };
  // 只取 tagName + class 序列：主题切换不得改变它，否则就不是「只换 CSS」。
  const sig = [...document.querySelectorAll('#root *')].map((e) => e.tagName + '.' + [...e.classList].join(',')).join('|');
  const text = document.querySelector('.kpi-value');
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    htmlBg: getComputedStyle(document.documentElement).backgroundColor,
    shell: cs('.shell', ['backgroundImage', 'fontFamily', 'fontSize', 'paddingTop', 'maxWidth', 'color']),
    kpi: cs('.kpi', ['backgroundColor', 'borderTopLeftRadius', 'borderTopWidth', 'borderTopStyle', 'boxShadow', 'paddingLeft', 'transform']),
    value: cs('.kpi-value', ['fontFamily', 'fontSize', 'fontWeight', 'color', 'letterSpacing']),
    btn: cs('.btn', ['backgroundColor', 'borderTopLeftRadius', 'borderTopWidth', 'borderStyle', 'textTransform', 'fontFamily']),
    th: cs('.table thead th', ['backgroundColor', 'color', 'textTransform', 'letterSpacing', 'fontFamily']),
    badge: cs('.badge', ['backgroundColor', 'borderTopLeftRadius', 'transform', 'color']),
    lede: cs('.lede', ['fontSize', 'lineHeight', 'fontFamily', 'borderLeftWidth', 'borderLeftStyle']),
    rowCount: document.querySelectorAll('.table:not(.mini) tbody tr').length,
    kpiCount: document.querySelectorAll('.kpi').length,
    chipCount: document.querySelectorAll('.chip').length,
    firstRow: (document.querySelector('.table:not(.mini) tbody tr td') || {}).textContent || '',
    kpiText: text ? text.textContent : '',
    domHash: hash(sig),
    domLen: sig.length,
    // 页面真实用到过的全部 class（含条件拼接出来的），用于校验三份 CSS 是否都覆盖同一套契约
    classes: [...new Set([...document.querySelectorAll('#root *')].flatMap((e) => [...e.classList]))].sort(),
    external: [...document.querySelectorAll('link[href], script[src], img[src]')]
      .map((e) => e.getAttribute('href') || e.getAttribute('src') || '')
      .filter((v) => /^https?:|^\/\//.test(v)),
    errs: [...document.querySelectorAll('.err')].map((e) => e.textContent.slice(0, 60)),
  };
};
