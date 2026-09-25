import type { AddOn, AddOnId, Currency, TierId } from '../lib/pricing';
import { ADD_ONS, convert, formatMoney, tierOf } from '../lib/pricing';

export interface AddOnsProps {
  readonly tier: TierId;
  readonly billedSeats: number;
  readonly currency: Currency;
  readonly picked: ReadonlySet<AddOnId>;
  readonly onToggle: (id: AddOnId) => void;
}

interface Bucket {
  readonly selectable: AddOn[];
  readonly included: AddOn[];
  readonly locked: AddOn[];
}

/** 三个分组一次遍历分完，而不是 filter 三趟（js-combine-iterations）。 */
function bucketize(tier: TierId): Bucket {
  const config = tierOf(tier);
  const included = new Set(config.includedAddOns); // js-set-map-lookups
  const allowed = new Set(config.allowedAddOns);
  const selectable: AddOn[] = [];
  const rest: AddOn[] = [];
  const locked: AddOn[] = [];
  for (const addOn of ADD_ONS) {
    if (allowed.has(addOn.id)) selectable.push(addOn);
    else if (included.has(addOn.id)) rest.push(addOn);
    else locked.push(addOn);
  }
  return { selectable, included: rest, locked };
}

export function AddOns({ tier, billedSeats, currency, picked, onToggle }: AddOnsProps) {
  const config = tierOf(tier);
  const { selectable, included, locked } = bucketize(tier);

  return (
    <div className="addons" data-testid="addons">
      <div className="addons-head">
        <span className="control-label" id="addon-label">
          增值模块
        </span>
        <span className="addon-note" data-testid="addon-summary">
          {selectable.length === 0
            ? '苗木档不含增值模块，升级林木后可选'
            : '本单已选 ' + picked.size + ' 项 · 折扣跟随「' + config.name + '」档'}
        </span>
      </div>
      {selectable.length === 0 ? (
        <p className="addon-empty" data-testid="addons-empty">
          这一档没有可加购项：附件存储、优先支持与高级 API 需要林木或冠层。
        </p>
      ) : (
        <div className="addon-grid">
          {selectable.map((addOn) => {
            const on = picked.has(addOn.id);

            return (
              <label key={addOn.id} className={'addon' + (on ? ' is-on' : '')} data-addon={addOn.id}>
                <input type="checkbox" checked={on} onChange={() => onToggle(addOn.id)} />
                <span>
                  <span className="addon-name">{addOn.name}</span>
                  <span className="addon-note">{addOn.note}</span>
                  <span className="addon-price" data-addon-price={addOn.id}>
                    {addOn.kind === 'flat'
                      ? formatMoney(currency, convert(currency, addOn.price)) + ' / 月 · 按组织'
                      : formatMoney(currency, convert(currency, addOn.price)) + ' / 席 · 本单 ' + billedSeats + ' 席'}
                  </span>
                </span>
              </label>
            );
          })}
          {included.map((addOn) => (
            <span key={addOn.id} className="addon is-on" data-addon-included={addOn.id}>
              <input type="checkbox" checked disabled aria-label={addOn.name + '（已含）'} />
              <span>
                <span className="addon-name">{addOn.name}</span>
                <span className="addon-note">{addOn.note}</span>
                <span className="addon-price">已含在「冠层」，不另计价</span>
              </span>
            </span>
          ))}
          {locked.map((addOn) => (
            <span key={addOn.id} className="addon is-off" data-addon-locked={addOn.id}>
              <input type="checkbox" disabled aria-label={addOn.name + '（当前套餐不可选）'} />
              <span>
                <span className="addon-name">{addOn.name}</span>
                <span className="addon-note">{addOn.note}</span>
                <span className="addon-price">需要「冠层」档</span>
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
