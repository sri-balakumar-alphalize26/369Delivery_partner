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
  /**
   * "I'm at the counter" (Rider_App_Pickup_Flow.pdf, delivery 19.0.22.0.0).
   * Odoo keeps offering it next to `verify_pickup_otp` after the rider has
   * pressed it, so the job screen reads `arrived_at_shop` to know whether it
   * is still due. Never in `PRIMARY_ACTIONS` for that reason.
   */
  | 'arrived_shop'
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
  | 'decline'
  /*
   * The rider-to-rider handover after a vehicle problem with the parcel on
   * board (Rider_App_Report_Problem.pdf, delivery 19.0.22.5.0). Rider A's bike
   * is fixed: back on the delivery. Rider B types A's code to take the parcel.
   */
  | 'cancel_handover'
  | 'verify_handover';

/**
 * Button labels. A lookup for rendering only — it confers no permission.
 *
 * Worded after the shop's Step-by-Step Guide, so the rider and the counter
 * name each step the same way: Collect, near the customer, reached, delivered.
 */
export const ACTION_LABEL: Record<Action, string> = {
  accept: 'Accept this job',
  decline: 'Decline',
  arrived_shop: "I'm at the counter",
  verify_pickup_otp: 'Collect – enter pickup code',
  // Normally fired straight after the pickup code; a button only if that failed.
  dispatch: 'Collected – leaving the shop',
  start_delivery: 'I am near the customer',
  verify_delivery_otp: 'Delivered – enter customer code',
  return_to_shop: 'Return to shop',
  confirm_return: 'Confirm return',
  report_issue: 'Report a problem',
  cancel_handover: 'Bike fixed – carry on',
  verify_handover: 'Collect – enter handover code',
};

/**
 * The action Odoo considers the main one at each step, so the UI can give it
 * the big button and push the rest down. Ordering only — never gating.
 */
