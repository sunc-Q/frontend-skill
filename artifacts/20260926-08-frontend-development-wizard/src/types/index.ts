/** Shared types (`~types/*` per the skill's import-alias table). */

export type StepId = 'identity' | 'plan' | 'payment' | 'review';
export type PlanId = 'starter' | 'studio' | 'market';
export type AddonId = 'stock' | 'points' | 'multisite' | 'receipt' | 'export' | 'support';
export type Billing = 'monthly' | 'annual';
export type Currency = 'CNY' | 'USD';
export type AccountType = 'personal' | 'enterprise';
export type InvoiceType = 'none' | 'normal' | 'special';
export type NotifyChannel = 'email' | 'phone' | 'both';

export interface PlanSpec {
  id: PlanId;
  name: string;
  latin: string;
  perSeat: number;
  platformFee: number;
  seatMin: number;
  seatMax: number;
  annualDiscount: number;
  quota: number;
  blurb: string;
}

export interface AddonSpec {
  id: AddonId;
  name: string;
  mode: 'seat' | 'org';
  price: number;
  note: string;
  requires?: AddonId;
  minPlan?: PlanId;
}

export interface OptionSpec {
  value: string;
  label: string;
}

export interface PriceLine {
  key: string;
  label: string;
  amount: number;
}

export interface PriceQuote {
  lines: PriceLine[];
  subtotal: number;
  discount: number;
  monthly: number;
  periodTotal: number;
  display: number;
  currency: Currency;
  billing: Billing;
  seats: number;
  plan: PlanId;
}

export interface WizardValues {
  /* step 1 — identity */
  storeName: string;
  subdomain: string;
  tagline: string;
  category: string;
  timezone: string;
  notify: NotifyChannel;
  supportPhone: string;
  /* step 2 — plan & capacity */
  plan: PlanId;
  seats: number;
  addons: AddonId[];
  billing: Billing;
  currency: Currency;
  /* step 3 — payment & compliance */
  accountType: AccountType;
  realName: string;
  idLast4: string;
  companyName: string;
  uscc: string;
  contactEmail: string;
  invoiceType: InvoiceType;
  taxTitle: string;
  taxNo: string;
  agree: boolean;
}

export interface BootstrapPayload {
  categories: OptionSpec[];
  timezones: OptionSpec[];
  notifyChannels: OptionSpec[];
  invoiceTypes: OptionSpec[];
  takenSubdomains: string[];
  reservedSubdomains: string[];
  takenEmails: string[];
  latencyMs: Record<string, number>;
}

export type AsyncVerdict = 'idle' | 'checking' | 'available' | 'taken' | 'reserved' | 'error';

export interface AsyncFieldState {
  verdict: AsyncVerdict;
  /** the value this verdict belongs to — a stale verdict must never block a newer value */
  forValue: string;
  /** monotonic token of the request that produced this verdict */
  token: number;
}

export interface SubmitRequest {
  token: string;
  payload: Record<string, unknown>;
}

export interface SubmitResponse {
  ok: boolean;
  status: number;
  orderId?: string;
  reason?: string;
  duplicate?: boolean;
}

export interface DraftEnvelope {
  version: number;
  step: StepId;
  values: WizardValues;
  savedAt: string;
}

export interface BridgeCall {
  path: string;
  method: 'GET' | 'POST';
  atMs: number;
  key: string;
}
