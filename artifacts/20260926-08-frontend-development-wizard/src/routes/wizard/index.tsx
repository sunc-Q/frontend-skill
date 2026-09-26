import { lazy } from 'react';
import { queryOptions } from '@tanstack/react-query';
import { BOOTSTRAP_KEY, bootstrapApi } from '~features/bootstrap';
import type { RouteSpec } from '../router';

/** Skill clause: `routes/{feature-name}/index.tsx`, component lazy-loaded at the route. */
const WizardPage = lazy(() =>
  import('~features/wizard').then((m) => ({ default: m.WizardPage })),
);

export const wizardRoute: RouteSpec = {
  path: '/wizard',
  crumb: '开店向导',
  loader: ({ queryClient }) =>
    queryClient.ensureQueryData(
      queryOptions({ queryKey: BOOTSTRAP_KEY, queryFn: () => bootstrapApi.getBootstrap(), staleTime: Infinity }),
    ),
  component: WizardPage,
};

export default wizardRoute;
