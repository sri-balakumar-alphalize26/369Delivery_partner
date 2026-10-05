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
 *   accept → arrived {point: "shop"}         (the branch presses Dispatch)
 *          → pickup/verify-otp               (Collected by Rider, unlocked)
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
  // Rider B in a takeover collects from rider A, not the shop. Standing rider
  // A in for the shop points the map, Navigate, Call and the job card at A's
  // live position with no screen having to know (Rider_App_Report_Problem.pdf).
  const from = order.pickup_from;
  const shop: DeliveryOrder['shop'] =
    from?.kind === 'rider'
      ? {
          id: -from.id,
          name: `Rider ${from.name}`,
          image_url: null,
          latitude: from.latitude,
          longitude: from.longitude,
          address: from.address || `${from.name}'s live position`,
          phone: from.phone,
        }
      : order.shop;
  return {
    ...order,
    shop,
    amount_to_collect: Number.isFinite(amount) ? amount : 0,
    allowed_actions: normaliseActions(order.allowed_actions),
  };
}

function fixResult(result: ActionResult): ActionResult {
  return {
    ...result,
    allowed_actions: normaliseActions(result.allowed_actions),
    // A verified pickup code carries the whole job, now unlocked.
    ...(result.order ? { order: fixOrder(result.order) } : {}),
  };
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
      // A number before 19.0.21.5.0, the per-period object since.
      earnings?: HistoryResponse['earnings'];
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
   * At the counter. In branch mode (`pickup_handover: "branch"`, the default
   * since delivery 19.0.22.0.0) no code is made: the Shop Queue card rings,
   * staff press Dispatch and read the rider the code off their screen, and the
   * reply says `waiting_for_branch`. In the older `rider_request` mode the
   * server sends the code to the shop's WhatsApp, or to the rider's when the
   * job has no shop.
   */
  async arrivedAtShop(id, fix) {
    const res = await step('/api/delivery/arrived', {
      delivery_order_id: id,
      point: 'shop',
      ...(fix ? { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy } : {}),
    });
    if (res.otp_sent === false && !res.waiting_for_branch) {
      return {
        ...res,
        message: `${res.message ?? 'Could not send the pickup code.'} Ask the counter to tap Generate Pickup Code.`,
      };
    }
    return res;
  },

  // In branch mode: "Remind the counter" - rings the Shop Queue card again and
  // makes no code.
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

  /**
   * A parcel photo as a multipart upload: `delivery_order_id` and `file`, 8 MB
   * at most (a larger one is refused `too_large`). `stage` is ours, not the
   * contract's yet: the server keeps the file and drops the field for now.
   */
  async uploadProof(id, uri, fileName, stage) {
    const form = new FormData();
    form.append('delivery_order_id', String(id));
    form.append('stage', stage);
    // React Native's FormData takes a file as {uri, name, type}.
    form.append('file', { uri, name: fileName, type: 'image/jpeg' } as unknown as Blob);
    const r = await request<{ attachment_id: number }>('/api/delivery/proof', {
      method: 'POST',
      form,
      // A photo on a weak signal takes longer than a JSON call.
      timeoutMs: 60_000,
    });
    return { attachment_id: r.attachment_id };
  },
  fuelReport: () => notHere(),
  vehicleIssue: () => notHere(),

  returnToShop: (id, reason, key) =>
    step('/api/delivery/return', { delivery_order_id: id, reason: reason ?? '' }, key),

  // Only the shop closes a return now. Should Odoo still offer this, its
  // `wrong_state` answer redraws the screen from the truth.
  confirmReturn: (id) => step('/api/delivery/return/confirm', { delivery_order_id: id }),

  /**
   * Tells the office, and for the eight known codes the server also takes the
   * next step itself and answers with `next` (delivery 19.0.22.5.0): a
   * message to the customer, a wait, a return allowed, a new drop point, or
   * another rider. The code goes in `reason`, a free note in `note`.
   */
  async reportIssue(id, reason, key, extra) {
    // "other: <words>" from older callers splits into the code and a note.
    const other = /^other:\s*([\s\S]*)$/.exec(reason);
    const fields: Record<string, string> = other
      ? { reason: 'other', note: other[1] }
      : { reason };
    if (extra?.note) fields.note = extra.note;
    if (extra?.photoUri) {
      const form = new FormData();
      form.append('delivery_order_id', String(id));
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      form.append('file', {
        uri: extra.photoUri,
        name: extra.photoName ?? `problem_${id}.jpg`,
        type: 'image/jpeg',
      } as unknown as Blob);
      return fixResult(
        await request<ActionResult>('/api/delivery/issue', {
          method: 'POST',
          form,
          idempotencyKey: key,
          timeoutMs: 60_000,
        })
      );
    }
    return step('/api/delivery/issue', { delivery_order_id: id, ...fields }, key);
  },

  verifyHandover: (id, code) =>
    step('/api/delivery/handover/verify', { delivery_order_id: id, code }),
  cancelHandover: (id) => step('/api/delivery/handover/cancel', { delivery_order_id: id }),
  newHandoverCode: (id) => step('/api/delivery/handover/new-code', { delivery_order_id: id }),
};
