export function cny(cents: number): string {
  if (!Number.isFinite(cents)) return '—';
  return '¥' + (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function cnyCompact(cents: number): string {
  if (!Number.isFinite(cents)) return '—';
  const v = cents / 100;
  if (Math.abs(v) >= 1_000_000) return '¥' + (v / 1_000_000).toFixed(2) + 'M';
  if (Math.abs(v) >= 10_000) return '¥' + (v / 10_000).toFixed(1) + '万';
  if (Math.abs(v) >= 1_000) return '¥' + (v / 1_000).toFixed(1) + 'k';
  return '¥' + v.toFixed(0);
}

export function dateOnly(iso: string | undefined | null): string {
  if (iso === undefined || iso === null || iso === '') return '—';
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

export const COURSE_STATUS_LABEL: Record<string, string> = {
  draft: '未上架',
  published: '在售',
  archived: '已下线',
};

export const ENROLL_STATUS_LABEL: Record<string, string> = {
  active: '在读',
  completed: '已结课',
  waitlist: '候补',
  dropped: '已退课',
};

export const SOURCE_LABEL: Record<string, string> = {
  official: '官网',
  referral: '老学员推荐',
  campus: '校园渠道',
  ad: '广告投放',
};

export function daysUntil(iso: string): number {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return 0;
  return Math.round((target - Date.now()) / 86_400_000);
}

export function sign(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function minutes(h: number): string {
  return `${h} 小时`;
}
