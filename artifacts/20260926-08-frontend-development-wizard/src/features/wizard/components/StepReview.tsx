import React, { Suspense, lazy, useState } from 'react';
import { Button } from '@mui/material';
import { OPTIONS, STEPS, planOf } from '@/lib/facts';
import { money } from '@/lib/format';
import { quote } from '../helpers/pricing';
import { FIELD_LABEL } from '../helpers/fields';
import type { IssueLite } from '../helpers/wizardSchema';
import type { StepId, WizardValues } from '~types/index';

/**
 * The review step is the one heavy-enough-to-split panel: it is mounted only when the user
 * arrives, and the printable receipt behind it is a second, deeper dynamic import, so the
 * evidence build has two real chunk boundaries to show for (group L).
 */
const ReceiptCard = lazy(() => import('./ReceiptCard'));

export interface ReviewProps {
  values: WizardValues;
  issues: IssueLite[];
  blockers: { field: string; reason: string }[];
  onGo: (id: StepId) => void;
  submitting: boolean;
  submitText: string;
  onSubmit: () => void;
  orderId: string | null;
}

const labelOfOption = (list: { value: string; label: string }[], value: string): string =>
  list.find((o) => o.value === value)?.label ?? value;

export function displayRow(values: WizardValues, key: keyof WizardValues): string {
  const raw = values[key];
  if (key === 'plan') return `${planOf(values.plan).name}（¥${planOf(values.plan).perSeat}/席）`;
  if (key === 'addons') return values.addons.length === 0 ? '未选' : values.addons.join('、');
  if (key === 'billing') return values.billing === 'annual' ? '按年结算' : '按月结算';
  if (key === 'currency') return values.currency;
  if (key === 'category') return labelOfOption(OPTIONS.category, values.category);
  if (key === 'timezone') return values.timezone;
  if (key === 'notify') return labelOfOption(OPTIONS.notify, values.notify);
  if (key === 'accountType') return values.accountType === 'personal' ? '个人收款' : '企业收款';
  if (key === 'invoiceType') return labelOfOption(OPTIONS.invoice, values.invoiceType);
  if (key === 'agree') return values.agree ? '已勾选' : '未勾选';
  if (key === 'seats') return String(values.seats);
  if (typeof raw === 'string') return raw === '' ? '（空）' : raw;
  return String(raw);
}

const ReviewStep: React.FC<ReviewProps> = ({ values, issues, blockers, onGo, submitting, submitText, onSubmit, orderId }) => {
  const [receipt, setReceipt] = useState(orderId !== null);
  const q = quote(values);
  const blocked = issues.length > 0 || blockers.length > 0;
  return (
    <section className="fd-panel" aria-label="预览与提交" data-role="review">
      <h2 className="fd-panel-title">预览与提交</h2>
      <p className="fd-panel-hint">
        提交前请核对；任何一项未通过都不会发出请求。修改请点「跳至」回到对应步骤。
      </p>
      <div className="fd-review" data-role="review-table">
        {STEPS.filter((s) => s.fields.length > 0).flatMap((s) =>
          s.fields.map((f) => (
            <React.Fragment key={f}>
              <span className="fd-review-k">{FIELD_LABEL[f]}</span>
              <span className="fd-review-v" data-review={f}>
                {displayRow(values, f)}
                <button type="button" className="fd-flag" data-jump-from-review={s.id} onClick={() => onGo(s.id)}>
                  改
                </button>
              </span>
            </React.Fragment>
          )),
        )}
      </div>
      <div className="fd-total">
        <span>应付合计</span>
        <span className="fd-total-value" data-role="review-total">
          {money(q.display, values.currency)}
        </span>
      </div>
      {blocked ? (
        <ul className="fd-checks" data-role="review-blockers">
          {[...issues.map((i) => `${FIELD_LABEL[i.path as keyof typeof FIELD_LABEL] ?? i.path}：${i.message}`),
            ...blockers.map((b) => `${FIELD_LABEL[b.field as keyof typeof FIELD_LABEL] ?? b.field}：${b.reason}`)].map((t) => (
            <li className="fd-check" key={t} data-pass="0">
              <span>{t}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="fd-actions">
        <Button
          variant="contained"
          onClick={() => {
            onSubmit();
            if (orderId === null) setReceipt(true);
          }}
          disabled={submitting || blocked}
          data-action="submit"
        >
          {submitting ? '提交中…' : `提交开通申请 · ${money(q.display, values.currency)}`}
        </Button>
        <span className="fd-note" data-role="submit-state">
          {blocked ? '仍有未通过项' : submitText}
        </span>
      </div>
      {orderId === null ? null : (
        <div className="fd-suspense-host" data-min-height="132" style={{ minHeight: 132 }}>
          <Suspense fallback={<span className="fd-empty" data-testid="receipt-fallback">正在生成回执…</span>}>
            <ReceiptCard orderId={orderId} values={values} shown={receipt} />
          </Suspense>
        </div>
      )}
    </section>
  );
};

export default ReviewStep;
