import { useState } from 'react';
import { DEFAULT_SETTINGS, loadSettings, persistSettings } from '../storage';
import type { Settings } from '../storage';
import { cn } from '../types';

// rendering-conditional-render: 条件渲染一律用三元，避免 && 短路渲染异常值
export function SettingsSection({ onToast }: { onToast: (m: string) => void }) {
  const [form, setForm] = useState<Settings>(() => loadSettings());
  // rerender-lazy-state-init: 初始快照惰性生成，只作为 dirty 参照
  const [snapshot, setSnapshot] = useState<Settings>(() => ({ ...form }));
  const [errors, setErrors] = useState<Partial<Record<keyof Settings, string>>>({});
  const dirty = JSON.stringify(form) !== JSON.stringify(snapshot);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    // rerender-functional-setstate
    setForm((cur) => ({ ...cur, [k]: v }));
  };

  const submit = () => {
    const next: Partial<Record<keyof Settings, string>> = {};
    if (form.serviceName.trim() === '') next.serviceName = '服务名称不能为空';
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(form.defaultDomain)) next.defaultDomain = '请填写合法域名（小写字母、数字、点、横线）';
    if (!Number.isInteger(form.pageSize) || form.pageSize < 5 || form.pageSize > 50) next.pageSize = '每页条数须为 5–50 的整数';
    setErrors(next);
    if (Object.keys(next).length > 0) {
      onToast('表单有 ' + Object.keys(next).length + ' 处错误待修正');
      return;
    }
    const ok = persistSettings(form);
    setSnapshot({ ...form });
    onToast(ok ? '设置已保存' : '设置仅在本次会话生效（本地存储不可用）');
  };

  const reset = () => {
    setForm(DEFAULT_SETTINGS);
    setErrors({});
    onToast('已恢复默认值，未保存');
  };

  return (
    <div className="stack">
      <form
        className="panel form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <header className="panel-head">
          <h2>服务设置</h2>
          <span className="panel-sub">{dirty ? '有未保存修改' : '已与服务配置同步'}</span>
        </header>

        <label className={cn('field', errors.serviceName !== undefined && 'field--bad')}>
          <span>服务名称</span>
          <input value={form.serviceName} onChange={(e) => set('serviceName', e.target.value)} />
          {errors.serviceName !== undefined ? <em>{errors.serviceName}</em> : <em className="field-hint">显示在侧栏与邮件抬头</em>}
        </label>

        <label className={cn('field', errors.defaultDomain !== undefined && 'field--bad')}>
          <span>默认短链域名</span>
          <input value={form.defaultDomain} onChange={(e) => set('defaultDomain', e.target.value)} />
          {errors.defaultDomain !== undefined ? <em>{errors.defaultDomain}</em> : <em className="field-hint">新短链将使用该域名前缀</em>}
        </label>

        <label className={cn('field', errors.pageSize !== undefined && 'field--bad')}>
          <span>列表每页条数</span>
          <input
            type="number"
            min={5}
            max={50}
            value={String(form.pageSize)}
            onChange={(e) => set('pageSize', Number.parseInt(e.target.value, 10))}
          />
          {errors.pageSize !== undefined ? <em>{errors.pageSize}</em> : <em className="field-hint">5–50 之间的整数</em>}
        </label>

        <div className="switch-row">
          <label className="switch">
            <input type="checkbox" checked={form.weeklyDigest} onChange={(e) => set('weeklyDigest', e.target.checked)} />
            <span>每周一发送数据周报邮件</span>
          </label>
          <label className="switch">
            <input type="checkbox" checked={form.slowLinkAlert} onChange={(e) => set('slowLinkAlert', e.target.checked)} />
            <span>慢链路（&gt;800ms）触发告警</span>
          </label>
        </div>

        <footer className="form-foot">
          <button type="submit" className="btn btn--primary">保存设置</button>
          <button type="button" className="btn btn--ghost" onClick={reset}>恢复默认</button>
        </footer>
      </form>
    </div>
  );
}
