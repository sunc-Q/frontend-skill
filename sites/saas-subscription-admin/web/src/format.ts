export function usd(cents: number): string {
  if (!Number.isFinite(cents)) return '—';
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function usdCompact(cents: number): string {
  if (!Number.isFinite(cents)) return '—';
  const v = cents / 100;
  if (Math.abs(v) >= 1_000_000) return '$' + (v / 1_000_000).toFixed(2) + 'M';
  if (Math.abs(v) >= 1_000) return '$' + (v / 1_000).toFixed(1) + 'k';
  return '$' + v.toFixed(0);
}

export function dateOnly(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function dateTime(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${dateOnly(iso)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

export const STATUS_LABEL: Record<string, string> = {
  trialing: '试用中',
  active: '正常计费',
  past_due: '逾期未付',
  canceled: '已退订',
};

export const PERIOD_LABEL: Record<string, string> = {
  monthly: '月付',
  yearly: '年付',
};

export function daysUntil(iso: string): number {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return 0;
  return Math.round((target - Date.now()) / 86_400_000);
}

export function sign(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
