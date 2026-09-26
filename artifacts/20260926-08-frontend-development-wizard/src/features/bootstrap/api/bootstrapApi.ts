import { fetchBootstrap } from '@/lib/apiClient';
import type { BootstrapPayload } from '~types/index';

export const BOOTSTRAP_ROUTE = '/wizard/bootstrap';

/** Query keys live with the api layer so route loaders and hooks cannot drift apart. */
export const BOOTSTRAP_KEY = ['wizard', 'bootstrap'] as const;
export const SUBDOMAIN_KEY = (value: string): readonly ['check', 'subdomain', string] =>
  ['check', 'subdomain', value] as const;
export const EMAIL_KEY = (value: string): readonly ['check', 'email', string] => ['check', 'email', value] as const;

export const bootstrapApi = {
  getBootstrap: (): Promise<BootstrapPayload> => fetchBootstrap(),
};

export default bootstrapApi;
