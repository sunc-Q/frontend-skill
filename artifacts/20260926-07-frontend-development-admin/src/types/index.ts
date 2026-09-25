export interface BeLink {
  id: number;
  slug: string;
  target: string;
  owner: string;
  createdAt: number;
  lastClickAt: number | null;
  clicks: number;
  paused: boolean;
  note: string;
}

export interface ApiKey {
  id: number;
  label: string;
  prefix: string;
  secret: string;
  scopes: string[];
  lastUsedAt: number | null;
  createdAt: number;
}

export interface ActivityEvent {
  id: number;
  at: number;
  kind: 'deploy' | 'alert' | 'user' | 'system';
  text: string;
}

export interface Stats {
  totalLinks: number;
  activeLinks: number;
  clicks7d: number;
  clicksPrev7d: number;
  apiCalls30d: number;
  topSlug: string;
  topClicks: number;
  uptime: number;
  sparkDaily: number[];
  sparkWeekly: number[];
  sparkApi: number[];
  sparkUptime: number[];
}

export interface Dataset {
  links: BeLink[];
  series14: number[];
  keys: ApiKey[];
  events: ActivityEvent[];
  stats: Stats;
}

export interface OverviewData {
  stats: Stats;
  events: ActivityEvent[];
}

export interface Settings {
  serviceName: string;
  defaultDomain: string;
  weeklyDigest: boolean;
  slowLinkAlert: boolean;
  pageSize: number;
}

export type LinkFilter = 'all' | 'active' | 'paused';
export type SortKey = 'clicks' | 'createdAt' | 'slug';
