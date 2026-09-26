import { memo, type MouseEvent, type ReactElement } from 'react';
import { arm } from '@/lib/ablation';
import { countRender } from '@/lib/counter';
import type { ViewModel } from '../helpers/listModel';

export interface PostRowProps {
  view: ViewModel;
  starred: boolean;
  hotMark: string;
  onStar: (slug: string) => void;
}

/**
 * Skill clause "React.memo: Expensive components". In the conformant arm the row is memoised and
 * every prop is referentially stable, so a keystroke re-renders the shell but not the ~14 rows on
 * screen; the `nomemo` arm drops the wrapper and re-renders all of them. Group N counts both.
 */
function PostRowImpl({ view, starred, hotMark, onStar }: PostRowProps): ReactElement {
  countRender('row');
  const slug = view.key;
  const toggle = (e: MouseEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    onStar(slug);
  };
  return (
    <article className="row" data-testid="row" data-hot={String(view.hot)} data-hotmark={hotMark} aria-label={view.title}>
      <span className="num">{view.num}</span>
      <span className="titles">
        <a className="t" href={view.href}>
          {view.title}
        </a>
        <span className="s" data-testid="row-sub">{view.sub}</span>
      </span>
      <span className="tag">{view.tagLabel}</span>
      <span className="when">
        {view.when} / {view.views}
      </span>
      <span className="mins">{view.minutes}′</span>
      <button type="button" className="star" aria-pressed={starred} aria-label={`收藏 ${view.title}`} onClick={toggle}>
        {starred ? '★' : '☆'}
      </button>
    </article>
  );
}

const Memoised = memo(PostRowImpl);

export const PostRow = arm.memo ? Memoised : PostRowImpl;
export default PostRow;
