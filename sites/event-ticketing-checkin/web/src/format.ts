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

/** 距开门/开演的倒计时：已开场与未开场用不同文案，闸口状态一眼可辨。 */
export function countdown(iso: string, nowMs: number): { text: string; expired: boolean } {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return { text: '—', expired: true };
  const leftMs = t - nowMs;
  if (leftMs <= 0) return { text: '已过时点', expired: true };
  const totalMin = Math.floor(leftMs / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const text = d > 0 ? `剩 ${d}天${String(h).padStart(2, '0')}时` : h > 0 ? `剩 ${h}h${String(m).padStart(2, '0')}m` : `剩 ${m}m`;
  return { text, expired: false };
}

export const EVENT_STATUS_LABEL: Record<string, string> = {
  draft: '待开票',
  on_sale: '在售',
  closed: '已散场',
  cancelled: '已取消',
};

export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: '待支付',
  paid: '已支付',
  refunded: '已退票',
  cancelled: '已作废',
};

export const TICKET_STATUS_LABEL: Record<string, string> = {
  valid: '未入场',
  used: '已入场',
  void: '已作废',
};

export const TYPE_STATUS_LABEL: Record<string, string> = {
  open: '在售',
  paused: '停售',
};

export const CHANNEL_LABEL: Record<string, string> = {
  web: '线上',
  box: '票店',
  partner: '合作方',
  onsite: '现场',
};

export const CATEGORY_LABEL: Record<string, string> = {
  concert: '音乐会',
  theatre: '话剧',
  livehouse: '现场音乐',
  exhibition: '展览',
  family: '亲子',
  esports: '电竞',
};

/** 核销/退票被拦下时的原因码 → 人话。与 domain 里的裁决码一一对应。 */
export const VERDICT_LABEL: Record<string, string> = {
  event_cancelled: '场次已取消',
  not_on_sale: '场次未开票',
  event_closed: '已散场关闸',
  doors_not_open: '未到入场时间',
  gate_shut: '已过迟到宽限',
  already_used: '该票已入场',
  ticket_void: '该票已作废',
  gate_required: '需指定闸口',
  gate_unknown: '闸口不属于本场',
  already_refunded: '已退过票',
  order_cancelled: '订单未支付',
  partially_used: '已有人入场',
  partially_void: '已有票作废',
  past_cutoff: '已过退票截止',
  sold_out: '配额不足',
  conflict: '状态不允许',
  not_found: '资源不存在',
  invalid_request: '参数校验未通过',
  unauthorized: '缺少管理令牌',
  forbidden: '管理令牌无效',
  server_misconfigured: '服务端未配令牌',
  body_too_large: '请求体过大',
  internal_error: '服务内部错误',
  network: '连不上后端',
};

export function verdict(code: string | undefined | null): string {
  if (code === undefined || code === null || code === '') return '—';
  return VERDICT_LABEL[code] ?? code;
}

/** 万分比 → 百分比文本。 */
export function bp(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return (value / 100).toFixed(1) + '%';
}

/** 立减万分比 → 「立减 12%」；0 返回空串由调用方省略。 */
export function earlyOff(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return '';
  return `立减 ${(bps / 100).toFixed(0)}%`;
}

export function sign(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
