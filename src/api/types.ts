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
  /**
   * Odoo offers this from "Rider Near Customer" on, but the customer has no
   * code until the rider reaches the door: `ApiAdapter.reachedCustomer`,
   * which is never in this list - the job screen calls it itself.
   */
  | 'verify_delivery_otp'
  | 'return_to_shop'
  /**
   * No longer offered: only the shop confirms a return, in Odoo. Kept so an
   * answer from an older server still renders rather than crashing.
   */
  | 'confirm_return'
  | 'report_issue'
  /** Say no to an offer; Odoo passes it to the next rider on duty. */
  | 'decline';

/** Button labels. A lookup for rendering only — it confers no permission. */
export const ACTION_LABEL: Record<Action, string> = {
  accept: 'Accept this job',
  decline: 'Decline',
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
  return status === 'offered' ||
    status === 'accepted' ||
    status === 'returning' ||
    isAtShop(status)
    ? 'shop'
    : 'customer';
}

/**
 * The job is this rider's, but the parcel is not ready to collect: the shop is
 * still taking it on or packing it, or nobody could be offered it yet. No
 * actions, and nothing collected — the rider waits to be called.
 */
export const AT_SHOP_STATES: readonly DeliveryStatus[] = [
  'awaiting_shop',
  'preparing',
  'ready',
  'to_assign',
];

export function isAtShop(status: DeliveryStatus): boolean {
  return AT_SHOP_STATES.includes(status);
}

export type DeliveryStatus =
  /**
   * The store flow's three steps before a rider is called — the rider is
   * chosen when the order is confirmed, then waits while the shop accepts
   * (`awaiting_shop`), packs (`preparing`) and marks it packed (`ready`).
   */
  | 'awaiting_shop'
  | 'preparing'
  | 'ready'
  /** Nobody could be offered it yet (no WhatsApp session, say). */
  | 'to_assign'
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
  /**
   * When the 369 Mart counter pressed Packed — UTC with a `Z`, like
   * `promised_by`; null before it is packed. Sent by the `mart369_rider_bridge`
   * module only, so absent on a server without it.
   */
  packed_at?: string | null;
  /** `office` when a person chose this rider, `auto` when the least-busy rule did. */
  assigned_by?: 'auto' | 'office';
  /**
   * When the rider reached the door and the customer was sent their code, UTC.
   * Read when the server sends it; the job screen also remembers it per job.
   */
  reached_customer_on?: string;
}

/** The four dashboard figures. */
export interface OrderCounts {
  assigned: number;
  picked_up: number;
  out_for_delivery: number;
  delivered: number;
}

/** The bucket behind each of those figures. */
export type CountBucket = keyof OrderCounts;

/**
 * Which statuses each of the four counts covers.
 *
 * Odoo computes `counts` server-side, so this is the app's mirror of that
 * grouping rather than its source. It earns its place by having two readers:
 * the mock tallies with it, and a tapped tile on Home opens the jobs behind its
 * own number with it. Written once, they cannot disagree.
 *
 * `returning` is deliberately in no bucket — Odoo lists such a job but counts
 * it nowhere, which is why the jobs screen keeps an unfiltered view.
 *
 * Lives here, beside `headingFor()`, for the same reason: pure status logic
 * that wants testing, and a Node test cannot import a file full of React Native
 * components.
 */
export const COUNT_BUCKET: Record<CountBucket, DeliveryStatus[]> = {
  // The shop's three steps count as assigned: the job is this rider's, it is
  // just not packed yet. `to_assign` is counted nowhere, like `returning`.
  assigned: ['offered', 'accepted', 'awaiting_shop', 'preparing', 'ready'],
  picked_up: ['picked', 'dispatched'],
  out_for_delivery: ['out_for_delivery'],
  delivered: ['delivered'],
};

export function inBucket(status: DeliveryStatus, bucket: CountBucket): boolean {
  return COUNT_BUCKET[bucket].includes(status);
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
  /**
   * On a pickup-code request: false when the shop was sent a code under a
   * minute ago and keeps it, rather than a new one voiding it.
   */
  resent?: boolean;
  /** On `decline`: the job is no longer this rider's. Leave its screen. */
  removed?: boolean;
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
  /** With `delivery_fleet_ops`: the vehicle now in hand, null once given back. */
  vehicle?: Vehicle | null;
}

