import { AppState } from 'react-native';
import { getServer } from '../api/config';
import { api } from '../api/endpoints';
import { ApiError, DeliveryOrder } from '../api/types';
import { syncClock } from '../lib/clock';
import { shopName } from '../lib/format';
import { announced, keepOnly, loadLedger, markAnnounced } from './offerLedger';
import { ringJob } from './fullScreenRing';

/**
 * One look for new offers while the app is out of sight — the duty watch calls
 * this from the location task's wake-ups (`src/location/tracking.ts`).
 *
 * The open app has its own poll and its own alarm (`useOfferAlert`), so this
 * stays out of the way while it is in front. Behind the lock screen it is the
 * only thing listening: there is no push on this API.
 *
 * Returns false when the server says the rider is off duty — the watch should
 * stop — true when it looked, and null when it could not (no signal, signed
 * out): try again on the next wake.
 */
export async function checkOffers(): Promise<boolean | null> {
  if (AppState.currentState === 'active') return null;

  try {
    // Before any call: after Android restarts the service this runs in a fresh
    // context, where the synchronous `peekServer()` behind `api` would still
    // hold the build's defaults — demo mode — rather than the saved server.
    await getServer();
    const res = await api.orders();
    syncClock(res.server_time);
    if (res.on_duty === false) return false;

    await loadLedger();
    const offered = (res.orders ?? []).filter((o) => o.delivery_status === 'offered');
    keepOnly(new Set(offered.map((o) => o.delivery_order_id)));

    for (const job of offered) {
      if (announced(job.delivery_order_id)) continue;
      markAnnounced(job.delivery_order_id);
      await ringOffer(job);
    }
    return true;
  } catch (err) {
    // No signal and signed out are expected here; anything else is a bug.
    if (!(err instanceof ApiError)) console.warn('[offer] check failed:', (err as Error)?.message);
    return null;
  }
}

/**
 * The lock-screen alert: rung like an incoming call (`fullScreenRing.ts`).
 * Answering it opens the job, through `usePush`.
 */
export async function ringOffer(job: DeliveryOrder): Promise<void> {
  const from = shopName(job.shop);
  await ringJob({
    id: job.delivery_order_id,
    title: 'New job offered',
    body: from ? `${from} → ${job.customer_name}` : job.customer_name,
  });
}
