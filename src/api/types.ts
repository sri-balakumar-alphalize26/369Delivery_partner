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

/**
 * Which end of the job the rider is actually travelling to, so the map can
 * draw the leg in front of them rather than the whole journey.
 *
 * A delivery is two trips, not one: to the shop to collect, then to the
 * customer to hand over. Drawing shop-to-customer while the rider is still on
 * their way to the shop points past them entirely.
 *
 * `returning` is the case worth spelling out — a refused parcel goes back
 * where it came from, so the target flips to the shop a second time.
 *
 * Lives here rather than in the screen because it is pure status logic that
 * wants testing, and a Node test cannot import a file full of React Native
 * components.
 */
export function headingFor(status: DeliveryStatus): 'shop' | 'customer' {
  return status === 'offered' || status === 'accepted' || status === 'returning'
    ? 'shop'
    : 'customer';
}

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

/**
 * Why a delivery went wrong.
 *
 * Proposed by the app team and adopted verbatim by the Odoo team, who prefer a
 * shared list to one either side invents. Free text is still accepted
 * alongside, so nothing is rejected mid-rollout — which is why `other` carries
 * a note rather than standing alone.
 */
export const DELIVERY_REASONS = [
  { code: 'customer_absent', label: 'Customer not there' },
  { code: 'customer_refused', label: 'Customer refused it' },
  { code: 'address_wrong', label: 'Address is wrong' },
  { code: 'address_unreachable', label: 'Cannot reach the address' },
  { code: 'payment_refused', label: 'Customer would not pay' },
  { code: 'damaged', label: 'Parcel is damaged' },
  { code: 'vehicle_problem', label: 'Problem with my vehicle' },
  { code: 'other', label: 'Something else' },
] as const;

export type DeliveryReason = (typeof DELIVERY_REASONS)[number]['code'];

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

/** `{ enabled: true }` is the only signal that may start the location service. */
export interface Tracking {
  enabled: boolean;
}

/**
 * The shop a job is collected from.
 *
 * This arrived as a bare string until the backend shipped N2, and the app
 * rendered it directly — so the object crashed React Native with "Objects are
 * not valid as a React child". Both shapes are accepted deliberately: the live
 * server sends the object, older captures and the odd cached response send the
 * string, and neither should be able to take a screen down. Read it through
 * `shopName()` in `lib/format`, never straight into JSX.
 */
export interface Shop {
  id: number;
  name: string;
  /** Absolute and unauthenticated, or null when the shop has no image. */
  image_url: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string;
  phone: string;
}

export interface DeliveryOrder {
  delivery_order_id: number;
  delivery_order_name: string;
  job_code: string;
  sales_order: string;

  customer_name: string;
  customer_mobile: string;
  delivery_address: string;
  /** Object since N2; string before it. Render via `shopName()`. */
  shop: Shop | string;
  /** e.g. "1 item(s) - 2 unit(s)". Ships alongside the shop object. */
  items_summary?: string;

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

  /** Since N2 these ship on the list too, not only on GET /orders/{id}. */
  products?: Product[];
  /**
   * `null` when the address has never been geocoded — which is every row on
   * res-test1 today. It was `0.0` before, which a map renders as a pin in the
   * Atlantic, so treat both as absent and navigate by address instead.
   */
  latitude?: number | null;
  longitude?: number | null;
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
  /**
   * Seconds until another code may be requested. The server enforces a 60s
   * window: inside it no new code is issued and the existing one keeps its
   * full life, so a double-tap can no longer kill the code the rider is about
   * to type. Present on every request-code response, so the button can be
   * timed rather than left looking broken.
   */
  retry_after_seconds?: number;
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
  /**
   * Who a stuck rider calls. Optional — the button is hidden when unset.
   *
   * Here rather than in a constant for the same reason the server address is:
   * ops will change it, and a rebuild to edit a phone number is a bad trade.
   */
  supportPhone: string;
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

  /**
   * Hand Odoo a push token so it can wake this phone when a job is offered.
   *
   * `projectId` is sent because Expo rejects a send whose messages span two
   * EAS projects — and rejects the whole request, so one stale token can
   * silence every other rider. The server groups its sends by it.
   */
  registerPush(input: {
    token: string;
    platform: string;
    projectId: string;
  }): Promise<void>;

  /** Deactivate a token on sign-out. */
  unregisterPush(token: string): Promise<void>;

  returnToShop(id: number, reason?: string): Promise<ActionResult>;
  confirmReturn(id: number): Promise<ActionResult>;
  reportIssue(id: number, note: string): Promise<ActionResult>;
}
