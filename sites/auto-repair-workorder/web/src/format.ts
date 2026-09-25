import type { Category, Grade, MoveKind, OrderStatus, PartStatus, Priority } from './types';

export function yuan(cents: number): string {
  if (!Number.isFinite(cents)) return '—';
  return (
    '¥' +
    (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

export function yuanCompact(cents: number): string {
  if (!Number.isFinite(cents)) return '—';
  const v = cents / 100;
  if (Math.abs(v) >= 10_000) return '¥' + (v / 10_000).toFixed(2) + '万';
  return '¥' + v.toFixed(v >= 100 || Number.isInteger(v) ? 0 : 2);
}

export function dateOnly(iso: string | null | undefined): string {
  if (iso === undefined || iso === null || iso === '') return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

export function hourMin(iso: string | null | undefined): string {
  if (iso === undefined || iso === null || iso === '') return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function dateTime(iso: string | null | undefined): string {
  if (iso === undefined || iso === null || iso === '') return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${dateOnly(iso)} ${hourMin(iso)} UTC`;
}

export function minutesToHours(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return '0 小时';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} 分钟`;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  received: '接车',
  diagnosed: '检测定项',
  awaiting_parts: '待料',
  repairing: '在修',
  qc: '完工质检',
  settled: '已结算',
  picked_up: '已提车',
  cancelled: '已作废',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  normal: '普通',
  urgent: '加急',
  warranty: '保客回厂',
};

export const GRADE_LABEL: Record<Grade, string> = {
  junior: '初级',
  middle: '中级',
  master: '大师',
};

export const CATEGORY_LABEL: Record<Category, string> = {
  engine: '发动机系统',
  brake: '制动系统',
  filter: '滤清系统',
  electrical: '电气',
  suspension: '悬挂转向',
  consumable: '油液耗材',
  transmission: '传动',
};

export const MOVE_KIND_LABEL: Record<MoveKind, string> = {
  receipt: '入库',
  issue: '出库',
  return: '退料',
  scrap: '报损',
};

export const PART_STATUS_LABEL: Record<PartStatus, string> = {
  active: '在用',
  discontinued: '停用',
};

export function statusLabel(status: string): string {
  return (ORDER_STATUS_LABEL as Record<string, string>)[status] ?? status;
}

export function lineLabel(kind: string): string {
  return kind === 'labor' ? '工时' : kind === 'part' ? '配件' : kind;
}

export function sign(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

// 逾期与等待的判据都交给后端算（promise_overdue / wait_minutes），
// 前端只做展示，绝不第二次算账。
export function waitLabel(minutes: number): string {
  if (minutes <= 0) return '刚开单';
  return `在厂 ${minutesToHours(minutes)}`;
}
