// 三风格计算样式探针：在页面里执行，返回可直接对比的扁平对象。
// 用法（两种）：
//   node scripts/style-shoot.mjs <URL模板>        # 真无头 Chrome 自动跑（推荐）
//   browser-use evaluate_script(本文件内容)        # 手工单页取样
//
// 断言口径由 scripts/style-diff.py 判定：
//   ① 互斥性 —— 每对主题 ≥3 项 getComputedStyle 不同；
//   ② 同构性 —— 元素数量/内联样式表/外链数等结构字段三主题全等（同一份 DOM + JS）。
// 两类都不能漏：只量互斥性会放过后悄悄多塞了 DOM 的风格；只量同构性会放过三份没差别的 CSS。
() => {
  const g = (sel, props) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    const cs = getComputedStyle(el);
    const o = {};
    for (const p of props) o[p] = cs[p];
    return o;
  };
  const txt = (sel) => ((document.querySelector(sel) || {}).textContent || '').replace(/\s+/g, ' ').trim();
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    // ---- 结构类字段（同构性断言用）----
    rowCount: document.querySelectorAll('.table tbody tr').length,
    kpiCount: document.querySelectorAll('.kpi').length,
    badgeCount: document.querySelectorAll('.badge').length,
    trackCount: document.querySelectorAll('.track-item').length,
    tabCount: document.querySelectorAll('.theme-btn').length,
    inlineScripts: document.querySelectorAll('script:not([src])').length,
    inlineStyles: document.querySelectorAll('style').length,
    external: [...document.querySelectorAll('link[href], script[src], img[src]')]
      .map((e) => e.getAttribute('href') || e.getAttribute('src') || '')
      .filter((v) => /^https?:|^\/\//.test(v)),
    // ---- 取样文本（证明页面真的渲染了接口数据而不是空壳）----
    firstKpi: ((document.querySelector('.kpi-value') || {}).textContent || '').trim(),
    firstBadge: ((document.querySelector('.badge') || {}).textContent || '').trim(),
    firstTrack: txt('.track-item'),
    firstRow: txt('.table tbody tr'),
    // ---- 风格类字段（互斥性断言用）----
    shell: g('.shell', ['fontFamily', 'backgroundColor', 'color']),
    brand: g('.brand-name', ['fontFamily', 'transform', 'letterSpacing', 'fontSize', 'textTransform']),
    kpi: g('.kpi', ['backgroundColor', 'backgroundImage', 'borderTopWidth', 'borderTopStyle',
      'borderTopColor', 'borderTopLeftRadius', 'boxShadow', 'paddingTop', 'transform']),
    label: g('.kpi-label', ['fontFamily', 'fontSize', 'letterSpacing', 'textTransform', 'fontStyle']),
    value: g('.kpi-value', ['fontFamily', 'fontSize', 'fontWeight', 'color', 'fontStyle']),
    head: g('.table th', ['fontFamily', 'fontSize', 'color', 'backgroundColor', 'textTransform',
      'borderBottomWidth', 'borderBottomStyle', 'letterSpacing']),
    row: g('.table tbody tr', ['backgroundColor', 'borderBottomStyle', 'borderBottomWidth']),
    btn: g('.btn', ['backgroundColor', 'color', 'borderTopWidth', 'borderTopStyle',
      'borderTopLeftRadius', 'textTransform', 'paddingTop', 'boxShadow']),
    input: g('.input', ['backgroundColor', 'color', 'borderTopWidth', 'borderTopStyle', 'borderTopLeftRadius']),
    badge: g('.badge', ['backgroundColor', 'color', 'borderTopStyle', 'borderTopLeftRadius', 'letterSpacing']),
    gap: g('.kpis', ['columnGap', 'rowGap']),
    bar: g('.bar-track', ['backgroundColor', 'height', 'borderTopLeftRadius']),
    fill: g('.bar-fill', ['backgroundColor', 'backgroundImage', 'borderTopLeftRadius']),
    status: g('.statusline', ['fontFamily', 'fontSize', 'backgroundColor', 'borderTopWidth']),
    stamp: g('.stamp', ['fontFamily', 'transform', 'borderTopStyle', 'color']),
    // ---- 本页专属：计费明细与轨迹，风格气质最容易差出来的地方 ----
    bill: g('.bill-total', ['fontFamily', 'backgroundColor', 'borderTopStyle', 'borderTopWidth', 'letterSpacing']),
    track: g('.track-dot', ['backgroundColor', 'borderTopLeftRadius', 'width', 'height', 'boxShadow']),
    chip: g('.chip', ['backgroundColor', 'borderTopLeftRadius', 'borderStyle', 'color']),
    lane: g('.lane', ['backgroundColor', 'borderLeftWidth', 'borderLeftColor', 'borderTopLeftRadius']),
    identity: g('.identity', ['backgroundColor', 'borderLeftColor', 'borderLeftWidth', 'boxShadow']),
  };
}
