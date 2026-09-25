import { useMemo, useState } from 'react';
import type { VoiceTag } from '../lib/content';
import { VOICES, VOICE_TAGS } from '../lib/content';
import { cn } from '../components/ui';

const ALL: VoiceTag | 'all' = 'all';
const TAGS: Array<VoiceTag | 'all'> = [ALL, ...VOICE_TAGS];

export function Voices() {
  const [tag, setTag] = useState<VoiceTag | 'all'>(ALL);

  /* rerender-derived-state-no-effect: 列表直接由 tag 派生，
     不写「useEffect 里 setList(filtered)」这种二次渲染 */
  const list = useMemo(() => (tag === ALL ? VOICES : VOICES.filter((v) => v.tag === tag)), [tag]);

  return (
    <section id="voices" className="section">
      <div className="sec-head">
        <h2 className="section-title">谁在用它整理</h2>
        <div className="chips" data-voice-tags>
          {TAGS.map((t) => (
            <button
              type="button"
              key={t}
              className={cn('chip', tag === t && 'chip--on')}
              data-voice-tag={t}
              onClick={() => setTag(t)}
            >
              {t === ALL ? '全部' : t}
            </button>
          ))}
        </div>
      </div>

      <div className="voices">
        {/* 动态列表里不挂 data-reveal：reveal observer 只在挂载时收集一次目标 */}
        {list.length > 0
          ? list.map((v) => (
              <figure className="voice" key={v.id} data-voice={v.id}>
                <blockquote>{v.quote}</blockquote>
                <figcaption>
                  <span className="voice-avatar" data-avatar={v.id}>
                    {v.name.slice(0, 1)}
                  </span>
                  <span className="voice-meta">
                    <span className="voice-name">{v.name}</span>
                    <span className="voice-role">{v.role}</span>
                  </span>
                  <span className="voice-photos">{v.photos}</span>
                </figcaption>
              </figure>
            ))
          : <p className="empty">这一类暂时没有可展示的使用者。</p>}
      </div>
    </section>
  );
}
