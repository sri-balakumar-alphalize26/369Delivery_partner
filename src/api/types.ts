/**
 * The contract, as published by the Odoo team
 * ("Delivery Partner API", Odoo 19, integration contract v1.0).
 *
 * Their first rule governs this whole file:
 *
 *   "Odoo decides the workflow. The app renders it. Every response carries
 *    allowed_actions. Show the buttons in that list and no others."
 *
 * So there is deliberately NO state machine here. The app does not know what
 * comes after `picked`, and must not — when the flow changes in Odoo, a
 * correctly written app follows it with no new release.
 */

/** Every action Odoo can offer. The app renders these and nothing else. */
export type Action =
  | 'accept'
  | 'verify_pickup_otp'
  | 'dispatch'
  | 'start_delivery'
  | 'verify_delivery_otp'
  | 'return_to_shop'
  | 'confirm_return'
  | 'report_issue';

/** Button labels. A lookup for rendering only — it confers no permission. */
export const ACTION_LABEL: Record<Action, string> = {
  accept: 'Accept this job',
  verify_pickup_otp: 'Enter pickup code',
  dispatch: 'Leaving the shop',
  start_delivery: 'Start delivery',
  verify_delivery_otp: 'Enter delivery code',
  return_to_shop: 'Return to shop',
  confirm_return: 'Confirm return',
  report_issue: 'Report a problem',
};

/**
 * The action Odoo considers the main one at each step, so the UI can give it
 * the big button and push the rest down. Ordering only — never gating.
 */
export const PRIMARY_ACTIONS: Action[] = [
  'accept',
  'verify_pickup_otp',
  'dispatch',
  'start_delivery',
  'verify_delivery_otp',
  'confirm_return',
];

export type DeliveryStatus =
  | 'offered'
  | 'accepted'
  | 'picked'
  | 'dispatched'
  | 'out_for_delivery'
  | 'delivered'
  | 'returning'
  | 'returned'
  | 'cancelled'
  /**
   * Undocumented, but live: job 530 on res-test1 came back as `failed` with an
   * empty `allowed_actions`. Odoo can add a state faster than the app ships, so
   * anything unmapped has to degrade rather than crash.
   */
  | 'failed';

export type PaymentStatus = 'cod' | 'paid';
export type DeliveryType = 'quick' | 'express';

/**
 * Every money field arrives with its own currency.
 *
 * The contract is explicit that `decimals` is the only correct source for
 * rounding — "OMR is 3, most currencies 2, some 0. Do not hardcode two."
 */
export interface Currency {
  code: string;
  symbol: string;
  decimals: number;
}

export interface Product {
  name: string;
  quantity: number;
  uom?: string;
}

/**
 * When each step happened, on GET /orders/{id}. An empty string means 'not yet'
 * — the server does not omit the key.
 */
export interface OrderTimestamps {
  offered: string;
  accepted: string;
  picked_up: string;
  dispatched: string;
  out_for_delivery: string;
  delivered: string;
}

/**  is the only signal that may start the location service. */
export interface Tracking {
  enabled: boolean;
}

export interface DeliveryOrder {
  delivery_order_id: number;
  delivery_order_name: string;
  job_code: string;
  sales_order: string;

  customer_name: string;
  customer_mobile: string;
  delivery_address: string;
  shop: string;

  payment_status: PaymentStatus;
  amount_to_collect: number;
  currency: Currency;

  delivery_status: DeliveryStatus;
  delivery_type: DeliveryType;
  /**
   * UTC, ending in `Z`. Convert for display with the `timezone` the API
   * returns — never with the phone's own zone, which the contract warns may
   * not match the server's.
   */
  promised_by: string;

  allowed_actions: Action[];

  /** Only on GET /orders/{id}. */
  products?: Product[];
  latitude?: number;
  longitude?: number;
  tracking?: Tracking;
  timestamps?: OrderTimestamps;
  delivered_at?: string;
}

