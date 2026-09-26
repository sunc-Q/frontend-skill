import React, { Suspense } from 'react';

interface SuspenseLoaderProps {
  children: React.ReactNode;
  /** reserve the space the content will take, so resolving cannot move anything below it */
  minHeight?: number;
  label?: string;
}

/**
 * The skill's loading rule is "no early returns — wrap in SuspenseLoader". A plain fallback
 * of fixed small height *replaces* the content, so anything under the boundary still jumps
 * when data lands; `minHeight` is what makes the rule worth following. Both halves are
 * asserted in group F (placeholder visible while pending, zero displacement after).
 */
export const SuspenseLoader: React.FC<SuspenseLoaderProps> = ({ children, minHeight = 0, label = '载入中' }) => (
  <div className="fd-suspense-host" data-min-height={minHeight > 0 ? String(minHeight) : undefined} style={{ minHeight: minHeight || undefined }}>
    <Suspense
      fallback={
        <div className="fd-suspense" aria-busy="true" data-testid="suspense-fallback" style={{ minHeight: minHeight || undefined }}>
          <span className="fd-suspense-dot" aria-hidden="true" />
          {label}
        </div>
      }
    >
      {children}
    </Suspense>
  </div>
);

export default SuspenseLoader;
