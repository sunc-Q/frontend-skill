import React, { type ReactNode } from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from '../__root';
import { RouteGate } from '@/lib/ablation';
import { OVERVIEW_QUERY_KEY, overviewApi } from '~features/overview/api/overviewApi';

const OverviewSection = React.lazy(() =>
  import('~features/overview/components/OverviewSection').then((m) => ({ default: m.OverviewSection })),
);

function OverviewPage(): ReactNode {
  return (
    <RouteGate queryKey={OVERVIEW_QUERY_KEY} queryFn={overviewApi.get}>
      <OverviewSection />
      <p className="fd-foot" data-fd="crumb">总览 / 控制台</p>
    </RouteGate>
  );
}

export const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: OverviewPage });
