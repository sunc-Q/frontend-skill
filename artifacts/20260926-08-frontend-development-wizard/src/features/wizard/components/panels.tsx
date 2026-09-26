import React from 'react';
import { Button, LinearProgress } from '@mui/material';
import { STEPS, planOf, ADDONS } from '@/lib/facts';
import { money, percent } from '@/lib/format';
import { annualSaving, quote } from '../helpers/pricing';
import { FIELD_LABEL } from '../helpers/fields';
import type { IssueLite } from '../helpers/wizardSchema';
import type { PriceQuote, StepId, WizardValues } from '~types/index';

export const StepRail: React.FC<{
  current: StepId;
  validity: Partial<Record<StepId, boolean>>;
  reachable: Record<StepId, boolean>;
  onGo: (id: StepId) => void;
}> = ({ current, validity, reachable, onGo }) => {
  const doneCount = STEPS.filter((s) => validity[s.id] === true).length;
  return (
    <nav className="fd-rail" aria-label="开站步骤">
      {STEPS.map((s) => {
        const valid = validity[s.id] === true;
        const isCurrent = s.id === current;
        return (
          <button
            type="button"
            key={s.id}
            className="fd-rail-item"
            data-step={s.id}
            data-current={isCurrent ? '1' : '0'}
            data-done={valid ? '1' : '0'}
            data-bad={!valid && s.fields.length > 0 && reached(s, validity) ? '1' : '0'}
            data-reachable={reachable[s.id] ? '1' : '0'}
            onClick={() => onGo(s.id)}
          >
            <span className="fd-rail-no">
              STEP {s.no} / {STEPS.length}
            </span>
            <span className="fd-rail-title">{s.title}</span>
            <span className="fd-rail-hint">{s.hint}</span>
            <span className="fd-rail-state" data-rail-state={s.id}>
              {valid ? '已完成' : isCurrent ? '进行中' : `${s.fields.length} 项待填`}
            </span>
          </button>
        );
      })}
      <div className="fd-rail-progress" data-role="rail-progress">
        <LinearProgress variant="determinate" value={Math.round((doneCount / STEPS.length) * 100)} />
        <span className="fd-flag">
          {doneCount}/{STEPS.length} 步已通过
        </span>
      </div>
    </nav>
  );
};

const reached = (s: (typeof STEPS)[number], validity: Partial<Record<StepId, boolean>>): boolean =>
  validity[s.id] === false || s.fields.length === 0;

export const SummaryPanel: React.FC<{ values: WizardValues; q?: PriceQuote }> = ({ values, q }) => {
  const quote_ = q ?? quote(values);
  const plan = planOf(values.plan);
  return (
    <section className="fd-panel" aria-label="费用摘要" data-role="summary">
      <h2 className="fd-panel-title">费用摘要</h2>
      <p className="fd-panel-hint">
        {plan.name} · {values.seats} 席 · {values.billing === 'annual' ? '年付' : '月付'} ·{' '}
        <span data-role="quote-mode">{quote_.lines.length > 0 ? '分项现算' : '无明细'}</span>
      </p>
      <div className="fd-summary">
        {quote_.lines.map((l) => (
          <span className="fd-line" key={l.key} data-line={l.key}>
            <span>{l.label}</span>
            <span className="fd-line-amt" data-amount={l.key}>
              {money(l.amount, values.currency)}
            </span>
          </span>
        ))}
        <span className="fd-line" data-line="subtotal">
          <span>小计</span>
          <span className="fd-line-amt" data-amount="subtotal">
            {money(quote_.subtotal, values.currency)}
          </span>
        </span>
        {quote_.discount === 0 ? null : (
          <span className="fd-line" data-line="discount">
            <span>{plan.name} 年付折扣 {percent(plan.annualDiscount)}</span>
            <span className="fd-line-amt" data-amount="discount">
              {money(quote_.discount, values.currency)}
            </span>
          </span>
        )}
        <span className="fd-total">
          <span>{values.billing === 'annual' ? '本年应付' : '每月应付'}</span>
          <span className="fd-total-value" data-role="total">
            {money(quote_.display, values.currency)}
          </span>
        </span>
        {values.billing === 'annual' ? (
          <span className="fd-note" data-role="saving">
            比按月付省 {money(annualSaving(values), values.currency)}
          </span>
        ) : null}
      </div>
    </section>
  );
};

