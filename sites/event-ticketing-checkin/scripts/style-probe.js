// 三风格计算样式探针（灯塔票务）：在页面里执行，返回可直接对比的扁平对象。
// 选择器全部取本页 DOM 真实存在的类，避免拿上一轮场景的类名来断言这一轮的页面。
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
  // is-on 例外：它标的是「当前选中的风格按钮/页签」，本来就该随主题移动一个位置；
  // 结构是否同构看去掉 is-on 之后的签名，is-on 的总数另单列，防止某主题靠少画一个选中态混过去。
  const allCls = [...document.querySelectorAll('#root *')];
  const sigOf = (norm) => allCls.map((e) => e.tagName + '.' + [...e.classList].filter((c) => !norm || c !== 'is-on').join(',')).join('|');
  const sig = sigOf(false);
  const sigIso = sigOf(true);
  const txt = (sel) => {
    const el = document.querySelector(sel);
    return el === null ? '' : (el.textContent ?? '').trim();
  };
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    styleBytes: (document.getElementById('etk-theme') ?? {}).textContent?.length ?? 0,
    htmlBg: getComputedStyle(document.documentElement).backgroundColor,
    bodyBg: cs('body', ['backgroundColor', 'backgroundImage', 'color', 'fontFamily', 'fontSize']),
    shell: cs('.app', ['maxWidth', 'fontFamily', 'fontSize', 'paddingLeft', 'color']),
    topbar: cs('.topbar', ['backgroundColor', 'backgroundImage', 'borderTopWidth', 'borderTopStyle', 'borderTopLeftRadius', 'boxShadow']),
    tabOn: cs('.tab.is-on', ['backgroundColor', 'color', 'borderBottomWidth', 'borderTopLeftRadius', 'letterSpacing']),
    kpi: cs('.kpi', ['backgroundColor', 'borderTopLeftRadius', 'borderLeftWidth', 'borderLeftStyle', 'boxShadow', 'paddingLeft']),
    value: cs('.kpi-value', ['fontFamily', 'fontSize', 'fontWeight', 'color', 'letterSpacing']),
    btn: cs('.btn', ['backgroundColor', 'color', 'borderTopLeftRadius', 'borderTopWidth', 'textTransform', 'fontFamily']),
    th: cs('.table thead th', ['backgroundColor', 'color', 'textTransform', 'letterSpacing', 'fontFamily', 'borderBottomWidth']),
    badge: cs('.tag', ['backgroundColor', 'borderTopLeftRadius', 'color', 'borderBottomStyle', 'letterSpacing']),
    hint: cs('.hint', ['fontSize', 'lineHeight', 'fontFamily', 'borderLeftWidth', 'borderLeftStyle', 'color']),
    rowCount: document.querySelectorAll('.table tbody tr').length,
    kpiCount: document.querySelectorAll('.kpi').length,
    chipCount: document.querySelectorAll('.theme-btn').length,
    tabCount: document.querySelectorAll('.tab').length,
    firstRow: txt('.table tbody tr td'),
    kpiText: txt('.kpi-value'),
    footText: txt('.foot'),
    identity: txt('.identity-title'),
    domHash: hash(sig),
    domLen: sig.length,
    isoHash: hash(sigIso),
    isoLen: sigIso.length,
    onCount: document.querySelectorAll('#root .is-on').length,
    // 页面真实用到过的全部 class（含条件拼接出来的），用于校验三份 CSS 是否都覆盖同一套契约
    classes: [...new Set([...document.querySelectorAll('#root *')].flatMap((e) => [...e.classList]))].sort(),
    external: [...document.querySelectorAll('link[href], script[src], img[src]')]
      .map((e) => e.getAttribute('href') || e.getAttribute('src') || '')
      .filter((v) => /^https?:|^\/\//.test(v)),
    errs: [...document.querySelectorAll('.err')].map((e) => (e.textContent ?? '').slice(0, 60)),
  };
};
