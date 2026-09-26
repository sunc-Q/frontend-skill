// 三风格计算样式探针：在页面里执行，返回可直接对比的扁平对象。
// 用法（browser-use MCP）：读取本文件内容 → evaluate_script({function: 内容})
// 断言口径见 scripts/style-diff.py：STYLE_GROUPS 里每个分组都必须出现，
// 且分组名与 style-diff.py 的常量严格对齐（名字对不上会直接 KeyError）。
() => {
  const g = (sel, props) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    const cs = getComputedStyle(el);
    const o = {};
    for (const p of props) o[p] = cs[p];
    return o;
  };
  const text = (sel) => (document.querySelector(sel) ?? {}).textContent ?? '';
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    shell: g('.shell', ['fontFamily', 'backgroundColor', 'lineHeight', 'paddingTop', 'color']),
    brand: g('.brand-name', ['fontFamily', 'fontSize', 'letterSpacing', 'textTransform', 'color']),
    kpi: g('.kpi', ['borderTopLeftRadius', 'borderTopWidth', 'borderTopStyle', 'paddingTop', 'boxShadow', 'backgroundColor']),
    label: g('.kpi-label', ['fontFamily', 'fontSize', 'letterSpacing', 'textTransform', 'fontStyle']),
    value: g('.kpi-value', ['fontFamily', 'fontSize', 'fontWeight', 'color']),
    head: g('.table th', ['fontFamily', 'fontSize', 'color', 'backgroundColor', 'textTransform', 'borderTopStyle']),
    row: g('.table tbody td', ['borderBottomStyle', 'borderBottomWidth', 'paddingTop', 'fontSize', 'color']),
    btn: g('.btn', ['borderTopLeftRadius', 'borderTopWidth', 'borderTopStyle', 'color', 'textTransform', 'paddingTop']),
    input: g('.input', ['borderTopLeftRadius', 'borderTopWidth', 'borderTopStyle', 'backgroundColor']),
    badge: g('.badge', ['borderTopLeftRadius', 'borderTopStyle', 'letterSpacing', 'textTransform', 'fontSize']),
    gap: g('.kpis', ['columnGap', 'rowGap']),
    bar: g('.bar-track', ['height', 'borderTopLeftRadius', 'backgroundColor', 'borderBottomStyle']),
    fill: g('.bar-fill', ['borderTopLeftRadius', 'backgroundColor', 'backgroundImage']),
    status: g('.statusline', ['fontFamily', 'fontSize', 'letterSpacing', 'textTransform', 'borderTopStyle']),
    stamp: g('.identity', ['fontFamily', 'fontSize', 'color', 'borderLeftStyle', 'borderLeftWidth', 'letterSpacing']),
    rowCount: document.querySelectorAll('.table tbody tr').length,
    kpiCount: document.querySelectorAll('.kpi').length,
    badgeCount: document.querySelectorAll('.badge').length,
    trackCount: document.querySelectorAll('.bar-track').length,
    tabCount: document.querySelectorAll('.theme-btn').length,
    firstKpi: text('.kpi-value'),
    firstBadge: text('.badge'),
    firstTrack: text('.bar-name'),
    firstRow: text('.table tbody tr'),
    external: [...document.querySelectorAll('link[href], script[src], img[src]')]
      .map((e) => e.getAttribute('href') || e.getAttribute('src') || '')
      .filter((v) => /^https?:|^\/\//.test(v)),
    inlineScripts: document.querySelectorAll('script:not([src])').length,
    inlineStyles: document.querySelectorAll('style').length,
  };
}
