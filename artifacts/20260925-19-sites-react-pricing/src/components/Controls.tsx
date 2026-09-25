import type { AddOnId, Currency, Period, TierId } from '../lib/pricing';
import { CANOPY_MIN_SEATS, CANOPY_UNIT, convert, formatMoney, nextBracketAt, TIERS, tierOf } from '../lib/pricing';
import { TierCard } from './TierCard';

const PERIODS: readonly { id: Period; label: string }[] = [
  { id: 'monthly', label: '按月付' },
  { id: 'annual', label: '按年付' },
];

const CURRENCIES: readonly { id: Currency; label: string }[] = [
  { id: 'CNY', label: '人民币 ¥' },
  { id: 'USD', label: '美元 $' },
];

export interface ControlsProps {
  readonly seats: number;
  readonly period: Period;
  readonly currency: Currency;
  readonly addOns: readonly AddOnId[];
  readonly onSeats: (next: number) => void;
  readonly onPeriod: (next: Period) => void;
  readonly onCurrency: (next: Currency) => void;
  readonly onSelectTier: (next: TierId) => void;
  readonly tier: TierId;
}

export function Controls({ tier, seats, period, currency, addOns, onSeats, onPeriod, onCurrency, onSelectTier }: ControlsProps) {
  const config = tierOf(tier);
  const max = config.seats.max;
  const step = nextBracketAt(seats);

  return (
    <section className="estimator" id="estimator" aria-label="价格算价台">
      <div className="controls">
        <div className="control-row">
          <span className="control-label" id="period-label">
            付款周期
          </span>
          <div className="seg" role="group" aria-labelledby="period-label">
            {PERIODS.map((item) => (
              <button key={item.id} type="button" data-period={item.id} aria-pressed={period === item.id} onClick={() => onPeriod(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
          <span className="save-flag" data-flag="annual-save">
            {period === 'annual' ? '年付已按套餐折扣计算' : '年付可省最多 25%'}
          </span>
        </div>

        <div className="control-row">
          <span className="control-label" id="currency-label">
            结算币种
          </span>
          <div className="seg" role="group" aria-labelledby="currency-label">
            {CURRENCIES.map((item) => (
              <button
                key={item.id}
                type="button"
                data-currency={item.id}
                aria-pressed={currency === item.id}
                onClick={() => onCurrency(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <span className="save-flag" data-flag="fx">
            {currency === 'USD' ? '按 1 : 7.15 折算，取整到 0.5 美元' : '以人民币标价，取整到 1 元'}
          </span>
        </div>

        <div className="control-row">
          <span className="control-label" id="seats-label">
            团队席位
          </span>
          <div className="slider-wrap">
            <input
              type="range"
              min={1}
              max={max}
              step={1}
              value={seats}
              data-testid="seats"
              aria-labelledby="seats-label"
              aria-valuetext={seats + ' 席'}
              onChange={(event) => onSeats(Number(event.currentTarget.value))}
            />
            <div className="slider-meta">
              <span>1 席</span>
              <span data-testid="seats-out">
                <b className="seat-count">{seats}</b> / {max} 席
              </span>
              <span>{max} 席</span>
            </div>
          </div>
        </div>
        <p className="hero-note" data-testid="bracket-hint">
          {config.id === 'seed'
            ? '苗木档最多 3 席，要更多席位请先选林木。'
            : config.id === 'canopy'
              ? seats < CANOPY_MIN_SEATS
                ? '冠层档不足 ' + CANOPY_MIN_SEATS + ' 席时按 ' + CANOPY_MIN_SEATS + ' 席计费，已含 SSO 与审计日志。'
                : '冠层档每席 ' + formatMoney(currency, convert(currency, CANOPY_UNIT)) + ' / 月，已含 SSO 与审计日志。'
              : step === null
                ? '林木档已在最低阶梯：第 51 席起每席 ' + formatMoney(currency, convert(currency, 17)) + ' / 月。'
                : '林木档再加至 ' + step + ' 席进入下一阶梯单价，人均更便宜。'}
        </p>
      </div>

      <div className="tiers">
        {TIERS.map((item) => (
          <TierCard
            key={item.id}
            tier={item}
            selected={tier === item.id}
            seats={seats}
            currency={currency}
            period={period}
            addOns={addOns}
            onSelect={onSelectTier}
          />
        ))}
      </div>
    </section>
  );
}
