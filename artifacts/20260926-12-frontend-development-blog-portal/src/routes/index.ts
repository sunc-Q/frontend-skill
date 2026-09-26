import { aboutRoute } from './about';
import { archiveRoute } from './archive';
import { homeRoute } from './home';
import { postRoute } from './post';
import type { RouteSpec } from './router';

/**
 * The route table. Home first, because matchRoute falls back to routes[0] for unknown hashes —
 * a bad deep link must land somewhere readable rather than blank.
 */
export const routes: RouteSpec[] = [homeRoute, postRoute, archiveRoute, aboutRoute];

export const DEFAULT_HASH = '#/';

export function currentHash(): string {
  const h = window.location.hash;
  return h === '' ? DEFAULT_HASH : h;
}
