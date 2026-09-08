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

  return useMutation<DutyResult, Error, boolean, { previous?: OrdersResponse }>({
    mutationFn: (on) => api.duty(on),

    /**
     * Show the tap at once, by patching the cached orders response.
     *
     * The switch reads `data.on_duty` from that cache, so without this it went
     * on, off, then on again: the native control animated across, React
     * re-rendered it from a cache still saying `false` and it snapped back, and
     * only the refetch a moment later flipped it a second time. Three states for
     * one tap, and the middle one a lie.
     */
    onMutate: async (next) => {
      // Stop a poll landing mid-flight and overwriting this with stale truth.
      await qc.cancelQueries({ queryKey: ['orders'] });
      const previous = qc.getQueryData<OrdersResponse>(['orders']);
      qc.setQueryData<OrdersResponse>(['orders'], (old) =>
        old ? { ...old, on_duty: next } : old
      );
      return { previous };
    },

    /** The server refused, so put back what was there rather than leave a guess. */
    onError: (_err, _next, context) => {
      if (context?.previous) qc.setQueryData(['orders'], context.previous);
    },

    onSuccess: (result) => {
      applyDuty(result);
      // The server's answer, not the guess — they agree in practice, but this
      // is the one that is true.
      qc.setQueryData<OrdersResponse>(['orders'], (old) =>
        old ? { ...old, on_duty: result.on_duty } : old
      );
    },

    /**
     * Reconcile either way. Clocking on collects whatever was confirmed while
     * nobody was on duty, so the list that follows is genuinely different.
     */
    onSettled: () => {
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