/** The four dashboard figures. */
export interface OrderCounts {
  assigned: number;
  picked_up: number;
  out_for_delivery: number;
  delivered: number;
}

export interface OrdersResponse {
  counts: OrderCounts;
  orders: DeliveryOrder[];
  /** Duty is server-held; this is the authority, not anything the app remembers. */
  on_duty?: boolean;
  timezone?: string;
  server_time?: string;
}

export interface Rider {
  id: number;
  name: string;
  mobile: string;
  /** "own" for staff riders; freelancers differ. */
  kind: string;
  /** No work is offered at all while this is false. */
  on_duty: boolean;
  /** UTC, or "" when off duty. */
  duty_since: string;
}

/** What every action endpoint returns. */
export interface ActionResult {
  status: DeliveryStatus;
  allowed_actions: Action[];
  tracking?: Tracking;
  message?: string;
  delivered_at?: string;
}

/**
 * POST /duty.
 *
 * `jobs_picked_up` is the point of the endpoint: clocking on collects whatever
 * was confirmed while nobody was on duty, so the app can open on "3 jobs were
 * waiting for you" rather than an empty screen.
 */
export interface DutyResult {
  on_duty: boolean;
  duty_since: string;
  jobs_picked_up: number;
  message?: string;
}

export interface LocationResult {
  /** True means the delivery is over — stop the location service at once. */
  stop: boolean;
  status: DeliveryStatus;
}

/** Error codes the server actually returns. */
export type ApiErrorCode =
  | 'unauthorized'
  | 'not_found'
  | 'wrong_state'
  | 'bad_otp'
  | 'otp_required'
  | 'no_database'
  | 'network'
  | 'unknown';

/**
 * `message` is written by Odoo for the rider to read. The contract says to show
 * it unchanged, so never substitute our own wording.
 *
 * A `wrong_state` error also carries `status_name` and `allowed_actions`, which
 * is enough to re-render a stale screen correctly without reloading.
 */
export class ApiError extends Error {
  code: ApiErrorCode;
  status?: number;
  statusName?: DeliveryStatus;
  allowedActions?: Action[];

  constructor(
    code: ApiErrorCode,
    message: string,
    opts: {
      status?: number;
      statusName?: DeliveryStatus;
      allowedActions?: Action[];
    } = {}
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = opts.status;
    this.statusName = opts.statusName;
    this.allowedActions = opts.allowedActions;
  }
}

/** Server connection, pasted on the Connect screen. */
export interface ServerConfig {
  url: string;
  db: string;
  token: string;
  /** Run against the built-in simulation instead of the live server. */
  useMock: boolean;
}

/** What /auth/me answers: who this is, plus how to format what they are shown. */
export interface Identity {
  rider: Rider;
  timezone: string;
  currency: Currency;
}

/**
 * Both backends implement this, so contract drift surfaces as a compile error
 * rather than as a blank screen on a rider's phone.
 */
export interface ApiAdapter {
  me(): Promise<Identity>;

  duty(on: boolean): Promise<DutyResult>;

  orders(): Promise<OrdersResponse>;
  order(id: number): Promise<DeliveryOrder>;

  accept(id: number): Promise<ActionResult>;
  requestPickupOtp(id: number): Promise<ActionResult>;
  verifyPickupOtp(id: number, otp: string): Promise<ActionResult>;
  dispatch(id: number): Promise<ActionResult>;
  start(id: number): Promise<ActionResult>;
  verifyDeliveryOtp(id: number, otp: string): Promise<ActionResult>;

  sendLocation(
    id: number,
    fix: { latitude: number; longitude: number; accuracy: number }
  ): Promise<LocationResult>;

  returnToShop(id: number, reason?: string): Promise<ActionResult>;
  confirmReturn(id: number): Promise<ActionResult>;
  reportIssue(id: number, note: string): Promise<ActionResult>;
}
