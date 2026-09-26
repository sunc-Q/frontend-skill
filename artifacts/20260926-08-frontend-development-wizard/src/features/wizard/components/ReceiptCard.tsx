import React from 'react';
import { BRAND, planOf } from '@/lib/facts';
import { money } from '@/lib/format';
import { quote } from '../helpers/pricing';
import type { WizardValues } from '~types/index';

/**
 * Deeper dynamic import (chunk evidence for group L): a printable receipt that is never
 * needed until a submission succeeds. Phrases that exist only here — 「回执编号」「纸质回执」 —
 * are what the checks assert as absent from the first-load bundle.
 */
interface ReceiptCardProps {
  orderId: string;
  values: WizardValues;
  shown: boolean;
}

const ReceiptCard: React.FC<ReceiptCardProps> = ({ orderId, values, shown }) => {
  const q = quote(values);
  const plan = planOf(values.plan);
  return (
    <div className="fd-receipt" data-role="receipt" data-shown={shown ? '1' : '0'}>
      <p className="fd-panel-title">开通回执</p>
      <p className="fd-note">
        回执编号 <span className="fd-mono" data-role="receipt-serial">{orderId}</span> · 纸质回执可在后台补打
      </p>
      <div className="fd-review">
        <span className="fd-review-k">站点</span>
        <span className="fd-review-v">
          {values.storeName} · {values.subdomain}.tideside.example
        </span>
        <span className="fd-review-k">方案</span>
        <span className="fd-review-v">
          {plan.name} × {values.seats} 席（{values.billing === 'annual' ? '年付' : '月付'}）
        </span>
        <span className="fd-review-k">应付</span>
        <span className="fd-review-v">{money(q.display, values.currency)}</span>
        <span className="fd-review-k">开票</span>
        <span className="fd-review-v">{values.invoiceType === 'none' ? '暂不开票' : values.taxTitle}</span>
      </div>
      <p className="fd-note">
        {BRAND.zh} · 受理后可在「我的站点」继续修改；如需帮助请寄信 {BRAND.supportMail}
      </p>
    </div>
  );
};

export default ReceiptCard;
