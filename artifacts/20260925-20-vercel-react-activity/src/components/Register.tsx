import { useRef, useState } from 'react';
import type { Boot } from '../lib/api';
import type { Summary } from '../lib/types';
import { getTransport, isApiError } from '../lib/api';
import { useResource } from '../lib/hooks';
import { readPrefs, writePrefs } from '../lib/storage';
import { EVENT } from '../lib/content';

/* 正则提到模块级，别在按键回调里每次重建（js-hoist-regexp） */
const PHONE_RE = /^1[3-9]\d{9}$/;
const NAME_RE = /^[\p{L}\p{M}\s·•-]{2,20}$/u;

type TierId = (typeof EVENT.tiers)[number]['id'];

interface VipLeft {
  left: number | null;
  loading: boolean;
  error: string;
}

export function RegisterSkeleton() {
  return (
    <section className="section register" data-testid="register-skeleton" aria-busy="true">
      <h2>报名</h2>
      <div className="sk-rows">
        <i className="sk-row" />
        <i className="sk-row" />
        <i className="sk-row" />
      </div>
    </section>
  );
}

export default function Register({ boot }: { boot: Boot }) {
  const summary = useResource(boot.summary);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [qty, setQty] = useState(2);
  /* 惰性初始化 + 持久化回填（rerender-lazy-state-init） */
  const [tier, setTier] = useState<TierId>(() => {
    const saved = readPrefs().tier;
    return (EVENT.tiers.find((t) => t.id === saved) ?? EVENT.tiers[0]).id;
  });
  const [vip, setVip] = useState<VipLeft>({ left: null, loading: false, error: '' });
  const [formError, setFormError] = useState('');
  const [done, setDone] = useState<{ id: string; amount: number } | null>(null);
  const lockRef = useRef(false); // 提交锁走 ref，不引起重渲染（rerender-use-ref-transient-values）

  const unit = EVENT.tiers.find((t) => t.id === tier) ?? EVENT.tiers[0];
  const total = unit.price * qty;

  /* async-defer-await：VIP 前区库存只有选中 VIP 档才需要——
     放进事件处理器里按分支发起，而不是挂载即查。 */
  function pickTier(next: TierId) {
    setTier(next);
    writePrefs({ tier: next });
    if (next !== 'vip') {
      setVip({ left: null, loading: false, error: '' });
      return;
    }
    setVip({ left: null, loading: true, error: '' });
    getTransport()
      .get<{ left: number }>('/api/tickets/vip')
      .then((v) => setVip({ left: v.left, loading: false, error: '' }))
      .catch(() => setVip({ left: null, loading: false, error: '前区库存查询失败，可稍后再试' }));
  }

  function submit() {
    if (lockRef.current) return;
    if (!NAME_RE.test(name.trim())) {
      setFormError('请填写 2-20 位真实姓名（报名表将用于入场核验）');
      return;
    }
    if (!PHONE_RE.test(phone)) {
      setFormError('手机号格式不正确：需 11 位、1 开头');
      return;
    }
    setFormError('');
    lockRef.current = true;
    const snapshot: Summary = { ...summary };
    /* 乐观更新：立即把票从余量挪到「已报名」，失败再回滚 */
    boot.summary.patch((prev) => ({ ...prev, signedCount: prev.signedCount + qty, ticketsLeft: Math.max(0, prev.ticketsLeft - qty) }));
    getTransport()
      .post<{ ok: true; registrationId: string; signedCount: number; ticketsLeft: number }>('/api/register', { name: name.trim(), phone, qty, tier })
      .then((ok) => {
        boot.summary.settle({ ...snapshot, signedCount: ok.signedCount, ticketsLeft: ok.ticketsLeft });
        setDone({ id: ok.registrationId, amount: total });
      })
      .catch((e: unknown) => {
        boot.summary.settle(snapshot); // 回滚到提交前的服务端口径
        setFormError(isApiError(e) ? e.message : '网络异常，报名未提交');
      })
      .finally(() => {
        lockRef.current = false;
      });
  }

  return (
    <section className="section register" id="register" data-testid="register">
      <div className="sec-head">
        <h2>报名 · 占一张江边的票</h2>
        <p className="sec-note">
          实时余票 <b data-remain-slot>{summary.ticketsLeft.toLocaleString('zh-CN')}</b> 张 · 已报名{' '}
          <b data-signed-slot>{summary.signedCount.toLocaleString('zh-CN')}</b>
        </p>
      </div>
      {done !== null ? (
        <div className="done-card" data-testid="done-card">
          <h3>报名成功</h3>
          <p>
            受理号 <code>{done.id}</code>，应付 <b>¥{done.amount.toLocaleString('zh-CN')}</b>。轮渡票与手环将在开幕前 3 日短信发放。
          </p>
          <button type="button" onClick={() => setDone(null)}>
            再报一单
          </button>
        </div>
      ) : (
        <div className="reg-grid">
          <div className="tiers" role="radiogroup" aria-label="票档">
            {EVENT.tiers.map((t) => (
              <button
                type="button"
                key={t.id}
                role="radio"
                aria-checked={tier === t.id}
                className={'tier' + (tier === t.id ? ' active' : '')}
                data-tier={t.id}
                onClick={() => pickTier(t.id)}
              >
                <b>{t.name}</b>
                <span className="tier-price">¥{t.price}</span>
                <span className="tier-note">{t.note}</span>
                {t.id === 'vip' && tier === 'vip' ? (
                  <span className="vip-left" data-testid="vip-left">
                    {vip.loading ? '查询前区库存…' : vip.error !== '' ? vip.error : vip.left === null ? '' : '前区余 ' + vip.left + ' 席'}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="fields">
            <label className="field">
              <span>姓名</span>
              <input value={name} data-field="name" onChange={(e) => setName(e.target.value)} placeholder="证件同名" />
            </label>
            <label className="field">
              <span>手机号</span>
              <input value={phone} data-field="phone" inputMode="numeric" onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, ''))} placeholder="11 位，用于登船核验" />
            </label>
            <label className="field">
              <span>张数（每单 1-4）</span>
              <input type="range" min={1} max={4} value={qty} data-field="qty" onChange={(e) => setQty(Math.min(4, Math.max(1, Number(e.target.value) || 1)))} />
            </label>
            <p className="total" data-testid="total">
              合计 ¥{total.toLocaleString('zh-CN')}
            </p>
            <p className={'form-error' + (formError === '' ? ' visually-hidden' : '')} aria-live="polite" data-testid="form-error">
              {formError}
            </p>
            <button type="button" className="btn primary submit" data-testid="submit" onClick={submit}>
              提交报名 · ¥{total.toLocaleString('zh-CN')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
