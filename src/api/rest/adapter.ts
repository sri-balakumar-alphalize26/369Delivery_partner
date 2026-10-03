import {
  ActionResult,
  ApiAdapter,
  ApiError,
  DeliveryOrder,
  DeliveryStatus,
  DutyResult,
  HistoryResponse,
  Identity,
  OrdersResponse,
  PastJob,
} from '../types';
import { logout, normaliseActions, request, requestCode, verifyCode } from './client';

/**
 * The live backend: the Delivery Partner API of the WhatsApp delivery module
 * (`sales_automation_delivery`), every path under /api/delivery. The database
 * header and the rider's token are attached by `client.ts`, so nothing here
 * deals with auth.
 *
 * The steps are the shop guide's, run by the same server actions as the
 * buttons on Odoo's job form (Rider_App_Developer_Plan.pdf rev 2, sections
 * 5-6b; Delivery_Developer_Flow.pdf section 3 before it):
 *
 *   accept → pickup/verify-otp → dispatch    (Collected by Rider)
 *          → start                           (Rider Near Customer)
 *          → arrived {point: "customer"}     (the customer is sent their code)
 *          → complete/verify-otp             (Delivered)
 *
 * `arrived` is never in `allowed_actions`: at `out_for_delivery` Odoo offers
 * the code straight away, so the app calls it itself at the door.
 *
 * An offer is one rider's at a time, with a time limit (`offer_expires_at`):
 * accept it, decline it, or let it lapse to the next rider.
 *
 * What this app does not use yet - vehicles, the door photo, push - is refused
 * or skipped here, and the screens never offer it: `me` carries no `fleet`
 * block, and push waits for its own round.
 */

const NOT_HERE = 'This server does not support that from the app. Ask the office.';

function notHere(): never {
  throw new ApiError('disabled', NOT_HERE);
}

/**
 * Every job the app reads goes through here: its buttons are names the app
 * knows, and the amount is a number. The list sends the amount as
 * `{"amount": 0.0, "formatted": "AED 0.00"}`, which `money()` cannot format
 * and the cash totals cannot add.
 */
function fixOrder(order: DeliveryOrder): DeliveryOrder {
  const raw = order.amount_to_collect as unknown;
  const amount =
    raw && typeof raw === 'object' ? Number((raw as { amount?: unknown }).amount) : Number(raw);
  return {
    ...order,
    amount_to_collect: Number.isFinite(amount) ? amount : 0,
    allowed_actions: normaliseActions(order.allowed_actions),
  };
}

function fixResult(result: ActionResult): ActionResult {
  return { ...result, allowed_actions: normaliseActions(result.allowed_actions) };
}

async function step(
  path: string,
  body: Record<string, unknown>,
  idempotencyKey?: string
): Promise<ActionResult> {
  return fixResult(await request<ActionResult>(path, { method: 'POST', body, idempotencyKey }));
}

