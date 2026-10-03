/**
 * The clock of the on-duty heartbeat (`POST /rider/location`), shared by its
 * two senders: `useDutyLocation` while the app is open, and the duty watch's
 * foreground service while the screen is off. Each asks before sending and
 * reports after, so the server's `poll_after_seconds` holds across both and a
 * phone that wakes in the background never doubles a beat the app just sent.
 */

/** A beat this early is close enough; waiting would add a whole interval. */
const SLACK_MS = 2_000;
/** Never faster than this, whatever a reply says. */
const FLOOR_S = 15;

let nextDueAt = 0;

export function riderBeatDue(now = Date.now()): boolean {
  return now >= nextDueAt - SLACK_MS;
}

/** How long until the next beat is due, for a sender scheduling its own timer. */
export function riderBeatWait(now = Date.now()): number {
  return Math.max(0, nextDueAt - now);
}

export function riderBeatSent(pollAfterSeconds: number, now = Date.now()): void {
  nextDueAt = now + Math.max(pollAfterSeconds, FLOOR_S) * 1000;
}

/** A failed beat is followed by another after `retryMs`, not queued. */
export function riderBeatFailed(retryMs: number, now = Date.now()): void {
  nextDueAt = now + retryMs;
}

/** Going on duty starts a fresh shift: the first fix goes out at once. */
export function riderBeatReset(): void {
  nextDueAt = 0;
}
