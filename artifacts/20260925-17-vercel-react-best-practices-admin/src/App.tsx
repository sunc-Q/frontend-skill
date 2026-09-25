import { useCallback, useState } from 'react';
import { buildDataset } from './data/dataset';
import { OverviewSection } from './sections/Overview';
import { LinksSection } from './sections/Links';
import { KeysSection } from './sections/Keys';
import { SettingsSection } from './sections/Settings';
import { NAV_ITEMS, NavIcon, LogoMark, Toasts, THEME_META } from './components/shared';
import type { SectionId } from './components/shared';
import { cn } from './types';

const THEME = document.documentElement.dataset.theme ?? 'business';

// 种子数据在模块作用域构建一次：确定性随机，三主题共享同一份
const DATASET = buildDataset();

let toastSeq = 0;

export function App() {
  const [section, setSection] = useState<SectionId>('overview');
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; ts: number }>>([]);

  // rerender-functional-setstate: 稳定回调，不闭包读取 toasts
  const pushToast = useCallback((message: string) => {
    toastSeq += 1;
    setToasts((cur) => [...cur.slice(-2), { id: toastSeq, message, ts: Date.now() }]);
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const meta = THEME_META[THEME] ?? { name: '未知主题', desc: '' };

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <LogoMark />
          <div>
            <p className="brand-name">Beacon 信标</p>
            <p className="brand-sub">短链服务 · 运营后台</p>
          </div>
        </div>
        <nav className="nav" aria-label="主导航">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn('nav-btn', section === item.id && 'nav-btn--on')}
              onClick={() => setSection(item.id)}
            >
              <NavIcon section={item.id} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <p className="theme-badge">风格：{meta.name}</p>
          <p className="dim">数据为种子样本，仅演示</p>
          <p className="dim">v2.9.3 · 区域 cn-east</p>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <h1>{NAV_ITEMS.find((n) => n.id === section)?.label ?? '总览'}</h1>
          <div className="topbar-right">
            <span className="env-pill">生产环境</span>
            <span className="avatar" title="ops@beacon.dev">O</span>
          </div>
        </header>
        <div className="content">
          {/* 后台各分区状态各自保留：用隐藏而非卸载，卸载会丢失过滤/展开状态 */}
          <div hidden={section !== 'overview'}>
            <OverviewSection data={DATASET} />
          </div>
          <div hidden={section !== 'links'}>
            <LinksSection initial={DATASET.links} onToast={pushToast} />
          </div>
          <div hidden={section !== 'keys'}>
            <KeysSection keys={DATASET.keys} onToast={pushToast} />
          </div>
          <div hidden={section !== 'settings'}>
            <SettingsSection onToast={pushToast} />
          </div>
        </div>
      </main>

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
