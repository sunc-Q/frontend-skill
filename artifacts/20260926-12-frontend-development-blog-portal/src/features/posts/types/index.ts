import type { Density, SortId, TagId } from '~types/post';

export interface PostRow {
  slug: string;
  title: string;
  day: number;
  tag: TagId;
  views: number;
  minutes: number;
  comments: number;
}

export interface ListPayload {
  rows: PostRow[];
  generatedFor: string;
}

export interface PostPayload extends PostRow {
  summary: string;
  series: string | null;
  sections: string[];
  body: string;
  related: PostRow[];
}

export interface ListQuery {
  q: string;
  tag: TagId | 'all';
  sort: SortId;
  density: Density;
}
