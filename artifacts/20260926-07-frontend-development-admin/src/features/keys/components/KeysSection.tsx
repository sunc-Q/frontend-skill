import React, { useCallback, useMemo, useReducer } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { KEYS_QUERY_KEY, keysApi } from '../api/keysApi';
import { useKeysQuery } from '../hooks/useKeysQuery';
import { KeyRow } from './KeyRow';
import { fullKey } from '../helpers/mask';
import { copyText } from '@/lib/format';
import { useMuiSnackbar } from '@/hooks/useMuiSnackbar';
import type { ApiKey } from '~types/index';

interface RevealState {
  revealed: number[];
}

type RevealAction = { type: 'toggle'; id: number };

function revealReducer(s: RevealState, a: RevealAction): RevealState {
  return { revealed: s.revealed.includes(a.id) ? s.revealed.filter((i) => i !== a.id) : [...s.revealed, a.id] };
}

export const KeysSection: React.FC = () => {
  const keys = useKeysQuery();
  const [state, dispatch] = useReducer(revealReducer, { revealed: [] });
  const queryClient = useQueryClient();
  const snackbar = useMuiSnackbar();

  const unused = useMemo(() => keys.filter((k) => k.lastUsedAt === null).length, [keys]);

  const revokeMutation = useMutation({
    mutationFn: (k: ApiKey): Promise<ApiKey[]> => keysApi.revoke(k.id),
    onSuccess: (next, k) => {
      queryClient.setQueryData(KEYS_QUERY_KEY, next);
      snackbar.enqueue(`已吊销密钥「${k.label}」`, 'success');
    },
    onError: () => snackbar.enqueue('吊销失败，请稍后再试', 'error'),
  });

  const onReveal = useCallback((id: number) => dispatch({ type: 'toggle', id }), []);
  const onCopy = useCallback(
    (k: ApiKey) => {
      void copyText(fullKey(k)).then((ok) =>
        snackbar.enqueue(ok ? `已复制「${k.label}」的密钥` : '剪贴板不可用，请手动复制', ok ? 'success' : 'error'),
      );
    },
    [snackbar],
  );
  const onRevoke = useCallback((k: ApiKey) => revokeMutation.mutate(k), [revokeMutation]);

  return (
    <Paper className="fd-relief" sx={{ p: 2, display: 'grid', gap: 1 }} data-section="keys">
      <Typography variant="caption" component="p" data-fd="keys-hint">
        共 {keys.length} 个密钥，其中 {unused} 个从未使用。密钥仅在此界面展示明文，请勿截图外传。
      </Typography>
      <TableContainer>
        <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell component="th" scope="col">名称</TableCell>
            <TableCell component="th" scope="col">密钥</TableCell>
            <TableCell component="th" scope="col">权限范围</TableCell>
            <TableCell component="th" scope="col">最近使用</TableCell>
            <TableCell component="th" scope="col">创建于</TableCell>
            <TableCell component="th" scope="col">操作</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {keys.length > 0 ? (
            keys.map((k) => (
              <KeyRow key={k.id} k={k} revealed={state.revealed.includes(k.id)} onReveal={onReveal} onCopy={onCopy} onRevoke={onRevoke} />
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={6} className="fd-empty">已无可用密钥</TableCell>
            </TableRow>
          )}
        </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
};

export default KeysSection;
