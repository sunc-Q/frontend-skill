import { apiClient } from '@/lib/apiClient';
import type { ApiKey } from '~types/index';

export const KEYS_QUERY_KEY = ['keys'] as const;

export const keysApi = {
  list: (): Promise<ApiKey[]> => apiClient.getKeys(),
  revoke: (id: number): Promise<ApiKey[]> => apiClient.revokeKey(id),
};

export default keysApi;
