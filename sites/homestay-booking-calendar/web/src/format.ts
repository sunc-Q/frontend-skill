// 展示层格式化：金额一律来自后端的"分"，这里只做千分位，绝不参与业务计算。

export function yuan(cents: number | undefined): string {
  if (cents === undefined || !Number.isFinite(cents)) return '—';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const yuanPart = Math.floor(abs / 100).toLocaleString('zh-CN');
  const centPart = String(abs % 100).padStart(2, '0');
  return `${sign}¥${yuanPart}.${centPart}`;
}

export function yuanShort(cents: number | undefined): string {
  if (cents === undefined || !Number.isFinite(cents)) return '—';
  const v = cents / 100;
  if (Math.abs(v) >= 10_000) return `¥${(v / 10_000).toFixed(1)}万`;
  if (Math.abs(v) >= 1_000) return `¥${(v / 1_000).toFixed(1)}k`;
  return `¥${v.toFixed(0)}`;
}

// pct 接万分比（后端 occ_bps / fill_bps / share_bps 全是 0~10000）。
export function pct(bps: number | undefined, digits = 1): string {
  if (bps === undefined || !Number.isFinite(bps)) return '—';
  return `${(bps / 100).toFixed(digits)}%`;
}

export function int(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('zh-CN');
}

// MM-DD：日历表头只要月日，年份在窗口说明里给一次。
export function mmdd(date: string): string {
  if (date.length < 10) return date;
  return date.slice(5);
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function nightCount(checkIn: string, checkOut: string): number {
  const a = new Date(checkIn + 'T12:00:00Z').getTime();
  const b = new Date(checkOut + 'T12:00:00Z').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.round((b - a) / 86_400_000);
}

// 离店日不计夜，所以"住到哪天"要说成"离开那天"。
export function stayText(nights: number): string {
  return `${nights} 晚 ${Math.max(nights - 1, 0)} 天`;
}

export function daysToText(days: number): string {
  if (days === 0) return '今天入住';
  if (days > 0) return `${days} 天后入住`;
  return `${-days} 天前已入住`;
}

export function dateTimeLocal(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

export function rating(ratingPermille: number): string {
  return (ratingPermille / 1000).toFixed(2);
}
