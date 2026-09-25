import { createHashHistory, createRouter } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { indexRoute } from './overview/index';
import { linksRoute } from './links/index';
import { keysRoute } from './keys/index';
import { settingsRoute } from './settings/index';

const routeTree = rootRoute.addChildren([indexRoute, linksRoute, keysRoute, settingsRoute]);

/** Hash history: the three previews are opened over file://, where history.pushState is unavailable. */
export const router = createRouter({ routeTree, history: createHashHistory() });

export type AppRouter = typeof router;
