/* 零框架「服务端」等价物：页面内 promise + 延迟表 + 请求日志。
   规则与 20:00 轮 server/mock-api.mjs 一致：
   - 姓名含「风控」→ 409 risk_hold（回滚）
   - 手机 000 开头 → 403 device_denied（回滚）
   - qty > ticketsLeft → 409 sold_out
   - 同一艺人二次投票 → 409 already_voted
   - VIP 前区 left = min(46, ticketsLeft)
   对照意义：React 轮用 node:http 真服务端做时序证据；本轮没有构建期也没有进程外服务，
   所以时序断言只能落在「同一页内的请求日志 + setTimeout 延迟档」上，证明强度低于上一轮（报告 §7 记录）。 */
const LATENCY = { summary: 40, lineup: 120, schedule: 90, notices: 320, vip: 260, register: 60, vote: 45 };

function createSvc() {
  const state = {
    summary: Object.assign({}, FIXTURE_SUMMARY),
    artists: FIXTURE_ARTISTS.map(function (a) { return Object.assign({}, a); }),
    voted: {},
    registrations: 0,
  };
  const reqLog = [];
  const t0 = Date.now();

  function log(path, dir) {
    reqLog.push({ path: path, dir: dir, at: Date.now() - t0 });
  }
  function later(ms, fn) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try { resolve(fn()); } catch (e) { reject(e); }
      }, ms);
    });
  }

  return {
    reqLog: reqLog,
    state: state,
    serverNow: function () { return FIXTURE_SUMMARY.serverNow + (Date.now() - t0); },

    /* 聚合入口：hero/schedule/lineup 一次拿齐，对应 React 轮 bootstrap() 的并行发起 */
    boot: function () {
      log('/api/boot', 'GET');
      return later(LATENCY.summary, function () {
        return {
          summary: Object.assign({}, state.summary),
          schedule: FIXTURE_SESSIONS.slice(),
          artists: state.artists.slice(),
        };
      });
    },
    vipLeft: function () {
      log('/api/tickets/vip', 'GET');
      return later(LATENCY.vip, function () {
        return { left: Math.min(46, state.summary.ticketsLeft) };
      });
    },
    notices: function () {
      log('/api/notices', 'GET');
      return later(LATENCY.notices, function () { return FIXTURE_NOTICES.slice(); });
    },
    register: function (payload) {
      log('/api/register', 'POST');
      return later(LATENCY.register, function () {
        if (payload.name.indexOf('风控') >= 0) throw svcError('risk_hold', '姓名触发实名风控，报名已回滚');
        if (payload.phone.indexOf('000') === 0) throw svcError('device_denied', '风控拦截：该手机号被暂时限制');
        if (payload.qty > state.summary.ticketsLeft) throw svcError('sold_out', '余票不足，剩 ' + state.summary.ticketsLeft + ' 张');
        state.registrations += 1;
        state.summary.signedCount += payload.qty;
        state.summary.ticketsLeft = Math.max(0, state.summary.ticketsLeft - payload.qty);
        return { ok: true, registrationId: 'R-' + String(1000 + state.registrations), signedCount: state.summary.signedCount, ticketsLeft: state.summary.ticketsLeft };
      });
    },
    vote: function (artistId) {
      log('/api/vote/' + artistId, 'POST');
      return later(LATENCY.vote, function () {
        if (state.voted[artistId]) throw svcError('already_voted', '每位乐迷每档只有一次投票机会');
        state.voted[artistId] = true;
        var hit = null;
        for (var i = 0; i < state.artists.length; i++) if (state.artists[i].id === artistId) hit = state.artists[i];
        if (!hit) throw svcError('not_found', '阵容中未找到该艺人');
        hit.votes += 1;
        return { id: artistId, votes: hit.votes };
      });
    },
  };

  function svcError(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }
}
