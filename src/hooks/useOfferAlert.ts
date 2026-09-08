import { useRouter, useSegments } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { AppState, Platform, Vibration } from 'react-native';
import { DeliveryOrder } from '../api/types';
import { shopName } from '../lib/format';
import { ensureJobsChannel } from '../push/register';
import { pushArrivedRecently } from '../push/usePush';
import { useOrders } from './useOrders';

/**
 * Making a new job impossible to miss.
 *
 * Until now an offer arrived in silence: `useOrders` polls, the cache updates,
 * and a card appears in a list. A rider on a bike never sees that. The offer
 * screen this puts up already existed — nothing routed to it on its own, and
 * nothing made a sound.
 *
 * Vibration rather than a bundled alarm tone deliberately: `Vibration` is React
 * Native core, so this needs no new native module and no rebuild, and a phone in
 * a jacket pocket at 60km/h is felt long before it is heard. The notification
 * channel supplies the sound in the one case a banner is used.
 */

/** Wait, buzz, pause — repeated until something stops it. */
const PATTERN = [0, 700, 500];

/**
 * How long an unanswered offer keeps buzzing.
 *
 * Long enough to survive a pocket and a helmet, short enough that a phone left
 * on a counter does not buzz for the rest of the shift. The alert deliberately
 * does NOT stop when the offer screen merely appears — an alarm that silences
 * itself the instant it is shown is a 200ms blip nobody registers. It stops when
 * the rider acts on the job, leaves it, backgrounds the app, or this runs out.
 */
const CEILING_MS = 15_000;

let ceiling: ReturnType<typeof setTimeout> | null = null;

/**
 * Silence the alert.
 *
 * Exported because the thing that ends an alarm is the rider dealing with it,
 * which happens on the job screen — see the `stopOfferAlert` calls there.
 * Safe to call when nothing is buzzing.
 */
export function stopOfferAlert(): void {
  if (ceiling) {
    clearTimeout(ceiling);
    ceiling = null;
  }
  if (Platform.OS !== 'web') Vibration.cancel();
}

function startBuzzing(): void {
  // react-native-web has no vibration and warns rather than no-opping.
  if (Platform.OS === 'web') return;
  Vibration.vibrate(PATTERN, true);
  if (ceiling) clearTimeout(ceiling);
  ceiling = setTimeout(stopOfferAlert, CEILING_MS);
}

/** A banner for an offer the rider is too busy to be shown. */
async function announce(job: DeliveryOrder): Promise<void> {
  try {
    await ensureJobsChannel();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'New job offered',
        body: `${shopName(job.shop)} → ${job.customer_name}`,
        // Matches a real push, so tapping it routes through the same handler.
        data: { delivery_order_id: job.delivery_order_id },
        sound: true,
      },
      trigger: null,
    });
  } catch (err) {
    // A missing banner makes the alert quieter, never broken — the phone is
    // already buzzing by the time this runs.
    console.warn('[offer] could not announce:', (err as Error)?.message);
  }
}

export function useOfferAlert(connected: boolean): void {
  const { data } = useOrders();
  const router = useRouter();
  // Cast: expo-router types this as a tuple of known route literals, which
  // then refuses `includes` against a plain string.
  const segments = useSegments() as string[];

  /** Offers already announced, so a poll every 10s does not re-alert. */
  const announced = useRef<Set<number>>(new Set());

  /**
   * Whether a baseline has been taken yet.
   *
   * The first list to arrive is not news. It is the backlog that was waiting
   * when the rider clocked on — `POST /duty` exists precisely to collect jobs
   * confirmed while nobody was available — or whatever was already open when the
   * app started. Alarming on it would throw a rider who has just gone on duty
   * into the first of five jobs instead of letting them see that there are five.
   * Only what appears AFTER a baseline is an offer worth taking the screen for.
   */
  const seeded = useRef(false);

  /**
   * Whether it is safe to put the offer screen up.
   *
   * Read through a ref so that changing tab does not re-run the detection
   * effect — only new data should be able to raise an alert.
   */
  const canTakeOver = segments[0] === '(app)' && !segments.includes('order');
  const canTakeOverRef = useRef(canTakeOver);
  canTakeOverRef.current = canTakeOver;

  useEffect(() => {
    if (!connected) {
      // A sign-out and back in should take a fresh baseline, not inherit the
      // last rider's.
      seeded.current = false;
      announced.current.clear();
      return;
    }
    if (!data) return;

    const offered = (data?.orders ?? []).filter((o) => o.delivery_status === 'offered');
    const live = new Set(offered.map((o) => o.delivery_order_id));

    // Forget anything no longer on offer: the set cannot then grow all shift,
    // and a job offered a second time announces itself again.
    for (const id of announced.current) {
      if (!live.has(id)) announced.current.delete(id);
    }

    // Taken before the early return below: a first list that happens to be empty
    // is still a baseline, and without this the next job to arrive would be
    // swallowed as one.
    const baseline = !seeded.current;
    seeded.current = true;

    const fresh = offered.filter((o) => !announced.current.has(o.delivery_order_id));
    if (!fresh.length) return;
    for (const o of fresh) announced.current.add(o.delivery_order_id);
    if (baseline) return;

    // Foreground only. `useOrders` sets refetchIntervalInBackground: false, so
    // a backgrounded app reaches this at most once on resume — and a real push
    // is the path in while it is away.
    if (AppState.currentState !== 'active') return;

    startBuzzing();

    const job = fresh[0];

    /**
     * The guard that matters most.
     *
     * A rider inside another job is mid-code or mid-handover. Yanking them onto
     * a new offer would lose a half-typed code and could hand the wrong parcel
     * to the wrong door — far worse than the silence this replaces. The same
     * applies on Connect, where they went deliberately to change a setting.
     * Buzz, and leave a banner they can come back to.
     */
    if (!canTakeOverRef.current) {
      // Unless a push has already said the same thing, which would give the
      // rider two banners for one job.
      if (!pushArrivedRecently()) void announce(job);
      return;
    }

    router.push(`/order/${job.delivery_order_id}`);
  }, [connected, data, router]);

  // A phone put away mid-alert should go quiet, and so should one whose app is
  // being torn down.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') stopOfferAlert();
    });
    return () => {
      sub.remove();
      stopOfferAlert();
    };
  }, []);
}
