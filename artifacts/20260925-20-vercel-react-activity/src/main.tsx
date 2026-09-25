import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { bootstrap, getTransport, initTransport, reqLog } from './lib/api';

/* build.lib 的 IIFE 产物只导出全局对象、不会自挂载：
   内联模板需显式 SoundIsleActivity.mount(root)。
   bootstrap() 在这里先发起全部首屏取数（start-early），组件树里才 await（await-late）。 */
export function mount(el: HTMLElement): void {
  initTransport();
  (window as unknown as { __reqs: typeof reqLog }).__reqs = reqLog;
  const boot = bootstrap(getTransport());
  createRoot(el).render(
    <StrictMode>
      <App boot={boot} />
    </StrictMode>,
  );
}
