import { memo } from 'react';
import type { AddOnId, Currency, Period, Tier, TierId } from '../lib/pricing';
import { CANOPY_MIN_SEATS, formatMoney, monthlyFor } from '../lib/pricing';

/* 每张卡都要画一遍的图形提到组件外：静态 JSX 不该在每次渲染时重建（rendering-hoist-jsx）。 */
const TICK = (
  <span className="tick" aria-hidden="true">
    +
  </span>
);

export interface TierCardProps {
  readonly tier: Tier;
  readonly selected: boolean;
  readonly seats: number;
  readonly currency: Currency;
  readonly period: Period;
  readonly addOns: readonly AddOnId[];
  readonly onSelect: (id: TierId) => void;
}

function TierCardBase({ tier, selected, seats, currency, period, addOns, onSelect }: TierCardProps) {
  const clamped = tier.id === 'seed' && seats > tier.seats.max ? tier.seats.max : seats;
  const monthly = monthlyFor(tier.id, clamped, addOns, period, currency);
  const billed = tier.id === 'canopy' && clamped < CANOPY_MIN_SEATS ? CANOPY_MIN_SEATS : clamped;
  const perSeat = billed === 0 || monthly === 0 ? 0 : Math.round((monthly * 10) / billed) / 10;
  const discount = period === 'annual' ? tier.annualDiscount : 0;

  return (
    <button
      type="button"
      className="tier"
      data-hue={tier.id}
      data-tier={tier.id}
      data-selected-label="已选"
      aria-pressed={selected}
      onClick={() => onSelect(tier.id)}
    >
      <span className="tier-top">
        <span className="tier-name">{tier.name}</span>
        <span className="tier-latin">{tier.latin}</span>
      </span>
      <span className="tier-price" data-price={tier.id}>
        {monthly === 0 ? formatMoney(currency, 0) : formatMoney(currency, monthly)}
        <span className="tier-unit" data-unit={tier.id}>
          {monthly === 0 ? '/ 永久免费' : '/ 月'}
          {discount > 0 ? ' · 年付省 ' + Math.round(discount * 100) + '%' : ''}
        </span>
      </span>
      <span className="tier-sub">{tier.tagline}</span>
      <ul className="tier-list">
        {tier.highlights.map((item) => (
          <li key={item}>
            {TICK}
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <span className="tier-foot" data-foot={tier.id}>
        {tier.id === 'seed'
          ? '3 席以内，随时升级'
          : billed + ' 席 · 每席约 ' + formatMoney(currency, perSeat) + ' · 一年 ' + formatMoney(currency, monthly * 12)}
      </span>
    </button>
  );
}

/** 席位/周期/币种/模块变化才需要重算；勾选别的卡不会让它重渲染（rerender-memo）。 */
export const TierCard = memo(TierCardBase);