/** A bike or car from Odoo's Fleet app that riders may take. */
export interface Vehicle {
  id: number;
  /** Fleet's own "Brand/Model/Plate". */
  name: string;
  plate: string;
  model: string;
  brand: string;
  /** Fleet's two kinds; null when the model does not say. */
  type: 'bike' | 'car' | null;
  grounded: boolean;
}

/**
 * `me`'s `fleet` block. Only a server with `delivery_fleet_ops` sends it, and
 * the vehicle screens stay hidden without it — an older server must never be
 * sent a `vehicle_id` it has no parameter for.
 */
export interface FleetInfo {
  vehicle: Vehicle | null;
  default_vehicle_id: number | null;
  /** On: the server refuses to clock the rider on without a vehicle. */
  vehicle_required: boolean;
  /** On: the delivery code is refused until a photo at the door is sent. */
  proof_required?: boolean;
  /**
   * What this server accepts: `vehicles`, `location`, `geofence` (a position
   * with "arrived"), `fuel` (fuel and problem reports), `proof` (door photo).
   */
  features: string[];
}

/** What a phone knows about where it is, sent with "arrived". */
export interface Fix {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export type VehicleIssueCategory = 'flat_tyre' | 'breakdown' | 'accident' | 'other';

export interface LogResult {
  log_id: number;
  message?: string;
  grounded?: boolean;
}

/**
 * `rider_location`'s answer. The server paces the heartbeat: 30 s with work
 * in hand, 2 min without. `on_duty: false` means stop sending.
 */
export interface RiderLocationResult {
  on_duty: boolean;
  poll_after_seconds: number;
  has_new_offer: boolean;
}

export interface TakeVehicleResult {
  vehicle: Vehicle | null;
  message?: string;
}

/** What the rider may take now, and which one to preselect. */
export interface VehiclesResponse extends FleetInfo {
  vehicles: Vehicle[];
  preselect_id: number | null;
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
  // The module's other refusals, named so code can tell them apart.
  | 'bad_point'
  | 'off_duty'
  | 'no_file'
  | 'too_large'
  | 'no_token'
  | 'uuid_reused'
  // delivery_fleet_ops: no vehicle picked where one is required, or the one
  // picked has just gone out with somebody else.
  | 'vehicle_needed'
  | 'vehicle_unavailable'
  // "Arrived" far from the shop, with the arrival check set to refuse.
  | 'too_far'
  | 'no_vehicle'
  | 'bad_odometer'
  | 'bad_input'
  | 'proof_needed'
  // Fuel and problem logs switched off in Delivery Settings.
  | 'disabled'
  | 'no_database'
  | 'network'
  | 'unknown';

/**
 * `message` is written by Odoo for the rider to read. The contract says to show
 * it unchanged, so never substitute our own wording.
 *
 * A `wrong_state` refusal also carries `status` and `allowed_actions`, which
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

/** Server connection, entered on the Connect screen. */
export interface ServerConfig {
  url: string;
  db: string;
  /**
   * The rider's WhatsApp number, digits with the country code (96891234567).
   * It is where the sign-in code is sent. The tokens that follow are kept
   * apart from this config, in `rest/auth.ts`.
   */
  login: string;
  /**
   * Who a stuck rider calls. Optional — the button is hidden when unset.
   *
   * Here rather than in a constant for the same reason the server address is:
   * ops will change it, and a rebuild to edit a phone number is a bad trade.
   */
  supportPhone: string;
  /**
   * OpenRouteService key, for the road-following route line and a real ETA.
   *
   * Optional in the same way the support number is: with none, the map falls
   * back to the straight dashed leg it drew before, and no ETA is claimed.
   */
  orsKey: string;
  /** Run against the built-in simulation instead of the live server. */
  useMock: boolean;
}

/** What /auth/me answers: who this is, plus how to format what they are shown. */
export interface Identity {
  rider: Rider;
  timezone: string;
  currency: Currency;
  /** Absent on a server without `delivery_fleet_ops`. */
  fleet?: FleetInfo;
}

/**
 * Both backends implement this, so contract drift surfaces as a compile error
 * rather than as a blank screen on a rider's phone.
 */
/** What `auth/request-code` answers. Deliberately the same for an unknown number. */
export interface CodeRequestResult {
  message?: string;
  /** Seconds before another code may be asked for. */
  retry_after_seconds?: number;
}

export interface ApiAdapter {
  /**
   * Step one of signing in: Odoo sends a code to this number on WhatsApp, if
   * the number belongs to a rider. The answer never says which.
   */
  requestCode(phone: string): Promise<CodeRequestResult>;
  /** Step two: trade the code for the tokens every later call carries. */
  verifyCode(phone: string, code: string): Promise<void>;
  /** End the session on the server. Best effort: a failure must never block signing out. */
  logout(): Promise<void>;

