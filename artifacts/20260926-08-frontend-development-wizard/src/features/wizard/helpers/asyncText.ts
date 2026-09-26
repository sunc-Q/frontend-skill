import type { AsyncVerdict } from '~types/index';

export const ASYNC_ERROR_TEXT: Record<AsyncVerdict, string> = {
  idle: '',
  checking: '正在校验…',
  available: '',
  taken: '该名称已被占用',
  reserved: '该名称为平台保留名',
  error: '校验服务无响应，请重试',
};

export const VERDICT_LABEL: Record<AsyncVerdict, string> = {
  idle: '未校验',
  checking: '校验中',
  available: '可用',
  taken: '已占用',
  reserved: '保留名',
  error: '校验失败',
};

/**
 * Verdicts that must read as an error on the field itself, not only in the checklist.
 * The set is derived from VERDICT_LABEL so a renamed label cannot silently drop a state.
 */
export const ASYNC_BAD: ReadonlySet<string> = new Set<string>([
  VERDICT_LABEL.taken,
  VERDICT_LABEL.reserved,
  VERDICT_LABEL.error,
]);
