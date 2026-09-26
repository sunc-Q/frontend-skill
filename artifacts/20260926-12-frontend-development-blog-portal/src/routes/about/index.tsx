import { lazy } from 'react';
import type { RouteSpec } from '../router';

const AboutPage = lazy(() => import('~features/about').then((m) => ({ default: m.AboutPage })));

/** No loader at all: this route must contribute zero reads (group G asserts exactly that). */
export const aboutRoute: RouteSpec = {
  pattern: '/about',
  crumb: '关于',
  layoutId: 'about',
  component: AboutPage,
};
