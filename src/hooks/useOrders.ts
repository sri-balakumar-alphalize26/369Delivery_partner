import { useQuery } from '@tanstack/react-query';
import { api } from '../api/endpoints';
import { DeliveryOrder, OrdersResponse } from '../api/types';
import { useSession } from '../store/session';

/**
 * The rider's jobs.
 *
 * Polled, because there is no push yet — FCM details are still to come from the
 * Odoo team. Ten seconds is a compromise between finding a new job quickly and
 * not draining a phone that has to last a shift; it becomes a fallback the
 * moment push arrives.
 */
export function useOrders() {
  const connected = useSession((s) => s.connected);

  return useQuery<OrdersResponse>({
    queryKey: ['orders'],
    queryFn: () => api.orders(),
    enabled: connected,
    refetchInterval: connected ? 10_000 : false,
    refetchIntervalInBackground: false,
  });
}

/** The one job the rider should be looking at, if any. */
export function pickCurrent(orders: DeliveryOrder[] | undefined): DeliveryOrder | null {
  if (!orders?.length) return null;

  // Anything already under way outranks a fresh offer — finish what you started.
  const live = orders.find((o) => o.delivery_status !== 'offered');
  return live ?? orders[0];
}
