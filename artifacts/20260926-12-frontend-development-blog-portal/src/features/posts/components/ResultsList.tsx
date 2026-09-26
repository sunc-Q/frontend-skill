import { type ReactElement } from 'react';
import { VirtualList } from '~components/VirtualList/VirtualList';
import { countRender } from '@/lib/counter';
import { PostRow } from './PostRow';
import type { ViewModel } from '../helpers/listModel';

export interface ResultsListProps {
  views: ViewModel[];
  starred: Set<string>;
  hotMark: string;
  rowHeight: number;
  total: number;
  query: string;
  onStar: (slug: string) => void;
}

/**
 * Split out of the page so the render counters can separate "the shell re-rendered" from
 * "the rows re-rendered": this component is deliberately NOT memoised, so it does run on every
 * keystroke, and group N reads whether the memoised rows below it survive that.
 */
export function ResultsList({ views, starred, hotMark, rowHeight, total, query, onStar }: ResultsListProps): ReactElement {
  countRender('list');
  if (views.length === 0) {
    return (
      <p className="empty" data-testid="empty" role="status">
        没有匹配「{query}」的文章 · 共 {total} 篇可选。换个说法，或者点掉标签筛选。
      </p>
    );
  }
  return (
    <>
      <div className="list-head" aria-hidden="true">
        <span>序</span>
        <span>标题</span>
        <span>标签</span>
        <span>发布 / 阅读</span>
        <span>分钟</span>
        <span>收藏</span>
      </div>
      <VirtualList
        rows={views}
        rowHeight={rowHeight}
        testid="rows"
        renderRow={(v) => (
          <PostRow view={v} starred={starred.has(v.key)} hotMark={hotMark} onStar={onStar} />
        )}
      />
    </>
  );
}

export default ResultsList;
