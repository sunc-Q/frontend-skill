import { apiClient } from '@/lib/apiClient';
import type { BeLink } from '~types/index';

/** Skill clause: "Create API service file: api/{feature}Api.ts", route format "/links" (no /api prefix). */
export const LINKS_QUERY_KEY = ['links'] as const;

export const linksApi = {
  list: (): Promise<BeLink[]> => apiClient.getLinks(),
  setPaused: (id: number, paused: boolean): Promise<BeLink[]> => apiClient.setLinkPaused(id, paused),
  remove: (id: number): Promise<BeLink[]> => apiClient.deleteLink(id),
};

export default linksApi;
