import { useEffect, useState } from 'react';
import type { Boot } from '../lib/api';
import { useResource } from '../lib/hooks';
import { EVENT } from '../lib/content';

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

export function formatLeft(ms: number): { d: string; h: string; m: string; s: string; past: boolean } {
  const past = ms <= 0;
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    d: String(Math.floor(total / 86400)),
    h: pad(Math.floor((total % 86400) / 3600)),
    m: pad(Math.floor((total % 3600) / 60)),
    s: pad(total % 60),
    past,
  };
}

export function HeroSkeleton() {
  return (
    <section className="hero" data-testid="hero-skeleton" aria-busy="true">
      <p className="hero-kicker">{EVENT.city} · 10.16 - 10.18 · 三日五舞台</p>
      <h1 className="hero-title">
        把整个秋天
        <br />
        调成同一种音量
      </h1>
      <div className="sk-rows">
        <i className="sk-row" />
        <i className="sk-row" />
      </div>
    </section>
  );
}

export default function Hero({ boot }: { boot: Boot }) {
  const summary = useResource(boot.summary);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const left = formatLeft(EVENT.startsAt - now);
  const pct = Math.round((summary.signedCount / summary.capacity) * 1000) / 10;
  const soldOut = summary.ticketsLeft === 0;

  return (
    <section className="hero" id="top">
      <p className="hero-kicker">{EVENT.city} · 10.16 - 10.18 · 三日五舞台</p>
      <h1 className="hero-title">
        把整个秋天
        <br />
        调成同一种音量
      </h1>
      <p className="hero-sub">
        湘江中央的星屿，三天里只发生一件事：声音。12 组艺人、25 场演出、一条会发光的轮渡航线。
      </p>
      <div className="countdown" data-testid="countdown" aria-label="开幕倒计时">
        {left.past ? (
          <span className="cd-live">演出进行中</span>
        ) : (
          <>
            <span className="cd-cell">
              <b>{left.d}</b>天
            </span>
            <span className="cd-cell">
              <b>{left.h}</b>时
            </span>
            <span className="cd-cell">
              <b>{left.m}</b>分
            </span>
            <span className="cd-cell">
              <b>{left.s}</b>秒
            </span>
          </>
        )}
      </div>
      <div className="kpis" data-testid="kpis">
        <div className="kpi">
          <span className="kpi-label">已报名</span>
          <span className="kpi-value" data-signed="">
            {summary.signedCount.toLocaleString('zh-CN')}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">余票</span>
          <span className={'kpi-value' + (soldOut ? ' is-danger' : '')} data-remain="">
            {soldOut ? '售罄' : summary.ticketsLeft.toLocaleString('zh-CN')}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">合作品牌</span>
          <span className="kpi-value">{summary.brandPartners}</span>
        </div>
      </div>
      <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: pct + '%' }} />
        <span className="bar-note">已出 {pct}% · 票池 {summary.capacity.toLocaleString('zh-CN')} 张</span>
      </div>
      <div className="hero-cta">
        <a className="btn primary" href="#register">
          立即报名
        </a>
        <a className="btn ghost" href="#lineup">
          先看阵容
        </a>
      </div>
    </section>
  );
}
