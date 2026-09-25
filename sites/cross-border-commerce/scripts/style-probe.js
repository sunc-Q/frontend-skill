// 三风格计算样式探针：在页面里执行，返回可直接对比的扁平对象。
// 用法（browser-use MCP）：读取本文件内容 → evaluate_script({function: 内容})
// 断言口径：字体族/底色/圆角/字距/大小写/边框样式等至少 6 项在两两主题间不同。
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
    theme: document.documentElement.getAttribute('data-theme'),
    shellFont: shell === null ? null : getComputedStyle(shell).fontFamily,
    shellBg: shell === null ? null : getComputedStyle(shell).backgroundColor,
    gap: g('.kpis', ['columnGap', 'rowGap']),
    kpi: g('.kpi', ['borderTopLeftRadius', 'borderTopWidth', 'borderTopStyle', 'paddingTop', 'boxShadow', 'backgroundColor']),
    label: g('.kpi-label', ['fontFamily', 'fontSize', 'letterSpacing', 'textTransform', 'fontStyle']),
    value: g('.kpi-value', ['fontFamily', 'fontSize', 'fontWeight', 'color']),
    head: g('.table thead th', ['fontFamily', 'fontSize', 'color', 'backgroundColor', 'textTransform', 'borderTopStyle']),
    btn: g('.btn', ['borderTopLeftRadius', 'borderTopWidth', 'borderTopStyle', 'color', 'textTransform', 'paddingTop']),
    input: g('.input', ['borderTopLeftRadius', 'borderTopWidth', 'borderTopStyle', 'backgroundColor']),
    badge: g('.badge', ['borderTopLeftRadius', 'borderTopStyle', 'letterSpacing']),
    rowCount: document.querySelectorAll('.table tbody tr').length,
    kpiCount: document.querySelectorAll('.kpi').length,
    cartLines: document.querySelectorAll('.cart-line').length,
    firstSku: (document.querySelector('.table tbody .mono') ?? {}).textContent ?? '',
    totalCol: (document.querySelector('.totals tbody tr[data-active="true"]') ?? {}).textContent ?? '',
    external: [...document.querySelectorAll('link[href], script[src], img[src]')]
      .map((e) => e.getAttribute('href') || e.getAttribute('src') || '')
      .filter((v) => /^https?:|^\/\//.test(v)),
    inlineScripts: document.querySelectorAll('script:not([src])').length,
    inlineStyles: document.querySelectorAll('style').length,
  };
}
