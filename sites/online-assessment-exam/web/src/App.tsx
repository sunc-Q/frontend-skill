import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import {
  ASMT_STATUS_LABEL,
  ATTEMPT_STATUS_LABEL,
  CHANNEL_LABEL,
  clock,
  dateTime,
  difficultyClass,
  KIND_LABEL,
  letter,
  minutes,
  num,
  pct,
  pickedText,
  TYPE_LABEL,
} from './format';
import { persistTheme, initialTheme, Swatch, THEMES, themeCss } from './themes';
import { useAction, useAsync } from './useAsync';
import {
  ApiError,
  type AssessmentRow,
  type AttemptRow,
  type ItemStat,
  type ListParams,
  type Paper,
  type QuestionView,
  type Receipt,
  type StartOut,
  type Statistics,
  type Stats,
  type SubmitOut,
} from './types';

const TOKEN_KEY = 'biz-site-admin-token';

/** 列表筛选态：字段全部必填，空串表示「不过滤」，由 api 层丢弃。 */
interface AsmtFilter {
  q: string;
  status: string;
  subject: string;
  kind: string;
  sort: string;
  dir: string;
  page: number;
  page_size: number;
}

interface RosterFilter {
  status: string;
  channel: string;
  passed: string;
  sort: string;
  dir: string;
  page: number;
  page_size: number;
}

const DEFAULT_ASMT: AsmtFilter = {
  q: '',
  status: '',
  subject: '',
  kind: '',
  sort: 'opens_at',
  dir: 'desc',
  page: 1,
  page_size: 6,
};

