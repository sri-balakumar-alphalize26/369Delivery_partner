import { useQuery } from '@tanstack/react-query';
import { bookingMode, bookingsApi } from '../api/danatfix';
import { BookingsResponse, PastBooking } from '../api/danatfixTypes';
import { useSession } from '../store/session';

/**
 * The website repair bookings still open, as the Store's Live Screen lists
 * them. Polled every 15 s while someone who works in Service is signed in and
 * the app has a service key - the counter's alarm rings on the same list.
 */
export function useBookings() {
  const connected = useSession((s) => s.connected);
  const works = useSession((s) => s.lines.includes('service'));
  const on = connected && works && bookingMode();
  return useQuery<BookingsResponse>({
    queryKey: ['bookings'],
    queryFn: () => bookingsApi.list(),
    enabled: on,
    refetchInterval: on ? 15_000 : false,
    refetchIntervalInBackground: false,
  });
}

/** The last finished bookings, for the bottom of the list. */
export function useBookingHistory() {
  const connected = useSession((s) => s.connected);
  const on = connected && bookingMode();
  return useQuery<PastBooking[]>({
    queryKey: ['bookings-history'],
    queryFn: () => bookingsApi.history(10),
    enabled: on,
    refetchInterval: on ? 60_000 : false,
  });
}
