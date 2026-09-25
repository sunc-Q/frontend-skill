import { Suspense, memo, useState } from 'react';
import type { Notice, Session, Stage } from '../lib/types';
import type { Boot } from '../lib/api';
import { getTransport, loadResource, type Resource } from '../lib/api';
import { useResource } from '../lib/hooks';
import { EVENT } from '../lib/content';

export function ScheduleSkeleton() {
  return (
    <section className="section schedule" data-testid="schedule-skeleton">
      <h2>三日日程</h2>
      <div className="sk-rows">
        {Array.from({ length: 5 }, (_, i) => (
          <i className="sk-row" key={i} aria-hidden="true" />
        ))}
      </div>
    </section>
  );
}

const STAGE_LABEL: Record<Stage, string> = { main: '主舞台 · 星环', isle: '屿环舞台', lounge: '江雾厅' };

const DAY_TABS: { key: 'fri' | 'sat' | 'sun' | 'notices'; label: string }[] = [
  { key: 'fri', label: EVENT.days[0].label },
  { key: 'sat', label: EVENT.days[1].label },
  { key: 'sun', label: EVENT.days[2].label },
  { key: 'notices', label: '交通与须知' },
];

/* 一轮循环同时完成筛选与按舞台分组（js-combine-iterations） */
function byStage(rows: Session[]): Map<Stage, Session[]> {
  const map = new Map<Stage, Session[]>();
  for (const r of rows) {
    const bucket = map.get(r.stage);
    if (bucket === undefined) map.set(r.stage, [r]);
    else bucket.push(r);
  }
  return map;
}

const Row = memo(function Row({ s }: { s: Session }) {
  return (
    <li className="slot" data-slot={s.id}>
      <time className="slot-time">
        {s.start}–{s.end}
      </time>
      <div className="slot-body">
        <b className="slot-title">{s.title}</b>
        <span className="slot-artist">{s.artist}</span>
      </div>
      <em className="slot-tag">{s.tag}</em>
    </li>
  );
});

function DayPane({ day, sessions }: { day: 'fri' | 'sat' | 'sun'; sessions: Session[] }) {
  const rows: Session[] = [];
  for (const x of sessions) if (x.day === day) rows.push(x);
  const grouped = byStage(rows);
  return (
    <div className="day-pane" data-testid={'day-' + day}>
      {(['main', 'isle', 'lounge'] as Stage[]).map((stage) => {
        const list = grouped.get(stage);
        return list === undefined || list.length === 0 ? null : (
          <div className="stage-block" key={stage}>
            <h4 className="stage-name">{STAGE_LABEL[stage]}</h4>
            <ul className="slots">
              {list.map((s) => (
                <Row key={s.id} s={s} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function NoticesPane({ res }: { res: Resource<Notice[]> }) {
  const notices = useResource(res);
  return (
    <div className="day-pane notices" data-testid="notices-pane">
      {notices.map((n) => (
        <div className="notice" key={n.id} data-notice={n.kind}>
          <h4>{n.title}</h4>
          <p>{n.body}</p>
        </div>
      ))}
    </div>
  );
}

export default function Schedule({ boot }: { boot: Boot }) {
  const schedule = useResource(boot.schedule);
  const [tab, setTab] = useState<'fri' | 'sat' | 'sun' | 'notices'>('fri');

  /* async-defer-await：「交通与须知」在首屏路径上用不到，
     所以连请求都不发——点开的那一刻才发起（不 await、先给 Suspense 挂 loading）。 */
  function openTab(next: 'fri' | 'sat' | 'sun' | 'notices') {
    if (next === 'notices') {
      loadResource('notices', () => getTransport().get<Notice[]>('/api/notices'));
    }
    setTab(next);
  }

  return (
    <section className="section schedule" id="schedule" data-testid="schedule">
      <div className="sec-head">
        <h2>三日日程 · 五个舞台</h2>
        <p className="sec-note">轮渡末班 23:30，请为返航留出 40 分钟</p>
      </div>
      <div className="tabs" role="tablist" aria-label="日期选择">
        {DAY_TABS.map((d) => (
          <button
            key={d.key}
            type="button"
            role="tab"
            aria-selected={tab === d.key}
            className={'tab' + (tab === d.key ? ' active' : '')}
            data-tab={d.key}
            onClick={() => openTab(d.key)}
          >
            {d.label}
          </button>
        ))}
      </div>
      {tab === 'notices' ? (
        <Suspense fallback={<p className="notices-loading" data-testid="notices-loading">正在拉取交通与须知…</p>}>
          <NoticesPane res={loadResource('notices', () => getTransport().get<Notice[]>('/api/notices'))} />
        </Suspense>
      ) : (
        <DayPane day={tab} sessions={schedule.sessions} />
      )}
    </section>
  );
}
