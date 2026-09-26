import { ADDONS, CURRENCY, planOf } from '@/lib/facts';
import { RATE_USD, roundHalf } from '@/lib/format';
import type { AddonId, Billing, Currency, PlanId, PriceLine, PriceQuote, WizardValues } from '~types/index';

/**
 * Money. `quote()` builds the printable breakdown line by line; `quoteDirect()` recomputes
 * the same final amount from the raw scalars with a differently-shaped aggregation (one
 * closed form over two grouped sums). Group E runs both over every
 * plan × seat × 64 addon subsets × billing × currency combination and requires equality.
 *
 * The rounding stage is shared on purpose: 折扣按「分」为单位向上取整（half-up）。让两条路径
 * 各自发明取整方式是这类账单最容易差出一分钱的地方，所以它是契约的一部分，不是实现细节。
 */

type PricingValues = Pick<WizardValues, 'plan' | 'seats' | 'addons' | 'billing' | 'currency'>;

export const rateOf = (currency: Currency): number =>
  CURRENCY.find((c) => c.id === currency)?.perSeatRate ?? RATE_USD;

export const toCents = (yuan: number): number => Math.round(yuan * 100);
export const halfUpCents = (cents: number, pct: number): number => Math.floor(cents * pct + 0.5);

export function priceLines(values: PricingValues): PriceLine[] {
  const plan = planOf(values.plan);
  const lines: PriceLine[] = [];
  if (plan.platformFee > 0) {
    lines.push({ key: 'platform', label: `${plan.name} 平台服务费`, amount: plan.platformFee });
  }
  lines.push({
    key: 'seats',
    label: `席位 ${values.seats} × ¥${plan.perSeat}`,
    amount: values.seats * plan.perSeat,
  });
  for (const a of ADDONS) {
    if (!values.addons.includes(a.id)) continue;
    lines.push({
      key: `addon:${a.id}`,
      label: a.mode === 'seat' ? `${a.name} ${values.seats} × ¥${a.price}` : `${a.name}（按组织）`,
      amount: a.mode === 'seat' ? values.seats * a.price : a.price,
    });
  }
  return lines;
}

export function quote(values: PricingValues): PriceQuote {
  const plan = planOf(values.plan);
  const lines = priceLines(values);
  const subtotalC = lines.reduce((s, l) => s + toCents(l.amount), 0);
  const discountC = values.billing === 'annual' ? halfUpCents(subtotalC, plan.annualDiscount) : 0;
  const monthlyC = subtotalC - discountC;
  const periodC = values.billing === 'annual' ? monthlyC * 12 : monthlyC;
  const periodTotal = periodC / 100;
  const display = values.currency === 'CNY' ? periodTotal : roundHalf(periodTotal / rateOf(values.currency));
  return {
    lines,
    subtotal: subtotalC / 100,
    discount: -discountC / 100,
    monthly: monthlyC / 100,
    periodTotal,
    display,
    currency: values.currency,
    billing: values.billing,
    seats: values.seats,
    plan: values.plan,
  };
}

/** independent aggregation: group the addons once, then a single closed form */
export function quoteDirect(
  plan: PlanId,
  seats: number,
  addons: AddonId[],
  billing: Billing,
  currency: Currency,
): number {
  const p = planOf(plan);
  let seatCents = 0;
  let orgCents = 0;
  for (const id of addons) {
    const a = ADDONS.find((x) => x.id === id);
    if (a === undefined) continue;
    if (a.mode === 'seat') seatCents += toCents(a.price);
    else orgCents += toCents(a.price);
  }
  const subtotalC = toCents(p.platformFee) + seats * toCents(p.perSeat) + seatCents * seats + orgCents;
  const monthlyC = billing === 'annual' ? subtotalC - halfUpCents(subtotalC, p.annualDiscount) : subtotalC;
  const periodC = billing === 'annual' ? monthlyC * 12 : monthlyC;
  const periodTotal = periodC / 100;
  return currency === 'CNY' ? periodTotal : roundHalf(periodTotal / rateOf(currency));
}

/** clamp used when the plan changes — an out-of-range seat count would otherwise survive */
export function clampSeats(plan: PlanId, seats: number): number {
  const p = planOf(plan);
  const int = Number.isFinite(seats) ? Math.round(seats) : p.seatMin;
  return Math.min(p.seatMax, Math.max(p.seatMin, int));
}

export function annualSaving(values: PricingValues): number {
  const plan = planOf(values.plan);
  const subtotalC = priceLines(values).reduce((s, l) => s + toCents(l.amount), 0);
  const monthlyC = subtotalC - halfUpCents(subtotalC, plan.annualDiscount);
  return (subtotalC * 12 - monthlyC * 12) / 100;
}
