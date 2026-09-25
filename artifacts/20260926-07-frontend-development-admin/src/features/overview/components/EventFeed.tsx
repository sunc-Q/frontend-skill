import React from 'react';
import { Paper, Typography } from '@mui/material';
import { fmtDate } from '@/lib/format';
import type { ActivityEvent } from '~types/index';

const EVENT_LABEL: Record<ActivityEvent['kind'], string> = {
  deploy: '部署',
  alert: '告警',
  user: '成员',
  system: '系统',
};

export interface EventFeedProps {
  events: ActivityEvent[];
}

export const EventFeed: React.FC<EventFeedProps> = ({ events }) => (
  <Paper className="fd-relief" sx={{ p: 2, display: 'grid', gap: 1 }} data-panel="events">
    <div className="fd-panel-head">
      <Typography variant="subtitle2" component="h2">最近事件</Typography>
      <Typography variant="caption" component="span">自动刷新已暂停</Typography>
    </div>
    <ul className="fd-events" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
      {events.map((e) => (
        <li key={e.id} data-event-kind={e.kind} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <span className="fd-event-kind">{EVENT_LABEL[e.kind]}</span>
          <span className="fd-event-text">{e.text}</span>
          <time className="fd-event-time fd-num" style={{ marginLeft: 'auto' }}>{fmtDate(e.at)}</time>
        </li>
      ))}
    </ul>
  </Paper>
);

export default EventFeed;
