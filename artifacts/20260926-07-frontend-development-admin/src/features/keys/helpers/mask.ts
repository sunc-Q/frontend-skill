import type { ApiKey } from '~types/index';

const MASK_DOTS = 12;

export function maskKey(k: ApiKey): string {
  return `${k.prefix}_${'•'.repeat(MASK_DOTS)}${k.secret.slice(-4)}`;
}

export function fullKey(k: ApiKey): string {
  return `bcn_${k.secret}`;
}
