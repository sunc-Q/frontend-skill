import {
  THEME_META,
  Toasts,
  detectTheme,
  useDeferredAnalytics,
  useReveal,
  useScrollSpy,
  useScrolled,
  useToasts,
} from './components/ui';
import { Nav } from './sections/Nav';
import { Features, Hero, How } from './sections/Story';
import { Wall } from './sections/Wall';
import { Voices } from './sections/Voices';
import { Questions } from './sections/Questions';
import { Cta, Footer } from './sections/Cta';

export default function App() {
  const theme = detectTheme();
  const meta = THEME_META[theme];
  const [active, jump] = useScrollSpy();
  const scrolled = useScrolled();
  const [toasts, push, dismiss] = useToasts();
  useDeferredAnalytics();
  useReveal();

  return (
    <div className="page" data-theme-key={theme}>
      <Nav active={active} onJump={jump} scrolled={scrolled} themeName={meta.name} />
      <main className="main">
        <Hero />
        <Features />
        <How />
        <Wall />
        <Voices />
        <Questions />
        <Cta onToast={push} />
      </main>
      <Footer themeName={meta.name} themeNote={meta.note} />
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
