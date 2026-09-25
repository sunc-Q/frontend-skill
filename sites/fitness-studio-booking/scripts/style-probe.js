// 三风格计算样式探针：在页面里执行，返回可直接对比的扁平对象。
// 用法（browser-use MCP）：读取本文件内容 → evaluate_script({function: 内容})
// 断言口径：字体族/背景/字距/圆角/描边/阴影/间距 至少 3 项在两两主题之间不同，
// 且外链为 0、表格行数来自接口数据（不是写死的假数据）。
() => {
  const g = (sel, props) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    const cs = getComputedStyle(el);
    const o = {};
    for (const p of props) o[p] = cs[p];
    return o;
  };
  const text = (sel) => (document.querySelector(sel) ?? {}).textContent ?? null;
  const shell = document.querySelector('.shell');
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    shellFont: shell === null ? null : getComputedStyle(shell).fontFamily,
    shellBg: shell === null ? null : getComputedStyle(shell).backgroundColor,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    gap: g('.kpis', ['columnGap', 'rowGap']),
    kpi: g('.kpi', ['borderTopLeftRadius', 'borderTopWidth', 'borderTopStyle', 'paddingTop', 'boxShadow', 'backgroundColor', 'borderColor']),
    label: g('.kpi-label', ['fontFamily', 'fontSize', 'letterSpacing', 'textTransform', 'fontStyle', 'fontWeight']),
    value: g('.kpi-value', ['fontFamily', 'fontSize', 'fontWeight', 'color']),
    head: g('.table th', ['fontFamily', 'fontSize', 'color', 'backgroundColor', 'textTransform', 'borderTopStyle', 'letterSpacing']),
    row: g('.table td', ['paddingTop', 'paddingLeft', 'borderBottomWidth', 'fontFamily', 'fontSize']),
    btn: g('.btn', ['borderTopLeftRadius', 'borderTopWidth', 'borderTopStyle', 'color', 'textTransform', 'paddingTop', 'boxShadow']),
    input: g('.input', ['borderTopLeftRadius', 'borderTopWidth', 'borderTopStyle', 'backgroundColor']),
    badge: g('.badge', ['borderTopLeftRadius', 'borderTopStyle', 'letterSpacing', 'fontSize', 'fontWeight']),
    bar: g('.bar-fill', ['backgroundColor', 'height', 'borderTopLeftRadius']),
    seats: g('.seats', ['fontFamily', 'fontSize', 'fontWeight', 'color']),
    stamp: g('.stamp', ['fontFamily', 'transform', 'letterSpacing', 'borderTopStyle']),
    rowCount: document.querySelectorAll('.table tbody tr').length,
    kpiCount: document.querySelectorAll('.kpi').length,
    occupancyText: text('.kpi-value'),
    sessionTitle: text('.table tbody tr .cell-strong'),
    external: [...document.querySelectorAll('link[href], script[src], img[src]')]
      .map((e) => e.getAttribute('href') || e.getAttribute('src') || '')
      .filter((v) => /^https?:|^\/\//.test(v)),
    inlineScripts: document.querySelectorAll('script:not([src])').length,
    inlineStyles: document.querySelectorAll('style').length,
  };
}
