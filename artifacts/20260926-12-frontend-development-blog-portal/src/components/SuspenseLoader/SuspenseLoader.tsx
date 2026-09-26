import { Suspense, type ReactElement, type ReactNode } from 'react';

export interface SuspenseLoaderProps {
  children: ReactNode;
  /** Reserved height in px — this is the whole point: the boundary keeps the layout stable. */
  minHeight?: number;
  label: string;
  pulse?: boolean;
}

/**
 * Skill clause "Always wrap lazy components in Suspense" + "No early returns".
 * The fallback reserves the same box the content will occupy, so a slow read cannot shift
 * anything below it. `data-min-height` is what group F measures.
 */
export function SuspenseLoader({ children, minHeight = 200, label, pulse = true }: SuspenseLoaderProps): ReactElement {
  return (
    <Suspense
      fallback={
        <div className={`skel${pulse ? ' pulse' : ''}`} data-skeleton data-min-height={minHeight} style={{ minHeight }} aria-busy="true">
          <span className="state">载入 {label}…</span>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

export default SuspenseLoader;
