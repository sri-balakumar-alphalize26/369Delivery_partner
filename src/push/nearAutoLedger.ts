/**
 * Jobs whose automatic "near the customer" has already been announced, once
 * each. Shared by the job screen and the push listener, so the server's own
 * `near_customer_auto` push and the screen noticing the same change on a poll
 * never ring twice for one job.
 */
const announcedFor = new Set<number>();

/** True the first time for a job, false after: the caller announces only on true. */
export function claimNearAuto(orderId: number): boolean {
  if (announcedFor.has(orderId)) return false;
  announcedFor.add(orderId);
  return true;
}
