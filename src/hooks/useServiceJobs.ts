import { useQuery } from '@tanstack/react-query';
import { serviceApi } from '../api/service';
import {
  SERVICE_IN_HAND,
  ServiceJob,
  ServiceJobsResponse,
} from '../api/serviceTypes';
import { syncClock } from '../lib/clock';
import { useSession } from '../store/session';

/**
 * Service visits: offers, visits in hand, today's bookings, and the finished
 * ones. Polled like `['orders']`, but only for someone the office set to work
 * in Service - everybody else never makes the call.
 */
export async function fetchServiceJobs(): Promise<ServiceJobsResponse> {
  const res = await serviceApi.jobs();
  syncClock(res.server_time);
  return res;
}

export function useServiceJobs() {
  const connected = useSession((s) => s.connected);
  const works = useSession((s) => s.lines.includes('service'));
  const on = connected && works;

  return useQuery<ServiceJobsResponse>({
    queryKey: ['service-jobs'],
    queryFn: fetchServiceJobs,
    enabled: on,
    refetchInterval: on ? 10_000 : false,
    refetchIntervalInBackground: false,
  });
}

/** Offers first (the one ending soonest on top), then visits in hand, then bookings by slot. */
export function sortServiceJobs(jobs: ServiceJob[]): ServiceJob[] {
  const rank = (j: ServiceJob) =>
    j.status === 'offered' ? 0 : SERVICE_IN_HAND.includes(j.status) ? 1 : 2;
  return [...jobs].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.offer_expires_at ?? a.slot_start).localeCompare(b.offer_expires_at ?? b.slot_start)
  );
}
