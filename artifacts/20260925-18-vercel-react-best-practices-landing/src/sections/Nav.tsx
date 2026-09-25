import { Icon, SECTIONS, cn, scrollToId } from '../components/ui';
import type { SectionId } from '../components/ui';

export function Nav({ active, onJump, scrolled, themeName }: { active: SectionId; onJump: (id: SectionId) => void; scrolled: boolean; themeName: string }) {
  return (
    <header className={cn('nav', scrolled && 'nav--lift')}>
      <div className="nav-in">
        <a
          className="brand"
          href="#hero"
          onClick={(e) => {
            e.preventDefault();
            onJump('hero');
          }}
        >
          <Icon name="mark" size={20} />
          <span className="brand-name">拾光 Shiguang</span>
        </a>
        <nav className="nav-links" aria-label="页面导航">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={'#' + s.id}
              className={cn('nav-link', active === s.id && 'nav-link--on')}
              data-spy={s.id}
              onClick={(e) => {
                e.preventDefault();
                onJump(s.id);
              }}
            >
              {s.label}
            </a>
          ))}
        </nav>
        <div className="nav-right">
          <span className="nav-theme" data-theme-badge>{themeName}</span>
          <a
            className="btn btn--primary btn--sm"
            href="#cta"
            onClick={(e) => {
              e.preventDefault();
              scrollToId('cta');
            }}
          >
            获取早鸟版
          </a>
        </div>
      </div>
    </header>
  );
}
