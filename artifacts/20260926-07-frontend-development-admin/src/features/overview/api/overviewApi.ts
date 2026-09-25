import { apiClient } from '@/lib/apiClient';
import type { OverviewData } from '~types/index';

export const OVERVIEW_QUERY_KEY = ['overview'] as const;

export const overviewApi = {
  get: (): Promise<OverviewData> => apiClient.getOverview(),
};

export default overviewApi;
