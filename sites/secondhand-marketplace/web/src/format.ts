// 金额单位是「分」，展示为人民币元；时间统一 UTC 文本，展示也按 UTC，
// 避免同一份数据在不同机器上算出不同的「剩余有效期」。

export function cny(cents: number): string {
  if (!Number.isFinite(cents)) return '—';
  return '¥' + (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function cnyCompact(cents: number): string {
  if (!Number.isFinite(cents)) return '—';
  const v = cents / 100;
  if (Math.abs(v) >= 100_000_000) return '¥' + (v / 100_000_000).toFixed(2) + '亿';
  if (Math.abs(v) >= 10_000) return '¥' + (v / 10_000).toFixed(2) + '万';
  if (Math.abs(v) >= 1_000) return '¥' + (v / 1_000).toFixed(1) + 'k';
  return '¥' + v.toFixed(0);
}

/** 只到分的整数元写法，输入框里用，避免 ¥ 与小数把用户绕晕。 */
export function yuanToCent(yuan: number): number {
  return Math.round(yuan * 100);
}

export function centToYuan(cents: number): number {
  return Math.round(cents) / 100;
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
  return `${dateOnly(iso)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function daysAgo(iso: string, nowMs: number): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000));
}

/** 出价有效期倒计时：过期与「还没开始」都归到「已过期」。 */
export function countdown(iso: string, nowMs: number): { text: string; expired: boolean } {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return { text: '—', expired: true };
  const leftMs = t - nowMs;
  if (leftMs <= 0) return { text: '已过期', expired: true };
  const totalMin = Math.floor(leftMs / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return { text: h > 0 ? `剩 ${h}h${String(m).padStart(2, '0')}m` : `剩 ${m}m`, expired: false };
}

export const LISTING_STATUS_LABEL: Record<string, string> = {
  available: '在拍',
  reserved: '已约定',
  sold: '已售出',
  withdrawn: '已下架',
};

export const OFFER_STATUS_LABEL: Record<string, string> = {
  pending: '待确认',
  accepted: '已成交',
  rejected: '已拒绝',
  outbid: '被顶掉',
  expired: '已过期',
};

export const CONDITION_LABEL: Record<string, string> = {
  like_new: '几乎全新',
  good: '成色不错',
  fair: '有使用痕迹',
  parts: '零件/故障',
};

/** 溢价指数：挂单价相对行情参考价。>100 就是卖贵了。 */
export function premiumPct(pct: number): string {
  if (!Number.isFinite(pct)) return '—';
  return (pct > 100 ? '+' : '') + Math.round(pct - 100) + '%';
}

export function sign(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
