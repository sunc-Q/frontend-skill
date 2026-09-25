import { memo, useState, useTransition } from 'react';
import type { Artist } from '../lib/types';
import type { Boot } from '../lib/api';
import { getTransport, isApiError } from '../lib/api';
import { useResource } from '../lib/hooks';
import { readPrefs, writePrefs } from '../lib/storage';

export function LineupSkeleton() {
  return (
    <section className="section lineup" data-testid="lineup-skeleton">
      <h2>演出阵容</h2>
      <div className="artist-grid">
        {Array.from({ length: 8 }, (_, i) => (
          <div className="artist sk" key={i} aria-hidden="true">
            <i className="sk-face" />
            <i className="sk-line" />
            <i className="sk-line short" />
          </div>
        ))}
      </div>
    </section>
  );
}

interface CardProps {
  artist: Artist;
  voted: boolean;
  onVote: (id: string) => void;
}

/* 卡片 memo：一次投票只让被点的卡与相邻名次卡重渲染，而不是 12 张（rerender-memo） */
const ArtistCard = memo(function ArtistCard({ artist, voted, onVote }: CardProps) {
  const share = Math.min(100, Math.round((artist.votes / 3200) * 100));
  return (
    <article className="artist" data-artist={artist.id}>
      <div className="face" aria-hidden="true">
        <span className="initial">{artist.name.slice(0, 1)}</span>
        {artist.headliner ? <em className="tag head">头牌</em> : null}
      </div>
      <h3 className="a-name">{artist.name}</h3>
      <p className="a-en">
        {artist.enName} · {artist.city} · {artist.genre}
      </p>
      <div className="vote-row">
        <span className="votes" data-votes={artist.votes}>
          {artist.votes.toLocaleString('zh-CN')}
        </span>
        <i className="vote-bar-track" aria-hidden="true">
          <i className="vote-bar" style={{ width: share + '%' }} />
        </i>
        <button type="button" className="vote-btn" data-vote={artist.id} disabled={voted} onClick={() => onVote(artist.id)}>
          {voted ? '已投票' : '投 TA'}
        </button>
      </div>
    </article>
  );
});

type SortMode = 'votes' | 'billing';

export default function Lineup({ boot }: { boot: Boot }) {
  const artists = useResource(boot.lineup);
  const [mode, setMode] = useState<SortMode>('votes');
  const [status, setStatus] = useState('');
  const [isPending, startSort] = useTransition();

  const voted = new Set(readPrefs().voted); // Set 做 O(1) 判断（js-set-map-lookups）

  /* 派生排序在渲染期完成，不经 effect（rerender-derived-state-no-effect）；
     排序只是视觉重排，属于非紧急更新 → startTransition（rerender-transitions） */
  const sorted = mode === 'votes' ? [...artists].sort((x, y) => y.votes - x.votes) : [...artists];
  const orderIds = sorted.map((a) => a.id).join('>');

  function vote(id: string) {
    if (voted.has(id)) return;
    const before = readPrefs().voted;
    writePrefs({ voted: [...before, id] });
    setStatus('');
    // 乐观补丁：UI 立即 +1；服务端确认后 settle 覆盖，失败回滚
    boot.lineup.patch((prev) => prev.map((a) => (a.id === id ? { ...a, votes: a.votes + 1 } : a)));
    getTransport()
      .post<{ votes: number }>('/api/vote', { artistId: id })
      .then((ok) => {
        // 用 patch 而非 settle：以最新客户端视图为基底，只覆盖这一档的票数
        boot.lineup.patch((prev) => prev.map((a) => (a.id === id ? { ...a, votes: ok.votes } : a)));
      })
      .catch((e: unknown) => {
        boot.lineup.patch((prev) => prev.map((a) => (a.id === id ? { ...a, votes: Math.max(0, a.votes - 1) } : a)));
        writePrefs({ voted: before });
        setStatus(isApiError(e) ? e.message : '投票失败，请稍后再试');
      });
  }

  return (
    <section className="section lineup" id="lineup" data-testid="lineup" data-order={orderIds} data-pending={isPending ? '1' : '0'}>
      <div className="sec-head">
        <h2>演出阵容 · 人气打榜</h2>
        <div className="sorts" role="group" aria-label="排序方式">
          <button type="button" className={'sort' + (mode === 'votes' ? ' active' : '')} data-sort="votes" onClick={() => startSort(() => setMode('votes'))}>
            人气序
          </button>
          <button type="button" className={'sort' + (mode === 'billing' ? ' active' : '')} data-sort="billing" onClick={() => startSort(() => setMode('billing'))}>
            官宣序
          </button>
        </div>
      </div>
      <div className="artist-grid">
        {sorted.map((a) => (
          <ArtistCard key={a.id} artist={a} voted={voted.has(a.id)} onVote={vote} />
        ))}
      </div>
      <p className={'lineup-status' + (status === '' ? ' visually-hidden' : '')} aria-live="polite" data-testid="lineup-status">
        {status}
      </p>
    </section>
  );
}
