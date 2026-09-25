export function yuan(cents: number): string {
  if (!Number.isFinite(cents)) return '—';
  return '¥' + (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function yuanCompact(cents: number): string {
  if (!Number.isFinite(cents)) return '—';
  const v = cents / 100;
  if (Math.abs(v) >= 10_000) return '¥' + (v / 10_000).toFixed(2) + '万';
  return '¥' + v.toFixed(v >= 100 || Number.isInteger(v) ? 0 : 2);
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

export const CATEGORY_LABEL: Record<string, string> = {
  general: '普通书',
  large_print: '大字本',
  boxed_set: '盒装',
  reference: '参考工具书',
};

export const COPY_STATUS_LABEL: Record<string, string> = {
  available: '在架',
  on_loan: '借出',
  missing: '遗失',
  retired: '剔旧',
};

export const LOAN_STATUS_LABEL: Record<string, string> = {
  active: '在借',
  returned: '已还',
  overdue: '逾期',
};

export const MEMBER_STATUS_LABEL: Record<string, string> = {
  active: '正常',
  suspended: '停用',
};

export const MEMBER_TYPE_LABEL: Record<string, string> = {
  standard: '普通证',
  family: '家庭证',
  student: '学生证',
};

export const CONDITION_LABEL: Record<string, string> = {
  good: '完好',
  worn: '磨损',
  damaged: '破损',
};

export function daysUntil(iso: string): number {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return 0;
  return Math.round((target - Date.now()) / 86_400_000);
}

export function sign(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
