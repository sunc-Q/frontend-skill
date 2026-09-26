import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { countRender } from '@/lib/counter';
import { TAG_LABEL, corpus, formatDate, intfmt, relativeDay } from '@/lib/facts';
import { usePostQuery } from '../hooks/usePostQuery';
import { usePrefs } from '../hooks/usePrefs';
import { highlight, parseBody, prevNext } from '../helpers/listModel';
import type { PostRow } from '../types';

/**
 * Detail page. It reads the same persisted prefs as the list (star state carries over), and it
 * is the only consumer of `postsApi.getPost`, so the request-count assertions can attribute a
 * fetch to this route alone.
 */
export function PostPage({ slug = '' }: { slug?: string }): ReactElement {
  countRender('page');
  const post = usePostQuery(slug);
  const { starred, toggleStar } = usePrefs();
  const [progress, setProgress] = useState(0);
  const barRef = useRef<HTMLDivElement | null>(null);

  const blocks = useMemo(() => parseBody(post.body), [post.body]);
  const rows = useMemo<PostRow[]>(() => corpus.posts.map((p) => ({
    slug: p.slug,
    title: p.title,
    day: p.day,
    tag: p.tag,
    views: p.views,
    minutes: p.readingMinutes,
    comments: p.comments,
  })), []);
  const neighbours = useMemo(() => prevNext(slug, rows), [slug, rows]);

  /**
   * Skill clause "memory leak prevention (cleanup in useEffect)" — the listener is removed in
   * the same effect that added it, and it is passive because it only reads scroll position.
   */
  useEffect(() => {
    const onScroll = (): void => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? Math.min(1, Math.max(0, doc.scrollTop / max)) : 1;
      setProgress(ratio);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const bar = barRef.current;
    if (bar !== null) bar.style.width = `${(progress * 100).toFixed(1)}%`;
  }, [progress]);

  const star = useCallback((): void => toggleStar(slug), [toggleStar, slug]);

  return (
    <>
      <article className="post" data-testid="post">
        <div className="bar" ref={barRef} data-testid="progress" data-progress={progress.toFixed(3)} aria-hidden="true" />
        <p className="meta">
          <a href="#/" data-testid="back">← 返回列表</a> · {TAG_LABEL[post.tag]} · {formatDate(post.day)}（
          {relativeDay(post.day)}）· {intfmt(post.views)} 次阅读 · {post.minutes} 分钟 · {post.comments} 条讨论
          {post.series === null ? '' : ` · 系列：${post.series}`}
        </p>
        <h1 data-testid="post-title">{post.title}</h1>
        <p className="summary" data-testid="post-summary">{post.summary}</p>
        <div className="toolbar">
          <button type="button" className="btn ghost" data-testid="post-star" aria-pressed={starred.has(slug)} onClick={star}>
            {starred.has(slug) ? '★ 已收藏' : '☆ 收藏'}
          </button>
          <span className="count" data-testid="block-count">{blocks.length} 个段落块 / {post.sections.length} 节</span>
        </div>

        <div className="cols">
          <div className="prose" data-testid="prose">
            {blocks.map((b, i) => {
              if (b.kind === 'h2') return <h2 key={i} id={`sec-${i}`}>{b.text}</h2>;
              if (b.kind === 'h3') return <h3 key={i}>{b.text}</h3>;
              if (b.kind === 'quote') return <blockquote key={i}>{b.text}</blockquote>;
              if (b.kind === 'code') {
                return (
                  <pre key={i} data-testid="code" lang={b.lang}>
                    <code>
                      {highlight(b.text).map((line, li) => (
                        <span key={li}>
                          {line.map((tok, ti) => (
                            <span key={ti} className={`tok-${tok.c}`}>{tok.t}</span>
                          ))}
                          {'\n'}
                        </span>
                      ))}
                    </code>
                  </pre>
                );
              }
              return <p key={i}>{b.text}</p>;
            })}
          </div>

          <aside className="side" aria-label="本篇导航">
            <section className="panel">
              <h2>目录</h2>
              <ol className="toc" data-testid="toc">
                {post.sections.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </section>
            <section className="panel">
              <h2>相关阅读</h2>
              <div className="toolbar">
                {post.related.length === 0 ? (
                  <p className="state" data-testid="related-empty">这篇暂时没有同类记录。</p>
                ) : (
                  post.related.map((r) => (
                    <a key={r.slug} className="chip" href={`#/post/${r.slug}`} data-testid="related">
                      {r.title} · {intfmt(r.views)}
                    </a>
                  ))
                )}
              </div>
            </section>
          </aside>
        </div>

        <nav className="prevnext" aria-label="上下篇">
          {neighbours.prev === null ? null : (
            <a className="btn ghost" href={`#/post/${neighbours.prev.slug}`} data-testid="prev">
              ← 较早：{neighbours.prev.title}
            </a>
          )}
          {neighbours.next === null ? null : (
            <a className="btn ghost" href={`#/post/${neighbours.next.slug}`} data-testid="next">
              较新：{neighbours.next.title} →
            </a>
          )}
        </nav>
      </article>
    </>
  );
}

export default PostPage;
