import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { addDays, daysToText, int, mmdd, nightCount, pct, rating, stayText, yuan, yuanShort } from './format';
import { initialTheme, persistTheme, Swatch, THEMES, themeCss } from './themes';
import { useAction, useAsync } from './useAsync';
import {
  BOOKING_SORTS,
  CHANNEL_LABEL,
  HORIZON_LABEL,
  KIND_LABEL,
  ROOM_SORTS,
  STATUS_LABEL,
  type CalDay,
  type PropertyRow,
  type RoomRow,
  type SortDir,
} from './types';

const TOKEN_KEY = 'biz-site-admin-token';
const DAY_WINDOWS = [14, 21, 28, 45];

interface RoomCalendar {
  room: RoomRow;
  days: CalDay[];
}

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
      // 存不下就算了，令牌仍然在当前内存里可用。
    }
  }, [token]);

  // ---------- 看板参数 ----------
  const [property, setProperty] = useState<string>('');
  const [days, setDays] = useState<number>(28);
  const [horizon, setHorizon] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [q, setQ] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [bookingSort, setBookingSort] = useState<string>('check_in');
  const [bookingDir, setBookingDir] = useState<SortDir>('asc');
  const [roomSort, setRoomSort] = useState<string>('property');
  const [roomDir, setRoomDir] = useState<SortDir>('asc');
  const [selectedBooking, setSelectedBooking] = useState<string>('');
  const [selectedCell, setSelectedCell] = useState<{ room: string; date: string } | null>(null);

  // ---------- 试算与下单表单 ----------
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [formRoom, setFormRoom] = useState<string>('');
  const [checkIn, setCheckIn] = useState<string>(addDays(today, 3));
  const [checkOut, setCheckOut] = useState<string>(addDays(today, 5));
  const [units, setUnits] = useState<number>(1);
  const [guests, setGuests] = useState<number>(2);
  const [guestName, setGuestName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [channel, setChannel] = useState<string>('direct');
  const [note, setNote] = useState<string>('');
  const [closureLabel, setClosureLabel] = useState<string>('顶棚检修');

  const write = useAction();

  // ---------- 读接口 ----------
  const stats = useAsync(() => api.stats({ from: today, days }), [today, days]);

  const props = useAsync(() => api.properties({ from: today, days }), [today, days]);

  const rooms = useAsync(() => api.rooms({ property, sort: roomSort, dir: roomDir, page_size: 100 }), [
    property,
    roomSort,
    roomDir,
  ]);

  const calendar = useAsync(
    async (): Promise<RoomCalendar[]> => {
      const list = await api.rooms({ property, status: 'active', sort: roomSort, dir: roomDir, page_size: 100 });
      const cells = await Promise.all(
        list.items.map((r) => api.roomDetail(r.code, { from: today, days }).then((d) => d.calendar)),
      );
      return list.items.map((r, i) => ({ room: r, days: cells[i] ?? [] }));
    },
    [property, roomSort, roomDir, today, days],
  );

  const bookings = useAsync(
    () =>
      api.bookings({
        property,
        horizon,
        status,
        q,
        sort: bookingSort,
        dir: bookingDir,
        page,
        page_size: 20,
      }),
    [property, horizon, status, q, bookingSort, bookingDir, page],
  );

  const detail = useAsync(
    () => (selectedBooking === '' ? Promise.resolve(null) : api.bookingDetail(selectedBooking)),
    [selectedBooking],
  );

  const quote = useAsync(
    () => (formRoom === '' ? Promise.resolve(null) : api.quote(formRoom, { check_in: checkIn, check_out: checkOut, units, guests })),
    [formRoom, checkIn, checkOut, units, guests],
  );

  const roomList = rooms.data?.items ?? [];
  const propList = props.data?.items ?? [];

  useEffect(() => {
    if (formRoom !== '' || roomList.length === 0) return;
    const first = roomList.find((r) => r.status === 'active');
    if (first !== undefined) setFormRoom(first.code);
  }, [formRoom, roomList]);

  const reloadAll = useCallback(() => {
    stats.reload();
    props.reload();
    rooms.reload();
    calendar.reload();
    bookings.reload();
    detail.reload();
    quote.reload();
  }, [stats, props, rooms, calendar, bookings, detail, quote]);

  // ---------- 写接口 ----------
  const needToken = token.trim() === '';

  function submitBooking(): void {
    if (formRoom === '') return;
    write.run(async () => {
      const out = await api.book(token, formRoom, { check_in: checkIn, check_out: checkOut, units, guests, guest_name: guestName, phone, channel, note }, '');
      setSelectedBooking(out.booking.code);
      return out.message;
    });
    window.setTimeout(reloadAll, 350);
  }

  function advance(to: string): void {
    if (selectedBooking === '') return;
    write.run(async () => {
      const out = await api.setStatus(token, selectedBooking, to, '看板操作', '');
      return out.message;
    });
    window.setTimeout(reloadAll, 350);
  }

  function toggleClosure(closed: boolean): void {
    if (selectedCell === null) return;
    write.run(async () => {
      const out = await api.toggleClosure(token, selectedCell.room, { date: selectedCell.date, closed, label: closureLabel });
      return out.message;
    });
    window.setTimeout(reloadAll, 350);
  }

  function toggleRoomStatus(to: string): void {
    if (selectedCell === null) return;
    write.run(async () => {
      const out = await api.setRoomStatus(token, selectedCell.room, to);
      return out.message;
    });
    window.setTimeout(reloadAll, 350);
  }

  const s = stats.data;
  const fromDate = s?.forward.from ?? today;
  const dates = useMemo(() => Array.from({ length: days }, (_, i) => addDays(fromDate, i)), [fromDate, days]);
  const selectedRoomRow = roomList.find((r) => r.code === selectedCell?.room);
  const quoteOut = quote.data?.quote;
  const detailRow = detail.data?.booking;

  return (
    <div className="shell">
      <style>{themeCss(theme)}</style>

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Swatch theme={theme} />
          </span>
          <span className="brand-name">山宿云房 · 房态日历台</span>
          <span className="brand-sub">
            {s === null ? '正在读取' : `${s.today} ${s.weekday}`} · {propList.length} 家门店 · {int(rooms.data?.total)} 个房型 · 窗口 {days} 天
          </span>
        </div>
        <div className="themes" role="group" aria-label="界面风格">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className="theme-btn"
              aria-pressed={t.id === theme}
              title={t.mood}
              onClick={() => setTheme(t.id)}
            >
              <Swatch theme={t.id} />
              {t.label}
            </button>
          ))}
        </div>
        <div className="tokenbox">
          <label className="field-label" htmlFor="admin-token">
            管理令牌 ADMIN_TOKEN
          </label>
          <input
            id="admin-token"
            className="input"
            type="password"
            placeholder="下单与停售需要"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
        </div>
      </header>

      {stats.error !== null && (
        <div className="banner" role="alert">
          <span className="banner-tag">数据通道</span>
          {stats.error}
          <span className="hint">（{stats.errorCode ?? '—'}）</span>
          <button type="button" className="btn" onClick={stats.reload}>
            重试
          </button>
        </div>
      )}

      {s !== null && (
        <section className="kpis" aria-label="今日经营面板">
          <div className="kpi">
            <span className="kpi-label">今日到店</span>
            <span className="kpi-value">{int(s.ops.arrivals)}</span>
            <span className="kpi-hint">份 · 待入住 {int(s.ops.pending)} 份 / {int(s.ops.pending_units)} 间</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">今日在住</span>
            <span className="kpi-value">{int(s.ops.in_house)}</span>
            <span className="kpi-hint">{int(s.ops.in_house_units)} 间 · 今日退房 {int(s.ops.departures)} 份</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">历史入住率</span>
            <span className="kpi-value">{pct(s.performance.occ_bps)}</span>
            <span className="kpi-hint">近 {int(s.history.days)} 天 · {int(s.performance.room_nights_sold)} 间夜</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">ADR 平均房价</span>
            <span className="kpi-value">{yuan(s.performance.adr_cents)}</span>
            <span className="kpi-hint">RevPAR {yuan(s.performance.revpar_cents)}</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">实收净额</span>
            <span className="kpi-value">{yuan(s.money.net_cents)}</span>
            <span className="kpi-hint">成交 {yuanShort(s.money.gmv_cents)} · 退款 {yuanShort(s.money.refund_cents)}</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">未来可售均值</span>
            <span className="kpi-value">{int(s.ops.sellable_units_avg)}</span>
            <span className="kpi-hint">间/天 · 已占 {int(s.ops.held_room_nights_next)} 间夜</span>
          </div>
        </section>
      )}

      <main className="layout">
        <div className="col-main">
          <section className="panel">
            <div className="section-head">
              <h2 className="section-title">房态日历</h2>
              <span className="section-note">
                一格 = 一个房型的一晚；数字是当晚成交价，条是占用率。点格子可停售/恢复。
              </span>
            </div>
            <div className="filters">
              <label className="field">
                <span className="field-label">门店</span>
                <select className="input" value={property} onChange={(e) => { setProperty(e.target.value); setPage(1); setSelectedCell(null); }}>
                  <option value="">全部门店</option>
                  {propList.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}（{p.region}）
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">窗口</span>
                <select className="input" value={String(days)} onChange={(e) => setDays(Number(e.target.value) || 28)}>
                  {DAY_WINDOWS.map((d) => (
                    <option key={d} value={String(d)}>
                      {d} 天
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">房型排序</span>
                <select className="input" value={roomSort} onChange={(e) => setRoomSort(e.target.value)}>
                  {ROOM_SORTS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn" onClick={() => setRoomDir(roomDir === 'asc' ? 'desc' : 'asc')}>
                {roomDir === 'asc' ? '升序 ↑' : '降序 ↓'}
              </button>
              {calendar.loading && <span className="hint">日历加载中…</span>}
            </div>

            <div className="cal-legend" aria-label="日历图例">
              {Object.entries(KIND_LABEL).map(([k, label]) => (
                <span key={k} className="legend-item" data-kind={k}>
                  <span className="legend-dot" aria-hidden="true" />
                  {label}
                </span>
              ))}
              <span className="legend-item" data-kind="full">
                <span className="legend-dot" aria-hidden="true" />
                满房
              </span>
            </div>

            {calendar.error !== null ? (
              <div className="empty">日历读不到：{calendar.error}</div>
            ) : (
              <div className="cal" role="table" aria-label="房型房态日历">
                <div className="cal-head" role="row">
                  <span className="cal-name" role="columnheader">
                    房型 / 日期
                  </span>
                  {dates.map((d) => (
                    <span key={d} className="cal-date" role="columnheader">
                      <span className="cal-num">{mmdd(d)}</span>
                      <span className="cal-week">{weekdayOf(d)}</span>
                    </span>
                  ))}
                </div>
                {calendar.data?.map((row) => (
                  <div key={row.room.code} className="cal-row" role="row">
                    <span className="cal-name" role="rowheader">
                      <span className="cell-strong">{row.room.name}</span>
                      <span className="cal-sub">
                        {row.room.code} · {row.room.units} 间 · {yuanShort(row.room.base_price_cents)} 起
                      </span>
                    </span>
                    {row.days.map((c) => (
                      <button
                        key={c.date}
                        type="button"
                        className="cal-cell"
                        role="cell"
                        data-kind={c.closed ? 'closed' : c.kind}
                        data-full={c.available === 0 && !c.closed ? 'yes' : 'no'}
                        data-sel={selectedCell?.room === row.room.code && selectedCell?.date === c.date ? 'yes' : 'no'}
                        title={`${row.room.name} ${c.date} ${c.weekday}｜${KIND_LABEL[c.kind] ?? c.kind}${c.label === undefined ? '' : '·' + c.label}｜占用 ${c.occupied}/${c.units}`}
                        onClick={() => setSelectedCell({ room: row.room.code, date: c.date })}
                      >
                        <span className="cal-price">{c.closed ? '停售' : yuanShort(c.price_cents).replace('¥', '')}</span>
                        <span className="cal-bar" aria-hidden="true">
                          <span className="cal-fill" style={{ width: `${Math.min(100, c.fill_bps / 100)}%` }} />
                        </span>
                        <span className="cal-avail">{c.closed ? '—' : `${c.available}/${c.units}`}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {selectedCell !== null && (
              <div className="facts">
                <span className="fact">
                  选中：<b>{selectedCell.room}</b> · {selectedCell.date}
                </span>
                {selectedRoomRow !== undefined && (
                  <span className="fact">
                    库存 {selectedRoomRow.units} 间 · 基准 {yuan(selectedRoomRow.base_price_cents)} · 周末 +{selectedRoomRow.weekend_pct}%
                  </span>
                )}
                <label className="field">
                  <span className="field-label">停售原因</span>
                  <input className="input" value={closureLabel} maxLength={20} onChange={(e) => setClosureLabel(e.target.value)} />
                </label>
                <button type="button" className="btn" disabled={needToken || write.busy} onClick={() => toggleClosure(true)}>
                  设为停售
                </button>
                <button type="button" className="btn" disabled={needToken || write.busy} onClick={() => toggleClosure(false)}>
                  恢复售卖
                </button>
                <button type="button" className="btn" disabled={needToken || write.busy} onClick={() => toggleRoomStatus('inactive')}>
                  房型下架
                </button>
                <button type="button" className="btn" disabled={needToken || write.busy} onClick={() => toggleRoomStatus('active')}>
                  房型上架
                </button>
                {needToken && <span className="hint">写接口需要管理令牌</span>}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="section-head">
              <h2 className="section-title">未来 {int(s?.forward.days)} 天负载</h2>
              <span className="section-note">条形=已售间夜占比；停售房型数标在右下。</span>
            </div>
            <div className="bars">
              {(s?.load ?? []).map((row) => (
                <div key={row.date} className="bar-row">
                  <div className="bar-head">
                    <span className="bar-name">
                      {mmdd(row.date)} {row.weekday}
                      {row.weekend && <span className="stamp">周末</span>}
                    </span>
                    <span className="bar-value">{pct(row.fill_bps, 0)}</span>
                  </div>
                  <div className="bar-track">
                    <span className="bar-fill" style={{ width: `${Math.min(100, row.fill_bps / 100)}%` }} />
                  </div>
                  <div className="bar-foot">
                    <span>
                      {int(row.held_units)}/{int(row.capacity_units)} 间 · 空 {int(row.free_units)}
                    </span>
                    <span>{yuanShort(row.revenue_cents)}</span>
                    {row.closed_rooms > 0 && <span>停售 {int(row.closed_rooms)} 房型</span>}
                  </div>
                </div>
              ))}
              {s === null && <div className="empty">等待后端数据…</div>}
            </div>
          </section>

          <section className="panel">
            <div className="section-head">
              <h2 className="section-title">订单台账</h2>
              <span className="section-note">共 {int(bookings.data?.total)} 份 · 手机号仅显示掩码</span>
            </div>
            <div className="filters">
              <label className="field">
                <span className="field-label">时间视角</span>
                <select className="input" value={horizon} onChange={(e) => { setHorizon(e.target.value); setPage(1); }}>
                  {Object.entries(HORIZON_LABEL).map(([k, label]) => (
                    <option key={k || 'all'} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">状态</span>
                <select className="input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
                  <option value="">全部状态</option>
                  {Object.entries(STATUS_LABEL).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field field-wide">
                <span className="field-label">搜索客人 / 订单号</span>
                <input
                  className="input"
                  value={search}
                  placeholder="回车查询"
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setQ(search);
                      setPage(1);
                    }
                  }}
                />
              </label>
              <button type="button" className="btn" onClick={() => { setQ(search); setPage(1); }}>
                查询
              </button>
              {(q !== '' || status !== '' || horizon !== '') && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setQ('');
                    setSearch('');
                    setStatus('');
                    setHorizon('');
                    setPage(1);
                  }}
                >
                  清空
                </button>
              )}
            </div>
            <div className="tablewrap">
              <table className="table">
                <thead>
                  <tr>
                    {['code', 'room', 'guest', 'check_in', 'check_out', 'nights', 'total', 'refund', 'status', 'channel'].map((k) => (
                      <th key={k}>
                        {BOOKING_SORTS.includes(k) ? (
                          <button
                            type="button"
                            className="sortbtn"
                            onClick={() => {
                              if (bookingSort === k) {
                                setBookingDir(bookingDir === 'asc' ? 'desc' : 'asc');
                              } else {
                                setBookingSort(k);
                                setBookingDir('asc');
                              }
                            }}
                          >
                            {SORT_TH_LABEL[k] ?? k}
                            {bookingSort === k && <span className="sortmark">{bookingDir === 'asc' ? '↑' : '↓'}</span>}
                          </button>
                        ) : (
                          SORT_TH_LABEL[k] ?? k
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(bookings.data?.items ?? []).map((b) => (
                    <tr
                      key={b.code}
                      data-sel={b.code === selectedBooking ? 'yes' : 'no'}
                      onClick={() => setSelectedBooking(b.code)}
                    >
                      <td className="mono">{b.code}</td>
                      <td>
                        <span className="cell-strong">{b.room_name}</span>
                        <span className="cell-sub">{b.property_name}</span>
                      </td>
                      <td>
                        <span className="cell-strong">{b.guest_name}</span>
                        <span className="cell-sub mono">{b.masked_phone}</span>
                      </td>
                      <td className="mono">{b.check_in}</td>
                      <td className="mono">{b.check_out}</td>
                      <td className="num">{int(b.nights)}</td>
                      <td className="num">{yuan(b.total_cents)}</td>
                      <td className="num">{b.refund_cents > 0 ? yuan(b.refund_cents) : '—'}</td>
                      <td>
                        <span className="badge" data-status={b.status}>
                          {STATUS_LABEL[b.status] ?? b.status}
                        </span>
                      </td>
                      <td>{CHANNEL_LABEL[b.channel] ?? b.channel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {bookings.loading && <div className="empty">加载中…</div>}
              {!bookings.loading && (bookings.data?.items.length ?? 0) === 0 && (
                <div className="empty">没有符合条件的订单。换个时间视角或清空筛选。</div>
              )}
            </div>
            <div className="pager">
              <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>
                上一页
              </button>
              <span className="pager-now">
                第 {int(bookings.data?.page)} / {int(Math.ceil((bookings.data?.total ?? 0) / 20) || 1)} 页
              </span>
              <button
                type="button"
                className="btn"
                disabled={(bookings.data?.items.length ?? 0) < 20}
                onClick={() => setPage((n) => n + 1)}
              >
                下一页
              </button>
            </div>
          </section>

          {selectedBooking !== '' && (
            <section className="panel detail">
              <div className="section-head">
                <h2 className="section-title">订单 {selectedBooking}</h2>
                <span className="section-note">
                  {detail.error ?? '逐夜金额与订单房费小计必须相等'}
                </span>
              </div>
              {detailRow !== undefined && detailRow !== null && (
                <div className="detail-main">
                  <div className="facts">
                    <span className="fact">
                      房型 <b>{detailRow.room_name}</b>（{detailRow.room_code}）
                    </span>
                    <span className="fact">
                      {detailRow.check_in} → {detailRow.check_out} · {stayText(detailRow.nights)} · {int(detailRow.units)} 间 · {int(detailRow.guests)} 人
                    </span>
                    <span className="fact">{daysToText(detailRow.days_to_check_in)}</span>
                    <span className="fact">
                      房费 {yuan(detailRow.night_subtotal_cents)} + 清洁 {yuan(detailRow.clean_fee_cents)} ={' '}
                      <b>{yuan(detailRow.total_cents)}</b>
                    </span>
                    <span className="fact">
                      实收 {yuan(detailRow.paid_cents)} · 退款 {yuan(detailRow.refund_cents)}
                    </span>
                    <span className="fact">
                      {STATUS_LABEL[detailRow.status] ?? detailRow.status} ·{' '}
                      {detailRow.holds_room ? '占房' : '不占房'} / {detailRow.counts_revenue ? '计营收' : '不计营收'}
                    </span>
                    {detailRow.note !== undefined && detailRow.note !== '' && (
                      <span className="fact">备注：{detailRow.note}</span>
                    )}
                  </div>
                  <table className="table mini">
                    <thead>
                      <tr>
                        <th>入住晚</th>
                        <th>属性</th>
                        <th>门市价</th>
                        <th>成交单价</th>
                        <th>间数</th>
                        <th>金额</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.data?.nights ?? []).map((n) => (
                        <tr key={n.date}>
                          <td className="mono">
                            {n.date} {n.weekday}
                          </td>
                          <td>
                            <span className="badge" data-kind={n.kind}>
                              {KIND_LABEL[n.kind] ?? n.kind}
                            </span>
                            {n.label !== undefined && <span className="cell-sub">{n.label}</span>}
                          </td>
                          <td className="num">{yuan(n.base_cents)}</td>
                          <td className="num">{yuan(n.price_cents)}</td>
                          <td className="num">{int(n.units)}</td>
                          <td className="num">{yuan(n.amount_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="form-row">
                    {(detailRow.next_statuses ?? []).map((to) => (
                      <button key={to} type="button" className="btn btn-primary" disabled={needToken || write.busy} onClick={() => advance(to)}>
                        推进到「{STATUS_LABEL[to] ?? to}」
                      </button>
                    ))}
                    {(detailRow.next_statuses.length ?? 0) === 0 && <span className="hint">该订单已是终态。</span>}
                    <button type="button" className="btn" onClick={() => setSelectedBooking('')}>
                      关闭详情
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="col-side">
          <section className="panel panel-form">
            <h2 className="form-title">试算与下单</h2>
            <label className="field field-wide">
              <span className="field-label">房型</span>
              <select className="input" value={formRoom} onChange={(e) => setFormRoom(e.target.value)}>
                <option value="">请选择</option>
                {roomList.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.property_name} / {r.name}（{r.units} 间）
                  </option>
                ))}
              </select>
            </label>
            <div className="form-row">
              <label className="field">
                <span className="field-label">入住</span>
                <input className="input" type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">离店</span>
                <input className="input" type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
              </label>
            </div>
            <div className="form-row">
              <label className="field">
                <span className="field-label">间数</span>
                <input className="input" type="number" min={1} max={8} value={units} onChange={(e) => setUnits(Number(e.target.value) || 1)} />
              </label>
              <label className="field">
                <span className="field-label">人数</span>
                <input className="input" type="number" min={1} max={20} value={guests} onChange={(e) => setGuests(Number(e.target.value) || 1)} />
              </label>
            </div>
            <div className="form-row">
              <label className="field">
                <span className="field-label">客人姓名</span>
                <input className="input" value={guestName} maxLength={20} onChange={(e) => setGuestName(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">手机号</span>
                <input className="input" value={phone} maxLength={11} inputMode="numeric" placeholder="11 位" onChange={(e) => setPhone(e.target.value)} />
              </label>
            </div>
            <div className="form-row">
              <label className="field">
                <span className="field-label">渠道</span>
                <select className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
                  {Object.entries(CHANNEL_LABEL).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">备注</span>
                <input className="input" value={note} maxLength={60} onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>
            <p className="form-note">
              区间 {checkIn} → {checkOut} 共 {int(nightCount(checkIn, checkOut))} 晚；离店日不计夜。
            </p>

            {quote.error !== null && <div className="err">{quote.error}</div>}
            {quoteOut !== undefined && (
              <div className="detail-side">
                <div className="facts">
                  <span className="fact">
                    房费 {yuan(quoteOut.night_subtotal_cents)} + 清洁 {yuan(quoteOut.clean_fee_cents)} ={' '}
                    <b>{yuan(quoteOut.total_cents)}</b>
                  </span>
                  <span className="fact">
                    均价 {yuan(quoteOut.avg_night_cents)} / 间夜 · 周末 {int(quoteOut.weekend_nights)} 晚 · 节假日 {int(quoteOut.holiday_nights)} 晚
                  </span>
                  <span className="fact">连住门槛 {int(quoteOut.min_stay)} 晚 · 最少住 {int(quoteOut.nights)} 晚</span>
                </div>
                {quoteOut.ok ? (
                  <table className="table mini">
                    <tbody>
                      {quoteOut.nights_detail.map((n) => (
                        <tr key={n.date}>
                          <td className="mono">
                            {mmdd(n.date)} {n.weekday}
                          </td>
                          <td>
                            <span className="badge" data-kind={n.kind}>
                              {KIND_LABEL[n.kind] ?? n.kind}
                            </span>
                          </td>
                          <td className="num">{yuan(n.price_cents)}</td>
                          <td className="num">{yuan(n.amount_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <ul className="err">
                    {quoteOut.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="form-row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={needToken || write.busy || quoteOut === undefined || !quoteOut.ok}
                onClick={submitBooking}
              >
                {write.busy ? '提交中…' : '生成订单'}
              </button>
              <button type="button" className="btn" onClick={quote.reload}>
                重新试算
              </button>
            </div>
            {needToken && <p className="hint">未填管理令牌：后端对所有写接口返回 401。</p>}
            {write.message !== null && (
              <p className="form-msg" data-kind={write.kind ?? 'ok'}>
                {write.message}
                {write.lastError !== null && <span className="caption">（字段：{Object.keys(write.lastError.fields).join('、') || '—'}）</span>}
              </p>
            )}
          </section>

          <section className="panel">
            <div className="section-head">
              <h2 className="section-title">恒等式体检</h2>
              <span className="section-note">后端每次统计都重算，前端只报结果。</span>
            </div>
            <div className="facts">
              <span className="fact" data-ok={String(s?.identity.subtotal_matches ?? false)}>
                Σ逐夜 = 房费小计：{s?.identity.subtotal_matches ? '成立' : '不成立'}（{yuan(s?.identity.night_sum_cents)}）
              </span>
              <span className="fact" data-ok={String(s?.identity.revpar_identity_ok ?? false)}>
                RevPAR ≈ ADR×OCC：漂移 {int(s?.identity.revpar_drift_cents)} 分
              </span>
              <span className="fact" data-ok={String(s?.identity.net_identity_ok ?? false)}>
                实收 = 成交 + 取消单 − 退款：缺口 {int(s?.identity.net_gap_cents)} 分
              </span>
              <span className="fact">
                价格构成：{(s?.kind_mix ?? []).map((k) => `${KIND_LABEL[k.kind] ?? k.kind} ${pct(k.share_bps, 0)}`).join(' / ')}
              </span>
            </div>
          </section>

          <section className="panel">
            <div className="section-head">
              <h2 className="section-title">渠道构成</h2>
              <span className="section-note">按已计营收的订单</span>
            </div>
            <div className="bars">
              {(s?.channels ?? []).map((c) => (
                <div key={c.channel} className="bar-row">
                  <div className="bar-head">
                    <span className="bar-name">{CHANNEL_LABEL[c.channel] ?? c.channel}</span>
                    <span className="bar-value">{pct(c.share_bps, 0)}</span>
                  </div>
                  <div className="bar-track">
                    <span className="bar-fill" style={{ width: `${Math.min(100, c.share_bps / 100)}%` }} />
                  </div>
                  <div className="bar-foot">
                    <span>{int(c.bookings)} 份 · {int(c.room_nights)} 间夜</span>
                    <span>{yuanShort(c.revenue_cents)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="section-head">
              <h2 className="section-title">门店组合</h2>
              <span className="section-note">未来 {int(s?.forward.days)} 天口径</span>
            </div>
            <table className="table mini">
              <thead>
                <tr>
                  <th>门店</th>
                  <th>间数</th>
                  <th>入住率</th>
                  <th>ADR</th>
                  <th>缓冲</th>
                </tr>
              </thead>
              <tbody>
                {propList.map((p: PropertyRow) => (
                  <tr key={p.code} data-sel={p.code === property ? 'yes' : 'no'} onClick={() => { setProperty(p.code); setPage(1); }}>
                    <td>
                      <span className="cell-strong">{p.name}</span>
                      <span className="cell-sub">
                        {p.region} · {rating(p.rating)} 分 · 连住 {p.min_stay_weekend} 晚
                      </span>
                    </td>
                    <td className="num">{int(p.unit_total)}</td>
                    <td className="num">{pct(p.occ_bps_window)}</td>
                    <td className="num">{yuan(p.adr_cents)}</td>
                    <td className="num">{int(p.clean_buffer_days)} 天</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {propList.length > 0 && (
              <button type="button" className="btn" onClick={() => { setProperty(''); setPage(1); }}>
                看全部门店
              </button>
            )}
          </section>

          <section className="panel">
            <div className="section-head">
              <h2 className="section-title">房型排行</h2>
              <span className="section-note">历史房晚 + 未来入住率</span>
            </div>
            <table className="table mini">
              <thead>
                <tr>
                  <th>房型</th>
                  <th>房晚</th>
                  <th>营收</th>
                  <th>ADR</th>
                  <th>未来</th>
                </tr>
              </thead>
              <tbody>
                {(s?.top_rooms ?? []).map((r) => (
                  <tr key={r.code}>
                    <td>
                      <span className="cell-strong">{r.name}</span>
                      <span className="cell-sub">{r.property_name}</span>
                    </td>
                    <td className="num">{int(r.room_nights)}</td>
                    <td className="num">{yuanShort(r.revenue_cents)}</td>
                    <td className="num">{yuan(r.adr_cents)}</td>
                    <td className="num">{pct(r.fill_bps_forward, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </aside>
      </main>

      <footer className="pagefoot">
        <span className="statusline">
          数据来自后端 seed 与实时判定接口 · 生成于 {s?.generated_at ?? '—'} · 统计窗口 {s?.history.from ?? '—'} → {s?.history.to ?? '—'}
        </span>
        <span className="footnote">
          同一份 DOM / 同一份 JS，切换上方三种风格只更换 CSS；写接口统一走 ADMIN_TOKEN 的 Bearer 校验。
        </span>
      </footer>
    </div>
  );
}

const SORT_TH_LABEL: Record<string, string> = {
  code: '订单号',
  room: '房型',
  guest: '客人',
  check_in: '入住',
  check_out: '离店',
  nights: '晚数',
  total: '总额',
  refund: '退款',
  status: '状态',
  channel: '渠道',
};

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function weekdayOf(date: string): string {
  const d = new Date(date + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return '';
  return WEEKDAY_CN[d.getUTCDay()] ?? '';
}
