import {
  ActionResult,
  ApiAdapter,
  ApiError,
  DeliveryOrder,
  DeliveryStatus,
  DutyResult,
  Identity,
  OrdersResponse,
} from '../types';
import { logout, normaliseActions, request, requestCode, verifyCode } from './client';

/**
 * The live backend: the Delivery Partner API of the WhatsApp delivery module
 * (`sales_automation_delivery`), every path under /api/delivery. The database
 * header and the rider's token are attached by `client.ts`, so nothing here
 * deals with auth.
 *
 * The steps are the shop guide's, run by the same server actions as the
 * buttons on Odoo's job form (Delivery_Developer_Flow.pdf, section 3):
 *
 *   accept → pickup/verify-otp → dispatch    (Collected by Rider)
 *          → start                           (Rider Near Customer)
 *          → arrived {point: "customer"}     (the customer is sent their code)
 *          → complete/verify-otp             (Delivered)
 *
 * `arrived` is never in `allowed_actions`: at `out_for_delivery` Odoo offers
 * the code straight away, so the app calls it itself at the door.
 *
 * What the API has no route for - declining, vehicles, the door photo, push -
 * is refused or skipped here, and the screens never offer it: Odoo does not put
 * `decline` in `allowed_actions`, and `me` carries no `fleet` block.
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

async function step(path: string, body: Record<string, unknown>): Promise<ActionResult> {
  return fixResult(await request<ActionResult>(path, { method: 'POST', body }));
}

export const restAdapter: ApiAdapter = {
  requestCode: (phone) => requestCode(phone),
  verifyCode: (phone, code) => verifyCode(phone, code),
  logout: () => logout(),

  // The first call after signing in, and on every launch: "is the token still
  // good" and "is this person a rider" together, plus the timezone and
  // currency everything else is formatted with.
  me: () => request<Identity>('/api/delivery/auth/me'),

  // No vehicle on this API: `me` has no fleet block, so none is ever picked.
  duty: (on) =>
    request<DutyResult>('/api/delivery/duty', { method: 'POST', body: { on_duty: on } }),

  vehicles: () => notHere(),
  takeVehicle: () => notHere(),

  // The office's live map is not on this API; positions travel with a job's
  // own tracking instead. Never called without the `location` feature.
  async riderLocation() {
    return { on_duty: true, poll_after_seconds: 120, has_new_offer: false };
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

  accept: (id) => step('/api/delivery/accept', { delivery_order_id: id }),

  decline: () => notHere(),

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

  dispatch: (id) => step('/api/delivery/dispatch', { delivery_order_id: id }),

  start: (id) => step('/api/delivery/start', { delivery_order_id: id }),

  // Reached Customer Location: Odoo stamps the time and sends the customer
  // their code. Calling it again sends a fresh one, voiding the last.
  reachedCustomer: (id) =>
    step('/api/delivery/arrived', { delivery_order_id: id, point: 'customer' }),

  verifyDeliveryOtp: (id, otp) =>
    step('/api/delivery/complete/verify-otp', { delivery_order_id: id, otp }),

  /**
   * "Tracking is over" can arrive as a refusal. It is an instruction, not a
   * failure - the location service must switch off on it - so it is read
   * rather than thrown.
   */
  async sendLocation(id, fix) {
    const r = await request<{
      success?: boolean;
      stop?: boolean;
      status?: DeliveryStatus;
      status_name?: DeliveryStatus;
    }>('/api/delivery/location', {
      method: 'POST',
      body: {
        delivery_order_id: id,
        lat: fix.latitude,
        lng: fix.longitude,
        accuracy: fix.accuracy,
      },
      // A stale fix is worthless; fail fast rather than queueing behind a bad link.
      timeoutMs: 10000,
      allowRefusal: true,
    });
    return {
      stop: r.success === false || !!r.stop,
      status: (r.status ?? r.status_name) as DeliveryStatus,
    };
  },

  // No push route on this API; the job list's polling is how a rider hears
  // about work. Accepted and dropped, so sign-in and sign-out never fail on it.
  async registerPush() {},
  async unregisterPush() {},

  uploadProof: () => notHere(),
  fuelReport: () => notHere(),
  vehicleIssue: () => notHere(),

  returnToShop: (id, reason) =>
    step('/api/delivery/return', { delivery_order_id: id, reason: reason ?? '' }),

  // Only the shop closes a return now. Should Odoo still offer this, its
  // `wrong_state` answer redraws the screen from the truth.
  confirmReturn: (id) => step('/api/delivery/return/confirm', { delivery_order_id: id }),

  // Written to the job's Last Error and its log; the state does not change.
  reportIssue: (id, note) => step('/api/delivery/issue', { delivery_order_id: id, reason: note }),
};
