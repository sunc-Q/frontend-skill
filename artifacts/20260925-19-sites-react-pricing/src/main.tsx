import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

/* build.lib 的 IIFE 产物只导出全局对象、不会自挂载，
   所以内联模板里必须显式调用 SongtaPricing.mount(...) */
export function mount(el: HTMLElement): void {
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