const DEFAULT_ROSTER: RosterFilter = {
  status: '',
  channel: '',
  passed: '',
  sort: 'rank',
  dir: 'asc',
  page: 1,
  page_size: 8,
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

  const [af, setAf] = useState<AsmtFilter>(DEFAULT_ASMT);
  const stats = useAsync<Stats>(() => api.stats(), []);
  const list = useAsync(
    () => api.assessments(assessmentParams(af)),
    [af.q, af.status, af.subject, af.kind, af.sort, af.dir, af.page, af.page_size],
  );

  const rows = list.data?.items ?? [];
  const [code, setCode] = useState<string>('');
  useEffect(() => {
    if (code !== '' && rows.some((r) => r.code === code)) return;
    const first = rows[0]?.code ?? '';
    if (first !== code && first !== '') setCode(first);
  }, [rows, code]);

  const paper = useAsync<Paper | null>(() => (code === '' ? Promise.resolve(null) : api.paper(code)), [code]);
  const stat = useAsync<Statistics | null>(() => (code === '' ? Promise.resolve(null) : api.statistics(code)), [code]);
  const scoped = useAsync<Stats | null>(
    () => (code === '' ? Promise.resolve(null) : api.stats({ assessment: code })),
    [code],
  );

  const [rf, setRf] = useState<RosterFilter>(DEFAULT_ROSTER);
  const roster = useAsync(
    () => (code === '' ? Promise.resolve(null) : api.attempts(code, rosterParams(rf))),
    [code, rf.status, rf.channel, rf.passed, rf.sort, rf.dir, rf.page, rf.page_size],
  );

  const rosterRows = roster.data?.items ?? [];
  const [attemptNo, setAttemptNo] = useState<string>('');
  useEffect(() => {
    if (attemptNo !== '' && rosterRows.some((r) => r.attempt_no === attemptNo)) return;
    const first = rosterRows[0]?.attempt_no ?? '';
    if (first !== attemptNo) setAttemptNo(first);
  }, [rosterRows, attemptNo]);
  const receipt = useAsync<Receipt | null>(
    () => (attemptNo === '' ? Promise.resolve(null) : api.receipt(attemptNo)),
    [attemptNo, roster.data?.total ?? 0],
  );

  const totalAsmts = list.data?.total ?? 0;
  const asmtPages = Math.max(1, Math.ceil(totalAsmts / af.page_size));
  const totalRuns = roster.data?.total ?? 0;
  const rosterPages = Math.max(1, Math.ceil(totalRuns / rf.page_size));

  const current = useMemo(
    () => rows.find((r) => r.code === code) ?? paper.data?.assessment ?? null,
    [rows, code, paper.data],
  );

  const refreshAll = useCallback(() => {
    stats.reload();
    list.reload();
    roster.reload();
    receipt.reload();
    scoped.reload();
    stat.reload();
  }, [stats, list, roster, receipt, scoped, stat]);

  return (
    <div className="shell">
      <ThemeStyle theme={theme} />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Swatch theme={theme} />
          </span>
          <span className="brand-name">知衡测评台</span>
          <span className="brand-sub">Assessment Console</span>
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
                <Swatch theme={t.id} />
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
        <p className="lede">
          一套接口、一份 DOM、三种互斥视觉主张。所有数字来自 Go/Gin + SQLite 后端的真实查询：
          <b> 判分引擎只在后端一处</b>，成绩单恒等式「总分 = 机械分 + 漏选半分 = 逐题得分之和」由接口体检字段{' '}
          <code>identity_ok</code> 实时公布。
        </p>
        <p className="stamp">
          数据快照 {stats.data ? dateTime(stats.data.generated_at) : '加载中'} · {stats.data?.window ?? ''}
        </p>
      </div>

      <Banner state={stats} label="总览接口" />

      <main className="layout">
        <section className="col-main">
          <div className="section-head">
            <h2 className="section-title">测评总览</h2>
            <span className="section-note">全体场次口径 · 均分与通过率只算已判分卷</span>
          </div>
          <KpiGrid s={stats.data} />
          <IdentityFlag s={stats.data} />

          <div className="section-head">
            <h2 className="section-title">场次台账</h2>
            <span className="section-note">
              第 {af.page} / {asmtPages} 页 · 共 {totalAsmts} 场 · 点击行切换下方视角
            </span>
          </div>
          <AssessmentFilters
            value={af}
            subjects={list.data?.subjects ?? []}
            pages={asmtPages}
            onChange={(next) => setAf((prev) => ({ ...prev, ...next.next, page: next.resetPage ? 1 : prev.page }))}
          />
          <Banner state={list} label="场次列表" />
          <AssessmentTable
            rows={rows}
            loading={list.loading}
            sort={af.sort}
            dir={af.dir === 'asc' ? 'asc' : 'desc'}
            selected={code}
            onSort={(sort) =>
              setAf((prev) => ({
                ...prev,
                sort,
                dir: prev.sort === sort && prev.dir === 'desc' ? 'asc' : 'desc',
                page: 1,
              }))
            }
            onPick={setCode}
          />
        </section>

        <aside className="col-side">
          <div className="section-head">
            <h2 className="section-title">分数段分布</h2>
            <span className="section-note">百分制 · 已判分卷</span>
          </div>
          <BucketBars buckets={stats.data?.buckets ?? []} />

          <div className="section-head">
            <h2 className="section-title">科目汇总</h2>
            <span className="section-note">作答量与均分率</span>
          </div>
          <SubjectTable subjects={stats.data?.subjects ?? []} />

          <div className="section-head">
            <h2 className="section-title">近 14 日作答</h2>
            <span className="section-note">外条=作答量，内条=达线数</span>
          </div>
          <DailyBars daily={stats.data?.daily ?? []} />

          <div className="section-head">
            <h2 className="section-title">最难题目</h2>
            <span className="section-note">全体场次中作答数 ≥ 15 的低正确率题</span>
          </div>
          <HardestList items={stats.data?.hardest_items ?? []} />
        </aside>
      </main>

      <section className="detail">
        <div className="detail-main">
          <div className="section-head">
            <h2 className="section-title">本场口径</h2>
            <span className="section-note">{code === '' ? '未选择场次' : `${code} · ${current?.title ?? ''}`}</span>
          </div>
          <Banner state={paper} label="卷面接口" />
          <Banner state={scoped} label="单场统计" />
          <PaperSummary row={current} s={scoped.data} />

          <div className="section-head">
            <h2 className="section-title">卷面试题</h2>
            <span className="section-note">后端不输出标准答案，选项仅按考生视角给出</span>
          </div>
          <PaperList questions={paper.data?.questions ?? []} />

          <div className="section-head">
            <h2 className="section-title">题目区分度</h2>
            <span className="section-note">
              {current?.status === 'closed' ? '已收卷：公布全部选项分布' : '未收卷：只公布正确率，分布已隐藏'}
            </span>
          </div>
          <Banner state={stat} label="区分度接口" />
          <ItemStatsTable items={stat.data?.items ?? []} closed={current?.status === 'closed'} />

          <div className="section-head">
            <h2 className="section-title">考生名单</h2>
            <span className="section-note">
              第 {rf.page} / {rosterPages} 页 · 共 {totalRuns} 份 · 手机号只输出脱敏值
            </span>
          </div>
          <Banner state={roster} label="名单接口" />
          <RosterFilters
            value={rf}
            pages={rosterPages}
            onChange={(next) => setRf((prev) => ({ ...prev, ...next.next, page: next.resetPage ? 1 : prev.page }))}
          />
          <RosterTable
            rows={rosterRows}
            loading={roster.loading}
            sort={rf.sort}
            dir={rf.dir === 'asc' ? 'asc' : 'desc'}
            selected={attemptNo}
            onSort={(sort) =>
              setRf((prev) => ({
                ...prev,
                sort,
                dir: prev.sort === sort && prev.dir === 'asc' ? 'desc' : 'asc',
                page: 1,
              }))
            }
            onPick={setAttemptNo}
          />
        </div>

        <div className="detail-side">
          <div className="section-head">
            <h2 className="section-title">成绩条</h2>
            <span className="section-note">{attemptNo === '' ? '未选择考生' : attemptNo}</span>
          </div>
          <Banner state={receipt} label="成绩条接口" />
          <ReceiptPanel state={receipt} />
          <ClosePaperCard current={current} token={token} onDone={refreshAll} />
        </div>
      </section>

      <footer className="pagefoot">
        <div className="section-head">
          <h2 className="section-title">考生侧与运营侧写操作</h2>
          <span className="section-note">全部经由 Bearer ADMIN_TOKEN；校验失败按字段回显，绝不外泄内部错误</span>
        </div>
        <div className="foot-grid">
          <ExamPanel token={token} openPapers={rows.filter((r) => r.status === 'open')} onDone={refreshAll} />
          <StatusForm token={token} current={current} onDone={refreshAll} />
        </div>
        <p className="footnote">
          接口：GET /api/health · /api/stats · /api/assessments · /api/assessments/&#123;code&#125; ·
          /api/assessments/&#123;code&#125;/statistics · /api/assessments/&#123;code&#125;/attempts ·
          /api/attempts/&#123;no&#125; ；POST（需令牌）/api/assessments/&#123;code&#125;/attempts ·
          /api/attempts/&#123;no&#125;/submit · /api/assessments/&#123;code&#125;/status
        </p>
      </footer>
    </div>
  );
}

