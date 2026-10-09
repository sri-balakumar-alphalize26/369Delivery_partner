import { DeliveryOrder, DeliveryStatus, WorkLine } from '../api/types';
import { SERVICE_IN_HAND, ServiceJob } from '../api/serviceTypes';
import { useSession } from '../store/session';
import { useOrders } from './useOrders';
import { useServiceJobs } from './useServiceJobs';

/** A delivery taken and not yet over: busy for Service. Offers do not count here. */
export const DELIVERY_IN_HAND: readonly DeliveryStatus[] = [
  'accepted',
  'picked',
  'dispatched',
  'out_for_delivery',
  'returning',
  'handover_waiting',
];

export interface Workload {
  /** Which line a job in hand makes this person busy on, if any. */
  busy: 'none' | WorkLine;
  /** The delivery or visit in hand, to jump back to. */
  delivery: DeliveryOrder | null;
  visit: ServiceJob | null;
  /** Offers waiting on each side, for the switcher's badges. */
  offers: Record<WorkLine, number>;
}

/**
 * One view of both lines: what is in hand and what is waiting.
 *
 * Busy is worked out from the jobs themselves, the same rule partner_app uses
 * on the server, so it is right the moment a job is accepted rather than at
 * the next `/api/partner/me`.
 */
export function useWorkload(): Workload {
  const lines = useSession((s) => s.lines);
  const orders = useOrders().data?.orders ?? [];
  const jobs = useServiceJobs().data?.jobs ?? [];

  const delivery = lines.includes('delivery')
    ? (orders.find((o) => DELIVERY_IN_HAND.includes(o.delivery_status)) ?? null)
    : null;
  const visit = lines.includes('service')
    ? (jobs.find((j) => SERVICE_IN_HAND.includes(j.status)) ?? null)
    : null;

  return {
    busy: visit ? 'service' : delivery ? 'delivery' : 'none',
    delivery,
    visit,
    offers: {
      delivery: lines.includes('delivery')
        ? orders.filter((o) => o.delivery_status === 'offered').length
        : 0,
      service: lines.includes('service') ? jobs.filter((j) => j.status === 'offered').length : 0,
    },
  };
}
