import type { TagId } from '~types/post';

export interface InsightsPayload {
  months: { month: string; count: number; views: number }[];
  tags: { tag: TagId; count: number }[];
  years: { year: number; minutes: number; posts: number }[];
}
