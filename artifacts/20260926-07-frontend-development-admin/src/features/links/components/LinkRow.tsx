import React from 'react';
import { Button, ButtonGroup, TableCell, TableRow } from '@mui/material';
import { actLabel, useTwoStep } from '@/hooks/useTwoStep';
import { fmtDate, fmtInt } from '@/lib/format';
import type { BeLink } from '~types/index';

export interface LinkRowProps {
  row: BeLink;
  ownerCount: number;
  expanded: boolean;
  busy: boolean;
  onExpand: (id: number | null) => void;
  onCopy: (row: BeLink) => void;
  onToggle: (row: BeLink) => void;
  onRemove: (row: BeLink) => void;
}

const COLUMN_COUNT = 7;

/** Skill clause: "React.memo: Expensive components" — 60 rows re-render on every filter keystroke. */
const LinkRowImpl: React.FC<LinkRowProps> = ({ row, ownerCount, expanded, busy, onExpand, onCopy, onToggle, onRemove }) => {
  const [confirmClick, armed, cancel] = useTwoStep(() => onRemove(row));

  return (
    <>
      <TableRow
        data-slug={row.slug}
        data-pending={armed ? '1' : '0'}
        selected={expanded}
        hover
        onClick={() => onExpand(row.id)}
        sx={{ cursor: 'pointer' }}
      >
        <TableCell className="fd-slug">r/{row.slug}</TableCell>
        <TableCell>
          <div className="fd-truncate" title={row.target}>{row.target}</div>
        </TableCell>
        <TableCell>{row.owner}</TableCell>
        <TableCell align="right" className="fd-num">{fmtInt(row.clicks)}</TableCell>
        <TableCell>{fmtDate(row.lastClickAt)}</TableCell>
        <TableCell>
          <span className={row.paused ? 'fd-pill' : 'fd-pill fd-pill--on'} data-status={row.paused ? 'paused' : 'active'}>
            {row.paused ? '已停用' : '活跃'}
          </span>
        </TableCell>
        <TableCell>
          <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 6 }}>
            <ButtonGroup size="small">
              <Button onClick={() => onCopy(row)}>复制</Button>
              <Button disabled={busy} onClick={() => onToggle(row)}>
                {row.paused ? '启用' : '停用'}
              </Button>
              <Button color={armed ? 'error' : 'inherit'} onClick={confirmClick}>
                {actLabel(armed, '删除')}
              </Button>
            </ButtonGroup>
            {armed ? <Button size="small" onClick={cancel}>取消</Button> : null}
          </div>
        </TableCell>
      </TableRow>
      {expanded ? (
        <TableRow className="fd-detail-row" sx={{ display: 'block', padding: 0 }}>
          <TableCell colSpan={COLUMN_COUNT} sx={{ p: 0, border: 0 }}>
            <dl className="fd-detail-grid fd-detail">
              <div><dt>创建时间</dt><dd>{fmtDate(row.createdAt)}</dd></div>
              <div><dt>同创建者短链数</dt><dd>{ownerCount} 条（{row.owner}）</dd></div>
              <div><dt>完整地址</dt><dd className="fd-slug">{row.target}</dd></div>
              <div><dt>备注</dt><dd>{row.note !== '' ? row.note : '无'}</dd></div>
            </dl>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
};

export const LinkRow = React.memo(LinkRowImpl);

export default LinkRow;
