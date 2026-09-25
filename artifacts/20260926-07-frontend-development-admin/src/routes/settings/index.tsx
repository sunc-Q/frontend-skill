import React, { type ReactNode } from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from '../__root';
import { SuspenseLoader } from '~components/SuspenseLoader/SuspenseLoader';

const SettingsSection = React.lazy(() =>
  import('~features/settings/components/SettingsSection').then((m) => ({ default: m.SettingsSection })),
);

/** No fetch here: settings are device state, so there is nothing to gate on. */
function SettingsPage(): ReactNode {
  return (
    <SuspenseLoader>
      <SettingsSection />
      <p className="fd-foot" data-fd="crumb">服务设置 / 控制台</p>
    </SuspenseLoader>
  );
}

export const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsPage });
