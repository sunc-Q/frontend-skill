import { useState } from 'react';
import type { Quote } from '../lib/pricing';
import { formatMoney, tierOf } from '../lib/pricing';
import { checkEmail } from '../lib/validate';

/* 本模块只在用户点开「查看报价单」后被动态 import：
   里面这些独有字符串不应出现在入口 chunk 里，split 构建的断言会核对。 */

export interface QuoteSheetProps {
  readonly quote: Quote;
  readonly email: string;
  readonly onEmail: (next: string) => void;
  readonly onSent: (email: string) => void;
}

export default function QuoteSheet({ quote, email, onEmail, onSent }: QuoteSheetProps) {
  const [touched, setTouched] = useState(false);
  const state = checkEmail(email);
  const config = tierOf(quote.tier);
  const showErr = touched && !state.ok;

  return (
    <div className="quote" data-testid="quote-sheet">
      <div className="quote-head">
        <div>
          <p className="eyebrow">报价单明细</p>
          <h3 className="tier-name">
            {config.name} {config.latin} · {quote.period === 'annual' ? '年付' : '月付'} · {quote.currency}
          </h3>
        </div>
        <button type="button" className="btn btn-ghost" data-testid="print-quote" onClick={() => window.print()}>
          打印或存 PDF
        </button>
      </div>

      <div className="quote-lines">
        {quote.lines.map((line) => (
          <div className="qline" key={line.key} data-line={line.key}>
            <span>{line.label}</span>
            <span className="qline-detail">{line.detail}</span>
            <span className="qline-money" data-amount={line.amount}>
              {line.amount < 0 ? '-' + formatMoney(quote.currency, -line.amount) : formatMoney(quote.currency, line.amount)}
            </span>
          </div>
        ))}
        <div className="qline is-total" data-line="total">
          <span>{quote.period === 'annual' ? '一年一次支付' : '每月支付'}</span>
          <span className="qline-detail">
            {quote.lines.length} 行相加 · {quote.billedSeats} 席
          </span>
          <span className="qline-money" data-testid="quote-total" data-amount={quote.charged}>
            {formatMoney(quote.currency, quote.charged)}
          </span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="quote-email">把这份报价单寄到我的邮箱</label>
        <div className="field-row">
          <input
            id="quote-email"
            type="email"
            value={email}
            placeholder="name@company.com"
            onChange={(event) => onEmail(event.currentTarget.value)}
            onBlur={() => setTouched(true)}
            data-testid="quote-email"
          />
          <button
            type="button"
            className="btn"
            data-testid="send-quote"
            disabled={quote.lines.length === 0}
            onClick={() => {
              setTouched(true);
              if (state.ok) onSent(email.trim());
            }}
          >
            {state.ok ? '发送报价' : '先填对邮箱'}
          </button>
        </div>
        {showErr ? (
          <p className="field-error" data-testid="quote-error" role="alert">
            {state.ok ? '' : state.reason}
          </p>
        ) : (
          <p className="field-ok" data-testid="quote-ok">
            {state.ok && touched ? '已寄出（演示站：只写入本地记录，不发真实邮件）' : '未填写邮箱时也可以直接打印这份明细。'}
          </p>
        )}
        <p className="quote-note" data-testid="quote-note">
          报价基于当前算价台的选择，席位变动后请重新生成。折前合计 {formatMoney(quote.currency, quote.listMonthly)} / 月，
          {quote.period === 'annual' ? '年付比按月付一年省 ' + formatMoney(quote.currency, quote.saved) + '。' : '切到年付最多可省 25%。'}
        </p>
      </div>
    </div>
  );
}
