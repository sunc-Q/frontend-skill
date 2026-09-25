export type Category = 'general' | 'large_print' | 'boxed_set' | 'reference';
export type CopyStatus = 'available' | 'on_loan' | 'missing' | 'retired';
export type LoanStatus = 'active' | 'returned';
export type MemberStatus = 'active' | 'suspended';
export type MemberType = 'standard' | 'family' | 'student';
export type LoanFilter = 'active' | 'returned' | 'overdue' | '';
export type SortDir = 'asc' | 'desc';

export interface ItemRow {
  id: number;
  code: string;
  title: string;
  author: string;
  publisher: string;
  pub_year: number;
  category: Category;
  loan_days: number;
  added_at: string;
  total_copies: number;
  available_copies: number;
  on_loan_copies: number;
}

export interface CopyRow {
  id: number;
  item_id: number;
  barcode: string;
  location: string;
  condition: string;
  status: CopyStatus;
  acquired_at: string;
  item_code: string;
  item_title: string;
  borrower_card?: string;
  borrower_name?: string;
  due_at?: string;
}

export interface LoanRow {
  id: number;
  copy_id: number;
  member_id: number;
  status: LoanStatus;
  borrowed_at: string;
  due_at: string;
  returned_at?: string;
  renew_count: number;
  fine_cents: number;
  fine_paid: boolean;
  member_card: string;
  member_name: string;
  member_type: MemberType;
  member_status: MemberStatus;
  item_code: string;
  item_title: string;
  item_category: Category;
  copy_barcode: string;
  copy_location: string;
  overdue_days: number;
  fine_due: number;
}

export interface MemberDetail {
  id: number;
  card_no: string;
  name: string;
  member_type: MemberType;
  status: MemberStatus;
  joined_at: string;
  suspended_at?: string;
  phone_masked: string;
  quota: number;
  active_loans: number;
  overdue_loans: number;
  outstanding_fine: number;
}

export interface PageEnvelope<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  served_at: string;
}

export interface ItemDetailResponse {
  item: ItemRow;
  copies: CopyRow[];
}

export interface LoanResponse {
  loan: LoanRow;
}

export interface MemberResponse {
  member: MemberDetail;
  loans: LoanRow[];
}

export interface ReturnResponse {
  loan: LoanRow;
  fine_cents: number;
  message: string;
}

export interface BorrowResponse {
  loan: LoanRow;
  message: string;
}

export interface TrendPoint {
  day: string;
  borrow: number;
  returned: number;
}

export interface CategoryRollup {
  category: Category;
  items: number;
  copies: number;
  active_loans: number;
}

export interface Stats {
  generated_at: string;
  today: string;
  total_items: number;
  total_copies: number;
  available_copies: number;
  on_loan_copies: number;
  active_loans: number;
  overdue_loans: number;
  returned_loans: number;
  total_members: number;
  active_members: number;
  suspended_members: number;
  outstanding_fine: number;
  collected_fine: number;
  borrow_today: number;
  return_today: number;
  identity_ok: boolean;
  identity_issues: string[];
  trend: TrendPoint[];
  by_category: CategoryRollup[];
  window: string;
}

export type ItemSortKey =
  | 'code'
  | 'title'
  | 'author'
  | 'year'
  | 'category'
  | 'added'
  | 'available'
  | 'total'
  | 'id';

export type LoanSortKey =
  | 'due'
  | 'borrowed'
  | 'returned'
  | 'member'
  | 'item'
  | 'barcode'
  | 'fine'
  | 'renew'
  | 'status'
  | 'id';

export interface ListParams {
  status?: string;
  category?: string;
  q?: string;
  sort?: string;
  dir?: SortDir;
  page?: number;
  page_size?: number;
}

export interface BorrowInput {
  barcode: string;
  card_no: string;
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