export const restAdapter: ApiAdapter = {
  requestCode: (phone) => requestCode(phone),
  verifyCode: (phone, code) => verifyCode(phone, code),
  logout: () => logout(),

  // The first call after signing in, and on every launch: "is the token still
  // good" and "is this person a rider" together, plus the timezone and
  // currency everything else is formatted with.
  //
  // This API has the on-duty heartbeat and wants positions from Accept (rider
  // plan rev 2), but says so in no field - so it is said here, without a
  // `fleet` block, which would bring up the vehicle screens.
  async me() {
    const r = await request<Identity>('/api/delivery/auth/me');
    return { ...r, features: ['location', 'track_from_accept'] };
  },

  // No vehicle on this API: `me` has no fleet block, so none is ever picked.
  // Clocking on carries the phone's fix, when it has one.
  duty: (on, _vehicleId, fix) =>
    request<DutyResult>('/api/delivery/duty', {
      method: 'POST',
      body: {
        on_duty: on,
        ...(on && fix
          ? { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy }
          : {}),
      },
    }),

  vehicles: () => notHere(),
  takeVehicle: () => notHere(),

  /**
   * The on-duty heartbeat. It is what the shop's "Call a Rider" ranks by - a
   * rider with no fix in the last 30 minutes is called last - and it also
   * moves any job in hand on the customer's map. The server sets the pace:
   * every 2 min waiting, 30 s with a job.
   *
   * A 409 `off_duty` is the office clocking the rider off: read, not thrown,
   * so the loop ends quietly and Home redraws the switch.
   */
  async riderLocation(fix) {
    const r = await request<{
      success?: boolean;
      code?: string;
      on_duty?: boolean;
      poll_after_seconds?: number;
      has_new_offer?: boolean;
    }>('/api/delivery/rider/location', {
      method: 'POST',
      body: { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy },
      timeoutMs: 10000,
      allowRefusal: true,
    });
    const offDuty = r.success === false || r.on_duty === false;
    return {
      on_duty: !offDuty,
      poll_after_seconds: r.poll_after_seconds ?? 120,
      has_new_offer: !!r.has_new_offer,
    };
  },

  async orders() {
    const r = await request<OrdersResponse>('/api/delivery/orders');
    return { ...r, orders: (r.orders ?? []).map(fixOrder) };
  },

  // Nested under `order`, unlike the list.
  async order(id) {
    const r = await request<{ order: DeliveryOrder }>(`/api/delivery/orders/${id}`);
    return fixOrder(r.order);
  },

  /**
   * Finished work. `scripts/live-check.mjs` reads the rows from `history`,
   * falling back to `orders`, so both are taken here too; the rows are jobs
   * like the list's and go through the same fixes.
   */
  async history(limit = 50) {
    const r = await request<{
      history?: PastJob[];
      orders?: PastJob[];
      timezone?: string;
      earnings?: number;
    }>(`/api/delivery/history?limit=${limit}`);
    const rows = r.history ?? r.orders ?? [];
    const out: HistoryResponse = {
      jobs: rows.map((row) => ({ ...fixOrder(row), finished_at: row.finished_at })),
      timezone: r.timezone,
      earnings: r.earnings,
    };
    return out;
  },

  accept: (id) => step('/api/delivery/accept', { delivery_order_id: id }),

  /**
   * Turn an offer down. Odoo calls the next rider at once and never offers
   * this job to this rider again, so it is gone from here whatever the reply
   * holds (`status: "offered"`, `reassigned_to`, no actions).
   */
  async decline(id, reason) {
    const res = await step('/api/delivery/decline', {
      delivery_order_id: id,
      reason: reason ?? '',
    });
    return { ...res, removed: true };
  },

  /**
   * At the counter. The counter makes the pickup code (Generate Pickup Code,
   * sent to the rider's WhatsApp too), so the app asks for none by itself:
   * `/arrived {point: "shop"}` would issue a new code and void that one. The
   * rider asks explicitly with "Ask the shop for a code" (`requestPickupOtp`).
   */
  async arrivedAtShop(id) {
    const order = await restAdapter.order(id);
    return {
      status: order.delivery_status,
      allowed_actions: order.allowed_actions,
      message: 'Ask the counter for the 6-digit pickup code.',
    };
  },

  requestPickupOtp: (id) => step('/api/delivery/pickup/request-otp', { delivery_order_id: id }),

  verifyPickupOtp: (id, otp) =>
    step('/api/delivery/pickup/verify-otp', { delivery_order_id: id, otp }),

  dispatch: (id, key) => step('/api/delivery/dispatch', { delivery_order_id: id }, key),

  start: (id, key) => step('/api/delivery/start', { delivery_order_id: id }, key),

  // Reached Customer Location: Odoo stamps the time and sends the customer
  // their code. Calling it again sends a fresh one, voiding the last.
  reachedCustomer: (id, key) =>
    step('/api/delivery/arrived', { delivery_order_id: id, point: 'customer' }, key),

  verifyDeliveryOtp: (id, otp) =>
    step('/api/delivery/complete/verify-otp', { delivery_order_id: id, otp }),

  /**
   * "Tracking is over" can arrive as a refusal. It is an instruction, not a
   * failure - the location service must switch off on it - so it is read
   * rather than thrown.
   *
   * `latitude`/`longitude`, never `lat`/`lng`: Odoo reads only the long names,
   * and a fix under the short ones was dropped while the reply still said
   * success - the customer's map stayed empty for every delivery.
   */
  async sendLocation(id, fix) {
    const r = await request<{
      success?: boolean;
      stop?: boolean;
      status?: DeliveryStatus;
      status_name?: DeliveryStatus;
      poll_after_seconds?: number;
    }>('/api/delivery/location', {
      method: 'POST',
      body: {
        delivery_order_id: id,
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracy: fix.accuracy,
      },
      // A stale fix is worthless; fail fast rather than queueing behind a bad link.
      timeoutMs: 10000,
      allowRefusal: true,
    });
    return {
      stop: r.success === false || !!r.stop,
      status: (r.status ?? r.status_name) as DeliveryStatus,
      poll_after_seconds: r.poll_after_seconds,
    };
  },

  // No push route on this API; the job list's polling is how a rider hears
  // about work. Accepted and dropped, so sign-in and sign-out never fail on it.
  async registerPush() {},
  async unregisterPush() {},

  uploadProof: () => notHere(),
  fuelReport: () => notHere(),
  vehicleIssue: () => notHere(),

  returnToShop: (id, reason, key) =>
    step('/api/delivery/return', { delivery_order_id: id, reason: reason ?? '' }, key),

  // Only the shop closes a return now. Should Odoo still offer this, its
  // `wrong_state` answer redraws the screen from the truth.
  confirmReturn: (id) => step('/api/delivery/return/confirm', { delivery_order_id: id }),

  // Written to the job's Last Error and its log; the state does not change.
  reportIssue: (id, note, key) =>
    step('/api/delivery/issue', { delivery_order_id: id, reason: note }, key),
};
