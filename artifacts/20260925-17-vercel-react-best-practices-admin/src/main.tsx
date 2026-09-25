import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/base.css';

export function mount(el: Element | null): void {
  if (el === null) return;
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
