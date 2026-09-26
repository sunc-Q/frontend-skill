export type TagId =
  | 'deploy'
  | 'observe'
  | 'incident'
  | 'testing'
  | 'storage'
  | 'network'
  | 'security'
  | 'db'
  | 'frontend'
  | 'go'
  | 'rust'
  | 'process';

export interface Post {
  slug: string;
  title: string;
  /** UTC day index, day 0 = 2021-01-01 */
  day: number;
  tag: TagId;
  series: string | null;
  readingMinutes: number;
  views: number;
  comments: number;
  summary: string;
  /** section headings of the article body, in order */
  sections: string[];
  body: string;
}

export interface MonthBucket {
  month: string;
  year: number;
  count: number;
  views: number;
  minutes: number;
}

export interface TagStat {
  tag: TagId;
  count: number;
  views: number;
  minutes: number;
}

export interface SiteStats {
  posts: number;
  views: number;
  minutes: number;
  comments: number;
  tags: number;
  /** distinct months that contain at least one post */
  months: number;
  /** first post month .. last post month, inclusive */
  spanMonths: number;
  /** longest run of consecutive posting months */
  streak: number;
  /** longest stretch of empty months inside the span */
  longestGap: number;
  avgViews: number;
  medianMinutes: number;
}

export interface Corpus {
  posts: Post[];
  byTag: TagStat[];
  byMonth: MonthBucket[];
  stats: SiteStats;
}

export type SortId = 'recent' | 'popular' | 'quick';
export type Density = 'comfortable' | 'compact';

export interface Prefs {
  version: number;
  sort: SortId;
  density: Density;
  tag: TagId | 'all';
  starred: string[];
}
