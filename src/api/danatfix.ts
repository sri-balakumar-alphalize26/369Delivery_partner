import { getServer, peekServer } from './config';
import {
  BookingAction,
  BookingActResult,
  BookingsResponse,
  PastBooking,
} from './danatfixTypes';
import { ApiError } from './types';

/**
 * The website repair bookings, straight from the danatfix module through
 * Odoo's own JSON door: `POST /json/2/<model>/<method>`, the same door the
 * website sends bookings in by. No module of ours on the server.
 *
 * The calls are the Store Live Screen's own: `screen_data` is its list,
 * `screen_act` its Accept / Call / Done / Cancel buttons - so a tap in the app
 * and a click at the counter go through the same row lock, and whichever is
 * first wins.
 *
 * Signed in with one shared Odoo API key (`serviceKey`, the "Technician App"
 * user), not the rider's token: this door only takes Odoo users' keys.
 */

const MODEL = 'danatfix.booking';
const TIMEOUT_MS = 20_000;

/** True when the Service side shows website bookings: a real server and a key. */
export function bookingMode(): boolean {
  const s = peekServer();
  return !s.useMock && !!s.serviceKey;
}

async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const { url, db, serviceKey } = await getServer();
  if (!url || !serviceKey) {
    throw new ApiError('disabled', 'No service key set. Add it under More settings on the sign-in screen.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${url}/json/2/${MODEL}/${method}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `bearer ${serviceKey}`,
        ...(db ? { 'X-Odoo-Database': db } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError('network', 'Could not reach the server. Check your connection.');
  } finally {
    clearTimeout(timer);
  }

  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const payload = isJson ? await res.json().catch(() => null) : null;
  if (res.ok) return payload as T;

  console.warn(`[bookings] ${method} refused: ${res.status}`, payload?.message ?? '');
  if (res.status === 401 || res.status === 403) {
    throw new ApiError('unknown', 'The service key was not accepted. Ask the office for the right one.', {
      status: res.status,
    });
  }
  if (res.status === 404) {
    throw new ApiError('not_found', 'Website bookings are not on this server.', { status: 404 });
  }
  // Odoo's own words for a refusal it raised (a UserError, an access error).
  throw new ApiError('unknown', payload?.message || `The server said no (${res.status}).`, {
    status: res.status,
  });
}

export const bookingsApi = {
  /** Every open booking (New, Calling, Accepted), oldest first: the Live Screen's list. */
  list(): Promise<BookingsResponse> {
    return call<BookingsResponse>('screen_data', {});
  },

  /** One of the Live Screen's buttons on one booking. Returns the fresh list. */
  act(id: number, action: BookingAction): Promise<BookingActResult> {
    return call<BookingActResult>('screen_act', { ids: [id], action });
  },

  /** The last finished bookings, newest first. */
  history(limit = 30): Promise<PastBooking[]> {
    return call<PastBooking[]>('search_read', {
      domain: [['state', 'in', ['done', 'cancelled']]],
      fields: ['name', 'state', 'customer_name', 'area', 'summary', 'write_date', 'accepted_by_name'],
      limit,
      order: 'write_date desc',
    });
  },
};
