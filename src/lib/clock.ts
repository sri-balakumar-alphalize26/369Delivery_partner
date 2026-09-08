/**
 * The server's clock, not the phone's.
 *
 * Every countdown on a rider's screen is a comparison between `promised_by` and
 * "now", and the phone is the wrong place to get "now" from. A device whose
 * clock is ten minutes fast shows every job as nearly late; ten minutes slow and
 * a job already overdue still reads as comfortable. Neither surfaces in testing,
 * because the machine doing the testing has the right time.
 *
 * `/orders` returns `server_time` on every response, so the offset between the
 * two clocks is free — no extra request, and it re-checks itself every ten
 * seconds along with the poll.
 *
 * The contract's rule about timezones is a separate matter and already handled
 * in `format.ts`: these are absolute instants, and the offset is in milliseconds
 * of drift, not hours of zone.
 */

/** Milliseconds to add to the device clock to get the server's. */
let offsetMs = 0;

/** Whether a server time has ever been seen, so callers can tell drift from ignorance. */
let synced = false;

/**
 * The contract states every datetime ends in `Z`, but its own examples do not
 * always include it. Treat a naked timestamp as UTC, per the stated rule, rather
 * than letting the runtime read it as local — which would manufacture an offset
 * the size of the rider's timezone.
 */
function asUtc(raw: string): string {
  return /[Zz]$|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`;
}

/**
 * Take the offset from a response that has just arrived.
 *
 * Called with the raw `server_time`; anything unparseable leaves the last good
 * offset in place rather than resetting to zero, since a bad reading is not
 * evidence that the clocks agree.
 */
export function syncClock(serverTime: string | undefined): void {
  if (!serverTime) return;

  const server = Date.parse(asUtc(serverTime));
  if (Number.isNaN(server)) return;

  offsetMs = server - Date.now();
  synced = true;
}

/** Now, as the server would report it. */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** How far the phone's clock is out, in milliseconds. Diagnostics only. */
export function clockOffsetMs(): number {
  return offsetMs;
}

/** False until a response has been seen; the offset is zero until then. */
export function clockSynced(): boolean {
  return synced;
}

/** Test seam: forget what has been learned, so a case starts from nothing. */
export function resetClock(): void {
  offsetMs = 0;
  synced = false;
}
