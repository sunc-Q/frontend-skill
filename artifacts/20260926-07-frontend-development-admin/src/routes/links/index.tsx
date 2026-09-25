import React, { type ReactNode } from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from '../__root';
import { RouteGate } from '@/lib/ablation';
import { LINKS_QUERY_KEY, linksApi } from '~features/links/api/linksApi';

const LinksSection = React.lazy(() => import('~features/links/components/LinksSection').then((m) => ({ default: m.LinksSection })));

function LinksPage(): ReactNode {
  return (
    <RouteGate queryKey={LINKS_QUERY_KEY} queryFn={linksApi.list}>
      <LinksSection />
      <p className="fd-foot" data-fd="crumb">短链管理 / 控制台</p>
    </RouteGate>
  );
}

export const linksRoute = createRoute({ getParentRoute: () => rootRoute, path: '/links', component: LinksPage });
