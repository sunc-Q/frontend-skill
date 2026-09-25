import React, { useCallback, useMemo, useReducer } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, ButtonGroup, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField } from '@mui/material';
import { LINKS_QUERY_KEY, linksApi } from '../api/linksApi';
import { useLinksQuery } from '../hooks/useLinksQuery';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { INITIAL_VIEW, ownerCounts, selectRows, sumClicks, viewReducer } from '../helpers/linkViews';
import { LinkRow } from './LinkRow';
import { copyText, fmtInt } from '@/lib/format';
import { useMuiSnackbar } from '@/hooks/useMuiSnackbar';
import type { BeLink, LinkFilter, SortKey } from '~types/index';

const FILTERS: ReadonlyArray<[LinkFilter, string]> = [
  ['all', '全部'],
  ['active', '活跃'],
  ['paused', '停用'],
];

const SORTS: ReadonlyArray<[SortKey, string]> = [
  ['clicks', '按点击'],
  ['createdAt', '按创建'],
  ['slug', '按短链码'],
];

/** rendering-hoist-jsx equivalent in the skill: static tables live at module scope. */
export const LinksSection: React.FC = () => {
  const rows = useLinksQuery();
  const queryClient = useQueryClient();
  const snackbar = useMuiSnackbar();
  const [view, dispatch] = useReducer(viewReducer, INITIAL_VIEW);
  const deferredQ = useDebouncedValue(view.q);

  const visible = useMemo(() => selectRows(rows, view, deferredQ), [rows, view, deferredQ]);
  const counts = useMemo(() => ownerCounts(rows), [rows]);
  const shownClicks = useMemo(() => sumClicks(visible), [visible]);
  const stale = deferredQ !== view.q;

  const pauseMutation = useMutation({
    mutationFn: (vars: { id: number; paused: boolean }): Promise<BeLink[]> => linksApi.setPaused(vars.id, vars.paused),
    onSuccess: (next) => queryClient.setQueryData(LINKS_QUERY_KEY, next),
  });
  const deleteMutation = useMutation({
    mutationFn: (row: BeLink): Promise<BeLink[]> => linksApi.remove(row.id),
    onSuccess: (next, row) => {
      queryClient.setQueryData(LINKS_QUERY_KEY, next);
      snackbar.enqueue(`已删除 r/${row.slug}`, 'success');
    },
    onError: () => snackbar.enqueue('删除失败，请稍后再试', 'error'),
  });

  const onCopy = useCallback(
    (row: BeLink) => {
      void copyText(`https://bcn.example/${row.slug}`).then((ok) => {
        snackbar.enqueue(ok ? `已复制 r/${row.slug} 的短链地址` : '剪贴板不可用，请手动复制', ok ? 'success' : 'error');
      });
    },
    [snackbar],
  );

  const onToggle = useCallback(
    (row: BeLink) => {
      pauseMutation.mutate(
        { id: row.id, paused: !row.paused },
        { onSuccess: () => snackbar.enqueue(row.paused ? `已启用 r/${row.slug}` : `已停用 r/${row.slug}`, 'success') },
      );
    },
    [pauseMutation, snackbar],
  );

  const onRemove = useCallback((row: BeLink) => deleteMutation.mutate(row), [deleteMutation]);
  const onExpand = useCallback(
    (id: number | null) => dispatch({ type: 'expand', id }),
    [],
  );

  return (
    <Paper className="fd-relief" sx={{ p: 2 }} data-section="links">
      <div className="fd-toolbar">
        <TextField
          size="small"
          label="搜索"
          placeholder="搜索短链码或目标地址…"
          value={view.q}
          onChange={(e) => dispatch({ type: 'q', q: e.target.value })}
          inputProps={{ 'data-fd': 'search' }}
          sx={{ minWidth: 240 }}
        />
        <ButtonGroup size="small" aria-label="状态筛选">
          {FILTERS.map(([key, label]) => (
            <Button
              key={key}
              variant={view.filter === key ? 'contained' : 'outlined'}
              data-filter={key}
              data-on={view.filter === key ? '1' : '0'}
              onClick={() => dispatch({ type: 'filter', filter: key })}
            >
              {label}
            </Button>
          ))}
        </ButtonGroup>
        <ButtonGroup size="small" aria-label="排序">
          {SORTS.map(([key, label]) => (
            <Button
              key={key}
              variant={view.sort === key ? 'contained' : 'outlined'}
              data-sort={key}
              data-on={view.sort === key ? '1' : '0'}
              onClick={() => dispatch({ type: 'sort', sort: key })}
            >
              {label}
            </Button>
          ))}
        </ButtonGroup>
        <span className="fd-toolbar-note" data-fd="toolbar-note">
          {visible.length} 条 · 合计 {fmtInt(shownClicks)} 次点击{stale ? ' · 正在过滤…' : ''}
        </span>
      </div>

      <TableContainer sx={{ mt: 1.5 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell component="th" scope="col">短链</TableCell>
              <TableCell component="th" scope="col">目标地址</TableCell>
              <TableCell component="th" scope="col">创建者</TableCell>
              <TableCell component="th" scope="col" align="right">点击</TableCell>
              <TableCell component="th" scope="col">最近访问</TableCell>
              <TableCell component="th" scope="col">状态</TableCell>
              <TableCell component="th" scope="col">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.length > 0 ? (
              visible.map((row) => (
                <LinkRow
                  key={row.id}
                  row={row}
                  ownerCount={counts.get(row.owner) ?? 0}
                  expanded={view.expandedId === row.id}
                  busy={pauseMutation.isPending || deleteMutation.isPending}
                  onExpand={onExpand}
                  onCopy={onCopy}
                  onToggle={onToggle}
                  onRemove={onRemove}
                />
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="fd-empty">
                  没有匹配「{deferredQ}」的短链
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <p className="fd-foot" data-fd="rows-total">服务端共 {rows.length} 条，当前视图 {visible.length} 条</p>
    </Paper>
  );
};

export default LinksSection;
