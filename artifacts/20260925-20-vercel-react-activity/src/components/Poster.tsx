import { useState } from 'react';
import type { PosterParams } from '../lib/poster';
import { track } from '../lib/track';

interface Shown {
  svg: string;
  headline: string;
}

export default function Poster() {
  const [holder, setHolder] = useState('');
  const [shown, setShown] = useState<Shown | null>(null);
  const [busy, setBusy] = useState(false);

  /* bundle-preload：悬停/聚焦即将点击的按钮时提前拉海报模块，点击即出图 */
  function preload() {
    if (shown === null && !busy) void import('../lib/poster');
  }

  async function make(tier: string, qty: number) {
    setBusy(true);
    track('poster_open', { tier, qty });
    const mod = await import('../lib/poster'); // bundle-conditional：模块激活时才加载
    const params: PosterParams = { tier, holder: holder.trim(), qty };
    setShown(mod.buildPoster(params));
    setBusy(false);
  }

  return (
    <section className="section poster" id="poster" data-testid="poster-section">
      <div className="sec-head">
        <h2>纪念票根 · 生成你的海报</h2>
        <p className="sec-note">仅在点击时才下载生成器（约一个模块的大小），首屏不背它</p>
      </div>
      <label className="field holder-field">
        <span>持票人</span>
        <input value={holder} data-field="holder" maxLength={20} placeholder="打在海报上的名字" onChange={(e) => setHolder(e.target.value)} />
      </label>
      <div className="poster-btns">
        <button type="button" className="btn primary" data-testid="poster-make" onMouseEnter={preload} onFocus={preload} onClick={() => void make('三日全通', 2)}>
          {busy ? '生成中…' : '生成海报（三日全通 ×2）'}
        </button>
      </div>
      {shown !== null ? (
        <div className="poster-stage" data-testid="poster-stage">
          <div
            className="poster-art"
            data-testid="poster-art"
            /* 构建器内已对全部插值做 XML 转义（含用户输入的持票人），这里才允许注入 SVG 标记 */
            dangerouslySetInnerHTML={{ __html: shown.svg }}
          />
          <p className="poster-cap">{shown.headline}</p>
        </div>
      ) : (
        <p className="poster-empty" data-testid="poster-empty">
          {busy ? '生成器下载中…' : '还没有生成海报'}
        </p>
      )}
    </section>
  );
}
