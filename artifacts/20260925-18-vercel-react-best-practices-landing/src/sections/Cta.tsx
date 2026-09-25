import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { PLANS, PLATFORMS } from '../lib/content';
import { loadDraft, saveDraft } from '../lib/storage';
import { Icon, cn } from '../components/ui';

/* js-hoist-regexp: 正则提到模块级，避免每次校验都重新编译 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Status = 'idle' | 'sending' | 'done';

export function Cta({ onToast }: { onToast: (m: string) => void }) {
  /* client-localstorage-schema + js-cache-storage: 读一次并缓存，不在渲染里反复访问 localStorage */
  const [draft, setDraft] = useState(loadDraft);
  const [saved, setSaved] = useState(draft);
  const restored = useRef(draft.email !== '' || draft.plan !== 'solo');
  const [status, setStatus] = useState<Status>('idle');

  /* rerender-simple-expression-in-memo: 单个正则测试是廉价表达式，不值得 memo */
  const emailOk = EMAIL_RE.test(draft.email);
  const changed =
    draft.plan !== saved.plan || draft.platform !== saved.platform || draft.email !== saved.email;

  const patch = (p: Partial<typeof draft>) => {
    setDraft((cur) => ({
      v: 1,
      plan: p.plan ?? cur.plan,
      platform: p.platform ?? cur.platform,
      email: p.email ?? cur.email,
    }));
  };

  const persist = () => {
    const ok = saveDraft(draft);
    setSaved(draft);
    onToast(ok ? '选择已存进本机 localStorage。' : '本机存储不可用，选择只保留在这次页面里。');
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // js-early-exit: 校验不过直接返回，主流程不套三层 if
    if (!emailOk) {
      onToast(draft.email === '' ? '先填一个邮箱，试用链接要发给你。' : '这个邮箱格式看起来不对。');
      return;
    }
    setStatus('sending');
    window.setTimeout(() => {
      saveDraft(draft);
      setSaved(draft);
      setStatus('done');
      onToast('已记下你的选择（本地演示，没有发出任何网络请求）。');
    }, 420);
  };

  return (
    <section id="cta" className="section section--cta">
      <h2 className="section-title">选一个版本，先试用 14 天</h2>

      <div className="plans" data-plans>
        {PLANS.map((p) => (
          <label
            className={cn('plan', draft.plan === p.id && 'plan--on')}
            key={p.id}
            data-plan={p.id}
            data-selected={String(draft.plan === p.id)}
          >
            <input
              type="radio"
              name="plan"
              className="plan-radio"
              value={p.id}
              checked={draft.plan === p.id}
              onChange={() => patch({ plan: p.id })}
            />
            <span className="plan-name">{p.name}</span>
            {p.badge !== undefined ? <span className="plan-badge" data-badge>{p.badge}</span> : null}
            <span className="plan-price">
              <span className="plan-p">{p.price}</span>
              <span className="plan-u">{p.unit}</span>
            </span>
            <span className="plan-limit">{p.limit}</span>
            <ul className="plan-lines">
              {p.lines.map((l) => (
                <li key={l}>
                  <Icon name="check" size={13} />
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          </label>
        ))}
      </div>

      <form className="cta-form" data-form onSubmit={submit} noValidate>
        <fieldset className="platforms" data-platforms>
          <legend>运行环境</legend>
          {PLATFORMS.map((pl) => (
            <label className={cn('platform', draft.platform === pl.id && 'platform--on')} key={pl.id} data-platform={pl.id}>
              <input
                type="radio"
                name="platform"
                value={pl.id}
                checked={draft.platform === pl.id}
                onChange={() => patch({ platform: pl.id })}
              />
              <span>{pl.name}</span>
            </label>
          ))}
        </fieldset>

        <div className="field">
          <label className="field-label" htmlFor="sg-email">
            邮箱
          </label>
          <input
            id="sg-email"
            className={cn('field-i', draft.email !== '' && !emailOk && 'field-i--bad')}
            data-email
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={draft.email}
            onChange={(e) => patch({ email: e.target.value })}
          />
          <span className="field-hint" data-email-ok={String(emailOk)}>
            {emailOk ? '可以用于接收试用链接' : '试用链接只发一次，不订阅任何邮件列表'}
          </span>
        </div>

        <div className="cta-actions">
          <button type="submit" className="btn btn--primary" data-submit disabled={status === 'sending'}>
            {status === 'sending' ? '正在记录…' : status === 'done' ? '已记录' : '获取试用链接'}
          </button>
          <button type="button" className="btn btn--ghost" data-persist onClick={persist}>
            仅保存选择
          </button>
          <span className="cta-flags">
            <span data-restored={String(restored.current)}>
              {restored.current ? '已恢复上次选择' : '首次访问'}
            </span>
            <span data-dirty={String(changed)}>{changed ? '有未保存的改动' : '与已存一致'}</span>
          </span>
        </div>
      </form>
    </section>
  );
}

export function Footer({ themeName, themeNote }: { themeName: string; themeNote: string }) {
  return (
    <footer className="foot" data-foot>
      <p className="foot-theme">
        当前风格：<span data-theme-name>{themeName}</span> · <span data-theme-note>{themeNote}</span>
      </p>
      <p className="foot-fine">
        三个页面的 JavaScript 完全相同（同一份 bundle），差别只有 <code>&lt;style&gt;</code> 里的两套 CSS。
        拾光是虚构产品，数据由固定种子生成。
      </p>
    </footer>
  );
}