export const PRIMARY_ACTIONS: Action[] = [
  'accept',
  'verify_pickup_otp',
  'verify_handover',
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
  // Rider B rides to rider A's live position, which the server reads from A.
  'handover_waiting',
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
  | 'failed'
  /**
   * Rider A after a vehicle problem with the parcel on board: waiting for
   * another rider to come and take it. Only report_issue / cancel_handover.
   */
  | 'handover_waiting'
  /** A vehicle problem before pickup: the job left this rider, like a decline. */
  | 'released';

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
  // The customer is at work, a temple, a friend's: not the saved address.
  // Today it only tells the office; the server is asked to confirm the place
  // with the customer and keep it for this order only.
  { code: 'customer_elsewhere', label: 'Customer is at another place' },
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

  /*
   * Pickup at the branch (Rider_App_Pickup_Flow.pdf, delivery 19.0.22.0.0).
   * Optional, so an older server that sends none of them reads as before:
   * unlocked, and the old pickup-code flow.
   */
  /**
   * True until the pickup code is verified. While it is, Odoo sends the
   * street address, mobile and note as "" and the pins and `pay_url` as null;
   * only `customer_area`, `customer_name` and `shop_to_customer_m` are real.
   * A Delivery Settings switch can turn the lock off, so read this, never the
   * status.
   */
  customer_location_locked?: boolean;
  /** City and pincode, e.g. "Dindigul, 624003". Always sent. */
  customer_area?: string;
  /**
   * Who makes the pickup code. `branch`: the counter presses Dispatch and
   * reads it out. `rider_request`: the old flow, the code goes to the shop's
   * WhatsApp. `rider_shows`: the code goes to the rider, the shop types it.
   */
  pickup_handover?: 'branch' | 'rider_request' | 'rider_shows';
  /** UTC time the rider pressed "I'm at the counter", or "". */
  arrived_at_shop?: string;
  /** True once the branch has pressed Dispatch and a code waits to be typed. */
  pickup_code_ready?: boolean;

  /*
   * Automatic "Rider Near Customer" (Rider_App_Auto_Near.pdf, delivery
   * 19.0.22.1.0). The server moves a dispatched job on by itself once the
   * heartbeat has stayed near a real customer pin; the button is the fallback.
   */
  /** When the job became "Rider Near Customer", UTC, or "" until then. */
  near_customer_at?: string;
  /** True only when the server set it from the rider's position, not a tap. */
  near_customer_auto?: boolean;

  /*
   * Where the parcel changed hands (Rider_App_Keep_Address.pdf, delivery
   * 19.0.22.2.0). Delivered no longer writes anything on the customer; the
   * spot is kept on the job instead.
   */
  /**
   * The rider's last heartbeat at Delivered, if it was under 10 minutes old.
   * Null before delivery or when no position was known; `metres_from_pin` is
   * null when the customer has no pin.
   */
  handover?: {
    latitude: number;
    longitude: number;
    at: string;
    metres_from_pin: number | null;
  } | null;

  /*
   * Parcel photos (Rider_App_Parcel_Photos.pdf, delivery 19.0.22.4.0): 2 to 4
   * after the pickup code and after the customer's code, kept per stage.
   */
  /** How many photos the server holds for each stage. */
  photo_counts?: { pickup: number; delivery: number };
  /** `problem`: the photo sent with a "Parcel is damaged" report (19.0.22.5.0). */
  photos?: { pickup: ProofPhotoRef[]; delivery: ProofPhotoRef[]; problem?: ProofPhotoRef[] };
  /** Stages short of 2 photos; `["delivery"]` right after Delivered is expected. */
  photos_missing?: ('pickup' | 'delivery')[];

  /*
   * After "Report a problem" (Rider_App_Report_Problem.pdf, delivery
   * 19.0.22.5.0). The server takes the next step for each reason itself; the
   * job carries where that stands, so a reopened screen shows it again.
   */
  /** The open problem, or null. `wait_until` is "" once there is no timer. */
  problem?: JobProblem | null;
  /**
   * Where the parcel goes for this delivery only: the location the customer
   * shared, or the spot where the rider waits. When set, the job's
   * latitude/longitude already ARE this point; the saved address is untouched.
   */
  drop_point?: DropPoint | null;
  /** Where the parcel is collected: the shop, or rider A in a takeover. */
  pickup_from?: PickupFrom | null;
  /** A takeover job: rider A waiting to hand over, or rider B coming to collect. */
  is_relay?: boolean;
  /** Rider A only: the 6-digit code rider B types. Present the whole time. */
  handover_code?: string;
  /** Rider A only: how the search for rider B stands. */
  relay?: RelayInfo | null;
  /** Rider B, after the code: the rider the parcel came from. */
  taken_over_from?: string;
}

export interface JobProblem {
  reason: string;
  at: string;
  /** UTC end of the wait before a return is allowed, or "". */
  wait_until: string;
  waiting_for: 'customer' | 'customer_location' | '';
  return_reason: string;
}

export interface DropPoint {
  latitude: number;
  longitude: number;
  /** "Where the rider is waiting", or the customer's shared place. */
  label: string;
  at: string;
}

export type PickupFrom =
  | ({ kind: 'shop' } & Partial<Shop>)
  | {
      kind: 'rider';
      id: number;
      name: string;
      phone: string;
      latitude: number | null;
      longitude: number | null;
      fix_at: string;
      address: string;
    };

export interface RelayInfo {
  /** `none`: nobody free; the office has been told to call. */
  relay_state: 'searching' | 'offered' | 'accepted' | 'none';
  handover_code: string;
  to_rider: { id: number; name: string; phone: string } | null;
}

/** What the server did after a report: the step that follows. */
export interface ProblemNext {
  kind: 'wait' | 'return_allowed' | 'new_drop_point' | 'reassigning' | 'none';
  wait_until?: string;
  waiting_for?: 'customer' | 'customer_location' | '';
  drop_point?: DropPoint;
  relay_state?: RelayInfo['relay_state'];
  handover_code?: string;
  to_rider?: RelayInfo['to_rider'];
}

