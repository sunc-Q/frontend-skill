// 三风格计算样式探针：在页面里执行，返回可直接对比的扁平对象。
// 用法（browser-use MCP）：读取本文件内容 → evaluate_script({function: 内容})
//    或 node scripts/style-shoot.mjs 自动跑三个主题。
// 断言口径见 scripts/style-diff.py：互斥性（每对 ≥3 项不同）+ 同构性（结构字段全等）。
() => {
  const g = (sel, props) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    const cs = getComputedStyle(el);
    const o = {};
    for (const p of props) o[p] = cs[p];
    return o;
  };
  const text = (sel) => {
    const el = document.querySelector(sel);
    return el === null ? null : el.textContent.trim().slice(0, 40);
  };
  const shell = document.querySelector('.shell');
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    shellFont: shell === null ? null : getComputedStyle(shell).fontFamily,
    pageBg: getComputedStyle(document.body).backgroundColor,
    // —— 互斥性取样组：每组 5-6 个计算属性，覆盖字体/色/边/圆角/间距/文字处理
    kpi: g('.kpi', ['borderTopLeftRadius', 'borderLeftWidth', 'borderLeftStyle', 'paddingTop', 'boxShadow', 'backgroundColor']),
    label: g('.kpi-label', ['fontFamily', 'fontSize', 'letterSpacing', 'textTransform', 'color']),
    value: g('.kpi-value', ['fontFamily', 'fontSize', 'fontWeight', 'color', 'lineHeight']),
    head: g('.tickets thead th', ['fontFamily', 'fontSize', 'color', 'backgroundColor', 'textTransform', 'borderBottomWidth']),
    btn: g('.btn', ['borderTopLeftRadius', 'borderTopWidth', 'borderTopStyle', 'color', 'paddingTop', 'textTransform']),
    input: g('.input', ['borderTopLeftRadius', 'borderTopWidth', 'borderStyle', 'backgroundColor', 'height']),
    chip: g('.chip', ['borderTopLeftRadius', 'borderStyle', 'letterSpacing', 'backgroundColor', 'color', 'paddingLeft']),
    tab: g('.tab', ['borderRadius', 'borderTopWidth', 'backgroundColor', 'color', 'fontSize']),
    cal: g('.cal-day', ['borderTopLeftRadius', 'borderStyle', 'backgroundColor', 'color', 'paddingTop']),
    bar: g('.bar', ['height', 'borderTopLeftRadius', 'backgroundColor', 'borderStyle']),
    panel: g('.panel', ['borderTopLeftRadius', 'borderTopWidth', 'boxShadow', 'padding', 'backgroundColor']),
    ident: g('.ident', ['borderLeftWidth', 'borderLeftStyle', 'backgroundColor', 'fontSize', 'paddingLeft']),
    tl: g('.tl-dot', ['width', 'height', 'borderRadius', 'backgroundColor', 'borderStyle']),
    // —— 同构性字段：三主题必须完全一致
    kpiCount: document.querySelectorAll('.kpi').length,
    rowCount: document.querySelectorAll('.tickets tbody tr').length,
    tabCount: document.querySelectorAll('.tab').length,
    calCount: document.querySelectorAll('.cal-day').length,
    loadCount: document.querySelectorAll('.load-row').length,
    matrixCount: document.querySelectorAll('.matrix tbody tr').length,
    identCount: document.querySelectorAll('.ident').length,
    dailyCount: document.querySelectorAll('.daily-row').length,
    clockCount: document.querySelectorAll('.clock-item, .clock-flag').length,
    inlineStyles: document.querySelectorAll('style').length,
    inlineScripts: document.querySelectorAll('script:not([src])').length,
    external: [...document.querySelectorAll('link[href], script[src], img[src]')]
      .map((e) => e.getAttribute('href') || e.getAttribute('src') || '')
      .filter((v) => /^https?:|^\/\//.test(v)),
    // —— 内容取样：证明页面真的从接口拿到了数，而不是空壳
    kpiText: text('.kpi-value'),
    firstRow: text('.tickets tbody tr .cell-code'),
    equationText: text('.equation-text'),
    clockText: text('.clock-value'),
    calText: text('.cal-date'),
  };
}
