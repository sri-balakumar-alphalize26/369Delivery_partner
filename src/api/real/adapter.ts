import { request } from '../client';
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
 * The live Odoo backend, over the published contract.
 *
 * Every path is under /api/delivery. The database header and the bearer token
 * are attached by `client.ts`, so nothing here deals with auth.
 */
export const realAdapter: ApiAdapter = {
  // The contract calls this the first call to make after signing in: it answers
  // "did the credentials work" and "is this person a rider" together, and
  // carries the timezone and currency everything else is formatted with.
  me: () => request<Identity>('/api/delivery/auth/me'),

  duty: (on) =>
    request<DutyResult>('/api/delivery/duty', {
      method: 'POST',
      body: { on_duty: on },
    }),

  orders: () => request<OrdersResponse>('/api/delivery/orders'),

  order: (id) => request<DeliveryOrder>(`/api/delivery/orders/${id}`),

  accept: (id) =>
    request<ActionResult>('/api/delivery/accept', {
      method: 'POST',
      body: { delivery_order_id: id },
    }),

  requestPickupOtp: (id) =>
    request<ActionResult>('/api/delivery/pickup/request-otp', {
      method: 'POST',
      body: { delivery_order_id: id },
    }),

  verifyPickupOtp: (id, otp) =>
    request<ActionResult>('/api/delivery/pickup/verify-otp', {
      method: 'POST',
      body: { delivery_order_id: id, otp },
    }),

  dispatch: (id) =>
    request<ActionResult>('/api/delivery/dispatch', {
      method: 'POST',
      body: { delivery_order_id: id },
    }),

  start: (id) =>
    request<ActionResult>('/api/delivery/start', {
      method: 'POST',
      body: { delivery_order_id: id },
    }),

  verifyDeliveryOtp: (id, otp) =>
    request<ActionResult>('/api/delivery/complete/verify-otp', {
      method: 'POST',
      body: { delivery_order_id: id, otp },
    }),

  sendLocation: (id, fix) =>
    request<LocationResult>('/api/delivery/location', {
      method: 'POST',
      body: {
        delivery_order_id: id,
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracy: fix.accuracy,
      },
      // A stale fix is worthless; fail fast rather than queueing behind a bad link.
      timeoutMs: 10000,
    }),

  returnToShop: (id, reason) =>
    request<ActionResult>('/api/delivery/return', {
      method: 'POST',
      body: { delivery_order_id: id, reason },
    }),

  /**
   * The contract's prose says only the shop closes a return, but its state
   * table lists `confirm_return` as the allowed action for `returning`. The
   * first rule wins — render what Odoo offers and let Odoo refuse it. A 409
   * already re-renders this screen from the returned `allowed_actions`.
   */
  confirmReturn: (id) =>
    request<ActionResult>('/api/delivery/return/confirm', {
      method: 'POST',
      body: { delivery_order_id: id },
    }),

  reportIssue: (id, note) =>
    request<ActionResult>('/api/delivery/issue', {
      method: 'POST',
      body: { delivery_order_id: id, note },
    }),
};
