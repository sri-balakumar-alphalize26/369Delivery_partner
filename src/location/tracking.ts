import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { api } from '../api/endpoints';

/**
 * Background location, under the contract's rules — which are stricter than the
 * usual delivery-app defaults, and deliberately so:
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

if (SUPPORTED) {
  TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
    if (error || !data || activeOrderId === null) return;

    const { locations } = data as { locations: Location.LocationObject[] };
    const fix = locations?.[locations.length - 1];
    if (!fix) return;

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
  });
}

export async function hasLocationPermission(): Promise<boolean> {
  if (!SUPPORTED) return false;
  const fg = await Location.getForegroundPermissionsAsync();
  const bg = await Location.getBackgroundPermissionsAsync();
  return fg.granted && bg.granted;
}

/** Returns false if the rider declined a permission we cannot work without. */
export async function requestLocationPermission(): Promise<boolean> {
  if (!SUPPORTED) return false;
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return false;

  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.granted;
}

/**
 * Call this ONLY with the /start response in hand, and only when
 * `tracking.enabled` is true.
 */
export async function startTracking(orderId: number): Promise<boolean> {
  // The web preview reports success so the flow can be walked; it simply does
  // not send positions.
  if (!SUPPORTED) {
    activeOrderId = orderId;
    return true;
  }
  if (!(await requestLocationPermission())) return false;

  activeOrderId = orderId;
  lastSentAt = 0;

  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(
    () => false
  );
  if (running) return true;

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

  return true;
}

export async function stopTracking(): Promise<void> {
  activeOrderId = null;
  if (!SUPPORTED) return;
  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(
    () => false
  );
  if (running) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}

export function trackedOrderId(): number | null {
  return activeOrderId;
}
