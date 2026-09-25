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

/** 秒 -> 分:秒，名单与成绩单共用。 */
export function clock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function minutes(n: number): string {
  return Number.isFinite(n) ? `${n} 分钟` : '—';
}

export function pct(v: number | undefined, digits = 1): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}%`;
}

export function num(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US');
}

/** 选项序号：0 -> A。判断题用 T/F 展示，但后端接收的是字母，前端不做二次翻译。 */
export function letter(i: number): string {
  return String.fromCharCode(65 + i);
}

export const ASMT_STATUS_LABEL: Record<string, string> = {
  draft: '待发布',
  open: '进行中',
  closed: '已收卷',
};

export const ATTEMPT_STATUS_LABEL: Record<string, string> = {
  ongoing: '作答中',
  graded: '已判分',
  invalid: '已作废',
};

export const KIND_LABEL: Record<string, string> = {
  placement: '摸底',
  unit: '单元',
  mock: '模拟',
  cert: '认证',
};

export const TYPE_LABEL: Record<string, string> = {
  single: '单选',
  multi: '多选',
  judge: '判断',
  blank: '填空',
};

export const CHANNEL_LABEL: Record<string, string> = {
  web: '官网报名',
  campus: '校园渠道',
  partner: '机构合作',
};

/** 判断题的作答在卷面上按文字回显，提交仍是字母。 */
export function pickedText(type: string, picked: string): string {
  if (picked === '') return '未作答';
  if (type === 'judge') {
    if (picked === 'T') return '正确';
    if (picked === 'F') return '错误';
  }
  return picked;
}

export function difficultyClass(d: string): string {
  return d === '难' ? 'hard' : d === '中' ? 'mid' : d === '易' ? 'easy' : 'empty';
}
