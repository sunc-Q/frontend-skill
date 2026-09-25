import type { ReactNode } from 'react';
import { createRootRoute, Outlet } from '@tanstack/react-router';
import AppShell from '~components/AppShell/AppShell';
import SnackbarHost from '~components/SnackbarHost/SnackbarHost';

/**
 * Skill routing clause is `createFileRoute` (TanStack Router) which needs the router's
 * codegen plugin to produce routeTree.gen.ts; not shipped by the skill. Manual tree here.
 */
export const rootRoute = createRootRoute({
  component: function Root(): ReactNode {
    return (
      <>
        <AppShell>
          <Outlet />
        </AppShell>
        <SnackbarHost />
      </>
    );
  },
});

export default rootRoute;
