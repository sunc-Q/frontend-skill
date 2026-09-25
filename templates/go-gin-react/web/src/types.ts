export interface Plan {
  id: number;
  code: string;
  name: string;
  price_monthly: number;
  price_yearly: number;
  seat_quota: number;
  active: boolean;
  created_at: string;
}

export type SubStatus = 'trialing' | 'active' | 'past_due' | 'canceled';
export type Period = 'monthly' | 'yearly';

export interface SubscriptionRow {
  id: number;
  subscriber_id: number;
  plan_id: number;
  period: Period;
  status: SubStatus;
  seats: number;
  mrr: number;
  start_at: string;
  renew_at: string;
  canceled_at?: string;
  last_payment_at?: string;
  email: string;
  company: string;
  plan_code: string;
  plan_name: string;
}

export interface Payment {
  id: number;
  subscription_id: number;
  amount: number;
  period: Period;
  paid_at: string;
}

export interface MonthlyPoint {
  month: string;
  new_subs: number;
  cancellations: number;
  mrr_added: number;
  mrr_lost: number;
}

export interface PlanRollup {
  plan_id: number;
  plan_code: string;
  plan_name: string;
  subs: number;
  mrr: number;
}

export interface Metrics {
  total_subscribers: number;
  active_subs: number;
  trialing_subs: number;
  past_due_subs: number;
  canceled_subs: number;
  mrr: number;
  arr: number;
  arpu: number;
  churn_rate_pct: number;
  trial_conversion_pct: number;
  monthly: MonthlyPoint[];
  by_plan: PlanRollup[];
  generated_at: string;
  window: string;
}

export interface SubscriptionList {
  items: SubscriptionRow[];
  total: number;
  page: number;
  page_size: number;
}

export interface SubscriptionDetail {
  subscription: SubscriptionRow;
  payments: Payment[];
}

export type SortKey = 'mrr' | 'renew_at' | 'seats' | 'status' | 'company';
export type SortDir = 'asc' | 'desc';

export interface ListParams {
  status?: SubStatus | '';
  plan?: string;
  q?: string;
  sort?: SortKey;
  dir?: SortDir;
  page?: number;
  page_size?: number;
}

export interface CreatePlanInput {
  code: string;
  name: string;
  price_monthly: number;
  price_yearly: number;
  seat_quota: number;
}

export interface RenewInput {
  amount: number;
  period: Period;
  next_renew: string;
}

export interface ApiErrorBody {
  code?: string;
  message?: string;
  fields?: Record<string, string>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.message ?? fallback);
    this.status = status;
    this.code = body?.code ?? String(status);
    this.fields = body?.fields ?? {};
  }
}
