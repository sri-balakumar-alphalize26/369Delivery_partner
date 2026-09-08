import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/endpoints';
import { syncClock } from '../lib/clock';
import { DeliveryOrder, DutyResult, OrdersResponse } from '../api/types';
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
    /**
     * Every response carries `server_time`, so the offset between the server's
     * clock and this phone's is taken here — free, and refreshed with the poll.
     * Countdowns read from it rather than from the device; see lib/clock.
     */
    queryFn: async () => {
      const res = await api.orders();
      syncClock(res.server_time);
      return res;
    },
    enabled: connected,
    refetchInterval: connected ? 10_000 : false,
    refetchIntervalInBackground: false,
  });
}

/**
 * Clocking on or off.
 *
 * The contract is clear that duty is what makes work flow at all: nothing is
 * offered to an off-duty rider, and clocking on collects whatever was confirmed
 * while nobody was available. So the orders list is refetched immediately
 * rather than waiting up to ten seconds for the next poll.
 */
export function useDuty() {
  const qc = useQueryClient();
  const applyDuty = useSession((s) => s.applyDuty);

  return useMutation<DutyResult, Error, boolean>({
    mutationFn: (on) => api.duty(on),
    onSuccess: (result) => {
      applyDuty(result);
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

/**
 * The order to work through first: anything already under way outranks a fresh
 * offer — finish what you started — and within a group, the soonest promise.
 *
 * A rider can hold several jobs at once, so this sorts rather than picks. The
 * previous behaviour returned only the first, which made every other job
 * unreachable.
 */
export function sortForRider(orders: DeliveryOrder[] | undefined): DeliveryOrder[] {
  if (!orders?.length) return [];

  return [...orders].sort((a, b) => {
    const aOffered = a.delivery_status === 'offered' ? 1 : 0;
    const bOffered = b.delivery_status === 'offered' ? 1 : 0;
    if (aOffered !== bOffered) return aOffered - bOffered;
    return (a.promised_by ?? '').localeCompare(b.promised_by ?? '');
  });
}
