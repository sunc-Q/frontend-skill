import React, { type ReactNode } from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from '../__root';
import { RouteGate } from '@/lib/ablation';
import { KEYS_QUERY_KEY, keysApi } from '~features/keys/api/keysApi';

const KeysSection = React.lazy(() => import('~features/keys/components/KeysSection').then((m) => ({ default: m.KeysSection })));

function KeysPage(): ReactNode {
  return (
    <RouteGate queryKey={KEYS_QUERY_KEY} queryFn={keysApi.list}>
      <KeysSection />
      <p className="fd-foot" data-fd="crumb">API 密钥 / 控制台</p>
    </RouteGate>
  );
}

export const keysRoute = createRoute({ getParentRoute: () => rootRoute, path: '/keys', component: KeysPage });
