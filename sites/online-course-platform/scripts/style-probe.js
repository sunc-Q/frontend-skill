// 三风格计算样式探针（bauhaus / newsprint / instrument）：返回可直接对比的扁平对象。
// 用法（browser-use MCP）：读取本文件内容 → evaluate_script({function: 内容})
// 断言口径：字体族/主色/标签字距/圆角/阴影/内边距等两两主题间至少 3 项不同。
// 两个实测坑：
// 1) 本函数含 7 组 getComputedStyle，在带无限 CSS 动画的主题（instrument）上会让
//    evaluate_script 15s 超时；改用「一次一小批」的取值脚本，或先导航重载页面。
// 2) 通过 MCP 传函数体时，JS 源码里的 '\n' 字面量会被解码成真换行 → SyntaxError，
//    拼接分隔符请用 ' | ' 之类不含反斜杠的字面串。
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
  const kpi = g('.kpi', ['borderTopLeftRadius', 'borderTopWidth', 'borderTopStyle', 'paddingTop', 'boxShadow', 'backgroundColor']);
  const label = g('.kpi-label', ['fontFamily', 'fontSize', 'letterSpacing', 'textTransform', 'fontStyle']);
  const value = g('.kpi-value', ['fontFamily', 'fontSize', 'fontWeight', 'color']);
  const head = g('.table th', ['fontFamily', 'fontSize', 'color', 'backgroundColor', 'textTransform', 'borderTopStyle']);
  const btn = g('.btn', ['borderTopLeftRadius', 'borderTopWidth', 'borderTopStyle', 'color', 'textTransform', 'paddingTop']);
  const input = g('.input', ['borderTopLeftRadius', 'borderTopWidth', 'borderTopStyle', 'backgroundColor']);
  const badge = g('.badge', ['borderTopLeftRadius', 'borderTopStyle', 'letterSpacing']);
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    shellFont: shell === null ? null : getComputedStyle(shell).fontFamily,
    shellBg: shell === null ? null : getComputedStyle(shell).backgroundColor,
    gap: g('.kpis', ['columnGap', 'rowGap']),
    kpi,
    label,
    value,
    head,
    btn,
    input,
    badge,
    rowCount: document.querySelectorAll('.table tbody tr').length,
    kpiCount: document.querySelectorAll('.kpi').length,
    mrrText: (document.querySelector('.kpi-value') ?? {}).textContent ?? '',
    external: [...document.querySelectorAll('link[href], script[src], img[src]')]
      .map((e) => e.getAttribute('href') || e.getAttribute('src') || '')
      .filter((v) => /^https?:|^\/\//.test(v)),
    inlineScripts: document.querySelectorAll('script:not([src])').length,
    inlineStyles: document.querySelectorAll('style').length,
  };
}