  me(): Promise<Identity>;

  /** `vehicleId` only when `me` carried a `fleet` block. */
  duty(on: boolean, vehicleId?: number): Promise<DutyResult>;

  /** Vehicles free for this rider. Only when `me` carried a `fleet` block. */
  vehicles(): Promise<VehiclesResponse>;
  /**
   * Swap vehicles while on duty. Not `duty(true, id)` again: clocking on
   * restarts the shift clock on the server.
   */
  takeVehicle(vehicleId: number): Promise<TakeVehicleResult>;

  /**
   * Where an on-duty rider is, for the office's live map. Only when `me`'s
   * `fleet.features` has `location`. A refusal (`off_duty`) comes back as
   * `on_duty: false`, not as an error.
   */
  riderLocation(fix: {
    latitude: number;
    longitude: number;
    accuracy: number;
  }): Promise<RiderLocationResult>;

  orders(): Promise<OrdersResponse>;
  order(id: number): Promise<DeliveryOrder>;

  accept(id: number): Promise<ActionResult>;
  /** Say no to an offer. On success the job is gone from this rider's list. */
  decline(id: number, reason?: string): Promise<ActionResult>;
  /**
   * At the counter: has the shop sent its pickup code. Within a minute of the
   * last code the shop keeps that one (`resent: false`).
   */
  /** `fix` is sent only to a server with the `geofence` feature. */
  arrivedAtShop(id: number, fix?: Fix | null): Promise<ActionResult>;
  requestPickupOtp(id: number): Promise<ActionResult>;
  verifyPickupOtp(id: number, otp: string): Promise<ActionResult>;
  dispatch(id: number): Promise<ActionResult>;
  start(id: number): Promise<ActionResult>;
  /**
   * At the door: Odoo sends the customer their code, or a fresh one that voids
   * the last. Never in `allowed_actions`; the job screen calls it itself.
   */
  reachedCustomer(id: number): Promise<ActionResult>;
  verifyDeliveryOtp(id: number, otp: string): Promise<ActionResult>;

  sendLocation(
    id: number,
    fix: { latitude: number; longitude: number; accuracy: number }
  ): Promise<LocationResult>;

  /**
   * Hand Odoo a push token so it can wake this phone when a job is offered.
   *
   * `projectId` is the EAS project that minted the token. It is carried here
   * because Expo rejects a send whose messages span two projects; the current
   * backend has one project and no parameter for it, so its adapter drops it.
   */
  registerPush(input: {
    token: string;
    platform: string;
    projectId: string;
  }): Promise<void>;

  /** Deactivate a token on sign-out. */
  unregisterPush(token: string): Promise<void>;

  /** A photo of the parcel at the door, base64 JPEG. Needs the `proof` feature. */
  uploadProof(id: number, imageBase64: string): Promise<{ attachment_id: number }>;

  /** Into Fleet's service log, against the vehicle in hand. Needs `fuel`. */
  fuelReport(input: {
    liters: number;
    amount?: number;
    odometer?: number;
    note?: string;
    photoBase64?: string;
  }): Promise<LogResult>;

  /** `grounded`: the rider cannot ride it; it is offered to nobody after this shift. */
  vehicleIssue(input: {
    category: VehicleIssueCategory;
    note?: string;
    photoBase64?: string;
    grounded?: boolean;
  }): Promise<LogResult>;

  returnToShop(id: number, reason?: string): Promise<ActionResult>;
  confirmReturn(id: number): Promise<ActionResult>;
  reportIssue(id: number, note: string): Promise<ActionResult>;
}
