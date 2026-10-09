import { AppState } from 'react-native';
import { getServer } from '../api/config';
import { api } from '../api/endpoints';
import { ApiError, DeliveryOrder } from '../api/types';
import { syncClock } from '../lib/clock';
import { shopName } from '../lib/format';
import { announced, keepOnly, loadLedger, markAnnounced } from './offerLedger';
import { ringJob } from './fullScreenRing';
import { serviceApi } from '../api/service';

/**
 * Whether this person works in Service. Asked again every ten minutes, so a
 * change the office makes to Works In reaches the lock-screen watch too.
 */
let serviceLine: { yes: boolean; at: number } | null = null;
const LINES_MAX_AGE_MS = 10 * 60_000;
async function worksInService(): Promise<boolean> {
  if (!serviceLine || Date.now() - serviceLine.at > LINES_MAX_AGE_MS) {
    try {
      serviceLine = { yes: (await api.partnerMe()).lines.includes('service'), at: Date.now() };
    } catch {
      return serviceLine?.yes ?? false;
    }
  }
  return serviceLine.yes;
}

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

    // Service offers too, for someone the office set to work in Service. The
    // lines are what the app last heard; a fresh context reads them again.
    if (await worksInService()) {
      const { jobs } = await serviceApi.jobs();
      const visits = jobs.filter((j) => j.status === 'offered');
      keepOnly(new Set(visits.map((j) => j.id)), 'service');
      for (const v of visits) {
        if (announced(v.id, 'service')) continue;
        markAnnounced(v.id, 'service');
        await ringJob({
          id: v.id,
          kind: 'service',
          title: 'New service job',
          body: `${v.title} · ${v.area}`,
        });
      }
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
