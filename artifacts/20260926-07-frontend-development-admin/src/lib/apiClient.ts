import { buildDataset } from './dataset';
import type { ApiKey, BeLink, Dataset, OverviewData } from '~types/index';

/**
 * frontend-development prescribes an `apiClient` axios instance talking to a real
 * backend. This scenario has no backend (single-file offline preview), so apiClient is
 * an in-process transport that keeps the same call shape (client.get/post on '/resource'
 * paths, no '/api' prefix) plus a latency table and an arrival log the checks read.
 */
export interface LogEntry {
  path: string;
  method: 'get' | 'post';
  atMs: number;
}

const LATENCY: Record<string, number> = {
  '/overview': 260,
  '/links': 180,
  '/keys': 320,
};

const dataset: Dataset = buildDataset();

/** Mutable "server" state; the UI only ever sees clones. */
const server = {
  links: dataset.links.map((l: BeLink) => ({ ...l })),
  keys: dataset.keys.map((k: ApiKey) => ({ ...k })),
};

const log: LogEntry[] = [];
const t0 = Date.now();

function snapshotLinks(): BeLink[] {
  return server.links.map((l: BeLink) => ({ ...l }));
}

function delay(path: string): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, LATENCY[path] ?? 150);
  });
}

async function request<T>(method: 'get' | 'post', path: string, read: () => T): Promise<T> {
  log.push({ path, method, atMs: Date.now() - t0 });
  await delay(path);
  return read();
}

export const apiClient = {
  getOverview: (): Promise<OverviewData> =>
    request('get', '/overview', () => ({
      stats: { ...dataset.stats },
      events: dataset.events.map((e) => ({ ...e })),
    })),
  getLinks: (): Promise<BeLink[]> => request('get', '/links', snapshotLinks),
  getKeys: (): Promise<ApiKey[]> =>
    request('get', '/keys', () => server.keys.map((k) => ({ ...k }))),
  setLinkPaused: (id: number, paused: boolean): Promise<BeLink[]> =>
    request('post', '/links', () => {
      server.links = server.links.map((l) => (l.id === id ? { ...l, paused } : l));
      return snapshotLinks();
    }),
  deleteLink: (id: number): Promise<BeLink[]> =>
    request('post', '/links', () => {
      server.links = server.links.filter((l) => l.id !== id);
      return snapshotLinks();
    }),
  revokeKey: (id: number): Promise<ApiKey[]> =>
    request('post', '/keys', () => {
      server.keys = server.keys.filter((k) => k.id !== id);
      return server.keys.map((k) => ({ ...k }));
    }),
};

export function requestLog(): LogEntry[] {
  return log.map((e) => ({ ...e }));
}

export const series14: number[] = dataset.series14;
