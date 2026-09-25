export function yuan(cents: number): string {
  if (!Number.isFinite(cents)) return '—';
  return '¥' + (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function yuanCompact(cents: number): string {
  if (!Number.isFinite(cents)) return '—';
  const v = cents / 100;
  if (Math.abs(v) >= 10_000) return '¥' + (v / 10_000).toFixed(1) + '万';
  if (Math.abs(v) >= 1_000) return '¥' + (v / 1_000).toFixed(1) + 'k';
  return '¥' + v.toFixed(0);
}

export function dateTime(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function timeOnly(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export const STATUS_LABEL: Record<string, string> = {
  placed: '待接单',
  cooking: '制作中',
  ready: '待取餐',
  delivering: '配送中',
  delivered: '已送达',
  cancelled: '已取消',
};

export const CATEGORY_LABEL: Record<string, string> = {
  hot: '热菜',
  cold: '凉菜',
  staple: '主食',
  soup: '汤羹',
  dessert: '饮品甜点',
};

export function spiceText(level: number): string {
  return '辣'.repeat(Math.max(0, Math.min(3, level))) || '不辣';
}

export function minutesText(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `${n} 分钟`;
}

export function elapsedMinutes(iso: string, nowMs: number): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((nowMs - t) / 60_000));
}
