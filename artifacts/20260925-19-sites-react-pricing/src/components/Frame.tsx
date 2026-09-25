import { FOOTER_COLUMNS, SUPPORT_CONTACTS } from '../lib/content';

const NAV_LINKS = [
  { href: '#estimator', label: '算价' },
  { href: '#compare', label: '逐项对比' },
  { href: '#faq', label: '常见问题' },
];

/* 整块内容随套餐选择不变：提到组件外，React 每次渲染少做无用功（rendering-hoist-jsx）。 */
const LOGO_MARK = (
  <span className="brand-mark" aria-hidden="true">
    ▲
  </span>
);

export function Nav() {
  return (
    <header className="nav">
      <div className="nav-inner">
        <span className="brand">
          {LOGO_MARK}
          <span>松塔 Songta</span>
        </span>
        <nav className="nav-links" aria-label="页面内导航">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}

const FOOTER_COLS = FOOTER_COLUMNS.map((col) => (
  <div className="fcol" key={col.title}>
    <h4>{col.title}</h4>
    <ul>
      {col.items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  </div>
));

export function Footer() {
  return (
    <footer className="footer">
      <div className="shell">
        <div className="footer-grid">
          <div className="fcol">
            <h4>松塔 Songta</h4>
            <ul>
              <li>把客户散在各处的话收进一条流水线</li>
              <li>演示站，价格与条款为样例数据</li>
            </ul>
          </div>
          {FOOTER_COLS}
        </div>
        <div className="footer-bottom">
          {SUPPORT_CONTACTS.map((item) => (
            <span key={item}>{item}</span>
          ))}
          <span>计价货币基准 CNY，USD 按 1 : 7.15 折算</span>
        </div>
      </div>
    </footer>
  );
}
