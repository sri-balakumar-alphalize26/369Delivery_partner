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

/**
 * Button labels. A lookup for rendering only — it confers no permission.
 *
 * Worded after the shop's Step-by-Step Guide, so the rider and the counter
 * name each step the same way: Collect, near the customer, reached, delivered.
 */
export const ACTION_LABEL: Record<Action, string> = {
  accept: 'Accept this job',
  decline: 'Decline',
  verify_pickup_otp: 'Collect – enter pickup code',
  // Normally fired straight after the pickup code; a button only if that failed.
  dispatch: 'Collected – leaving the shop',
  start_delivery: 'I am near the customer',
  verify_delivery_otp: 'Delivered – enter customer code',
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

/**
 * The states Odoo wants positions in: from Accept until Delivered (rider plan
 * rev 2, section 6b). The customer's tracking page and the shop's Live Tracking
 * draw nothing else.
 */
export const TRACKED_STATES: readonly DeliveryStatus[] = [
  'accepted',
  'picked',
  'dispatched',
  'out_for_delivery',
];

/**
 * Whether a reply or a job wants the location service on. The server's own
 * `tracking` flag wins; the state answers for a reply that carries none.
 */
export function trackingWanted(status: DeliveryStatus | undefined, tracking?: Tracking): boolean {
  if (tracking) return tracking.enabled;
  return !!status && TRACKED_STATES.includes(status);
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

/**
 * Why a rider turns an offer down. Free text on the server, read by the shop
 * deciding who to call next, so plain words rather than codes.
 */
export const DECLINE_REASONS = [
  { code: 'too far', label: 'Too far from me' },
  { code: 'busy', label: 'I am busy right now' },
  { code: 'vehicle problem', label: 'Problem with my vehicle' },
  { code: 'other', label: 'Something else' },
] as const;

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
  /**
   * The job has no shop, so the warehouse is the pickup point (delivery
   * 19.0.21.4.0). `id` is then null and `name` is the warehouse's.
   */
  is_warehouse?: boolean;
}

/** Money as the server formats it, with its own currency and separators. */
export interface Money {
  amount: number;
  /** e.g. "₹1,630.00" — shown as it is, never rebuilt in the app. */
  formatted: string;
}

export interface DeliveryOrder {
  delivery_order_id: number;
  delivery_order_name: string;
  job_code: string;
  sales_order: string;

  customer_name: string;
  customer_mobile: string;
  delivery_address: string;
  /**
   * Object since N2; string before it; null when the job has no shop, which
   * DUBAI_TEST sends for every job made before a shop existed. Render via
   * `shopName()`, read fields via `shopInfo()`.
   */
  shop: Shop | string | null;
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

  /**
   * While `offered`: when the offer lapses and goes to the next rider (UTC,
   * `Z`). Count down against the server's clock (`lib/clock`), never the
   * phone's. The shop sets the limit, 60 s by default.
   */
  offer_expires_at?: string;
  /** Which call this is for the job: 1 for the first rider asked. */
  offer_round?: number;

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

  /*
   * Added by delivery 19.0.21.4.0 / 19.0.21.5.0 (Rider_App_Last_3_Updates.pdf).
   * Optional, so an older server that sends none of them still type-checks.
   */
  /**
   * The customer's landmark, flat or gate note, from the WhatsApp chat: "Opposite
   * the Murugan temple, blue gate". One free-text answer; shown in bold under
   * the address. (`landmark` and `door` also ship, always empty.)
   */
  delivery_note?: string;
  /** Where the customer pin came from. `geocoded` is the typed address looked up: approximate. */
  location_source?: 'customer_pin' | 'geocoded' | null;
  /** Shop to customer, in metres, as the server measured it. */
  shop_to_customer_m?: number | null;
  /**
   * Pay for this trip: Delivery Partners (`rider.kind = "third_party"`) only,
   * null for own riders, who are on salary. Never worked out in the app.
   */
  rider_fee?: Money | null;
  /**
   * The customer's online pay page, on cash jobs only; null once paid. Shown
   * as a QR for the customer's own phone — never opened in the rider's app.
   */
  pay_url?: string | null;
}

/** The dashboard figures. */
export interface OrderCounts {
  assigned: number;
  picked_up: number;
  out_for_delivery: number;
  /** All time — not today, whatever an older label said. */
  delivered: number;
  /** In the rider's timezone; the week starts Monday (delivery 19.0.21.5.0). */
  delivered_today?: number;
  delivered_week?: number;
  delivered_month?: number;
}

/**
 * The bucket behind each of the four status figures. Named rather than
 * `keyof OrderCounts`, which would now take in the dated counts too.
 */
export type CountBucket = 'assigned' | 'picked_up' | 'out_for_delivery' | 'delivered';

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

/**
 * A finished job on `GET /history`: the same shape as a live one, plus when it
 * ended. Live it has only been seen through `scripts/live-check.mjs`, which
 * reads rows from `history`, falling back to `orders` — so both are accepted.
 */
export interface PastJob extends DeliveryOrder {
  /** UTC, ending in `Z`, like `promised_by`. */
  finished_at?: string;
}

/**
 * A Delivery Partner's pay on `/history` (delivery 19.0.21.5.0), formatted by
 * the server with separators ("₹1,630.00"). All zero for own riders.
 */
export interface HistoryEarnings {
  today?: Money;
  week?: Money;
  month?: Money;
  total?: Money;
  amount?: number;
  formatted?: string;
}

export interface HistoryResponse {
  jobs: PastJob[];
  timezone?: string;
  /**
   * A plain number on servers before 19.0.21.5.0 (always 0, no pay model);
   * the per-period object since. Shown only to Delivery Partners.
   */
  earnings?: number | HistoryEarnings;
}

export interface Rider {
  id: number;
  name: string;
  mobile: string;
  /**
   * `own` for staff riders, on salary; `third_party` for Delivery Partners,
   * paid per trip (`rider_fee`).
   */
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
  /** `off`, `idle` (on duty, free) or `busy` (a job in hand) — what the shop sees. */
  fleet_state?: 'off' | 'idle' | 'busy';
  /** The area the clock-on fix fell in, e.g. "al Azaiba, Muscat". Only with a fix. */
  address_short?: string;
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
  /** When to send the next fix: 20 s on the way, 10 s near the customer. */
  poll_after_seconds?: number;
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
  // An Accept that came after the offer's time limit: it has gone to the next rider.
  | 'offer_expired'
  // A push token registered without a bearer session.
  | 'no_device'
  | 'bad_request'
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
  /**
   * What the rider API offers beyond the fleet block: `location` (the on-duty
   * heartbeat) and `track_from_accept`. The REST adapter fills it in — the
   * API carries no such list of its own.
   */
  features?: string[];
  /**
   * Whether the shop is using Delivery Partners at all (delivery 19.0.21.5.0).
   * Off: a partner can still sign in and see history and pay, but is offered
   * nothing. Own riders are not affected. Absent on an older server.
   */
  third_party_enabled?: boolean;
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

  /**
   * `vehicleId` only when `me` carried a `fleet` block. `fix` goes with
   * clocking on: the shop's "Call a Rider" ranks riders by it from the first
   * minute, and the answer names the area it fell in.
   */
  duty(on: boolean, vehicleId?: number, fix?: Fix | null): Promise<DutyResult>;

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
  /** Finished work, newest first. Jobs leave `orders()` the moment they end. */
  history(limit?: number): Promise<HistoryResponse>;

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
  /*
   * `key` on the steps below is the Idempotency-Key. Only the outbox passes
   * one: a step tapped with no signal is re-sent under the key it was first
   * queued with, so a send whose answer was lost cannot run twice.
   */
  dispatch(id: number, key?: string): Promise<ActionResult>;
  start(id: number, key?: string): Promise<ActionResult>;
  /**
   * At the door: Odoo sends the customer their code, or a fresh one that voids
   * the last. Never in `allowed_actions`; the job screen calls it itself.
   */
  reachedCustomer(id: number, key?: string): Promise<ActionResult>;
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

  /**
   * A photo of the parcel at the door. Optional: the server accepts it in any
   * state while the job is the rider's, several per job, and never requires
   * one before Delivered (delivery 19.0.21.4.0). The REST API takes the file
   * itself (`uri`, multipart, 8 MB at most); base64 is for older servers.
   */
  uploadProof(id: number, imageBase64: string, uri?: string): Promise<{ attachment_id: number }>;

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

  returnToShop(id: number, reason?: string, key?: string): Promise<ActionResult>;
  confirmReturn(id: number): Promise<ActionResult>;
  reportIssue(id: number, note: string, key?: string): Promise<ActionResult>;
}
