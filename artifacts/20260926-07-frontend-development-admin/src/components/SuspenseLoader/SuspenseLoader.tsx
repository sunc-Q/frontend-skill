import { Suspense, type ReactNode } from 'react';
import { Box, Fade } from '@mui/material';
import { STYLES, readStyleId } from '@/lib/style/registry';

const SKELETON_ROWS = 6;

function Skeleton(): ReactNode {
  const t = STYLES[readStyleId()];
  return (
    <Box
      data-fd="suspense-loader"
      sx={{
        display: 'grid',
        gap: 1.5,
        p: 2,
        minHeight: 360,
        borderRadius: t.shape,
        border: `${Math.max(1, t.borderWidth)}px solid ${t.color.border}`,
        background: t.color.paper,
      }}
      aria-busy="true"
    >
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <Box
          key={i}
          sx={{
            height: 22,
            width: `${92 - i * 7}%`,
            borderRadius: t.shape,
            background: t.color.paperAlt,
          }}
        />
      ))}
    </Box>
  );
}

/** Skill clause: "SuspenseLoader for loading states (with fade animation)" + "Always wrap lazy components in Suspense". */
export function SuspenseLoader({ children }: { children: ReactNode }): ReactNode {
  return (
    <Suspense
      fallback={
        <Fade in timeout={120} appear>
          <Box data-fd="fade-host">
            <Skeleton />
          </Box>
        </Fade>
      }
    >
      {children}
    </Suspense>
  );
}

export default SuspenseLoader;