function assessmentParams(f: AsmtFilter): ListParams {
  return {
    q: f.q,
    status: f.status,
    subject: f.subject,
    kind: f.kind,
    sort: f.sort,
    dir: f.dir,
    page: f.page,
    page_size: f.page_size,
  };
}

function rosterParams(f: RosterFilter): ListParams {
  return {
    status: f.status,
    channel: f.channel,
    passed: f.passed,
    sort: f.sort,
    dir: f.dir,
    page: f.page,
    page_size: f.page_size,
  };
}

export function ThemeStyle({ theme }: { theme: string }): React.JSX.Element {
  return <style data-theme-css={theme}>{themeCss(theme)}</style>;
}

function Banner({ state, label }: { state: { loading: boolean; error: string | null }; label: string }): React.JSX.Element | null {
  if (state.error === null) return null;
  return (
    <p className="banner" role="status">
      <span className="banner-tag">{label}</span>
      {state.loading ? '重试中… ' : ''}
      {state.error}
    </p>
  );
}

const KPI_ORDER: readonly (keyof Stats)[] = [
  'assessments',
  'open_assessments',
  'questions',
  'attempts',
  'graded',
  'ongoing',
  'invalid',
  'passed',
  'pass_rate_pct',
  'avg_percent',
];

const KPI_LABEL: Record<string, string> = {
  assessments: '测评场次',
  open_assessments: '进行中场次',
  questions: '在库题目',
  attempts: '作答总数',
  graded: '已判分',
  ongoing: '进行中份数',
  invalid: '超时作废',
  passed: '达通过线',
  pass_rate_pct: '通过率',
  avg_percent: '平均得分率',
};

const KPI_HINT: Record<string, string> = {
  attempts: '含已判分、进行中与作废',
  graded: '已判分并逐题落库',
  ongoing: '开考未交卷，含超时未交',
  invalid: '超出限时 + 120 秒宽限，整卷记 0 分',
  pass_rate_pct: '达线 ÷ 已判分',
  avg_percent: '已判分卷的百分制均值',
};

function KpiGrid({ s }: { s: Stats | null }): React.JSX.Element {
  return (
    <div className="kpis">
      {KPI_ORDER.map((key) => {
        const raw = s?.[key];
        const value = typeof raw === 'number' ? raw : 0;
        const isRate = key === 'pass_rate_pct' || key === 'avg_percent';
        return (
          <article className="kpi" key={String(key)}>
            <h3 className="kpi-label">{KPI_LABEL[String(key)] ?? String(key)}</h3>
            <p className="kpi-value">{s === null ? '—' : isRate ? pct(value) : num(value)}</p>
            <p className="kpi-hint">{KPI_HINT[String(key)] ?? '实时统计'}</p>
          </article>
        );
      })}
    </div>
  );
}

function IdentityFlag({ s }: { s: Stats | null }): React.JSX.Element | null {
  if (s === null) return null;
  return (
    <p className="identity" data-ok={s.identity_ok ? 'true' : 'false'}>
      <span className="badge" data-tone={s.identity_ok ? 'ok' : 'bad'}>
        {s.identity_ok ? '口径一致' : '口径异常'}
      </span>
      接口体检：已判分总分 {num(s.score_total)} = 机械分 {num(s.mechanical_total)} + 漏选半分 {num(s.half_credit_total)}，
      违反 {s.identity_violations} 条。
    </p>
  );
}

const KIND_OPTIONS: readonly string[] = ['placement', 'unit', 'mock', 'cert'];

