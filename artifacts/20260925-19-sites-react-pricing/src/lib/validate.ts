/* 正则提到模块作用域，避免每次输入都新建 RegExp（js-hoist-regexp）。 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export type EmailState = { ok: true } | { ok: false; reason: string };

export function checkEmail(value: string): EmailState {
  const trimmed = value.trim();
  if (trimmed === '') return { ok: false, reason: '还没填邮箱' };
  if (trimmed.length > 80) return { ok: false, reason: '邮箱过长，请检查是否粘贴了多余内容' };
  if (!EMAIL_RE.test(trimmed)) return { ok: false, reason: '格式不像可用邮箱，收件箱里确认一下' };
  return { ok: true };
}
