export type Category = 'strength' | 'cardio' | 'yoga' | 'cycling' | 'boxing' | 'recovery';
export type CoachLevel = 'junior' | 'senior' | 'master';
export type SessionStatus = 'open' | 'closed' | 'canceled';
export type BookingStatus = 'confirmed' | 'waitlist' | 'canceled' | 'no_show';
export type CardType = 'trial' | 'ten_session' | 'monthly' | 'quarterly' | 'annual';
export type BookingSource = 'app' | 'front_desk' | 'coach' | 'phone';

export interface ClassItem {
  id: number;
  code: string;
  name: string;
  category: Category;
  coach: string;
  coach_level: CoachLevel;
  duration_min: number;
  intensity: number;
  capacity: number;
  price_cents: number;
  active: boolean;
  created_at: string;
}

export interface SessionRow {
  id: number;
  class_id: number;
  start_at: string;
  room: string;
  status: SessionStatus;
  note: string;
  class_code: string;
  class_name: string;
  category: Category;
  coach: string;
  coach_level: CoachLevel;
  duration_min: number;
  intensity: number;
  price_cents: number;
  capacity: number;
  confirmed: number;
  waitlist: number;
  remaining: number;
}

export interface RosterEntry {
  booking_id: number;
  member_id: number;
  name: string;
  phone: string;
  card_type: CardType;
  credits: number;
  status: BookingStatus;
  source: BookingSource;
  created_at: string;
}

export interface SessionDetail {
  session: SessionRow;
  roster: RosterEntry[];
}

export interface DayRollup {
  day: string;
  sessions: number;
  confirmed: number;
  canceled: number;
  seats: number;
}

export interface CategoryRollup {
  category: Category;
  sessions: number;
  confirmed: number;
  seats: number;
  occupancy_pct: number;
}

export interface CoachRollup {
  coach: string;
  coach_level: CoachLevel;
  sessions: number;
  confirmed: number;
  seats: number;
  occupancy_pct: number;
}

export interface CardRollup {
  card_type: CardType;
  members: number;
  credits: number;
}

export interface Stats {
  window: string;
  generated_at: string;
  total_sessions: number;
  open_sessions: number;
  seat_total: number;
  total_bookings: number;
  confirmed_bookings: number;
  waitlist_bookings: number;
  canceled_bookings: number;
  no_show_bookings: number;
  members: number;
  active_members: number;
  occupancy_pct: number;
  no_show_rate_pct: number;
  revenue_cents: number;
  avg_confirmed_per_session: number;
  days: DayRollup[];
  by_category: CategoryRollup[];
  by_coach: CoachRollup[];
  by_card: CardRollup[];
}

export interface ScheduleList {
  items: SessionRow[];
  total: number;
  page: number;
  page_size: number;
  sort: string;
  from: string;
  days: number;
  served_at: string;
}

export interface CreateBookingInput {
  member_id?: number;
  phone?: string;
  source?: BookingSource;
  allow_waitlist?: boolean;
}

export interface BookingResponse {
  booking: { id: number; session_id: number; member_id: number; status: BookingStatus; source: BookingSource };
  session: SessionDetail;
  credit_used: boolean;
  message: string;
}

export interface CreateMemberInput {
  name: string;
  phone: string;
  card_type: CardType;
  credits: number;
  days_valid: number;
}

export interface Member {
  id: number;
  name: string;
  phone: string;
  card_type: CardType;
  credits: number;
  visits: number;
  joined_at: string;
  expires_at: string;
  active: boolean;
}

export type SortKey = 'start_at' | 'class' | 'coach' | 'booked' | 'remaining' | 'room' | 'id';
export type SortDir = 'asc' | 'desc';

export interface ListParams {
  date?: string;
  days?: number;
  category?: Category | '';
  coach?: string;
  level?: CoachLevel | '';
  status?: SessionStatus | '';
  q?: string;
  sort?: SortKey;
  dir?: SortDir;
  page?: number;
  page_size?: number;
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
