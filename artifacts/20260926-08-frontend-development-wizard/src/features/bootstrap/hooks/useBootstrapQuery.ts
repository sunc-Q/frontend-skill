import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { BOOTSTRAP_KEY, BOOTSTRAP_ROUTE, bootstrapApi, EMAIL_KEY, SUBDOMAIN_KEY } from '../api/bootstrapApi';
import { checkEmail, checkSubdomain } from '@/lib/apiClient';
import type { SubdomainVerdict } from '@/lib/apiClient';
import type { BootstrapPayload } from '~types/index';

/**
 * Reference data comes in through the skill's primary fetching pattern
 * (`useSuspenseQuery` + a Suspense boundary), and the two async validators go through
 * `queryClient.fetchQuery` so identical repeated lookups are served from cache instead of
 * re-hitting the server. Both are asserted against the request log in group F.
 */

export { BOOTSTRAP_KEY, BOOTSTRAP_ROUTE, EMAIL_KEY, SUBDOMAIN_KEY };

export function useBootstrapQuery() {
  return useSuspenseQuery({
    queryKey: BOOTSTRAP_KEY,
    queryFn: () => bootstrapApi.getBootstrap(),
    staleTime: Infinity,
  });
}

export function useAsyncCheck() {
  const qc = useQueryClient();
  return {
    subdomain: (value: string): Promise<SubdomainVerdict> =>
      qc.fetchQuery({
        queryKey: SUBDOMAIN_KEY(value),
        queryFn: () => checkSubdomain(value),
        staleTime: Infinity,
      }),
    email: (value: string): Promise<SubdomainVerdict> =>
      qc.fetchQuery({ queryKey: EMAIL_KEY(value), queryFn: () => checkEmail(value), staleTime: Infinity }),
  };
}

export type { BootstrapPayload };