/** One stored parcel photo. `url` needs the usual auth headers to fetch. */
export interface ProofPhotoRef {
  id: number;
  name: string;
  url: string;
  size: number;
  at: string;
}

/** `/auth/me`: when the server marks "near" by itself (Delivery Settings). */
export interface AutoNearCustomer {
  enabled: boolean;
  radius_m: number;
  dwell_seconds: number;
}

/** Whether the customer's address, pin, phone and pay link are still withheld. */
export function isDropLocked(order: Pick<DeliveryOrder, 'customer_location_locked'>): boolean {
  return order.customer_location_locked === true;
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
  picked_up: ['picked', 'dispatched', 'handover_waiting'],
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
  /** On `arrived`: whether the code's WhatsApp went out. */
  otp_sent?: boolean;
  /**
   * On `arrived` and the pickup-code request, in branch mode: no code was
   * made, the counter has been rung and will press Dispatch. Not an error.
   */
  waiting_for_branch?: boolean;
  /** On `arrived`: when the server logged the arrival, UTC. */
  arrived_at?: string;
  /** On a verified pickup code: the whole job, now unlocked. */
  order?: DeliveryOrder;
  /** On `start`, also when the server had already marked it near. */
  near_customer_at?: string;
  near_customer_auto?: boolean;
  /** On `issue`: what the server does next for this reason. */
  next?: ProblemNext;
  /** On a 409 `wait`: when a return becomes possible, UTC. */
  wait_until?: string;
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
  // A 5th parcel photo for one stage (delivery 19.0.22.4.0): the server has the most it keeps.
  | 'too_many_photos'
  // A return while the "customer not there" timer runs (19.0.22.5.0): see `waitUntil`.
  | 'wait'
  // Delivered, Return or Start while rider A waits for rider B to take over.
  | 'handover_waiting'
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
  /** On a 409 `wait`: when a return becomes possible, UTC. */
  waitUntil?: string;

  constructor(
    code: ApiErrorCode,
    message: string,
    opts: {
      status?: number;
      statusName?: DeliveryStatus;
      allowedActions?: Action[];
      waitUntil?: string;
    } = {}
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = opts.status;
    this.statusName = opts.statusName;
    this.allowedActions = opts.allowedActions;
    this.waitUntil = opts.waitUntil;
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
  /** Absent on a server before delivery 19.0.22.1.0: the rider always taps. */
  auto_near_customer?: AutoNearCustomer;
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
   * One parcel photo, after the pickup code or the customer's code: 2 to 4
   * per stage. The REST API takes the file itself (multipart, 8 MB at most)
   * under `fileName`, the owner's `S00042_051026_173915.jpg`, and files it by
   * `stage` (delivery 19.0.22.4.0). The same name sent twice is kept once
   * (`duplicate: true`), so a retry after a dropped signal is safe; a 5th is
   * refused `too_many_photos`; a job finished over 24 h ago, `wrong_state`.
   */
  uploadProof(
    id: number,
    uri: string,
    fileName: string,
    stage: 'pickup' | 'delivery'
  ): Promise<{ attachment_id: number }>;

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
  /**
   * `reason` is one of the codes the server acts on (DELIVERY_REASONS), or
   * free text such as "item_missing: …", which only tells the office.
   * "other: <note>" goes up as reason `other` with the note apart. A photo
   * (a damaged parcel) makes it a multipart upload.
   */
  reportIssue(
    id: number,
    reason: string,
    key?: string,
    /** `note`: the rider's own words, sent with any reason code. */
    extra?: { photoUri?: string; photoName?: string; note?: string }
  ): Promise<ActionResult>;

  /** Rider B: the 6-digit code rider A shows. On success the job is B's, unlocked. */
  verifyHandover(id: number, code: string): Promise<ActionResult>;
  /** Rider A: the bike is fixed, back on the delivery. */
  cancelHandover(id: number): Promise<ActionResult>;
  /** Rider A: a fresh code after five wrong tries locked the old one. */
  newHandoverCode(id: number): Promise<ActionResult>;
}
