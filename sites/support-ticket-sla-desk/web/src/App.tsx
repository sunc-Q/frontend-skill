import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import {
  bd,
  clampPct,
  fieldClock,
  fieldDateTime,
  kindLabel,
  remainText,
  num,
  pct,
  rowTone,
  TONE_TEXT,
  type Tone,
} from './format';
import { initialTheme, persistTheme, Swatch, themeCss, THEMES } from './themes';
import { useAction, useAsync, type Action } from './useAsync';
import type { Agent, Customer, ListParams, Meta, TicketRow } from './types';

const TOKEN_KEY = 'sla-desk-admin-token';
const DEFAULT_PAGE_SIZE = 12;

const EMPTY_FORM = {
  title: '',
  description: '',
  customer: '',
  severity: 'S2',
  category: '',
  channel: '',
  agent: '',
};

export function App(): React.JSX.Element {
  const [theme, setTheme] = useState<string>(() => initialTheme());
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    persistTheme(theme);
  }, [theme]);

  const [token, setToken] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try {
      return window.localStorage.getItem(TOKEN_KEY) ?? '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* 隐私模式下忽略 */
    }
  }, [token]);

  const health = useAsync(() => api.health(), []);
  const meta = useAsync(() => api.meta(), []);
  const stats = useAsync(() => api.stats(), []);
  const dicts = useAsync(() => api.customers(), []);
  const agents = useAsync(() => api.agents(), []);
  const policies = useAsync(() => api.policies(), []);

  const [only, setOnly] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sort, setSort] = useState('due');
  const [dir, setDir] = useState('asc');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [tier, setTier] = useState('');
  const [team, setTeam] = useState('');

  const params: ListParams = {
    page,
    page_size: pageSize,
    sort,
    dir,
    only,
    status,
    severity,
    tier,
    team,
    q: search,
  };
  const list = useAsync(
    () => api.tickets(params),
    [page, pageSize, sort, dir, only, status, severity, tier, team, search],
  );

  const [selected, setSelected] = useState('');
  const rows = list.data?.items ?? [];
  useEffect(() => {
    if (rows.length === 0) return;
    if (!rows.some((r) => r.code === selected)) setSelected(rows[0]?.code ?? '');
  }, [rows, selected]);
  const detail = useAsync(
    () => (selected === '' ? Promise.resolve(null) : api.ticket(selected)),
    [selected, list.data?.served_at ?? ''],
  );

  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const audit = stats.data?.audit;
  const dropped = droppedFilters(params, list.data?.filter_echo ?? {});

  return (
    <div className="shell">
      <ThemeStyle theme={theme} />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Swatch />
          </span>
          <span className="brand-name">驻场 SLA 值班台</span>
          <span className="brand-sub">Field Support · Business-Minute Ledger</span>
        </div>

        <nav className="themes" aria-label="界面风格">
          <span className="field-label">风格</span>
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className="theme-btn"
              data-active={t.id === theme ? 'true' : 'false'}
              onClick={() => setTheme(t.id)}
              title={t.mood}
            >
              <span className="theme-icon" aria-hidden="true">
                <Swatch />
              </span>
              <span className="theme-text">{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="tokenbox">
          <label className="field-label" htmlFor="admin-token">
            管理令牌
          </label>
          <input
            id="admin-token"
            className="input"
            type="password"
            autoComplete="off"
            placeholder="ADMIN_TOKEN"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
      </header>

      <div className="statusline">
        {health.data === null ? (
          <span className="clock-item">正在连接后端…</span>
        ) : (
          <>
            <span className="clock-item">
              现场时间 <strong className="clock-value mono">{fieldDateTime(health.data.field_time)}</strong>
              <span className="clock-hint">（{health.data.today_field} · {health.data.day_reason}）</span>
            </span>
            <span className="clock-flag" data-on={health.data.now_in_session ? 'true' : 'false'}>
              {health.data.now_in_session ? '时钟走表中' : '休市中，时效停住'}
            </span>
            <span className="clock-item">
              下一窗口 <strong className="clock-value mono">{fieldClock(health.data.next_window_at)}</strong>
            </span>
            <span className="clock-item">
              工作窗口 <strong className="clock-value mono">{health.data.session_windows.join(' / ')}</strong>
              <span className="clock-hint">＝ {num(health.data.minutes_per_day)} 分钟/日</span>
            </span>
            <span className="clock-flag" data-on={health.data.admin_token_set ? 'true' : 'false'}>
              {health.data.admin_token_set ? '写接口已把守' : '服务端未设 ADMIN_TOKEN，写接口 503'}
            </span>
          </>
        )}
        {token === '' ? <span className="clock-flag" data-on="false">未填令牌，写操作会 401</span> : null}
      </div>

      <main className="layout">
        <div className="col-main">
          <section className="kpis" aria-label="实时指标">
            <Kpi label="在办工单" value={num(stats.data?.open ?? 0)} hint={`库内共 ${num(stats.data?.total ?? 0)} 张`} />
            <Kpi
              label="已超时"
              value={num(stats.data?.breached ?? 0)}
              hint={`另有 ${num(stats.data?.at_risk ?? 0)} 张 60 分钟内到期`}
              tone={(stats.data?.breached ?? 0) > 0 ? 'bad' : 'ok'}
            />
            <Kpi label="停表中" value={num(stats.data?.paused ?? 0)} hint="等客户/等厂商，时效不计" tone="warn" />
            <Kpi label="待首响" value={num(stats.data?.new_unassigned ?? 0)} hint="还没人接的单" />
            <Kpi label="解决达标率" value={pct(stats.data?.met_rate_pct ?? 0)} hint={`已解决 ${num(stats.data?.resolved_total ?? 0)} 张`} tone="ok" />
            <Kpi label="首响达标率" value={pct(stats.data?.response_met_pct ?? 0)} hint="按快照目标判定" tone="ok" />
            <Kpi
              label="平均解决时长"
              value={`${(stats.data?.avg_resolve_business_hours ?? 0).toFixed(1)} bd·h`}
              hint="只算工作分钟，剔除夜间与假日"
            />
            <Kpi
              label="今天新单 / 今天解决"
              value={`${num(stats.data?.created_today ?? 0)} / ${num(stats.data?.resolved_today ?? 0)}`}
              hint={`现场日期 ${stats.data?.today ?? '—'}`}
            />
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">时效队列</h2>
              <p className="panel-note">
                {list.data === null
                  ? '加载中…'
                  : `${num(total)} 张命中 · 第 ${list.data.page}/${pages} 页 · 服务端时间 ${fieldClock(list.data.now_field_time)}${list.data.now_in_session ? '（工作时段内）' : '（非工作时段，时效不推进）'}`}
              </p>
            </div>

            <div className="tabs" role="tablist" aria-label="页签">
              {(meta.data?.only ?? [{ value: '', label: '全部' }]).map((o) => (
                <button
                  key={o.value || 'all'}
                  type="button"
                  role="tab"
                  className="tab"
                  aria-selected={only === o.value ? 'true' : 'false'}
                  data-active={only === o.value ? 'true' : 'false'}
                  onClick={() => {
                    setOnly(o.value);
                    setPage(1);
                  }}
                >
                  {o.label}
                  <span className="tab-count mono">{tabCount(stats.data ?? undefined, o.value)}</span>
                </button>
              ))}
            </div>

            <form
              className="filters"
              onSubmit={(e) => {
                e.preventDefault();
                setPage(1);
                list.reload();
              }}
            >
              <Field label="关键词" htmlFor="f-q">
                <input
                  id="f-q"
                  className="input"
                  placeholder="工单号 / 标题 / 客户 / 工程师"
                  value={search}
                  maxLength={64}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </Field>
              <Field label="状态" htmlFor="f-status">
                <Select id="f-status" value={status} onChange={(v) => { setStatus(v); setPage(1); }}>
                  <option value="">全部</option>
                  {(meta.data?.statuses ?? []).map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="级别" htmlFor="f-sev">
                <Select id="f-sev" value={severity} onChange={(v) => { setSeverity(v); setPage(1); }}>
                  <option value="">全部</option>
                  {(meta.data?.severities ?? []).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="合同等级" htmlFor="f-tier">
                <Select id="f-tier" value={tier} onChange={(v) => { setTier(v); setPage(1); }}>
                  <option value="">全部</option>
                  {(meta.data?.tiers ?? []).map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="技能组" htmlFor="f-team">
                <input
                  id="f-team"
                  className="input"
                  placeholder="如 基础设施组"
                  value={team}
                  maxLength={24}
                  onChange={(e) => {
                    setTeam(e.target.value);
                    setPage(1);
                  }}
                />
              </Field>
              <Field label="排序" htmlFor="f-sort">
                <Select id="f-sort" value={sort} onChange={setSort}>
                  {(meta.data?.sorts ?? ['due']).map((s) => (
                    <option key={s} value={s}>
                      {sortLabel(s)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="方向" htmlFor="f-dir">
                <Select id="f-dir" value={dir} onChange={setDir}>
                  <option value="asc">升序</option>
                  <option value="desc">降序</option>
                </Select>
              </Field>
              <Field label="每页" htmlFor="f-size">
                <Select
                  id="f-size"
                  value={String(pageSize)}
                  onChange={(v) => {
                    setPageSize(Number(v));
                    setPage(1);
                  }}
                >
                  {[10, 12, 20, 50, 100].map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="field-actions">
                <button type="submit" className="btn">
                  刷新
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    setSearch('');
                    setStatus('');
                    setSeverity('');
                    setTier('');
                    setTeam('');
                    setOnly('');
                    setSort('due');
                    setDir('asc');
                    setPage(1);
                  }}
                >
                  清空筛选
                </button>
              </div>
            </form>

            {dropped.length > 0 ? (
              <p className="notice" role="status">
                这些筛选值不合法、已被服务端收敛：{dropped.join('、')}（服务端只接受字典内的值）
              </p>
            ) : null}
            {list.error !== null ? <ErrorBox message={list.error} onRetry={list.reload} /> : null}

            <div className="table-wrap">
              <table className="tickets">
                <thead>
                  <tr>
                    <th>工单号</th>
                    <th>标题</th>
                    <th>客户 / 合同</th>
                    <th>工程师</th>
                    <th>级别</th>
                    <th>状态</th>
                    <th className="th-clock">时效进度</th>
                    <th className="th-clock">剩余 / 超时</th>
                    <th className="th-clock">停表</th>
                    <th>账本</th>
                  </tr>
                </thead>
                <tbody>
                  {list.loading && rows.length === 0 ? (
                    <tr className="loading-row">
                      <td colSpan={10}>正在拉取队列…</td>
                    </tr>
                  ) : null}
                  {!list.loading && rows.length === 0 ? (
                    <tr className="empty-row">
                      <td colSpan={10}>没有命中任何工单，换个页签或清空筛选试试。</td>
                    </tr>
                  ) : null}
                  {rows.map((r) => (
                    <TicketTr key={r.code} row={r} selected={r.code === selected} onSelect={setSelected} />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pager">
              <span className="pager-info mono">
                {num(total)} 条 · 第 {page} / {pages} 页
              </span>
              <div className="pager-btns">
                <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  上一页
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={!list.data?.has_more || page >= pages}
                  onClick={() => setPage(page + 1)}
                >
                  下一页
                </button>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">时间账本 · {selected === '' ? '未选择' : selected}</h2>
              <p className="panel-note">页面显示的每一个分钟都来自后端重算，前端不参与判定</p>
            </div>
            {detail.error !== null ? <ErrorBox message={detail.error} onRetry={detail.reload} /> : null}
            {detail.data === null ? (
              <p className="empty">点左侧任意一行工单，这里会摊开它的挂钟分解、停表区间与完整时间线。</p>
            ) : (
              <div className="detail-grid">
                <article className="sub">
                  <h3 className="sub-title">{detail.data.ticket.title}</h3>
                  <p className="sub-desc">{detail.data.ticket.description}</p>
                  <dl className="facts">
                    <Fact k="客户" v={`${detail.data.ticket.customer_name}（${detail.data.ticket.customer_code}）`} />
                    <Fact
                      k="合同等级"
                      v={tierLabel(meta.data?.tiers ?? [], detail.data.ticket.tier)}
                    />
                    <Fact k="联系电话" v={detail.data.ticket.masked_phone} />
                    <Fact k="技能组 / 分类" v={`${detail.data.ticket.team} · ${detail.data.ticket.category}`} />
                    <Fact k="来单渠道" v={detail.data.ticket.channel} />
                    <Fact k="级别 / 优先级" v={`${detail.data.ticket.severity} · ${detail.data.ticket.priority}`} />
                    <Fact k="当前状态" v={`${detail.data.ledger.stage}（${detail.data.ticket.status}）`} />
                    <Fact k="处理人" v={detail.data.ticket.agent_name === '' ? '尚未派单' : detail.data.ticket.agent_name} />
                    <Fact k="建单时间" v={fieldDateTime(detail.data.ledger.created_at)} />
                    <Fact k="到期时间" v={fieldDateTime(detail.data.ledger.due_at)} />
                    <Fact k="重开 / 转派" v={`${detail.data.ticket.reopen_count} 次 / ${detail.data.ticket.reassign_count} 次`} />
                    <Fact
                      k="快照时效"
                      v={`首响 ${detail.data.response.target_bd_minutes} bd · 解决 ${detail.data.ticket.resolve_target_bd} bd`}
                    />
                  </dl>

                  <div className="equation" data-ok={detail.data.ledger.identity_wall_split_ok ? 'true' : 'false'}>
                    <span className="equation-label">分解式（后端原文）</span>
                    <p className="equation-text mono">{detail.data.ledger.decomposition}</p>
                  </div>

                  <div className="ledger-bars">
                    <LedgerBar label="挂钟总时长" value={detail.data.ledger.wall_minutes} total={detail.data.ledger.wall_minutes} tone="idle" />
                    <LedgerBar
                      label="非工作时段（不计）"
                      value={detail.data.ledger.outside_minutes}
                      total={detail.data.ledger.wall_minutes}
                      tone="idle"
                    />
                    <LedgerBar
                      label="工作时段"
                      value={detail.data.ledger.business_minutes}
                      total={detail.data.ledger.wall_minutes}
                      tone="ok"
                    />
                    <LedgerBar
                      label="其中停表"
                      value={detail.data.ledger.paused_bd_minutes}
                      total={detail.data.ledger.wall_minutes}
                      tone="warn"
                    />
                    <LedgerBar
                      label="计时中 / 目标"
                      value={detail.data.ledger.elapsed_bd_minutes}
                      total={Math.max(detail.data.ledger.target_bd_minutes, detail.data.ledger.elapsed_bd_minutes)}
                      tone={detail.data.ledger.met === false ? 'bad' : 'ok'}
                      caption={`${bd(detail.data.ledger.elapsed_bd_minutes)} / ${detail.data.ledger.target_human}`}
                    />
                  </div>

                  <ul className="ident-list">
                    <Ident
                      ok={detail.data.ledger.identity_clock_ok}
                      text="工作分钟 = 停表 + 计时中，且到期点反算回到目标值"
                    />
                    <Ident
                      ok={detail.data.ledger.identity_wall_split_ok}
                      text="挂钟 = 非工作 + 工作，两段互不重叠"
                    />
                    <Ident
                      ok={detail.data.ledger.identity_timeline_ok}
                      text="停表累计 = 时间线里 paused/resumed 区间重新积分的结果"
                    />
                    <Ident
                      ok={detail.data.response.pending ? null : (detail.data.response.met ?? null)}
                      text={`首响 ${bd(detail.data.response.bd_minutes)} / 目标 ${detail.data.response.target_human}（到期 ${fieldDateTime(detail.data.response.due_at)}）`}
                    />
                  </ul>

                  <OpsPanel
                    row={detail.data.ticket}
                    token={token}
                    meta={meta.data}
                    agents={agents.data?.items ?? []}
                    onChanged={() => {
                      detail.reload();
                      list.reload();
                      stats.reload();
                    }}
                  />
                </article>

                <article className="sub">
                  <h3 className="sub-title">时间线（每一跳都标了它计不计时）</h3>
                  <ol className="timeline">
                    {detail.data.timeline.map((e) => (
                      <li key={e.id} className="tl-entry" data-kind={e.kind} data-counts={e.counts_toward_sla ? 'true' : 'false'}>
                        <span className="tl-dot" aria-hidden="true" />
                        <div className="tl-body">
                          <div className="tl-head">
                            <strong className="tl-kind">{kindLabel(e.kind)}</strong>
                            <span className="tl-status mono">
                              {e.from_status === '' ? '—' : statusLabel(meta.data?.statuses ?? [], e.from_status)}
                              {' → '}
                              {statusLabel(meta.data?.statuses ?? [], e.to_status)}
                            </span>
                            <span className="tl-time mono">{fieldDateTime(e.at)}</span>
                          </div>
                          <p className="tl-meta">
                            {e.actor}（{e.actor_role}）· 本段挂钟 {num(e.span_wall_minutes)} 分 · 计时{' '}
                            {num(e.span_bd_minutes)} bd · {e.counts_toward_sla ? '计入 SLA' : '不计 SLA'}
                          </p>
                          {e.note === '' ? null : <p className="tl-note">{e.note}</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                </article>
              </div>
            )}
          </section>
        </div>

        <aside className="col-side">
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">工作日历</h2>
              <p className="panel-note">
                {(stats.data?.calendar.field_zone ?? '—') + ' · 调休上班日 ' + ((stats.data?.calendar.makeup_workdays ?? []).join('、') || '—')}
              </p>
            </div>
            <div className="calendar">
              {(stats.data?.calendar_days ?? []).map((d) => (
                <div
                  key={d.date}
                  className="cal-day"
                  data-working={d.working ? 'true' : 'false'}
                  data-today={d.is_today ? 'true' : 'false'}
                  data-holiday={d.is_holiday ? 'true' : 'false'}
                  data-makeup={d.is_makeup ? 'true' : 'false'}
                  title={`${d.date} ${d.weekday} · ${d.reason} · ${num(d.minutes)} 分钟`}
                >
                  <span className="cal-date mono">{d.date.slice(5)}</span>
                  <span className="cal-weekday">{d.weekday}</span>
                  <span className="cal-minutes mono">{d.working ? d.minutes : 0}</span>
                </div>
              ))}
            </div>
            <p className="foot-note">
              灰底＝整天不计（周末或法定假日）；带点＝调休上班的周末，照常计满 {num(stats.data?.calendar.minutes_per_day ?? 480)} 分钟。
            </p>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">工程师负载</h2>
              <p className="panel-note">负载＝手上在办单剩余时效所需的工作分钟 ÷ 每周可投入</p>
            </div>
            <ul className="load-list">
              {(stats.data?.agents ?? []).map((a) => (
                <li key={a.agent_code} className="load-row" data-over={a.load_pct > 100 ? 'true' : 'false'}>
                  <button
                    type="button"
                    className="load-name"
                    onClick={() => {
                      setSearch(a.agent_code);
                      setPage(1);
                    }}
                    title={`按 ${a.agent_code} 筛单`}
                  >
                    {a.agent_name}
                    <span className="load-sub mono">
                      {a.team} · {a.agent_code}
                      {a.active ? '' : '（已离岗）'}
                    </span>
                  </button>
                  <span className="load-bar" aria-hidden="true">
                    <span className="load-fill" style={{ width: `${clampPct(a.load_pct)}%` }} />
                  </span>
                  <span className="load-num mono">
                    {a.load_pct}% · 在办 {a.open} / 停表 {a.paused} / 超时 {a.breached}
                  </span>
                </li>
              ))}
            </ul>
            {(stats.data?.agents.length ?? 0) === 0 ? <p className="empty">还没有负载数据。</p> : null}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">SLA 合同矩阵</h2>
              <p className="panel-note">{policies.data?.note ?? '单位：工作分钟'}</p>
            </div>
            <div className="table-wrap">
              <table className="matrix">
                <thead>
                  <tr>
                    <th>合同</th>
                    {(policies.data?.severities ?? []).map((s) => (
                      <th key={s} className="th-clock">
                        {s}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(policies.data?.tiers ?? []).map((tierKey) => (
                    <tr key={tierKey}>
                      <th scope="row">{tierLabel(meta.data?.tiers ?? [], tierKey)}</th>
                      {(policies.data?.severities ?? []).map((sev) => {
                        const cell = policies.data?.items.find((p) => p.tier === tierKey && p.severity === sev);
                        return (
                          <td key={sev} className="th-clock mono">
                            {cell === undefined ? (
                              <span className="cell-missing">未约定</span>
                            ) : (
                              <>
                                <span className="cell-resp">{cell.response_min}′ 响</span>
                                <span className="cell-resolve">{cell.resolve_min}′ 解</span>
                              </>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PolicyForm
              token={token}
              meta={meta.data}
              onDone={() => {
                policies.reload();
                stats.reload();
              }}
            />
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">新建工单</h2>
              <p className="panel-note">写接口由 ADMIN_TOKEN 把守；同客户同名在办单会被唯一索引拦下</p>
            </div>
            <CreateForm
              token={token}
              meta={meta.data}
              customers={dicts.data?.items ?? []}
              agents={agents.data?.items ?? []}
              onCreated={(code) => {
                list.reload();
                stats.reload();
                if (code !== '') setSelected(code);
              }}
            />
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">时效审计</h2>
              <p className="panel-note">每次刷新统计时对全库逐单复算</p>
            </div>
            {audit === undefined ? (
              <p className="empty">审计数据尚未就绪。</p>
            ) : (
              <ul className="ident-list">
                <Ident ok={audit.clock_identity_ok} text={`① 时间账恒等：违例 ${num(audit.clock_violations)} / ${num(audit.checked_tickets)} 张`} />
                <Ident ok={audit.timeline_identity_ok} text={`② 时间线复算停表：违例 ${num(audit.timeline_violations)} 张`} />
                <Ident ok={audit.wall_split_ok} text={`③ 挂钟拆分无缺口：违例 ${num(audit.wall_split_violations)} 张`} />
                <Ident ok={audit.response_identity_ok} text={`④ 首响账自洽：违例 ${num(audit.response_violations)} 张`} />
              </ul>
            )}
            <p className="foot-note">{audit?.explanation ?? ''}</p>
            <dl className="facts">
              <Fact k="全库计时中" v={bd(stats.data?.worked_bd_total ?? 0)} />
              <Fact k="全库停表" v={bd(stats.data?.paused_bd_total ?? 0)} />
              <Fact k="全库非工作" v={`${num(stats.data?.outside_minutes_total ?? 0)} 挂钟分钟`} />
            </dl>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">分类与优先级</h2>
              <p className="panel-note">达标率按落库快照判定，与今天的合同无关</p>
            </div>
            <Rollup title="按状态" rows={stats.data?.by_status ?? []} />
            <Rollup title="按优先级" rows={stats.data?.by_priority ?? []} />
            <Rollup title="按技能组" rows={stats.data?.by_team ?? []} />
            <Rollup title="按合同等级" rows={stats.data?.by_tier ?? []} />
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">近 14 天进出</h2>
              <p className="panel-note">灰色竖条＝那天整日不计时</p>
            </div>
            <ul className="daily">
              {(stats.data?.daily ?? []).map((d) => {
                const max = Math.max(1, ...(stats.data?.daily ?? []).map((x) => Math.max(x.created, x.resolved)));
                return (
                  <li key={d.date} className="daily-row" data-working={d.working_day ? 'true' : 'false'} title={`${d.date} ${d.reason}`}>
                    <span className="daily-date mono">{d.date.slice(5)}</span>
                    <span className="daily-bars">
                      <span className="daily-created" style={{ width: `${(d.created / max) * 100}%` }} />
                      <span className="daily-resolved" style={{ width: `${(d.resolved / max) * 100}%` }} />
                    </span>
                    <span className="daily-num mono">
                      {d.created}↓ {d.resolved}✓
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>
      </main>

      <footer className="foot">
        <span>数据全部来自 /api/health、/api/meta、/api/stats、/api/tickets、/api/tickets/:code、/api/agents、/api/customers、/api/sla/policies；页面内没有任何写死的业务数字。</span>
        <span className="mono">{meta.data?.unit_note ?? ''}</span>
      </footer>
    </div>
  );
}

/* ---------- 小组件：同一份 DOM，样式全部交给 CSS ---------- */

function ThemeStyle({ theme }: { theme: string }): React.JSX.Element {
  const css = useMemo(() => themeCss(theme), [theme]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return <style data-theme-style="true">{css}</style>;
}

function Kpi({ label, value, hint, tone = 'ok' }: { label: string; value: string; hint: string; tone?: Tone }): React.JSX.Element {
  return (
    <article className="kpi" data-tone={tone}>
      <p className="kpi-label">{label}</p>
      <p className="kpi-value mono">{value}</p>
      <p className="kpi-hint">{hint}</p>
    </article>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Select({
  id,
  value,
  onChange,
  children,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  );
}

function Fact({ k, v }: { k: string; v: string }): React.JSX.Element {
  return (
    <div className="fact">
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function Ident({ ok, text }: { ok: boolean | null; text: string }): React.JSX.Element {
  return (
    <li className="ident" data-ok={ok === null ? 'na' : ok ? 'true' : 'false'}>
      <span className="ident-mark mono" aria-hidden="true">
        {ok === null ? '·' : ok ? '✓' : '✗'}
      </span>
      <span className="ident-text">{text}</span>
    </li>
  );
}

function LedgerBar({
  label,
  value,
  total,
  tone,
  caption,
}: {
  label: string;
  value: number;
  total: number;
  tone: Tone;
  caption?: string;
}): React.JSX.Element {
  const w = total <= 0 ? 0 : clampPct((value / total) * 100);
  return (
    <div className="ledger-bar" data-tone={tone}>
      <span className="lb-label">{label}</span>
      <span className="lb-track" aria-hidden="true">
        <span className="lb-fill" style={{ width: `${w}%` }} />
      </span>
      <span className="lb-value mono">{caption ?? bd(value)}</span>
    </div>
  );
}

function TicketTr({
  row,
  selected,
  onSelect,
}: {
  row: TicketRow;
  selected: boolean;
  onSelect: (code: string) => void;
}): React.JSX.Element {
  const tone = rowTone(row);
  return (
    <tr
      className="row"
      data-tone={tone}
      data-selected={selected ? 'true' : 'false'}
      onClick={() => onSelect(row.code)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(row.code);
        }
      }}
    >
      <td className="cell-code mono">{row.code}</td>
      <td className="cell-title">
        <span className="row-title">{row.title}</span>
        <span className="row-sub mono">
          {row.category} · {row.channel} · {fieldDateTime(row.created_at)} 建
        </span>
      </td>
      <td className="cell-cust">
        {row.customer_name}
        <span className="row-sub">{row.tier}</span>
      </td>
      <td className="cell-agent">{row.agent_name === '' ? '待派' : `${row.agent_name}·${row.team}`}</td>
      <td className="cell-sev mono">
        {row.severity}
        <span className="row-sub">{row.priority}</span>
      </td>
      <td className="cell-status">
        <span className="chip" data-tone={tone}>
          {TONE_TEXT[tone]}
        </span>
        <span className="row-sub">{statusText(row.status)}</span>
      </td>
      <td className="cell-progress">
        <span className="bar" aria-hidden="true">
          <span className="bar-fill" style={{ width: `${clampPct(row.progress_pct)}%` }} />
        </span>
        <span className="bar-num mono">
          {row.progress_pct}% · 目标 {row.resolve_target_bd}′
        </span>
      </td>
      <td className="cell-due mono">
        {remainText(row.remaining_bd_minutes, row.breached)}
        <span className="row-sub">{fieldDateTime(row.due_at)} 到期</span>
      </td>
      <td className="cell-paused mono">
        {row.status === 'pending_customer' ? `挂起中 ${row.pause_reason}` : `${num(row.paused_bd_total_minutes)}′`}
        <span className="row-sub">{row.status === 'pending_customer' ? '时效暂停' : '累计停表'}</span>
      </td>
      <td className="cell-ident">
        <span className="ident-mark mono" data-ok={row.clock_identity_ok ? 'true' : 'false'}>
          {row.clock_identity_ok ? '✓' : '✗'}
        </span>
      </td>
    </tr>
  );
}

function Rollup({ title, rows }: { title: string; rows: { label: string; total: number; open: number; breached: number; met_pct: number }[] }): React.JSX.Element {
  return (
    <div className="rollup">
      <h4 className="rollup-title">{title}</h4>
      <table className="rollup-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td className="mono">{r.total}</td>
              <td className="mono">在办 {r.open}</td>
              <td className="mono" data-tone={r.breached > 0 ? 'bad' : 'ok'}>
                超时 {r.breached}
              </td>
              <td className="mono">达标 {r.met_pct.toFixed(1)}%</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5}>暂无数据</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }): React.JSX.Element {
  return (
    <p className="error-box" role="alert">
      {message}
      <button type="button" className="btn" onClick={onRetry}>
        重试
      </button>
    </p>
  );
}

/* ---------- 写操作表单 ---------- */

function OpsPanel({
  row,
  token,
  meta,
  agents,
  onChanged,
}: {
  row: TicketRow;
  token: string;
  meta: Meta | null;
  agents: Agent[];
  onChanged: () => void;
}): React.JSX.Element {
  const action = useAction();
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [agent, setAgent] = useState('');

  return (
    <div className="ops" data-tone="ok">
      <h3 className="sub-title">值班操作</h3>
      <div className="form-row">
        <Field label="推进到" htmlFor="op-status">
          <Select id="op-status" value={status} onChange={setStatus}>
            <option value="">选择状态</option>
            {(meta?.statuses ?? []).map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <button
          type="button"
          className="btn"
          disabled={action.busy || status === ''}
          onClick={() => writeGuard(token, action, () => api.changeStatus(token, row.code, status, note).then(() => undefined))}
        >
          推进
        </button>
      </div>
      <div className="form-row">
        <Field label="派给工程师" htmlFor="op-agent">
          <Select id="op-agent" value={agent} onChange={setAgent}>
            <option value="">选择工程师</option>
            {agents
              .filter((a) => a.active)
              .map((a) => (
                <option key={a.code} value={a.code}>
                  {a.name}（{a.code}）
                </option>
              ))}
          </Select>
        </Field>
        <button
          type="button"
          className="btn"
          disabled={action.busy || agent === ''}
          onClick={() => writeGuard(token, action, () => api.assign(token, row.code, agent, note).then(() => undefined))}
        >
          派单
        </button>
      </div>
      <div className="form-row">
        <Field label="停表原因" htmlFor="op-reason">
          <Select id="op-reason" value={reason} onChange={setReason}>
            <option value="">选择原因</option>
            {(meta?.pause_reasons ?? []).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <button
          type="button"
          className="btn warn"
          disabled={action.busy || reason === ''}
          onClick={() => writeGuard(token, action, () => api.pause(token, row.code, reason, note).then(() => undefined))}
        >
          停表
        </button>
        <button
          type="button"
          className="btn"
          disabled={action.busy || row.status !== 'pending_customer'}
          onClick={() => writeGuard(token, action, () => api.resume(token, row.code, note).then(() => undefined))}
        >
          恢复计时
        </button>
      </div>
      <Field label="备注（最长 200 字）" htmlFor="op-note">
        <input id="op-note" className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ActionNote action={action} onDone={onChanged} />
    </div>
  );
}

function writeGuard(token: string, action: Action, fn: () => Promise<void>): void {
  if (token === '') {
    action.notify('请先在右上角填写管理令牌（ADMIN_TOKEN），写接口一律要 Bearer 校验');
    return;
  }
  action.run(fn);
}

function PolicyForm({
  token,
  meta,
  onDone,
}: {
  token: string;
  meta: Meta | null;
  onDone: () => void;
}): React.JSX.Element {
  const action = useAction();
  const [tier, setTier] = useState('platinum');
  const [sev, setSev] = useState('S1');
  const [resp, setResp] = useState('15');
  const [resolve, setResolve] = useState('240');

  return (
    <form
      className="policy-form"
      onSubmit={(e) => {
        e.preventDefault();
        writeGuard(token, action, () =>
          api
            .upsertPolicy(token, {
              tier,
              severity: sev,
              response_min: Number(resp),
              resolve_min: Number(resolve),
            })
            .then(() => undefined),
        );
      }}
    >
      <h3 className="sub-title">改合同（不回溯在办单）</h3>
      <div className="form-row">
        <Field label="合同等级" htmlFor="p-tier">
          <Select id="p-tier" value={tier} onChange={setTier}>
            {(meta?.tiers ?? []).map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="级别" htmlFor="p-sev">
          <Select id="p-sev" value={sev} onChange={setSev}>
            {(meta?.severities ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="首响 bd" htmlFor="p-resp">
          <input id="p-resp" className="input mono" type="number" min={5} max={1440} value={resp} onChange={(e) => setResp(e.target.value)} />
        </Field>
        <Field label="解决 bd" htmlFor="p-resolve">
          <input id="p-resolve" className="input mono" type="number" min={30} max={20160} value={resolve} onChange={(e) => setResolve(e.target.value)} />
        </Field>
        <button type="submit" className="btn" disabled={action.busy}>
          保存
        </button>
      </div>
      <ActionNote action={action} onDone={onDone} />
    </form>
  );
}

function CreateForm({
  token,
  meta,
  customers,
  agents,
  onCreated,
}: {
  token: string;
  meta: Meta | null;
  customers: Customer[];
  agents: Agent[];
  onCreated: (code: string) => void;
}): React.JSX.Element {
  const action = useAction();
  const [form, setForm] = useState(EMPTY_FORM);
  const set = (k: keyof typeof EMPTY_FORM, v: string): void => setForm((f) => ({ ...f, [k]: v }));

  return (
    <form
      className="create-form"
      onSubmit={(e) => {
        e.preventDefault();
        writeGuard(token, action, () =>
          api.createTicket(token, form).then((res) => {
            onCreated(res.ticket.code);
            setForm(EMPTY_FORM);
          }),
        );
      }}
    >
      <Field label="标题（4-80 字）" htmlFor="c-title">
        <input id="c-title" className="input" value={form.title} maxLength={80} onChange={(e) => set('title', e.target.value)} required />
      </Field>
      <Field label="描述（可空，≤500 字）" htmlFor="c-desc">
        <textarea id="c-desc" className="input area" rows={3} value={form.description} maxLength={500} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <div className="form-row">
        <Field label="客户" htmlFor="c-cust">
          <Select id="c-cust" value={form.customer} onChange={(v) => set('customer', v)}>
            <option value="">选择客户</option>
            {customers
              .filter((c) => c.active)
              .map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}（{c.code}）
                </option>
              ))}
          </Select>
        </Field>
        <Field label="级别" htmlFor="c-sev">
          <Select id="c-sev" value={form.severity} onChange={(v) => set('severity', v)}>
            {(meta?.severities ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="form-row">
        <Field label="分类" htmlFor="c-cat">
          <Select id="c-cat" value={form.category} onChange={(v) => set('category', v)}>
            <option value="">按分类自动派组</option>
            {(meta?.categories ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="渠道" htmlFor="c-chan">
          <Select id="c-chan" value={form.channel} onChange={(v) => set('channel', v)}>
            <option value="">未指定</option>
            {(meta?.channels ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="直接派给（可空）" htmlFor="c-agent">
        <Select id="c-agent" value={form.agent} onChange={(v) => set('agent', v)}>
          <option value="">先进待受理队列</option>
          {agents
            .filter((a) => a.active)
            .map((a) => (
              <option key={a.code} value={a.code}>
                {a.name}（{a.code}）
              </option>
            ))}
        </Select>
      </Field>
      <div className="form-row">
        <button type="submit" className="btn primary" disabled={action.busy}>
          {action.busy ? '提交中…' : '受理工单'}
        </button>
        <button type="button" className="btn ghost" onClick={() => setForm(EMPTY_FORM)}>
          重置
        </button>
      </div>
      <ActionNote action={action} onDone={() => onCreated('')} />
    </form>
  );
}

function ActionNote({ action, onDone }: { action: ReturnType<typeof useAction>; onDone: () => void }): React.JSX.Element | null {
  useEffect(() => {
    if (action.kind === 'ok') onDone();
    // 只在结果落地那一刻回调，避免 onDone 每次渲染都换引用造成循环。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action.kind, action.message]);
  if (action.message === null) return null;
  const fields = action.lastError?.fields ?? {};
  const keys = Object.keys(fields);
  return (
    <p className="action-note" data-kind={action.kind ?? 'err'} role="status">
      {action.message}
      {keys.length > 0 ? (
        <span className="field-errors mono">{keys.map((k) => `${k}：${fields[k] ?? ''}`).join('；')}</span>
      ) : null}
    </p>
  );
}

/* ---------- 纯函数 ---------- */

function tabCount(
  stats: { open: number; breached: number; at_risk: number; paused: number; new_unassigned: number; total: number } | undefined,
  only: string,
): number {
  if (stats === undefined) return 0;
  switch (only) {
    case 'open':
      return stats.open;
    case 'at_risk':
      return stats.at_risk;
    case 'breached':
      return stats.breached;
    case 'paused':
      return stats.paused;
    case 'responding':
      return stats.new_unassigned;
    default:
      return stats.total;
  }
}

const SORT_LABELS: Record<string, string> = {
  due: '到期时间',
  created: '建单时间',
  priority: '优先级',
  severity: '级别',
  status: '状态',
  customer: '客户名',
  agent: '工程师',
  code: '工单号',
  paused: '累计停表',
  resolveBd: '实际耗时',
};

function sortLabel(s: string): string {
  return SORT_LABELS[s] ?? s;
}

function tierLabel(tiers: { value: string; label: string }[], v: string): string {
  return tiers.find((t) => t.value === v)?.label ?? v;
}

function statusLabel(statuses: { value: string; label: string }[], v: string): string {
  if (v === '') return '—';
  return statuses.find((s) => s.value === v)?.label ?? v;
}

function statusText(v: string): string {
  switch (v) {
    case 'new':
      return '待受理';
    case 'assigned':
      return '已派单';
    case 'in_progress':
      return '处理中';
    case 'pending_customer':
      return '停表等客户';
    case 'resolved':
      return '待验收';
    case 'closed':
      return '已关单';
    case 'canceled':
      return '已取消';
    default:
      return v;
  }
}

// 服务端把非法筛选收敛掉了；这里比对「我发了什么」与「服务端认了什么」，
// 把没被接受的键显式告诉用户，而不是静默忽略。
function droppedFilters(params: ListParams, echo: Record<string, string>): string[] {
  const out: string[] = [];
  for (const key of ['status', 'severity', 'tier', 'team', 'q'] as const) {
    const sent = params[key];
    if (sent !== undefined && sent !== '' && echo[key] !== sent) out.push(`${key}=${sent}`);
  }
  return out;
}
