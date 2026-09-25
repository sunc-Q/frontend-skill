const NF = new Intl.NumberFormat('zh-CN');

export function fmtInt(n: number): string {
  return NF.format(Math.round(n));
}

export function fmtPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

export function fmtDelta(cur: number, prev: number): string {
  if (prev === 0) return '—';
  const pct = ((cur - prev) / prev) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);

export function fmtDate(ts: number | null): string {
  if (ts === null) return '从未';
  const diff = NOW - ts;
  if (diff < 0) return '刚刚';
  if (diff < DAY) return `${Math.max(1, Math.floor(diff / 3_600_000))} 小时前`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} 天前`;
  const d = new Date(ts);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

export function fmtNumCompact(n: number): string {
  return n >= 100_000 ? `${(n / 1000).toFixed(0)}k` : NF.format(n);
}

export function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText !== undefined) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => fallbackCopy(text),
    );
  }
  return Promise.resolve(fallbackCopy(text));
}

function fallbackCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
