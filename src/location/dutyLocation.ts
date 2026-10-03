import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { create } from 'zustand';
import { api, isMock } from '../api/endpoints';
import { hasFeature } from '../api/features';
import { OrdersResponse } from '../api/types';
import { fetchOrders } from '../hooks/useOrders';
import { useSession } from '../store/session';
import { riderBeatDue, riderBeatFailed, riderBeatSent, riderBeatWait } from './riderBeat';
import { onTrackingChange, trackedOrderId } from './tracking';

/**
 * Where an on-duty rider is, for the office's live map.
 *
 * Runs only on a server with the `location` feature — the REST rider API
 * always, a fleet server when its `me` lists it — and only while all of these
 * hold:
 *
 *   - the rider is on duty (the server's word, from the orders poll);
 *   - the app is on screen. With the screen off, the duty watch's service in
 *     `tracking.ts` sends the same beat; `riderBeat.ts` keeps the two to one
 *     clock;
 *   - location permission has already been granted. This never asks: Home
 *     asks behind `LocationPrimer` when the rider clocks on, and its sharing
 *     row offers the fix when something is off.
 *
 * The server paces it with `poll_after_seconds`: every 30 s with work in hand,
 * every 2 min without. While a delivery is being tracked (`tracking.ts`), its
 * pings already say where the rider is, so this stays quiet.
 *
 * What it is doing is published in `useSharingStatus`, so the rider can see
 * whether the office sees them — the tablet sat with location switched off and
 * nobody could tell.
 */

const FIRST_DELAY_MS = 5_000;
const RETRY_MS = 60_000;
/** How soon to look again while location is off or not allowed. Two cheap checks, no GPS. */
const RECHECK_MS = 5_000;
/** A GPS indoors can take minutes; after this long, say so rather than "Finding…". */
const NO_FIX_MS = 45_000;
/** How old a position the phone already holds may be and still be sent. */
const LAST_KNOWN_MAX_AGE_MS = 5 * 60_000;

export type SharingStatus =
  /** Not on duty, not a fleet server, or demo mode: nothing to say. */
  | { kind: 'idle' }
  | { kind: 'no_permission'; canAsk: boolean }
  | { kind: 'services_off' }
  | { kind: 'locating' }
  /** Location on and allowed, but no position has come yet — indoors, usually. */
  | { kind: 'no_fix' }
  | { kind: 'sharing'; sentAt: number }
  /** A delivery's own tracking is reporting instead. */
  | { kind: 'delivery' }
  | { kind: 'failed'; sentAt: number | null };

export const useSharingStatus = create<{ status: SharingStatus }>(() => ({
  status: { kind: 'idle' },
}));

function setStatus(status: SharingStatus): void {
  useSharingStatus.setState({ status });
}

function lastSentAt(): number | null {
  const s = useSharingStatus.getState().status;
  return s.kind === 'sharing' ? s.sentAt : s.kind === 'failed' ? s.sentAt : null;
}

/** Home calls this after the rider fixed permission or location, so the heartbeat starts at once. */
const permissionListeners = new Set<() => void>();
export function notifyLocationPermission(): void {
  for (const fn of permissionListeners) fn();
}

