import { request } from '../client';
import {
  ActionResult,
  ApiAdapter,
  DeliveryOrder,
  LocationResult,
  OrdersResponse,
  Rider,
} from '../types';

/**
 * The live Odoo backend, over the published contract.
 *
 * Every path is under /api/delivery. The database header and the bearer token
 * are attached by `client.ts`, so nothing here deals with auth.
 */
export const realAdapter: ApiAdapter = {
  async me() {
    const r = await request<{ rider: Rider }>('/api/delivery/auth/me');
    return r.rider;
  },

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

  reportIssue: (id, note) =>
    request<ActionResult>('/api/delivery/issue', {
      method: 'POST',
      body: { delivery_order_id: id, note },
    }),
};
