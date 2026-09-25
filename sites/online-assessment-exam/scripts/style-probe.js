// 三风格计算样式探针：在页面里执行，返回可直接对比的扁平对象。
// 用法（browser-use MCP）：读取本文件内容 → evaluate_script({function: 内容})
//   注意：evaluate_script 对超长返回值会超时，本探针刻意只取 39 个属性；
//   动作（click）与读取必须拆成两次调用。
// 断言口径：每对主题之间至少 3 项不同，交给 style-diff.py 判定。
() => {
  const g = (sel, props) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    const cs = getComputedStyle(el);
    const o = {};
    for (const p of props) o[p] = cs[p];
    return o;
  };
  const shell = document.querySelector('.shell');
  return {
    t: document.documentElement.getAttribute('data-theme'),
    shellFont: shell === null ? null : getComputedStyle(shell).fontFamily,
    shellBg: shell === null ? null : getComputedStyle(shell).backgroundColor,
    gap: g('.kpis', ['columnGap', 'rowGap']),
    kpi: g('.kpi', ['borderTopLeftRadius', 'borderTopWidth', 'borderTopStyle', 'paddingTop', 'boxShadow', 'backdropFilter', 'backgroundColor']),
    label: g('.kpi-label', ['fontFamily', 'fontSize', 'letterSpacing', 'textTransform', 'fontStyle']),
    value: g('.kpi-value', ['fontFamily', 'fontSize', 'fontWeight', 'color']),
    head: g('.table th', ['fontFamily', 'fontSize', 'color', 'backgroundColor', 'textTransform', 'borderTopStyle']),
    btn: g('.btn', ['borderTopLeftRadius', 'borderTopWidth', 'borderTopStyle', 'color', 'textTransform', 'paddingTop']),
    input: g('.input', ['borderTopLeftRadius', 'borderTopWidth', 'borderTopStyle', 'backgroundColor']),
    badge: g('.badge', ['borderTopLeftRadius', 'borderTopStyle', 'letterSpacing']),
    // 以下是本场景专属的结构不变量：三套皮肤共用一份 DOM，所以这些值必须完全一致
    kpiCount: document.querySelectorAll('.kpi').length,
    rowCount: document.querySelectorAll('.table tbody tr').length,
    identity: (document.querySelector('.identity') ?? {}).textContent ?? '',
    swatches: document.querySelectorAll('.themes button').length,
    external: [...document.querySelectorAll('link[href], script[src], img[src]')]
      .map((e) => e.getAttribute('href') || e.getAttribute('src') || '')
      .filter((v) => /^https?:|^\/\//.test(v)),
    inlineScripts: document.querySelectorAll('script:not([src])').length,
    inlineStyles: document.querySelectorAll('style').length,
  };
}
