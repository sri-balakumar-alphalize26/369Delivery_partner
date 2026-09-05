import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { api } from '../api/endpoints';

/**
 * Location for a delivery in progress, under the contract's rules — which are
 * stricter than the usual delivery-app defaults, and deliberately so:
 *
 *   - Start ONLY on the /start response where `tracking.enabled` turns true.
 *     Never before. Sending GPS outside `out_for_delivery` is listed under
 *     "what not to do".
 *   - At most ONE fix every 20 seconds. Odoo ignores movement under 25 metres,
 *     so a faster rate buys nothing and costs the battery the job depends on.
 *   - If any response carries `"stop": true`, stop immediately — the delivery is
 *     over, and a rider's evening is their own.
 *
 * There is no batching: the contract takes a single fix per request.
 */

export const LOCATION_TASK = 'd369-location-task';

const MIN_INTERVAL_MS = 20_000;
const MIN_DISTANCE_M = 25;

/** Which job the fixes belong to. Null means tracking is off. */
let activeOrderId: number | null = null;
let lastSentAt = 0;

/**
 * Background tasks do not exist in a browser. The web build is only ever used
 * to preview the UI, so registering the task there would throw for nothing.
 */
const SUPPORTED = Platform.OS !== 'web';

/**
 * Expo Go removed background location on Android entirely — not restricted,
 * absent. Asking for the permission there can only ever fail, which would stop
 * the flow dead at the Start button with a message about Settings that no
 * setting can fix.
 *
 * So in Expo Go we track from the foreground instead. Every contract rule still
 * holds: the same 20-second floor, the same single start point, the same
 * immediate stop. Only the source of the fixes differs, and a development or
 * store build never takes this branch.
 */
const IN_EXPO_GO =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient &&
  Platform.OS === 'android';

/** Set only on the Expo Go path. The background task has no equivalent. */
let foregroundWatch: Location.LocationSubscription | null = null;

/**
 * Why tracking could not start, so the screen can say the true thing.
 *
 * This was a bare boolean, which forced one message to cover three unrelated
 * problems — and told a rider with location switched off to go and change a
 * permission that was already correct.
 */
export type TrackingResult =
  | { ok: true }
  | { ok: false; reason: 'services_off' | 'foreground_denied' | 'background_denied' };

if (SUPPORTED) {
  TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
    if (error || !data || activeOrderId === null) return;

    const { locations } = data as { locations: Location.LocationObject[] };
    const fix = locations?.[locations.length - 1];
    if (!fix) return;

    await send(fix);
  });
}

/**
 * The one path every fix takes, background or foreground, so the 20-second
 * floor and the stop instruction cannot be honoured in one and forgotten in
 * the other.
 */
async function send(fix: Location.LocationObject): Promise<void> {
  if (activeOrderId === null) return;

  // Enforce the 20s floor ourselves — the OS may deliver more often than asked.
  const now = Date.now();
  if (now - lastSentAt < MIN_INTERVAL_MS) return;
  lastSentAt = now;

  try {
    const res = await api.sendLocation(activeOrderId, {
      latitude: fix.coords.latitude,
      longitude: fix.coords.longitude,
      accuracy: fix.coords.accuracy ?? 0,
    });

    if (res.stop) await stopTracking();
  } catch {
    // A dropped fix is not worth retrying — the next one is 20 seconds away
    // and more accurate. Queueing stale positions would misreport where the
    // rider is.
  }
}

export async function hasLocationPermission(): Promise<boolean> {
  if (!SUPPORTED) return false;
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) return false;
  if (IN_EXPO_GO) return true;

  const bg = await Location.getBackgroundPermissionsAsync();
  return bg.granted;
}

/**
 * Make sure the phone's location switch is actually on, offering to turn it on
 * rather than describing where the setting lives.
 *
 * `enableNetworkProviderAsync` raises Android's own dialog and flips the switch
 * in place. It rejects if the rider dismisses it, which is a refusal and not an
 * error worth surfacing as one.
 */
async function ensureServicesOn(): Promise<boolean> {
  if (await Location.hasServicesEnabledAsync()) return true;

  if (Platform.OS === 'android') {
    try {
      await Location.enableNetworkProviderAsync();
      return await Location.hasServicesEnabledAsync();
    } catch {
      return false;
    }
  }

  // iOS has no equivalent prompt; the rider has to visit Settings themselves.
  return false;
}

/** Asks for everything this build actually needs, in the order it needs it. */
async function requestLocationAccess(): Promise<TrackingResult> {
  if (!(await ensureServicesOn())) return { ok: false, reason: 'services_off' };

  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return { ok: false, reason: 'foreground_denied' };

  // Expo Go has no background location to ask for. Asking anyway would fail and
  // be reported as the rider's refusal, which it is not.
  if (IN_EXPO_GO) return { ok: true };

  const bg = await Location.requestBackgroundPermissionsAsync();
  if (!bg.granted) return { ok: false, reason: 'background_denied' };

  return { ok: true };
}

/**
 * Call this ONLY with the /start response in hand, and only when
 * `tracking.enabled` is true.
 */
export async function startTracking(orderId: number): Promise<TrackingResult> {
  // The web preview reports success so the flow can be walked; it simply does
  // not send positions.
  if (!SUPPORTED) {
    activeOrderId = orderId;
    return { ok: true };
  }

  const access = await requestLocationAccess();
  if (!access.ok) return access;

  activeOrderId = orderId;
  lastSentAt = 0;

  if (IN_EXPO_GO) {
    if (!foregroundWatch) {
      foregroundWatch = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: MIN_INTERVAL_MS,
          distanceInterval: MIN_DISTANCE_M,
        },
        send
      );
    }
    return { ok: true };
  }

  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(
    () => false
  );
  if (running) return { ok: true };

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: MIN_INTERVAL_MS,
    distanceInterval: MIN_DISTANCE_M,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: '369 Delivery Partner',
      notificationBody: 'Sharing your location for the delivery in progress.',
      notificationColor: '#0042B3',
    },
  });

  return { ok: true };
}

export async function stopTracking(): Promise<void> {
  activeOrderId = null;
  if (!SUPPORTED) return;

  if (foregroundWatch) {
    foregroundWatch.remove();
    foregroundWatch = null;
  }

  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(
    () => false
  );
  if (running) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}

export function trackedOrderId(): number | null {
  return activeOrderId;
}
