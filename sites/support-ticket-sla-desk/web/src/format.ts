// 展示层工具。时间口径约定：
// 库里与接口里的时刻是 UTC（GORM 把 DATETIME 统一按 UTC 存取，所以工单时间带 Z），
// 而现场挂钟是东八区。展示时做的是「UTC + 固定偏移」的确定性换算——
// 全程用 Date.parse / toISOString（两者都与本机时区无关），绝不用 toLocaleString，
// 否则同一份数据在 UTC+0 的机器上会整体错位 8 小时。
// 偏移量由 /api/meta 的 field_utc_offset_min 下发，默认 480（东八区）。

let fieldOffsetMin = 480;

export function setFieldOffset(minutes: number | undefined): void {
  if (typeof minutes === 'number' && Number.isFinite(minutes)) fieldOffsetMin = minutes;
}

/** 把任意带偏移的时刻串换成「现场挂钟」的 ISO 串；解析不了就原样返回。 */
function toFieldIso(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms + fieldOffsetMin * 60_000).toISOString();
}

export function fieldDateTime(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '—';
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(toFieldIso(iso));
  if (m === null) return iso;
  return `${m[1] ?? ''} ${m[2] ?? ''}`;
}

export function fieldDate(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '—';
  return toFieldIso(iso).slice(0, 10);
}

export function fieldClock(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '—';
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(toFieldIso(iso));
  if (m === null) return iso;
  return `${(m[1] ?? '').slice(5)} ${m[2] ?? ''}`;
}

/** 工作分钟的完整写法：详情页用，单位必须写全，避免和挂钟分钟混淆。 */
export function bd(minutes: number): string {
  if (!Number.isFinite(minutes)) return '—';
  return `${Math.round(minutes).toLocaleString('en-US')} 工作分钟`;
}

/** 工作分钟的紧凑写法：表格里用，>60 折成小时，符号表示剩余还是超时。 */
export function bdCompact(minutes: number): string {
  if (!Number.isFinite(minutes)) return '—';
  const n = Math.round(minutes);
  const abs = Math.abs(n);
  const body = abs >= 480 ? `${(abs / 480).toFixed(1)} 日` : abs >= 60 ? `${(abs / 60).toFixed(1)} 时` : `${abs} 分`;
  return n < 0 ? `超 ${body}` : body;
}

/** 剩余/超时的读法。后端两种口径都出现过：在办单剩余为负数，
 *  已完成超时单把超时量存成正数——所以统一取绝对值再自己贴「超」字，避免「超 超」。 */
export function remainText(remainingBd: number, breached: boolean): string {
  return breached ? `超 ${bdCompact(Math.abs(remainingBd))}` : bdCompact(remainingBd);
}

export function num(n: number): string {  return Number.isFinite(n) ? n.toLocaleString('en-US') : '—';
}

export function pct(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

export function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export type Tone = 'ok' | 'warn' | 'bad' | 'done' | 'idle';

/** 一行的色调：只依赖后端算好的布尔位，前端不再判一次时效。 */
export function rowTone(r: { breached: boolean; at_risk: boolean; finished: boolean; status: string }): Tone {
  if (r.status === 'canceled') return 'idle';
  if (r.breached) return 'bad';
  if (r.at_risk) return 'warn';
  if (r.finished) return 'done';
  return 'ok';
}

export function boolMark(v: boolean | null | undefined): string {
  if (v === null || v === undefined) return '待定';
  return v ? '达标' : '未达标';
}

export const TONE_TEXT: Record<Tone, string> = {
  ok: '正常计时',
  warn: '即将超时',
  bad: '已超时',
  done: '已完成',
  idle: '不参与时效',
};

export function kindLabel(kind: string): string {
  switch (kind) {
    case 'created':
      return '建单';
    case 'assigned':
      return '派单';
    case 'status':
      return '推进';
    case 'paused':
      return '停表';
    case 'resumed':
      return '恢复计时';
    case 'note':
      return '备注';
    case 'escalated':
      return '升级';
    default:
      return kind;
  }
}
