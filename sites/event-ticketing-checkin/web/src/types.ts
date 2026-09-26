// 与后端 internal/domain 的视图结构一一对应（字段名即 JSON key）。
// 这里只是「读侧类型」，任何数据都来自接口，页面不写死业务数据。

export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly fields: Record<string, string>;

	constructor(status: number, body: ApiErrorBody | null, fallback: string) {
		super(body?.message ?? fallback);
		this.status = status;
		this.code = body?.code ?? 'network';
		this.fields = body?.fields ?? {};
	}
}

export interface ApiErrorBody {
	code?: string;
	message?: string;
	fields?: Record<string, string>;
	trace_id?: string;
}

export interface Event {
	id: number;
	code: string;
	title: string;
	artist: string;
	category: string;
	venue: string;
	city: string;
	gates: string;
	doors_at: string;
	start_at: string;
	on_sale_at: string;
	presale_end: string;
	status: string;
	refund_cutoff_hours: number;
	note: string;
	created_at: string;
	closed_at?: string;
}

export interface EventRow extends Event {
	type_count: number;
	quota_total: number;
	sold_total: number;
	valid_tickets: number;
	used_tickets: number;
	void_tickets: number;
	gross_cent: number;
	min_unit_cent: number;
	sell_through_bp: number;
	early_live: boolean;
	checkin_open: boolean;
	checkin_why?: string;
}

export interface TypeRollup {
	type_code: string;
	type_name: string;
	zone: string;
	unit_cent: number;
	service_cent: number;
	early_bps: number;
	now_unit_cent: number;
	quota: number;
	sold_quantity: number;
	remaining: number;
	valid_tickets: number;
	used_tickets: number;
	void_tickets: number;
	status: string;
	seated: boolean;
}

export interface Order {
	id: number;
	code: string;
	event_id: number;
	type_id: number;
	buyer: string;
	channel: string;
	quantity: number;
	unit_cent: number;
	service_cent: number;
	discount_bps: number;
	subtotal_cent: number;
	fee_cent: number;
	payable_cent: number;
	retained_cent: number;
	refunded_cent: number;
	status: string;
	created_at: string;
	paid_at?: string;
	refunded_at?: string;
	refund_reason?: string;
	last_four_digits?: string;
}

export interface OrderView extends Order {
	event_code: string;
	event_title: string;
	type_code: string;
	type_name: string;
	city: string;
	phone_masked: string;
	ticket_count: number;
	used_count: number;
	void_count: number;
	refundable: boolean;
	refund_why?: string;
}

export interface Ticket {
	id: number;
	code: string;
	order_id: number;
	event_id: number;
	type_id: number;
	seq: number;
	seat_zone: string;
	seat_row: string;
	seat_no: string;
	status: string;
	issued_at: string;
	used_at?: string;
	gate?: string;
}

export interface TicketView extends Ticket {
	seat_label: string;
	order_code: string;
	event_code: string;
	event_title: string;
	doors_at: string;
	start_at: string;
	event_status: string;
	type_name: string;
	zone_name: string;
	gates: string[];
	buyer: string;
	phone_masked: string;
	unit_cent: number;
	service_cent: number;
	checkinable: boolean;
	checkin_why?: string;
}

export interface DailyPoint {
	day: string;
	orders: number;
	tickets: number;
	refunds: number;
	gross_cent: number;
	refund_cent: number;
	checkins: number;
}

export interface ChannelRollup {
	channel: string;
	orders: number;
	tickets: number;
	gross_cent: number;
	fee_cent: number;
	refund_cent: number;
	checkin_bp: number;
}

export interface Stats {
	today: string;
	events_total: number;
	events_on_sale: number;
	orders_total: number;
	orders_paid: number;
	tickets_issued: number;
	tickets_valid: number;
	tickets_used: number;
	tickets_void: number;
	gross_cent: number;
	fee_cent: number;
	net_cent: number;
	refund_cent: number;
	retained_cent: number;
	quota_total: number;
	sold_total: number;
	sell_through_bp: number;
	checkin_rate_bp: number;
	avg_order_cent: number;
	today_gross_cent: number;
	today_checkins: number;
	refund_rate_bp: number;
	identity_ok: boolean;
	identity_issues: string[];
	identity_note: string;
	daily: DailyPoint[];
	by_channel: ChannelRollup[];
	active_now: EventRow[];
	generated_at: string;
	window: string;
}

export interface Envelope<T> {
	items: T[];
	total: number;
	page: number;
	page_size: number;
	sort: string;
	dir: string;
	served_at: string;
}

export interface EventDetail {
	event: EventRow;
	ticket_types: TypeRollup[];
}

export interface TicketResult {
	ticket: TicketView;
}

export interface ListParams {
	status?: string;
	event?: string;
	type?: string;
	channel?: string;
	category?: string;
	city?: string;
	q?: string;
	sort?: string;
	dir?: string;
	page?: number;
	page_size?: number;
}

export interface CreateEventInput {
	code: string;
	title: string;
	artist: string;
	category: string;
	venue: string;
	city: string;
	gates: string;
	doors_at: string;
	start_at: string;
	presale_end: string;
	refund_cutoff_hours: number;
	note: string;
}

export interface SaleInput {
	event_code: string;
	type_code: string;
	quantity: number;
	buyer: string;
	phone: string;
	channel: string;
}

export interface SaleResult {
	order: OrderView;
	tickets: Ticket[];
	message: string;
}

export interface CheckinResult {
	ticket: TicketView;
	message: string;
}

export interface RefundResult {
	order: OrderView;
	refunded_cent: number;
	message: string;
}

export interface EventStatusResult {
	event: Event;
	message: string;
}
