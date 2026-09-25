import React from 'react';
import { Button, ButtonGroup, TableCell, TableRow } from '@mui/material';
import { fullKey, maskKey } from '../helpers/mask';
import { actLabel, useTwoStep } from '@/hooks/useTwoStep';
import { fmtDate } from '@/lib/format';
import type { ApiKey } from '~types/index';

export interface KeyRowProps {
  k: ApiKey;
  revealed: boolean;
  onReveal: (id: number) => void;
  onCopy: (k: ApiKey) => void;
  onRevoke: (k: ApiKey) => void;
}

const KeyRowImpl: React.FC<KeyRowProps> = ({ k, revealed, onReveal, onCopy, onRevoke }) => {
  const [confirmClick, armed, cancel] = useTwoStep(() => onRevoke(k));
  return (
    <TableRow data-keyid={k.id} data-pending={armed ? '1' : '0'}>
      <TableCell>{k.label}</TableCell>
      <TableCell className="fd-slug" data-revealed={revealed ? '1' : '0'}>{revealed ? fullKey(k) : maskKey(k)}</TableCell>
      <TableCell>
        <span className="fd-scopes" style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          {k.scopes.map((s) => <span key={s} className="fd-scope">{s}</span>)}
        </span>
      </TableCell>
      <TableCell>{fmtDate(k.lastUsedAt)}</TableCell>
      <TableCell>{fmtDate(k.createdAt)}</TableCell>
      <TableCell>
        <div style={{ display: 'flex', gap: 6 }}>
          <ButtonGroup size="small">
            <Button onClick={() => onReveal(k.id)}>{revealed ? '隐藏' : '显示'}</Button>
            <Button onClick={() => onCopy(k)}>复制</Button>
            <Button color={armed ? 'error' : 'inherit'} onClick={confirmClick}>{actLabel(armed, '吊销')}</Button>
          </ButtonGroup>
          {armed ? <Button size="small" onClick={cancel}>取消</Button> : null}
        </div>
      </TableCell>
    </TableRow>
  );
};

export const KeyRow = React.memo(KeyRowImpl);

export default KeyRow;
