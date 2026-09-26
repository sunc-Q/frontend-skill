import { useCallback, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { arm } from '@/lib/ablation';

export interface VirtualListProps<R> {
  rows: R[];
  rowHeight: number;
  /** rendered by the caller so the same row markup serves both arms */
  renderRow: (row: R, index: number) => ReactNode;
  testid?: string;
  overscan?: number;
}

/**
 * Skill clause: "virtual scrolling for lists" / "render only visible items".
 * The `novirtual` ablation arm returns the same list with every row in the DOM, which is what
 * makes the clause's price measurable (group N counts DOM rows and filter/scroll cost).
 */
export function VirtualList<R>({ rows, rowHeight, renderRow, testid = 'vport', overscan = 4 }: VirtualListProps<R>): ReactElement {
  const [top, setTop] = useState(0);
  const [viewport, setViewport] = useState(420);
  const nodeRef = useRef<HTMLElement | null>(null);

  const onScroll = useCallback((): void => {
    const node = nodeRef.current;
    if (node === null) return;
    setTop(node.scrollTop);
    setViewport(node.clientHeight);
  }, []);

  const { first, last } = useMemo(() => {
    const start = Math.max(0, Math.floor(top / rowHeight) - overscan);
    const end = Math.min(rows.length, Math.ceil((top + viewport) / rowHeight) + overscan);
    return { first: start, last: end };
  }, [top, viewport, rowHeight, rows.length, overscan]);

  const total = rows.length * rowHeight;

  if (!arm.virtual) {
    return (
      <div
        className="vport"
        data-testid={testid}
        data-virtual="off"
        data-total={total}
        ref={(node) => {
          nodeRef.current = node;
        }}
        onScroll={onScroll}
        tabIndex={0}
        role="list"
      >
        <div className="vinner" style={{ height: total }}>
          {rows.map((r, i) => (
            <div key={i} className="vrow" style={{ position: 'absolute', top: i * rowHeight, height: rowHeight, left: 0, right: 0 }}>
              {renderRow(r, i)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const slice = rows.slice(first, last);
  return (
    <div
      className="vport"
      data-testid={testid}
      data-virtual="on"
      data-total={total}
      data-window={`${first}:${last}`}
      ref={(node) => {
        nodeRef.current = node;
      }}
      onScroll={onScroll}
      tabIndex={0}
      role="list"
    >
      <div className="vinner" style={{ height: total }}>
        {slice.map((r, i) => (
          <div key={first + i} className="vrow" style={{ position: 'absolute', top: (first + i) * rowHeight, height: rowHeight, left: 0, right: 0 }}>
            {renderRow(r, first + i)}
          </div>
        ))}
      </div>
    </div>
  );
}

export default VirtualList;
