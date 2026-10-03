import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/endpoints';
import { syncClock } from '../lib/clock';
import { currentFix } from '../location/currentFix';
import { riderBeatReset } from '../location/riderBeat';
import {
  DeliveryOrder,
  DutyResult,
  HistoryResponse,
  OrdersResponse,
  TakeVehicleResult,
} from '../api/types';
import { useSession } from '../store/session';

/**
 * The rider's jobs.
 *
 * Polled, because there is no push yet — FCM details are still to come from the
 * Odoo team. Ten seconds is a compromise between finding a new job quickly and
 * not draining a phone that has to last a shift; it becomes a fallback the
 * moment push arrives.
 */
/**
 * Every response carries `server_time`, so the offset between the server's
 * clock and this phone's is taken here — free, and refreshed with the poll.
 * Countdowns read from it rather than from the device; see lib/clock.
 *
 * Shared by every observer of `['orders']`: React Query runs the query with
 * whichever observer's options it holds last, so one without this function
 * would break the poll for all of them.
 */
export async function fetchOrders(): Promise<OrdersResponse> {
  const res = await api.orders();
  syncClock(res.server_time);
  return res;
}

export function useOrders() {
  const connected = useSession((s) => s.connected);

  return useQuery<OrdersResponse>({
    queryKey: ['orders'],
    queryFn: fetchOrders,
    enabled: connected,
    refetchInterval: connected ? 10_000 : false,
    refetchIntervalInBackground: false,
  });
}

/**
 * Finished jobs, for the Past list.
 *
 * Not polled: the past only grows when this rider finishes something, and the
 * job screen invalidates `['history']` when they do. Opening the list refetches
 * it too, which covers a job the office closed.
 */
export function useHistory(enabled = true) {
  const connected = useSession((s) => s.connected);

  return useQuery<HistoryResponse>({
    queryKey: ['history'],
    queryFn: () => api.history(),
    enabled: connected && enabled,
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
export interface DutyInput {
  on: boolean;
  /** The vehicle picked on the way on duty, on a server with a fleet. */
  vehicleId?: number;
}

export function useDuty() {
  const qc = useQueryClient();
  const applyDuty = useSession((s) => s.applyDuty);

  return useMutation<DutyResult, Error, DutyInput, { previous?: OrdersResponse }>({
    /**
     * Clocking on takes the phone's position along — the one it already holds,
     * or a fresh one for up to five seconds — so the shop can rank this rider
     * by distance from the first minute. Never asks for permission, and never
     * holds the switch up: no fix, and the rider goes on duty without one.
     */
    mutationFn: async ({ on, vehicleId }) => {
      const fix = on ? await currentFix() : null;
      if (on) riderBeatReset();
      return api.duty(on, vehicleId, fix);
    },

    /**
     * Show the tap at once, by patching the cached orders response.
     *
     * The switch reads `data.on_duty` from that cache, so without this it went
     * on, off, then on again: the native control animated across, React
     * re-rendered it from a cache still saying `false` and it snapped back, and
     * only the refetch a moment later flipped it a second time. Three states for
     * one tap, and the middle one a lie.
     */
    onMutate: async ({ on }) => {
      // Stop a poll landing mid-flight and overwriting this with stale truth.
      await qc.cancelQueries({ queryKey: ['orders'] });
      const previous = qc.getQueryData<OrdersResponse>(['orders']);
      qc.setQueryData<OrdersResponse>(['orders'], (old) =>
        old ? { ...old, on_duty: on } : old
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

/** Changing vehicles mid-shift — the shift itself carries on untouched. */
export function useTakeVehicle() {
  const qc = useQueryClient();
  const applyVehicle = useSession((s) => s.applyVehicle);

  return useMutation<TakeVehicleResult, Error, number>({
    mutationFn: (vehicleId) => api.takeVehicle(vehicleId),
    onSuccess: (result) => applyVehicle(result.vehicle),
    // What is free has changed for everyone, this rider included.
    onSettled: () => qc.invalidateQueries({ queryKey: ['vehicles'] }),
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
