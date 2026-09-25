import type { BookingSource, BookingStatus, CardType, Category, CoachLevel, SessionStatus } from './types';

// 金额一律是后端返回的「分」，展示层再折算成元；前端不做任何业务计算。
export function cny(cents: number): string {
  if (!Number.isFinite(cents)) return '—';
  return '¥' + (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function cnyCompact(cents: number): string {
  if (!Number.isFinite(cents)) return '—';
  const v = cents / 100;
  if (Math.abs(v) >= 10_000) return '¥' + (v / 10_000).toFixed(1) + ' 万';
  return '¥' + v.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

export function dateOnly(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function timeOnly(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function endAt(iso: string, minutes: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const end = new Date(d.getTime() + minutes * 60_000);
  return `${pad(end.getUTCHours())}:${pad(end.getUTCMinutes())}`;
}

export function stamp(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${dateOnly(iso)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekday(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return WEEKDAYS[d.getUTCDay()] ?? '';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export const CATEGORY_LABEL: Record<Category, string> = {
  strength: '力量',
  cardio: '有氧',
  yoga: '瑜伽',
  cycling: '单车',
  boxing: '搏击',
  recovery: '恢复',
};

export const LEVEL_LABEL: Record<CoachLevel, string> = {
  junior: '初级教练',
  senior: '资深教练',
  master: '明星教练',
};

export const SESSION_LABEL: Record<SessionStatus, string> = {
  open: '开放预约',
  closed: '已结课',
  canceled: '已取消',
};

export const BOOKING_LABEL: Record<BookingStatus, string> = {
  confirmed: '已确认',
  waitlist: '候补中',
  canceled: '已取消',
  no_show: '未到',
};

export const CARD_LABEL: Record<CardType, string> = {
  trial: '体验卡',
  ten_session: '十次卡',
  monthly: '月卡',
  quarterly: '季卡',
  annual: '年卡',
};

export const SOURCE_LABEL: Record<BookingSource, string> = {
  app: '小程序',
  front_desk: '前台',
  coach: '教练代约',
  phone: '电话',
};

// daysUntil 以 UTC 为基准：后端把课节时间都存在 UTC，页面也必须按 UTC 读，
// 否则换一台时区不同的机器就会看到「未来的课显示成已开课」。
export function daysUntil(iso: string): number {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return 0;
  return Math.round((target - Date.now()) / 86_400_000);
}

export function sign(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
