import { call, login, logout, uuid } from './client';
import {
  ActionResult,
  ApiAdapter,
  DeliveryOrder,
  DutyResult,
  Identity,
  LocationResult,
  OrdersResponse,
} from '../types';

/**
 * The live Odoo backend: the `sa.rider.rpc` model of the `delivery_rider_rpc`
 * module, over JSON-RPC. Sign-in and the session cookie live in `client.ts`, so
 * nothing here deals with auth.
 *
 * Method and parameter names are the module's, so this file is the whole map
 * between the two vocabularies: the app's `delivery_order_id` is the module's
 * `job_id`, a problem report's `note` is its `reason`.
 *
 * Every tap carries a fresh `client_uuid`. The module runs an action once per
 * uuid and answers a repeat with the first result, which is what makes a tap
 * that is re-sent after a dropped connection safe.
 */
export const rpcAdapter: ApiAdapter = {
  login: (mobile, password) => login(mobile, password),
  logout: () => logout(),

  // The first call after signing in: "did the credentials work" and "is this
  // person a rider" together, plus the timezone and currency everything else
  // is formatted with.
  me: () => call<Identity>('me'),

  duty: (on) => call<DutyResult>('set_duty', { on_duty: on, client_uuid: uuid() }),

  orders: () => call<OrdersResponse>('orders'),

  // Nested under `order`, unlike the list — the module's one shape for it.
  async order(id) {
    const r = await call<{ order: DeliveryOrder }>('order', { job_id: id });
    return r.order;
  },

  accept: (id) => call<ActionResult>('accept', { job_id: id, client_uuid: uuid() }),

  requestPickupOtp: (id) => call<ActionResult>('request_pickup_otp', { job_id: id }),

  verifyPickupOtp: (id, otp) =>
    call<ActionResult>('verify_pickup', { job_id: id, otp, client_uuid: uuid() }),

  dispatch: (id) => call<ActionResult>('dispatch', { job_id: id, client_uuid: uuid() }),

  start: (id) => call<ActionResult>('start', { job_id: id, client_uuid: uuid() }),

  verifyDeliveryOtp: (id, otp) =>
    call<ActionResult>('verify_delivery', { job_id: id, otp, client_uuid: uuid() }),

  /**
   * "Tracking is over" arrives as `success: false, stop: true`. It is an
   * instruction, not a failure — the location service must switch off on it —
   * so the refusal is read rather than thrown. A job that is no longer this
   * rider's (`not_found`) means the same thing.
   */
  async sendLocation(id, fix) {
    const r = await call<LocationResult & { success: boolean }>(
      'ping',
      { job_id: id, latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy },
      // A stale fix is worthless; fail fast rather than queueing behind a bad link.
      { timeoutMs: 10000, allowRefusal: true }
    );
    return { stop: r.success === false || !!r.stop, status: r.status };
  },

  // The EAS project id is deliberately not sent: the module has no parameter
  // for it, and one EAS project mints every token this app registers.
  async registerPush({ token, platform }) {
    await call('register_push', { token, platform });
  },

  async unregisterPush(token) {
    await call('unregister_push', { token });
  },

  returnToShop: (id, reason) =>
    call<ActionResult>('return_to_shop', { job_id: id, reason: reason ?? '', client_uuid: uuid() }),

  /**
   * The module's prose says only the shop closes a return, but its state table
   * offers `confirm_return` to the rider. Render what Odoo offers and let Odoo
   * refuse it — a `wrong_state` answer re-renders the screen from the truth.
   */
  confirmReturn: (id) => call<ActionResult>('confirm_return', { job_id: id, client_uuid: uuid() }),

  reportIssue: (id, note) =>
    call<ActionResult>('report_issue', { job_id: id, reason: note, client_uuid: uuid() }),
};