export const CompletenessPanel: React.FC<{
  issues: IssueLite[];
  blockers: { field: string; reason: string }[];
  values: WizardValues;
  onGo: (id: StepId) => void;
}> = ({ issues, blockers, onGo }) => {
  const rows = [
    ...issues.map((i) => ({ key: `schema:${i.path}`, label: FIELD_LABEL[i.path as keyof typeof FIELD_LABEL] ?? i.path, why: i.message, step: stepFor(i.path) })),
    ...blockers.map((b) => ({ key: `async:${b.field}`, label: FIELD_LABEL[b.field as keyof typeof FIELD_LABEL] ?? b.field, why: b.reason, step: stepFor(b.field) })),
  ];
  return (
    <section className="fd-panel" aria-label="完整性检查" data-role="completeness">
      <h2 className="fd-panel-title">还差什么</h2>
      <p className="fd-panel-hint" data-role="issue-count">
        {rows.length === 0 ? '全部通过，可以提交' : `${rows.length} 项未通过`}
      </p>
      <ul className="fd-checks">
        {rows.slice(0, 12).map((r) => (
          <li className="fd-check" key={r.key} data-pass="0" data-issue={r.key}>
            <button type="button" className="fd-flag" data-jump={r.step} onClick={() => onGo(r.step)}>
              跳至
            </button>
            <span>
              {r.label}：{r.why}
            </span>
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="fd-check" data-pass="1" data-issue="none">
            <span>店铺身份、方案容量、收款合规三项均已通过</span>
          </li>
        ) : null}
      </ul>
    </section>
  );
};

const stepFor = (path: string): StepId =>
  STEPS.find((s) => (s.fields as string[]).includes(path))?.id ?? 'identity';

export const DraftBar: React.FC<{
  draftText: string;
  isDirty: boolean;
  dirtyCount: number;
  onSave: () => void;
  onSample: () => void;
  onClear: () => void;
}> = ({ draftText, isDirty, dirtyCount, onSave, onSample, onClear }) => (
  <section className="fd-panel" aria-label="草稿" data-role="draft-bar">
    <p className="fd-panel-hint" data-role="draft-state">
      {draftText}
    </p>
    <span className="fd-flag" data-role="dirty-count">
      {isDirty ? `${dirtyCount} 个字段已修改` : '无未保存修改'}
    </span>
    <div className="fd-actions">
      <Button variant="outlined" onClick={onSave} data-action="save-draft">
        保存草稿
      </Button>
      <Button variant="text" onClick={onSample} data-action="load-sample">
        载入示例
      </Button>
      <Button variant="text" onClick={onClear} data-action="clear-draft">
        清空
      </Button>
    </div>
  </section>
);

export const AddonLegend: React.FC<{ values: WizardValues }> = ({ values }) => (
  <section className="fd-panel" aria-label="模块说明" data-role="addon-legend">
    <h2 className="fd-panel-title">模块计价</h2>
    <ul className="fd-checks">
      {ADDONS.map((a) => (
        <li className="fd-check" key={a.id} data-pass={values.addons.includes(a.id) ? '1' : '0'}>
          <span>
            {a.name}：{a.mode === 'seat' ? `¥${a.price} × 席位` : `¥${a.price} / 月`}
            {a.requires ? `（需 ${a.requires}）` : ''}
            {a.note ? ` — ${a.note}` : ''}
          </span>
        </li>
      ))}
    </ul>
  </section>
);
