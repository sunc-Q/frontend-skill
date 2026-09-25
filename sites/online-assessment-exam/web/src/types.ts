export type AsmtStatus = 'draft' | 'open' | 'closed';
export type AttemptStatus = 'ongoing' | 'graded' | 'invalid';
export type QType = 'single' | 'multi' | 'judge' | 'blank';
export type SortDir = 'asc' | 'desc';

/** 列表参数：值一律给成字符串/数字，空串由 api 层丢弃，避免 undefined 与可选属性打架。 */
export type ListParams = Record<string, string | number>;

export interface Assessment {
  id: number;
  code: string;
  title: string;
  subject: string;
  kind: string;
  duration_min: number;
  pass_score: number;
  status: AsmtStatus;
  opens_at: string;
  closes_at: string;
  intro: string;
  created_at: string;
}

/** 场次行：卷面信息 + 题数/满分/作答数/通过数/平均分/最高分/进行中份数。 */
export interface AssessmentRow extends Assessment {
  question_no: number;
  total_score: number;
  attempts: number;
  passed_count: number;
  avg_percent: number;
  best_score: number;
  ongoing_count: number;
}

/** 作答行：接口层恒等式 score = mechanical_score + half_credit = Σ awarded。 */
export interface AttemptRow {
  id: number;
  attempt_no: string;
  assessment_id: number;
  candidate_name: string;
  channel: string;
  started_at: string;
  submitted_at?: string;
  elapsed_sec: number;
  status: AttemptStatus;
  score: number;
  mechanical_score: number;
  half_credit: number;
  passed: boolean;
  reason?: string;
  graded_at?: string;
  masked_phone: string;
  assessment_code: string;
  title: string;
  subject: string;
  total_score: number;
  pass_score: number;
  percent: number;
  rank_no: number;
}

/** 卷面试题：后端不输出标准答案，选项只以数组形式给出。 */
export interface QuestionView {
  code: string;
  order_no: number;
  type: QType;
  stem: string;
  options?: string[];
  score: number;
}

export interface Distractor {
  picked: string;
  count: number;
}

export interface ItemStat {
  code: string;
  order_no: number;
  type: QType;
  stem: string;
  score: number;
  answered: number;
  correct_count: number;
  accuracy_pct: number;
  awarded: number;
  difficulty: string;
  revealed: boolean;
  distractors?: Distractor[];
}

export interface ScoreBucket {
  label: string;
  from: number;
  to: number;
  count: number;
}

export interface DailyPoint {
  day: string;
  attempts: number;
  passed: number;
  avg_percent: number;
}

export interface SubjectRollup {
  subject: string;
  attempts: number;
  passed: number;
  avg_percent: number;
  pass_pct: number;
}

export interface Stats {
  assessments: number;
  open_assessments: number;
  draft_assessments: number;
  closed_assessments: number;
  questions: number;
  attempts: number;
  graded: number;
  ongoing: number;
  invalid: number;
  passed: number;
  pass_rate_pct: number;
  avg_percent: number;
  half_credit_total: number;
  score_total: number;
  mechanical_total: number;
  identity_violations: number;
  identity_ok: boolean;
  buckets: ScoreBucket[];
  subjects: SubjectRollup[];
  daily: DailyPoint[];
  hardest_items: ItemStat[];
  top_board: AttemptRow[];
  generated_at: string;
  window: string;
}

export interface ReceiptItem {
  code: string;
  order_no: number;
  type: QType;
  stem: string;
  picked: string;
  correct: boolean;
  awarded: number;
  max_score: number;
}

export interface AssessmentList {
  items: AssessmentRow[];
  total: number;
  page: number;
  page_size: number;
  sort: string;
  dir: SortDir;
  filters: { status: string; subject: string; kind: string; q: string };
  subjects: string[];
}

export interface AttemptList {
  items: AttemptRow[];
  total: number;
  page: number;
  page_size: number;
  sort: string;
  dir: SortDir;
  filters: { status: string; channel: string; passed: string };
}

export interface Paper {
  assessment: AssessmentRow;
  questions: QuestionView[];
}

export interface Statistics {
  assessment: AssessmentRow;
  items: ItemStat[];
  stats: Stats;
}

export interface Receipt {
  attempt: AttemptRow;
  items: ReceiptItem[];
}

export interface StartOut {
  attempt: AttemptRow;
  questions: QuestionView[];
  total_score: number;
}

export interface SubmitOut {
  attempt: AttemptRow;
  items: ReceiptItem[];
  message: string;
}

export interface StatusOut {
  assessment: Assessment;
  served_at: string;
}

export interface StartExamInput {
  name: string;
  phone: string;
  channel: string;
}

export interface AnswerInput {
  question_code: string;
  picked: string;
}

export interface SubmitInput {
  answers: AnswerInput[];
}

export interface ApiErrorBody {
  code?: string;
  message?: string;
  fields?: Record<string, string>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(status: number, body: ApiErrorBody | null, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }

  get code(): string {
    return this.body?.code ?? `http_${this.status}`;
  }

  /** 后端逐字段校验错误的回显，用于表单内联提示。 */
  get fields(): Record<string, string> {
    return this.body?.fields ?? {};
  }
}
