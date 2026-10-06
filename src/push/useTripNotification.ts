import { useEffect } from 'react';
import { DeliveryOrder, headingFor } from '../api/types';
import { coords, shopInfo, shopName, timeOnly } from '../lib/format';
import { photoRef } from '../lib/photoName';
import { metresBetween } from '../lib/routeGeometry';
import { clearTrip, showTrip } from './tripNotification';

/**
 * Keeps the pinned "current job" card (tripNotification.ts) in step with the
 * job screen: the step, who is at the other end, how far, and the arrival time
 * from the route when the map has one.
 */
export function useTripNotification(
  order: DeliveryOrder | undefined,
  active: boolean,
  leg: { distanceM: number; durationS: number } | null,
  riderAt: { latitude: number; longitude: number } | null,
  timezone?: string
): void {
  const toCustomer = order ? headingFor(order.delivery_status) === 'customer' : false;
  const shop = order ? shopInfo(order.shop) : null;
  const dest = order
    ? toCustomer
      ? coords(order.latitude, order.longitude)
      : coords(shop?.latitude, shop?.longitude)
    : null;

  const distanceM =
    leg && leg.distanceM > 0 ? leg.distanceM : riderAt && dest ? metresBetween(riderAt, dest) : undefined;
  const eta =
    leg && leg.durationS > 0
      ? timeOnly(new Date(Date.now() + leg.durationS * 1000).toISOString(), timezone)
      : undefined;

  useEffect(() => {
    if (!order) return;
    if (!active) {
      void clearTrip();
      return;
    }
    void showTrip({
      orderId: order.delivery_order_id,
      title: `${toCustomer ? 'Going to the customer' : 'Going to the shop'} · ${photoRef(order)}`,
      who: toCustomer ? order.customer_name : shopName(order.shop),
      dest,
      distanceM: distanceM === undefined ? undefined : Math.round(distanceM),
      eta,
    });
    // Rounded so a few metres of GPS jitter do not count as a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.delivery_order_id, order?.delivery_status, active, toCustomer, distanceM && Math.round(distanceM / 50), eta]);
}