function AssessmentFilters({
  value,
  subjects,
  pages,
  onChange,
}: {
  value: AsmtFilter;
  subjects: string[];
  pages: number;
  onChange: (next: { next: Partial<AsmtFilter>; resetPage: boolean }) => void;
}): React.JSX.Element {
  const [search, setSearch] = useState(value.q);
  useEffect(() => {
    if (search === value.q) return;
    const id = window.setTimeout(() => onChange({ next: { q: search }, resetPage: true }), 320);
    return () => window.clearTimeout(id);
  }, [search, value.q, onChange]);

  return (
    <div className="filters">
      <label className="field field-wide">
        <span className="field-label">关键词</span>
        <input
          className="input"
          type="search"
          value={search}
          maxLength={48}
          placeholder="卷名 / 编号 / 简介（服务端转义 LIKE）"
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label">状态</span>
        <select className="input" value={value.status} onChange={(e) => onChange({ next: { status: e.target.value }, resetPage: true })}>
          <option value="">全部</option>
          {(['draft', 'open', 'closed'] as const).map((s) => (
            <option key={s} value={s}>
              {ASMT_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">科目</span>
        <select className="input" value={value.subject} onChange={(e) => onChange({ next: { subject: e.target.value }, resetPage: true })}>
          <option value="">全部</option>
          {subjects.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">类型</span>
        <select className="input" value={value.kind} onChange={(e) => onChange({ next: { kind: e.target.value }, resetPage: true })}>
          <option value="">全部</option>
          {KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k] ?? k}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">每页</span>
        <select
          className="input"
          value={String(value.page_size)}
          onChange={(e) => onChange({ next: { page_size: Number(e.target.value) }, resetPage: true })}
        >
          {[6, 12, 24].map((n) => (
            <option key={n} value={String(n)}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <Pager page={value.page} pages={pages} onPage={(p) => onChange({ next: { page: p }, resetPage: false })} />
    </div>
  );
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }): React.JSX.Element {
  return (
    <div className="pager">
      <button type="button" className="btn btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        上一页
      </button>
      <span className="pager-now">
        {page} / {pages}
      </span>
      <button type="button" className="btn btn-ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        下一页
      </button>
    </div>
  );
}

const ASMT_COLS: readonly { key: string; sort: string; label: string; numeric?: boolean }[] = [
  { key: 'code', sort: 'code', label: '编号' },
  { key: 'title', sort: 'title', label: '场次' },
  { key: 'status', sort: '', label: '状态' },
  { key: 'question_no', sort: '', label: '题数', numeric: true },
  { key: 'total_score', sort: 'total_score', label: '满分', numeric: true },
  { key: 'attempts', sort: 'attempts', label: '作答', numeric: true },
  { key: 'passed_count', sort: 'passed', label: '通过', numeric: true },
  { key: 'avg_percent', sort: 'avg', label: '均分率', numeric: true },
  { key: 'opens_at', sort: 'opens_at', label: '开考时间' },
];

function AssessmentTable({
  rows,
  loading,
  sort,
  dir,
  selected,
  onSort,
  onPick,
}: {
  rows: AssessmentRow[];
  loading: boolean;
  sort: string;
  dir: 'asc' | 'desc';
  selected: string;
  onSort: (sort: string) => void;
  onPick: (code: string) => void;
}): React.JSX.Element {
  if (rows.length === 0 && !loading) return <p className="empty">当前筛选条件下没有场次，试试放宽条件。</p>;
  return (
    <div className="tablewrap">
      <table className="table" data-loading={loading ? 'true' : 'false'}>
        <caption className="caption">点击任一场次即可切换卷面、区分度、名单与成绩条视角</caption>
        <thead>
          <tr>
            {ASMT_COLS.map((c) => (
              <th key={c.key} scope="col" className={c.numeric === true ? 'num' : undefined}>
                {c.sort === '' ? (
                  c.label
                ) : (
                  <button type="button" className="sortbtn" data-on={sort === c.sort ? 'true' : 'false'} onClick={() => onSort(c.sort)}>
                    <span>{c.label}</span>
                    <span className="sortmark" aria-hidden="true">
                      {sort === c.sort ? (dir === 'asc' ? '▲' : '▼') : '·'}
                    </span>
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.code}
              data-active={r.code === selected ? 'true' : 'false'}
              tabIndex={0}
              onClick={() => onPick(r.code)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onPick(r.code);
              }}
            >
              <td className="mono">{r.code}</td>
              <td>
                <span className="cell-strong">{r.title}</span>
                <span className="cell-sub">
                  {r.subject} · {KIND_LABEL[r.kind] ?? r.kind} · {minutes(r.duration_min)} · 通过线 {r.pass_score} 分
                </span>
              </td>
              <td>
                <span className="badge" data-tone={r.status === 'open' ? 'ok' : r.status === 'draft' ? 'warn' : 'mute'}>
                  {ASMT_STATUS_LABEL[r.status]}
                </span>
                {r.ongoing_count > 0 ? <span className="mini">另有 {r.ongoing_count} 份在答</span> : null}
              </td>
              <td className="num mono">{r.question_no}</td>
              <td className="num mono">{r.total_score}</td>
              <td className="num mono">{num(r.attempts)}</td>
              <td className="num mono">{num(r.passed_count)}</td>
              <td className="num mono">{r.attempts === 0 ? '—' : pct(r.avg_percent)}</td>
              <td className="mono">{dateTime(r.opens_at).slice(0, 16)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaperSummary({ row, s }: { row: AssessmentRow | null; s: Stats | null }): React.JSX.Element {
  if (row === null) return <p className="empty">选择一个场次查看卷面与本场口径。</p>;
  return (
    <div className="paper-summary">
      <p className="paper-intro">{row.intro}</p>
      <p className="paper-meta">
        <span className="badge" data-tone={row.status === 'open' ? 'ok' : row.status === 'draft' ? 'warn' : 'mute'}>
          {ASMT_STATUS_LABEL[row.status]}
        </span>
        <span>限时 {minutes(row.duration_min)}</span>
        <span>满分 {row.total_score}（= 题目分值之和）</span>
        <span>通过线 {row.pass_score} 分</span>
        <span>最高分 {row.best_score}</span>
        <span>收卷 {dateTime(row.closes_at).slice(0, 16)} UTC</span>
      </p>
      {s === null ? null : (
        <p className="paper-scope">
          本场已判分 {num(s.graded)} 份 · 通过率 {pct(s.pass_rate_pct)} · 均分率 {pct(s.avg_percent)} · 作废{' '}
          {num(s.invalid)} 份 · 漏选半分合计 {num(s.half_credit_total)} 分
        </p>
      )}
    </div>
  );
}

function PaperList({ questions }: { questions: QuestionView[] }): React.JSX.Element {
  if (questions.length === 0) return <p className="empty">该场次尚未录入题目。</p>;
  return (
    <ol className="paper-list">
      {questions.map((q) => (
        <li className="question" key={q.code} data-type={q.type}>
          <p className="q-head">
            <span className="q-no">{String(q.order_no).padStart(2, '0')}</span>
            <span className="badge">{TYPE_LABEL[q.type] ?? q.type}</span>
            <span className="q-score">
              {q.score} 分{q.type === 'multi' ? ' · 漏选得半分' : ''}
            </span>
          </p>
          <p className="q-stem">{q.stem}</p>
          <div className="q-opts">
            {(q.options ?? []).map((text, i) => (
              <span className="opt" key={`${q.code}-${i}`}>
                <span className="opt-key">{letter(i)}</span>
                <span className="opt-text">{text}</span>
              </span>
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}

const DIFF_LABEL: Record<string, string> = { 易: '偏易', 中: '中等', 难: '偏难', 空题: '零作答' };

function ItemStatsTable({ items, closed }: { items: ItemStat[]; closed: boolean }): React.JSX.Element {
  if (items.length === 0) return <p className="empty">该场题目暂无判分样本。</p>;
  return (
    <div className="tablewrap">
      <table className="table">
        <caption className="caption">区分度即该题正确率；未收卷时后端不下发选项分布，这是产品规则而非前端遮罩</caption>
        <thead>
          <tr>
            <th scope="col">题号</th>
            <th scope="col">题型</th>
            <th scope="col">题干</th>
            <th scope="col" className="num">
              分值
            </th>
            <th scope="col" className="num">
              作答数
            </th>
            <th scope="col" className="num">
              正确率
            </th>
            <th scope="col">难度</th>
            <th scope="col">选项分布</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.code}>
              <td className="mono">
                {String(i.order_no).padStart(2, '0')} · {i.code}
              </td>
              <td>{TYPE_LABEL[i.type] ?? i.type}</td>
              <td className="cell-stem">{i.stem}</td>
              <td className="num mono">{i.score}</td>
              <td className="num mono">{num(i.answered)}</td>
              <td className="num mono">{pct(i.accuracy_pct, 0)}</td>
              <td>
                <span className="badge" data-tone={difficultyClass(i.difficulty)}>
                  {DIFF_LABEL[i.difficulty] ?? i.difficulty}
                </span>
              </td>
              <td>
                {i.revealed ? (
                  <span className="distro">
                    {(i.distractors ?? []).map((d) => (
                      <span className="distro-chip" key={`${i.code}-${d.picked}`}>
                        {pickedText(i.type, d.picked)} · {d.count}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="distro-locked">{closed ? '零作答' : '未收卷 · 已隐藏'}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BucketBars({ buckets }: { buckets: Stats['buckets'] }): React.JSX.Element {
  if (buckets.length === 0) return <p className="empty">正在加载分数段…</p>;
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <ul className="bars">
      {buckets.map((b) => (
        <li className="bar" key={b.label}>
          <span className="bar-head">
            <span className="bar-name">{b.label}</span>
            <span className="bar-value">{num(b.count)}</span>
          </span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${Math.max(2, Math.round((b.count / max) * 100))}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function DailyBars({ daily }: { daily: Stats['daily'] }): React.JSX.Element {
  if (daily.length === 0) return <p className="empty">近 14 日没有作答记录。</p>;
  const max = Math.max(1, ...daily.map((d) => d.attempts));
  return (
    <ul className="bars bars-spark">
      {daily.map((d) => (
        <li className="spark-row" key={d.day} title={`${d.day} · ${d.attempts} 份 · 均分 ${pct(d.avg_percent)}`}>
          <span className="spark-day">{d.day.slice(5)}</span>
          <span className="spark">
            <span className="spark-add" style={{ width: `${Math.max(4, Math.round((d.attempts / max) * 100))}%` }} />
            <span className="spark-cut" style={{ width: `${Math.round((d.passed / max) * 100)}%` }} />
          </span>
          <span className="spark-val">{d.attempts}</span>
        </li>
      ))}
    </ul>
  );
}

function SubjectTable({ subjects }: { subjects: Stats['subjects'] }): React.JSX.Element {
  if (subjects.length === 0) return <p className="empty">暂无科目汇总。</p>;
  return (
    <table className="table mini">
      <thead>
        <tr>
          <th scope="col">科目</th>
          <th scope="col" className="num">
            作答
          </th>
          <th scope="col" className="num">
            通过
          </th>
          <th scope="col" className="num">
            均分率
          </th>
        </tr>
      </thead>
      <tbody>
        {subjects.map((s) => (
          <tr key={s.subject}>
            <td>{s.subject}</td>
            <td className="num mono">{num(s.attempts)}</td>
            <td className="num mono">{num(s.passed)}</td>
            <td className="num mono">{pct(s.avg_percent)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HardestList({ items }: { items: ItemStat[] }): React.JSX.Element {
  if (items.length === 0) return <p className="empty">暂无难度样本（单题需累计 ≥15 次作答）。</p>;
  return (
    <ol className="hardest">
      {items.map((i) => (
        <li key={i.code}>
          <span className="hardest-stem">{i.stem}</span>
          <span className="hardest-meta">
            {TYPE_LABEL[i.type] ?? i.type} · 正确率 {pct(i.accuracy_pct, 0)} · {num(i.answered)} 次作答
            {i.revealed ? '' : ' · 分布待收卷'}
          </span>
        </li>
      ))}
    </ol>
  );
}

const ROSTER_COLS: readonly { key: string; sort: string; label: string }[] = [
  { key: 'rank_no', sort: 'rank', label: '名次' },
  { key: 'candidate', sort: 'candidate', label: '考生' },
  { key: 'score', sort: 'score', label: '得分' },
  { key: 'status', sort: 'status', label: '状态' },
  { key: 'elapsed', sort: 'elapsed', label: '用时' },
];

function RosterFilters({
  value,
  pages,
  onChange,
}: {
  value: RosterFilter;
  pages: number;
  onChange: (next: { next: Partial<RosterFilter>; resetPage: boolean }) => void;
}): React.JSX.Element {
  return (
    <div className="filters">
      <label className="field">
        <span className="field-label">判分状态</span>
        <select className="input" value={value.status} onChange={(e) => onChange({ next: { status: e.target.value }, resetPage: true })}>
          <option value="">全部</option>
          {(['ongoing', 'graded', 'invalid'] as const).map((s) => (
            <option key={s} value={s}>
              {ATTEMPT_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">渠道</span>
        <select className="input" value={value.channel} onChange={(e) => onChange({ next: { channel: e.target.value }, resetPage: true })}>
          <option value="">全部</option>
          {(['web', 'campus', 'partner'] as const).map((c) => (
            <option key={c} value={c}>
              {CHANNEL_LABEL[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">是否达线</span>
        <select className="input" value={value.passed} onChange={(e) => onChange({ next: { passed: e.target.value }, resetPage: true })}>
          <option value="">全部</option>
          <option value="yes">达线</option>
          <option value="no">未达线</option>
        </select>
      </label>
      <label className="field">
        <span className="field-label">每页</span>
        <select
          className="input"
          value={String(value.page_size)}
          onChange={(e) => onChange({ next: { page_size: Number(e.target.value) }, resetPage: true })}
        >
          {[8, 20, 50].map((n) => (
            <option key={n} value={String(n)}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <Pager page={value.page} pages={pages} onPage={(p) => onChange({ next: { page: p }, resetPage: false })} />
    </div>
  );
}

function RosterTable({
  rows,
  loading,
  sort,
  dir,
  selected,
  onSort,
  onPick,
}: {
  rows: AttemptRow[];
  loading: boolean;
  sort: string;
  dir: 'asc' | 'desc';
  selected: string;
  onSort: (sort: string) => void;
  onPick: (no: string) => void;
}): React.JSX.Element {
  if (rows.length === 0 && !loading) return <p className="empty">该场次在当前筛选下没有作答。</p>;
  return (
    <div className="tablewrap">
      <table className="table" data-loading={loading ? 'true' : 'false'}>
        <caption className="caption">名次由后端在已判分集合内按「得分率降序、用时升序」实时计算，未交卷与作废卷不参与排名</caption>
        <thead>
          <tr>
            {ROSTER_COLS.map((c) => (
              <th key={c.key} scope="col" className="num">
                <button type="button" className="sortbtn" data-on={sort === c.sort ? 'true' : 'false'} onClick={() => onSort(c.sort)}>
                  <span>{c.label}</span>
                  <span className="sortmark" aria-hidden="true">
                    {sort === c.sort ? (dir === 'asc' ? '▲' : '▼') : '·'}
                  </span>
                </button>
              </th>
            ))}
            <th scope="col">作答编号</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.attempt_no}
              data-active={r.attempt_no === selected ? 'true' : 'false'}
              tabIndex={0}
              onClick={() => onPick(r.attempt_no)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onPick(r.attempt_no);
              }}
            >
              <td className="num mono">{r.rank_no === 0 ? '—' : r.rank_no}</td>
              <td>
                <span className="cell-strong">{r.candidate_name}</span>
                <span className="cell-sub">
                  {r.masked_phone} · {CHANNEL_LABEL[r.channel] ?? r.channel}
                </span>
              </td>
              <td className="num mono">
                {r.status === 'ongoing' ? '—' : `${r.score}/${r.total_score}`}
                {r.status === 'graded' ? <span className="mini">{pct(r.percent, 0)}</span> : null}
              </td>
              <td>
                <span
                  className="badge"
                  data-tone={r.status === 'graded' ? (r.passed ? 'ok' : 'warn') : r.status === 'ongoing' ? 'mute' : 'bad'}
                >
                  {ATTEMPT_STATUS_LABEL[r.status]}
                </span>
                {r.reason ? <span className="mini">{r.reason}</span> : null}
              </td>
              <td className="num mono">{clock(r.elapsed_sec)}</td>
              <td className="mono">{r.attempt_no}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReceiptPanel({ state }: { state: { data: Receipt | null; loading: boolean } }): React.JSX.Element | null {
  const r = state.data;
  if (r === null) return <p className="empty">{state.loading ? '正在读取成绩条…' : '在名单中选择一份作答查看成绩条。'}</p>;
  const { attempt, items } = r;
  const awardedSum = items.reduce((acc, i) => acc + i.awarded, 0);
  return (
    <div className="receipt">
      <div className="score-hero" data-tone={attempt.status === 'graded' ? (attempt.passed ? 'ok' : 'warn') : 'mute'}>
        <p className="score-num">
          {attempt.status === 'ongoing' ? '—' : attempt.score}
          <span className="score-total">/{attempt.total_score}</span>
        </p>
        <p className="score-meta">
          {attempt.candidate_name} · {attempt.masked_phone} · 名次 {attempt.rank_no === 0 ? '未计入' : `第 ${attempt.rank_no}`}
        </p>
        <p className="score-msg">
          {attempt.status === 'graded'
            ? attempt.passed
              ? `已过线（线 ${attempt.pass_score} 分）`
              : `距通过线 ${Math.max(0, attempt.pass_score - attempt.score)} 分`
            : attempt.status === 'invalid'
              ? '整卷作废，不记成绩'
              : '尚未交卷'}
          {attempt.reason ? ` · ${attempt.reason}` : ''}
        </p>
      </div>
      <p className="receipt-check">
        逐题合计 {awardedSum} 分 / 卷面 {attempt.score} 分；机械分 {attempt.mechanical_score} + 漏选半分 {attempt.half_credit} ={' '}
        {attempt.mechanical_score + attempt.half_credit}；用时 {clock(attempt.elapsed_sec)}；交卷于 {dateTime(attempt.submitted_at)}
      </p>
      <table className="table mini receipt-table">
        <thead>
          <tr>
            <th scope="col">题号</th>
            <th scope="col">作答</th>
            <th scope="col">判定</th>
            <th scope="col" className="num">
              得分
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.code}>
              <td className="mono">
                {String(i.order_no).padStart(2, '0')} {TYPE_LABEL[i.type] ?? i.type}
              </td>
              <td className="cell-stem">{pickedText(i.type, i.picked)}</td>
              <td>
                <span className="badge" data-tone={i.correct ? 'ok' : i.awarded > 0 ? 'warn' : 'bad'}>
                  {i.correct ? '全对' : i.awarded > 0 ? '漏选半分' : i.picked === '' ? '未作答' : '错误'}
                </span>
              </td>
              <td className="num mono">
                {i.awarded}/{i.max_score}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClosePaperCard({
  current,
  token,
  onDone,
}: {
  current: AssessmentRow | null;
  token: string;
  onDone: () => void;
}): React.JSX.Element | null {
  const act = useAction();
  if (current === null) return null;
  return (
    <div className="side-form">
      <div className="section-head">
        <h2 className="section-title">收卷并公布分布</h2>
        <span className="section-note">open → closed，写接口需 Bearer 令牌</span>
      </div>
      <button
        type="button"
        className="btn"
        disabled={current.status !== 'open' || act.busy}
        onClick={() =>
          act.run(async () => {
            await api.setStatus(token, current.code, 'closed');
            onDone();
          })
        }
      >
        {act.busy ? '提交中…' : `锁定 ${current.code}`}
      </button>
      {current.status !== 'open' ? <p className="hint">当前场次不是「进行中」，状态机不再允许收卷。</p> : null}
      <ResultLine act={act} />
    </div>
  );
}

function ResultLine({
  act,
}: {
  act: { message: string | null; kind: 'ok' | 'err' | null; lastError: ApiError | null };
}): React.JSX.Element | null {
  if (act.message === null) return null;
  const fields = act.lastError?.fields ?? {};
  const keys = Object.keys(fields);
  return (
    <p className="form-msg" data-kind={act.kind ?? 'idle'}>
      {act.message}
      {keys.length === 0 ? null : (
        <ul className="field-errors">
          {keys.map((k) => (
            <li key={k}>
              <span className="field-name">{k}</span>
              {fields[k] ?? ''}
            </li>
          ))}
        </ul>
      )}
    </p>
  );
}

function StatusForm({
  token,
  current,
  onDone,
}: {
  token: string;
  current: AssessmentRow | null;
  onDone: () => void;
}): React.JSX.Element {
  const act = useAction();
  const [to, setTo] = useState('open');
  return (
    <form
      className="panel-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (current === null) return;
        act.run(async () => {
          await api.setStatus(token, current.code, to);
          onDone();
        });
      }}
    >
      <h3 className="form-title">试卷状态机</h3>
      <p className="form-note">draft → open → closed；closed 为终态，非法跳转返回 409 invalid_transition。</p>
      <label className="field">
        <span className="field-label">目标状态</span>
        <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="open">发布开考</option>
          <option value="closed">收卷封存</option>
        </select>
      </label>
      <p className="form-note">当前场次：{current === null ? '未选择' : `${current.code}（${ASMT_STATUS_LABEL[current.status]}）`}</p>
      {act.lastError?.code === 'unauthorized' || act.lastError?.code === 'forbidden' ? (
        <p className="hint">请在右上角填入正确的管理令牌。</p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={act.busy || current === null || token === ''}>
        {act.busy ? '提交中…' : '执行状态迁移'}
      </button>
      <ResultLine act={act} />
    </form>
  );
}

const CHANNELS: readonly string[] = ['web', 'campus', 'partner'];

function ExamPanel({
  token,
  openPapers,
  onDone,
}: {
  token: string;
  openPapers: AssessmentRow[];
  onDone: () => void;
}): React.JSX.Element {
  const [pick, setPick] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [channel, setChannel] = useState('web');
  const [exam, setExam] = useState<StartOut | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<SubmitOut | null>(null);
  const start = useAction();
  const submit = useAction();

  useEffect(() => {
    if (openPapers.length === 0) {
      if (pick !== '') setPick('');
      return;
    }
    if (openPapers.some((p) => p.code === pick)) return;
    setPick(openPapers[0]?.code ?? '');
  }, [openPapers, pick]);

  const questions: QuestionView[] = exam?.questions ?? [];
  const answered = questions.filter((q) => (answers[q.code] ?? '').trim() !== '').length;

  return (
    <form
      className="panel-form exam-panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (exam === null) {
          start.run(async () => {
            const out = await api.startAttempt(token, pick, { name: name.trim(), phone, channel });
            setExam(out);
            setAnswers({});
            setResult(null);
            onDone();
          });
          return;
        }
        submit.run(async () => {
          const out = await api.submit(
            token,
            exam.attempt.attempt_no,
            { answers: questions.map((q) => ({ question_code: q.code, picked: answers[q.code] ?? '' })) },
          );
          setResult(out);
          onDone();
        });
      }}
    >
      <h3 className="form-title">模拟考生作答</h3>
      <p className="form-note">
        开考取卷 → 逐题作答 → 交卷判分，与种子数据共用后端同一判分引擎；超时未交卷会被置为作废（超出限时 + 120 秒宽限）。
      </p>

      {exam === null ? (
        <>
          <label className="field field-wide">
            <span className="field-label">场次（仅进行中的试卷可考）</span>
            <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
              {openPapers.length === 0 ? <option value="">当前没有进行中的试卷</option> : null}
              {openPapers.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.code} · {p.title}（{p.duration_min} 分钟 / 满分 {p.total_score}）
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">姓名</span>
              <input className="input" value={name} maxLength={32} placeholder="1-32 个字符" onChange={(e) => setName(e.target.value)} />
              {start.lastError?.fields.name ? <span className="err">{start.lastError.fields.name}</span> : null}
            </label>
            <label className="field">
              <span className="field-label">手机号</span>
              <input
                className="input"
                value={phone}
                maxLength={11}
                inputMode="numeric"
                placeholder="11 位、1 开头"
                onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ''))}
              />
              {start.lastError?.fields.phone ? <span className="err">{start.lastError.fields.phone}</span> : null}
            </label>
            <label className="field">
              <span className="field-label">渠道</span>
              <select className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {CHANNEL_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="hint">
            同场同手机号只允许一份有效作答（重复开考返回 409 already_started）；接口只回显脱敏号，原文不出后端边界。
          </p>
          {start.lastError?.code === 'unauthorized' || start.lastError?.code === 'forbidden' ? (
            <p className="hint">请在右上角填入正确的管理令牌。</p>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={start.busy || pick === '' || token === ''}>
            {start.busy ? '开考中…' : '开考并取卷'}
          </button>
          <ResultLine act={start} />
        </>
      ) : (
        <>
          <p className="exam-head">
            <span className="mono">{exam.attempt.attempt_no}</span>
            <span>
              {exam.attempt.candidate_name} · {exam.attempt.masked_phone}
            </span>
            <span>
              {questions.length} 题 / {exam.total_score} 分 · 已答 {answered} 题
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setExam(null);
                setAnswers({});
                setResult(null);
                start.clear();
                submit.clear();
              }}
            >
              放弃本次作答
            </button>
          </p>
          <ol className="paper-list exam-list">
            {questions.map((q) => (
              <QuestionCard
                key={q.code}
                q={q}
                value={answers[q.code] ?? ''}
                onChange={(v) => setAnswers((prev) => ({ ...prev, [q.code]: v }))}
              />
            ))}
          </ol>
          <button type="submit" className="btn btn-primary" disabled={submit.busy || answered === 0}>
            {submit.busy ? '判分中…' : '交卷'}
          </button>
          <ResultLine act={submit} />
          {result === null ? null : <ExamResult out={result} />}
        </>
      )}
    </form>
  );
}

function QuestionCard({ q, value, onChange }: { q: QuestionView; value: string; onChange: (v: string) => void }): React.JSX.Element {
  const options = q.options ?? [];
  const setMulti = (ch: string, on: boolean): void => {
    const rest = value.split('').filter((c) => c !== ch);
    onChange(on ? [...rest, ch].sort().join('') : rest.join(''));
  };
  return (
    <li className="question" data-type={q.type}>
      <p className="q-head">
        <span className="q-no">{String(q.order_no).padStart(2, '0')}</span>
        <span className="badge">{TYPE_LABEL[q.type] ?? q.type}</span>
        <span className="q-score">
          {q.score} 分{q.type === 'multi' ? ' · 漏选得半分' : ''}
        </span>
      </p>
      <p className="q-stem">{q.stem}</p>
      {q.type === 'blank' ? (
        <input
          className="input"
          value={value}
          maxLength={64}
          placeholder="填写关键词，判分忽略大小写与空格"
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div className="q-opts">
          {(q.type === 'judge' ? ['正确', '错误'] : options).map((text, i) => {
            const ch = q.type === 'judge' ? (i === 0 ? 'T' : 'F') : letter(i);
            const checked = q.type === 'multi' ? value.includes(ch) : value === ch;
            return (
              <label className="opt" key={`${q.code}-${ch}`} data-on={checked ? 'true' : 'false'}>
                <input
                  type={q.type === 'multi' ? 'checkbox' : 'radio'}
                  name={q.code}
                  checked={checked}
                  onChange={() => {
                    if (q.type === 'multi') setMulti(ch, !checked);
                    else onChange(ch);
                  }}
                />
                <span className="opt-key">{q.type === 'judge' ? text : ch}</span>
                <span className="opt-text">{q.type === 'judge' ? (i === 0 ? '该说法正确' : '该说法错误') : text}</span>
              </label>
            );
          })}
        </div>
      )}
    </li>
  );
}

function ExamResult({ out }: { out: SubmitOut }): React.JSX.Element {
  const a = out.attempt;
  return (
    <div className="exam-result" data-tone={a.status === 'graded' ? (a.passed ? 'ok' : 'warn') : 'bad'}>
      <p className="exam-result-msg">{out.message}</p>
      <p className="exam-result-meta">
        得分 {a.score}/{a.total_score}（{pct(a.percent, 0)}）· 名次 {a.rank_no === 0 ? '未计入' : a.rank_no} · 用时{' '}
        {clock(a.elapsed_sec)} · 通过线 {a.pass_score} 分 · {a.candidate_name} {a.masked_phone}
      </p>
      <ul className="exam-result-list">
        {out.items.map((i) => (
          <li key={i.code}>
            <span className="mono">{String(i.order_no).padStart(2, '0')}</span>
            <span>{pickedText(i.type, i.picked)}</span>
            <span className="badge" data-tone={i.correct ? 'ok' : i.awarded > 0 ? 'warn' : 'bad'}>
              {i.awarded}/{i.max_score}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