export function useDutyLocation(connected: boolean): void {
  const qc = useQueryClient();
  const wanted = useSession(
    (s) => s.features.includes('location') || !!s.fleet?.features.includes('location')
  );
  const riderOnDuty = useSession((s) => s.rider?.on_duty ?? false);

  // Read the orders cache without adding a second poll: this observer never
  // fetches, it only hears what `useOrders` brings in. It still carries the
  // real query function, because React Query may run the shared query with
  // this observer's options.
  const { data } = useQuery<OrdersResponse>({
    queryKey: ['orders'],
    queryFn: fetchOrders,
    enabled: false,
  });
  const onDuty = data?.on_duty ?? riderOnDuty;

  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [permTick, setPermTick] = useState(0);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setForeground(s === 'active'));
    const bump = () => setPermTick((n) => n + 1);
    permissionListeners.add(bump);
    return () => {
      sub.remove();
      permissionListeners.delete(bump);
    };
  }, []);

  const applies = connected && wanted && onDuty && Platform.OS !== 'web' && !isMock();
  const active = applies && foreground;

  // Off duty, signed out, or not a fleet server: the row disappears. A trip to
  // the background keeps the last word, which is still true on return.
  useEffect(() => {
    if (!applies) setStatus({ kind: 'idle' });
  }, [applies]);

  useEffect(() => {
    if (!active) return;

    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let recheck: ReturnType<typeof setTimeout> | null = null;
    let noFix: ReturnType<typeof setTimeout> | null = null;
    let watch: Location.LocationSubscription | null = null;
    let latest: Location.LocationObject | null = null;

    /**
     * Look again shortly. Switching location on from the quick-settings shade
     * never sends the app to the background, so waiting for the next return to
     * the front left the row saying "off" long after it was on.
     */
    const lookAgain = () => {
      recheck = setTimeout(() => alive && setPermTick((n) => n + 1), RECHECK_MS);
    };

    const schedule = (ms: number) => {
      if (!alive) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(beat, ms);
    };

    async function beat() {
      if (!alive) return;
      // A delivery on the road is already reporting through `ping`.
      if (trackedOrderId() !== null) {
        setStatus({ kind: 'delivery' });
        return schedule(RETRY_MS);
      }
      // The delivery's own pings were the last word on where the rider is.
      if (useSharingStatus.getState().status.kind === 'delivery') {
        setStatus({ kind: 'sharing', sentAt: Date.now() });
      }
      if (!latest) return schedule(RETRY_MS);
      // The duty watch beat while the screen was off; wait out its interval.
      if (!riderBeatDue()) return schedule(riderBeatWait());
      try {
        const res = await api.riderLocation({
          latitude: latest.coords.latitude,
          longitude: latest.coords.longitude,
          accuracy: latest.coords.accuracy ?? 0,
        });
        if (!alive) return;
        if (!res.on_duty) {
          // The office clocked this rider off; the next orders poll will say
          // so too, and this effect ends with it.
          qc.invalidateQueries({ queryKey: ['orders'] });
          return;
        }
        riderBeatSent(res.poll_after_seconds);
        setStatus({ kind: 'sharing', sentAt: Date.now() });
        if (res.has_new_offer) qc.invalidateQueries({ queryKey: ['orders'] });
        schedule(riderBeatWait());
      } catch {
        // A dropped beat is not worth queueing: the next one is fresher.
        riderBeatFailed(RETRY_MS);
        if (alive) setStatus({ kind: 'failed', sentAt: lastSentAt() });
        schedule(RETRY_MS);
      }
    }

    (async () => {
      const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (!alive) return;
      if (!perm?.granted) {
        setStatus({ kind: 'no_permission', canAsk: perm?.canAskAgain !== false });
        return lookAgain();
      }
      // With the phone's location switched off, asking for fixes makes Android
      // raise Google's "Location Accuracy" dialog — uninvited, over whatever
      // the rider is doing. Say so on Home instead, where the rider can choose
      // to turn it on; this runs again when the app comes back to the front.
      const servicesOn = await Location.hasServicesEnabledAsync().catch(() => false);
      if (!alive) return;
      if (!servicesOn) {
        setStatus({ kind: 'services_off' });
        return lookAgain();
      }
      if (useSharingStatus.getState().status.kind !== 'sharing') {
        setStatus({ kind: 'locating' });
      }
      // Start from where the phone already knows it is, as built-in apps do:
      // a fix another app took a minute ago is a better answer than nothing
      // while the GPS warms up indoors.
      const known = await Location.getLastKnownPositionAsync({
        maxAge: LAST_KNOWN_MAX_AGE_MS,
        requiredAccuracy: 500,
      }).catch(() => null);
      if (!alive) return;
      if (known && !latest) {
        latest = known;
        schedule(FIRST_DELAY_MS);
      }
      // Said plainly if the sky stays silent, rather than "Finding…" forever.
      noFix = setTimeout(() => {
        if (alive && !latest) setStatus({ kind: 'no_fix' });
      }, NO_FIX_MS);
      watch = await Location.watchPositionAsync(
        {
          // High, not Balanced: Balanced is Android's network positioning,
          // which is exactly the Google "Location Accuracy" option a rider may
          // have refused — the test tablet had it off, and the GPS was never
          // even switched on. High asks the GPS itself. It only runs while
          // the app is open on duty, and 50 m / 15 s keeps it light.
          accuracy: Location.Accuracy.High,
          timeInterval: 15_000,
          distanceInterval: 50,
          // With "Location Accuracy" off, Android would otherwise raise
          // Google's consent dialog on every start.
          mayShowUserSettingsDialog: false,
        },
        (fix) => {
          const first = !latest;
          latest = fix;
          if (first) schedule(FIRST_DELAY_MS);
        }
      );
      if (!alive) {
        watch.remove();
        watch = null;
      }
    })();

    // A delivery starting or ending changes what the row should say now.
    const offTracking = onTrackingChange(() => schedule(1_000));

    return () => {
      alive = false;
      offTracking();
      if (timer) clearTimeout(timer);
      if (recheck) clearTimeout(recheck);
      if (noFix) clearTimeout(noFix);
      watch?.remove();
    };
  }, [active, permTick, qc]);
}

/** Whether to ask for location on clocking on: the feature is on and nothing has been granted yet. */
export async function needsDutyLocationPermission(): Promise<boolean> {
  if (Platform.OS === 'web' || isMock()) return false;
  if (!hasFeature('location')) return false;
  const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
  return !perm?.granted && perm?.canAskAgain !== false;
}

/**
 * The rider tapped the fix on Home's sharing row. Each branch is the rider's
 * own choice, so raising Android's dialogs here is what they asked for.
 */
export async function fixSharing(status: SharingStatus): Promise<void> {
  if (status.kind === 'no_permission') {
    if (status.canAsk) {
      await Location.requestForegroundPermissionsAsync().catch(() => null);
    } else {
      // Refused twice: Android will not ask again, only Settings can change it.
      await Linking.openSettings().catch(() => {});
      return; // Coming back to the app re-checks.
    }
  } else if (status.kind === 'no_fix') {
    // What built-in apps do indoors: ask for Google's Wi-Fi positioning
    // ("Location Accuracy"), which answers in seconds where GPS cannot. The
    // dialog is Google's own and the choice is the rider's. iOS has no
    // equivalent to offer; it already uses Wi-Fi.
    if (Platform.OS === 'android') {
      await Location.enableNetworkProviderAsync().catch(() => {});
    }
  } else if (status.kind === 'services_off') {
    if (Platform.OS !== 'android') {
      // iOS has no in-app prompt for this; the rider has to flip it in Settings.
      await Linking.openSettings().catch(() => {});
      return;
    }
    await Location.enableNetworkProviderAsync().catch(() => {});
  }
  notifyLocationPermission();
}
