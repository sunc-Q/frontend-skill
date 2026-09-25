import { useMemo, useReducer, useState } from 'react';
import type { ApiKey } from '../data/dataset';
import { fmtDate, copyText } from '../lib/format';
import { useTwoStep, actButtonLabel } from '../components/shared';

interface KeysState {
  keys: ApiKey[];
  revealed: number[];
}

type KeysAction =
  | { type: 'reveal'; id: number }
  | { type: 'remove'; id: number };

function keysReducer(s: KeysState, a: KeysAction): KeysState {
  switch (a.type) {
    case 'reveal':
      return { ...s, revealed: s.revealed.includes(a.id) ? s.revealed.filter((i) => i !== a.id) : [...s.revealed, a.id] };
    case 'remove':
      return { keys: s.keys.filter((k) => k.id !== a.id), revealed: s.revealed.filter((i) => i !== a.id) };
  }
}

// advanced-event-handler-refs + client-event-listeners: 全局委托一次性监听
export function KeysSection({ keys: initial, onToast }: { keys: ApiKey[]; onToast: (m: string) => void }) {
  const [state, dispatch] = useReducer(keysReducer, { keys: initial, revealed: [] });
  const [copying, setCopying] = useState<number | null>(null);

  const total = state.keys.length;
  const unused = useMemo(() => state.keys.filter((k) => k.lastUsedAt === null).length, [state.keys]);

  const copyKey = (k: ApiKey) => {
    setCopying(k.id);
    void copyText(`bcn_${k.secret}`).then((ok) => {
      setCopying(null);
      onToast(ok ? `已复制「${k.label}」的密钥` : '剪贴板不可用，请手动复制');
    });
  };

  return (
    <div className="stack">
      <p className="hint">
        共 {total} 个密钥，其中 {unused} 个从未使用。密钥仅在此界面展示明文，请勿截图外传。
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>名称</th>
            <th>密钥</th>
            <th>权限范围</th>
            <th>最近使用</th>
            <th>创建于</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {state.keys.length > 0 ? state.keys.map((k) => (
            <KeyRow
              key={k.id}
              k={k}
              revealed={state.revealed.includes(k.id)}
              copying={copying === k.id}
              onReveal={() => dispatch({ type: 'reveal', id: k.id })}
              onCopy={() => copyKey(k)}
              onRemove={() => {
                dispatch({ type: 'remove', id: k.id });
                onToast(`已吊销密钥「${k.label}」`);
              }}
            />
          )) : (
            <tr><td colSpan={6} className="table-empty">已无可用密钥</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function KeyRow({ k, revealed, copying, onReveal, onCopy, onRemove }: {
  k: ApiKey;
  revealed: boolean;
  copying: boolean;
  onReveal: () => void;
  onCopy: () => void;
  onRemove: () => void;
}) {
  const [confirmClick, pending, cancelPending] = useTwoStep(onRemove);
  const masked = `${k.prefix}_${'•'.repeat(12)}${k.secret.slice(-4)}`;
  return (
    <tr data-keyid={k.id} data-pending={String(pending)}>
      <td>{k.label}</td>
      <td className="mono">{revealed ? `bcn_${k.secret}` : masked}</td>
      <td>
        <div className="scopes">
          {k.scopes.map((s) => <span key={s} className="scope">{s}</span>)}
        </div>
      </td>
      <td>{fmtDate(k.lastUsedAt)}</td>
      <td>{fmtDate(k.createdAt)}</td>
      <td>
        <div className="row-actions">
          <button type="button" className="btn btn--ghost" onClick={onReveal}>{revealed ? '隐藏' : '显示'}</button>
          <button type="button" className="btn btn--ghost" onClick={onCopy}>{copying ? '复制中…' : '复制'}</button>
          {pending !== 0 ? (
            <button type="button" className="btn btn--danger" onClick={confirmClick}>{actButtonLabel(true, '吊销')}</button>
          ) : (
            <button type="button" className="btn btn--ghost" onClick={confirmClick}>吊销</button>
          )}
          {pending !== 0 ? <button type="button" className="btn btn--ghost" onClick={cancelPending}>取消</button> : null}
        </div>
      </td>
    </tr>
  );
}
