export interface Instructor {
  id: number;
  name: string;
  title: string;
  org: string;
  bio: string;
  joined_at: string;
}

export interface Course {
  id: number;
  code: string;
  title: string;
  domain: string;
  level: string;
  instructor_id: number;
  price_cents: number;
  early_price_cents: number;
  early_deadline: string | null;
  capacity: number;
  hours: number;
  status: 'draft' | 'published' | 'archived';
  summary: string;
  published_at?: string;
  created_at: string;
}

export interface CourseRow extends Course {
  instructor_name: string;
  chapter_count: number;
  occupied: number;
  waitlisted: number;
  effective_price: number;
  early_now: boolean;
  seats_left: number;
  fill_pct: number;
}

export interface Chapter {
  id: number;
  course_id: number;
  seq: number;
  title: string;
  duration_min: number;
  free_preview: boolean;
}

export type EnrollStatus = 'active' | 'completed' | 'waitlist' | 'dropped';

export interface EnrollmentRow {
  id: number;
  learner_name: string;
  masked_phone: string;
  status: EnrollStatus;
  progress_pct: number;
  list_price: number;
  discount: number;
  paid_cents: number;
  source: string;
  enrolled_at: string;
}

export interface InstructorRow extends Instructor {
  course_count: number;
  published_count: number;
  learner_count: number;
}

export interface DomainRollup {
  domain: string;
  courses: number;
  capacity: number;
  occupied: number;
  learners: number;
  gmv_cents: number;
  fill_pct: number;
  early_courses: number;
}

export interface MonthPoint {
  month: string;
  enrolls: number;
  revenue: number;
  completed: number;
}

export interface Stats {
  published_courses: number;
  total_courses: number;
  paying_learners: number;
  active_learners: number;
  completed_count: number;
  waitlisted_count: number;
  dropped_count: number;
  gmv_cents: number;
  fill_pct: number;
  completion_rate_pct: number;
  discount_total: number;
  by_domain: DomainRollup[];
  monthly: MonthPoint[];
  generated_at: string;
  window: string;
}

export interface CourseList {
  items: CourseRow[];
  total: number;
  page: number;
  page_size: number;
  sort: string;
  dir: string;
  domain: string;
  level: string;
  q: string;
  served_at: string;
}

export interface CourseDetail {
  course: CourseRow;
  instructor: Instructor;
  chapters: Chapter[];
  recent_enrollments: EnrollmentRow[];
}

export interface EnrollResult {
  enrollment: EnrollmentRow;
  message: string;
}

export interface CourseStatusResult {
  course: Course;
  message: string;
}

export type SortKey =
  | 'code'
  | 'title'
  | 'price'
  | 'hours'
  | 'capacity'
  | 'occupied'
  | 'fill'
  | 'published'
  | 'id';
export type SortDir = 'asc' | 'desc';

export interface ListParams {
  domain?: string;
  level?: string;
  q?: string;
  early?: string;
  sort?: SortKey;
  dir?: SortDir;
  page?: number;
  page_size?: number;
}

export interface EnrollInput {
  course_code: string;
  name: string;
  phone: string;
  source: string;
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

export interface ApiErrorBody {
  code?: string;
  message?: string;
  fields?: Record<string, string>;
  trace_id?: string;
}
