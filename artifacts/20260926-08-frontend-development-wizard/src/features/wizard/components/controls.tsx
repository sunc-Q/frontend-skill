import React from 'react';
import { FieldLeaf } from './FieldText';
import { fieldByName, leafPropsFor } from '../helpers/fields';
import type { FieldDescriptor } from '../helpers/fields';
import { ADDONS, PLANS, planOf } from '@/lib/facts';
import { money } from '@/lib/format';
import type { AddonId, Billing, PlanId, WizardValues } from '~types/index';

/** per-field status strings; passed down as primitives so the memo arm keeps its edge */
export interface FieldChips {
  asyncText?: string;
  dirtyText?: string;
  countText?: string;
}

export const FieldsGrid: React.FC<{
  names: readonly (keyof WizardValues)[];
  reveal: boolean;
  chips: Partial<Record<keyof WizardValues, FieldChips>>;
  /** when provided, these descriptors win over the static table (server-fed option lists) */
  descriptors?: readonly FieldDescriptor[];
}> = ({ names, reveal, chips, descriptors }) => (
  <div className="fd-fields" data-grid={names[0]}>
    {names.map((name) => {
      const d = descriptors?.find((x) => x.name === name) ?? fieldByName(name);
      if (d === undefined) return null;
      const c = chips[name] ?? {};
      return <FieldLeaf key={name} {...leafPropsFor(d)} reveal={reveal} asyncText={c.asyncText ?? ''} dirtyText={c.dirtyText ?? ''} countText={c.countText ?? ''} />;
    })}
  </div>
);

export const PlanCards: React.FC<{
  value: PlanId;
  seats: number;
  onSelect: (id: PlanId) => void;
}> = ({ value, seats, onSelect }) => (
  <div className="fd-choices" data-role="plan-cards">
    {PLANS.map((p) => {
      const selected = p.id === value;
      return (
        <button
          type="button"
          key={p.id}
          className="fd-choice"
          data-plan={p.id}
          data-selected={selected ? '1' : '0'}
          aria-pressed={selected}
          onClick={() => onSelect(p.id)}
        >
          <span className="fd-choice-name">
            {p.name} <span className="fd-brand-latin">{p.latin}</span>
          </span>
          <span className="fd-choice-price">
            ¥{p.perSeat}/席 · 月
            {p.platformFee > 0 ? <span className="fd-choice-note">＋平台费 ¥{p.platformFee}</span> : null}
          </span>
          <span className="fd-choice-note">
            {p.blurb}（席位 {p.seatMin}-{p.seatMax}，年付省 {Math.round(p.annualDiscount * 100)}%）
          </span>
          <span className="fd-choice-note">当前：{seats} 席 ≈ {money(seats * p.perSeat + p.platformFee)}</span>
        </button>
      );
    })}
  </div>
);

export const SeatsField: React.FC<{
  plan: PlanId;
  value: number;
  onCommit: (n: number) => void;
  dirtyText: string;
  errorText: string;
}> = ({ plan, value, onCommit, dirtyText, errorText }) => {
  const p = planOf(plan);
  return (
    <div className="fd-seats" data-field-id="seats">
      <input
        type="range"
        min={p.seatMin}
        max={p.seatMax}
        step={1}
        value={value}
        data-field="seatsRange"
        onChange={(e) => onCommit(Number(e.target.value))}
        aria-label="席位数滑杆"
      />
      <input
        className="fd-mono"
        type="number"
        min={p.seatMin}
        max={p.seatMax}
        value={value}
        data-field="seats"
        onChange={(e) => onCommit(Number(e.target.value))}
        aria-label="席位数"
        style={{ width: 96 }}
      />
      <span className="fd-chips">
        {errorText === '' ? null : (
          <span className="fd-chip" data-kind="error" data-error-for="seats">
            {errorText}
          </span>
        )}
        {dirtyText === '' ? null : (
          <span className="fd-chip" data-kind="dirty" data-dirty-for="seats">
            {dirtyText}
          </span>
        )}
        <span className="fd-help" data-help-for="seats">
          {p.name} 允许 {p.seatMin}-{p.seatMax} 席
        </span>
      </span>
    </div>
  );
};

export const AddonField: React.FC<{
  value: AddonId[];
  plan: PlanId;
  seats: number;
  onToggle: (id: AddonId, on: boolean) => void;
  errorText: string;
  dirtyText: string;
}> = ({ value, seats, onToggle, errorText, dirtyText }) => {
  const picked = new Set(value);
  return (
    <div className="fd-addons" data-role="addon-field">
      {ADDONS.map((a) => {
        const on = picked.has(a.id);
        return (
          <label className="fd-addon" key={a.id} data-addon={a.id} data-on={on ? '1' : '0'}>
            <input type="checkbox" data-field={`addon:${a.id}`} checked={on} onChange={(e) => onToggle(a.id, e.target.checked)} />
            <span>{a.name}</span>
            <span className="fd-addon-price">
              {a.mode === 'seat' ? `¥${a.price}/席` : `¥${a.price}/月`}
              {a.mode === 'seat' ? ` = ${money(seats * a.price)}` : ''}
            </span>
          </label>
        );
      })}
      <span className="fd-chips" data-chips="addons">
        {errorText === '' ? null : (
          <span className="fd-chip" data-kind="error" data-error-for="addons">
            {errorText}
          </span>
        )}
        {dirtyText === '' ? null : (
          <span className="fd-chip" data-kind="dirty" data-dirty-for="addons">
            {dirtyText}
          </span>
        )}
      </span>
    </div>
  );
};

export const BillingCards: React.FC<{
  value: Billing;
  savingText: string;
  onCommit: (b: Billing) => void;
}> = ({ value, savingText, onCommit }) => (
  <div className="fd-choices fd-choices-2" data-role="billing-cards">
    {(['monthly', 'annual'] as Billing[]).map((b) => (
      <button
        type="button"
        key={b}
        className="fd-choice"
        data-billing={b}
        data-selected={b === value ? '1' : '0'}
        aria-pressed={b === value}
        onClick={() => onCommit(b)}
      >
        <span className="fd-choice-name">{b === 'monthly' ? '按月结算' : '按年结算'}</span>
        <span className="fd-choice-note">{b === 'annual' ? savingText : '随时可切换，不影响已开票月份'}</span>
      </button>
    ))}
  </div>
);

export const AccountCards: React.FC<{
  value: WizardValues['accountType'];
  onCommit: (t: WizardValues['accountType']) => void;
}> = ({ value, onCommit }) => (
  <div className="fd-choices fd-choices-2" data-role="account-cards">
    {(['personal', 'enterprise'] as const).map((t) => (
      <button
        type="button"
        key={t}
        className="fd-choice"
        data-account={t}
        data-selected={t === value ? '1' : '0'}
        aria-pressed={t === value}
        onClick={() => onCommit(t)}
      >
        <span className="fd-choice-name">{t === 'personal' ? '个人收款' : '企业收款'}</span>
        <span className="fd-choice-note">{t === 'personal' ? '实名 + 证件后四位' : '企业名称 + 统一社会信用代码'}</span>
      </button>
    ))}
  </div>
);

export default FieldsGrid;
