import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { clearTrip, tripMoved } from '../push/tripNotification';
import { AppState, Platform } from 'react-native';
import { api } from '../api/endpoints';
import { hasFeature } from '../api/features';
import { riderBeatDue, riderBeatFailed, riderBeatSent } from './riderBeat';
import { checkOffers } from '../push/offerWatch';

/**
 * Location for a delivery in progress, under the contract's rules (rider plan
 * rev 2, section 6b — the customer's tracking page draws exactly these fixes):
 *
 *   - From Accept until Delivered. `tracking.enabled` is true for accepted,
 *     picked, dispatched and out_for_delivery; the job screen starts this on
 *     any of them and stops it when the job is over.
 *   - At the pace the server sets: each reply's `poll_after_seconds` says when
 *     the next fix is due — 20 s on the way, 10 s near the customer. No filter
 *     of our own: Odoo skips a fix too close to the last but still counts it as
 *     "last seen", which is what the page shows.
 *   - If any response carries `"stop": true`, stop immediately — the delivery is
 *     over, and a rider's evening is their own.
 *
 * There is no batching or queueing: a failed fix is simply followed by the next
 * one when it is due.
 *
 * The same task also keeps an on-duty rider listening for offers with the phone
 * locked — the duty watch. Android pauses a backgrounded app's polling, and
 * push is not wired yet, so a foreground service is the one thing that keeps
 * a check running. Its wake-ups call `checkOffers`, and with no job in hand
 * send the on-duty heartbeat (`/rider/location`) at the server's pace. One
 * task rather than two because expo-location gives every task its own service
 * and its own notification, and a rider does not need two banners saying the
 * same app is running.
 */

export const LOCATION_TASK = 'd369-location-task';

/** Until the server has said otherwise: its pace on the way to the customer. */
const DEFAULT_INTERVAL_MS = 20_000;
/** How often the OS is asked for a fix: the server's fastest pace, near the customer. */
const FIX_INTERVAL_MS = 10_000;
/** A fix this early is close enough: waiting for the next would add a whole interval. */
const DUE_SLACK_MS = 2_000;
/** How often an on-duty phone with no job wakes to look for offers. */
const DUTY_INTERVAL_MS = 15_000;
/** Stored, so a service Android restarts in a fresh context knows it is wanted. */
const DUTY_KEY = 'd369.dutyWatch';
/** The same for the job being tracked: a restart mid-delivery must not go quiet. */
const TRACK_KEY = 'd369.trackingOrder';

const trackingListeners = new Set<() => void>();

/**
 * Told whenever a job's reporting starts or stops, so Home's sharing row is
 * never a step behind - it used to say "sharing for this delivery" for up to
 * a minute after Delivered.
 */
export function onTrackingChange(fn: () => void): () => void {
  trackingListeners.add(fn);
  return () => {
    trackingListeners.delete(fn);
  };
}

function notifyTracking(): void {
  for (const fn of trackingListeners) fn();
}

/** Which job the fixes belong to. Null means tracking is off. */
let activeOrderId: number | null = null;
/** Whether `activeOrderId` has been read back from storage in this context. */
let trackRestored = false;
/** When the next fix is due, from the last reply's `poll_after_seconds`. */
let nextDueAt = 0;

/** Whether the rider is on duty and wants offers to ring with the phone locked. */
let dutyWatch = false;
/** Whether `dutyWatch` has been read back from storage in this context. */
let dutyRestored = false;
let lastOfferCheck = 0;

/** What the task is running as right now, so a re-apply can skip a no-op. */
let mode: 'job' | 'duty' | 'off' = 'off';

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
 * holds: the same server-set pace, the same start and stop points. Only the
 * source of the fixes differs, and a development or store build never takes
 * this branch.
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
    if (error || !data) return;

    const { locations } = data as { locations: Location.LocationObject[] };
    const fix = locations?.[locations.length - 1];
    if (fix && (await trackedJob()) !== null) await send(fix);
    else if (fix) await maybeBeat(fix);

    await maybeCheckOffers();
  });
}

/**
 * The on-duty heartbeat with the screen off — what keeps a waiting rider
 * ranked by distance for "Call a Rider" rather than last as "position
 * unknown". With the app open, `useDutyLocation` sends it from a sharper fix;
 * `riderBeat` keeps the two to the server's one pace.
 */
async function maybeBeat(fix: Location.LocationObject): Promise<void> {
  if (AppState.currentState === 'active') return;
  if (!hasFeature('location') || !(await dutyWatchOn()) || !riderBeatDue()) return;
  try {
    const res = await api.riderLocation({
      latitude: fix.coords.latitude,
      longitude: fix.coords.longitude,
      accuracy: fix.coords.accuracy ?? 0,
    });
    if (!res.on_duty) return await stopDutyWatch();
    riderBeatSent(res.poll_after_seconds);
    // A missed push: look at the orders on this same wake-up.
    if (res.has_new_offer) lastOfferCheck = 0;
  } catch {
    riderBeatFailed(60_000);
  }
}

/**
 * The job being tracked, read back from storage the first time a fresh context
 * asks — which is what Android restarting the service mid-delivery looks like.
 * Without this the customer's map froze until the rider reopened the job.
 * The server's `stop` still ends it, in `send()`.
 */
async function trackedJob(): Promise<number | null> {
  if (activeOrderId === null && !trackRestored) {
    trackRestored = true;
    const saved = Number(await AsyncStorage.getItem(TRACK_KEY).catch(() => null));
    if (Number.isFinite(saved) && saved > 0) activeOrderId = saved;
  }
  return activeOrderId;
}

async function dutyWatchOn(): Promise<boolean> {
  if (!dutyRestored) {
    dutyRestored = true;
    if (!dutyWatch) {
      dutyWatch = (await AsyncStorage.getItem(DUTY_KEY).catch(() => null)) === '1';
    }
  }
  return dutyWatch;
}

/**
 * About one look per 15s, however often the OS hands over a fix. The slack is
 * for jitter: a fix arriving at 14.8s would otherwise be skipped, and every
 * other check with it.
 */
async function maybeCheckOffers(): Promise<void> {
  if (!(await dutyWatchOn())) return;
  const now = Date.now();
  if (now - lastOfferCheck < DUTY_INTERVAL_MS - 3_000) return;
  lastOfferCheck = now;

  // The office can clock a rider off; the watch ends with the shift.
  if ((await checkOffers()) === false) await stopDutyWatch();
}

/**
 * The one path every fix takes, background or foreground, so the server's
 * pace and the stop instruction cannot be honoured in one and forgotten in
 * the other.
 */
async function send(fix: Location.LocationObject): Promise<void> {
  if (activeOrderId === null) return;

  // The OS hands over a fix every 10 s; the server decides which ones it wants.
  const now = Date.now();
  if (now < nextDueAt - DUE_SLACK_MS) return;
  nextDueAt = now + DEFAULT_INTERVAL_MS;

  try {
    const res = await api.sendLocation(activeOrderId, {
      latitude: fix.coords.latitude,
      longitude: fix.coords.longitude,
      accuracy: fix.coords.accuracy ?? 0,
    });

    if (res.stop) return await stopTracking();
    // The pinned job card's distance, kept fresh with the screen off.
    void tripMoved({ latitude: fix.coords.latitude, longitude: fix.coords.longitude });
    if (res.poll_after_seconds && res.poll_after_seconds > 0) {
      nextDueAt = now + res.poll_after_seconds * 1000;
    }
  } catch {
    // A dropped fix is not worth retrying — the next one is due soon and more
    // accurate. Queueing stale positions would misreport where the rider is.
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
 * Start reporting for a job the rider has just moved on — an action reply with
 * `tracking.enabled`, or one in a tracked state. May raise Android's
 * permission dialogs, so the screen shows its explainer first.
 */
export async function startTracking(orderId: number): Promise<TrackingResult> {
  // The web preview reports success so the flow can be walked; it simply does
  // not send positions.
  if (!SUPPORTED) {
    activeOrderId = orderId;
    return { ok: true };
  }
  if (activeOrderId === orderId && (foregroundWatch || mode === 'job')) return { ok: true };

  const access = await requestLocationAccess();
  if (!access.ok) return access;

  await begin(orderId);
  return { ok: true };
}

/**
 * Pick reporting up for a job that should already be tracked — opened after a
 * restart, or dispatched by the shop on its own screen. Never asks: with
 * permission missing it does nothing, and the next step's tap asks properly.
 */
export async function keepTracking(orderId: number): Promise<void> {
  if (!SUPPORTED) return;
  if (activeOrderId === orderId && (foregroundWatch || mode === 'job')) return;
  if (!(await hasLocationPermission())) return;
  if (!(await Location.hasServicesEnabledAsync().catch(() => false))) return;
  await begin(orderId);
}

async function begin(orderId: number): Promise<void> {
  // A different job than the one being reported: its pace starts afresh.
  if (activeOrderId !== orderId) nextDueAt = 0;
  activeOrderId = orderId;
  trackRestored = true;
  notifyTracking();
  await AsyncStorage.setItem(TRACK_KEY, String(orderId)).catch(() => {});

  if (IN_EXPO_GO) {
    if (!foregroundWatch) {
      foregroundWatch = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: FIX_INTERVAL_MS,
          distanceInterval: 0,
        },
        send
      );
    }
    return;
  }

  await applyMode();
}

export async function stopTracking(): Promise<void> {
  activeOrderId = null;
  // The job is over: the pinned "current job" card goes with it.
  void clearTrip();
  trackRestored = true;
  notifyTracking();
  await AsyncStorage.removeItem(TRACK_KEY).catch(() => {});
  if (!SUPPORTED) return;

  if (foregroundWatch) {
    foregroundWatch.remove();
    foregroundWatch = null;
  }

  // Back to listening for offers if the rider is still on duty, off otherwise.
  await applyMode();
}

const NOTIFICATION = {
  notificationTitle: '369 Delivery Partner',
  notificationColor: '#0F3D2E',
};

/**
 * The task's options for each need. Both use no distance filter: the duty
 * watch needs its wake-ups when the rider is standing still, and `send()`
 * keeps to the server's pace itself.
 */
const OPTIONS: Record<'job' | 'duty', Location.LocationTaskOptions> = {
  job: {
    accuracy: Location.Accuracy.High,
    timeInterval: FIX_INTERVAL_MS,
    distanceInterval: 0,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      ...NOTIFICATION,
      notificationBody: 'Sharing your location for the delivery in progress.',
    },
  },
  // Balanced, not High: these fixes are never sent anywhere, they only wake
  // the app. Balanced still arrives on time without holding the GPS on all shift.
  duty: {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: DUTY_INTERVAL_MS,
    distanceInterval: 0,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      ...NOTIFICATION,
      notificationBody: 'On duty – listening for new jobs.',
    },
  },
};

/**
 * Run the one task as whatever is needed now: a job's tracking, the duty
 * watch, or nothing.
 *
 * Starting a running task again swaps its options and its notification text in
 * place (expo-location's `setOptions`), so moving between the two needs no stop
 * and no second notification. Android allows that only with the app in front;
 * a switch attempted from the background — a job ended by the server's "stop"
 * — leaves the task as it was, and the callback still does the right thing,
 * since it reads `activeOrderId` and `dutyWatch` rather than the mode.
 */
async function applyMode(): Promise<void> {
  if (!SUPPORTED || IN_EXPO_GO) return;
  const want = activeOrderId !== null ? 'job' : dutyWatch ? 'duty' : 'off';

  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(
    () => false
  );
  if (want === 'off') {
    if (running) await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
    mode = 'off';
    return;
  }
  if (running && mode === want) return;

  try {
    await Location.startLocationUpdatesAsync(LOCATION_TASK, OPTIONS[want]);
    mode = want;
  } catch (err) {
    console.warn('[location] could not switch to', want, (err as Error)?.message);
  }
}

export type DutyWatchResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'services_off' | 'foreground_denied' };

/**
 * Listen for offers with the phone locked, for as long as the rider is on duty.
 *
 * Asks for nothing: it starts only on a permission the rider has already
 * given, and says which one is missing otherwise, so Home can explain before
 * Android asks. Foreground location is enough — a foreground service started
 * from the open app needs no "Allow all the time".
 */
export async function startDutyWatch(): Promise<DutyWatchResult> {
  // Expo Go has no background location at all, and the web has no tasks.
  if (!SUPPORTED || IN_EXPO_GO) return { ok: false, reason: 'unsupported' };
  if (!(await Location.hasServicesEnabledAsync())) return { ok: false, reason: 'services_off' };
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) return { ok: false, reason: 'foreground_denied' };

  dutyWatch = true;
  dutyRestored = true;
  await AsyncStorage.setItem(DUTY_KEY, '1').catch(() => {});
  await applyMode();
  return { ok: true };
}

export async function stopDutyWatch(): Promise<void> {
  dutyWatch = false;
  dutyRestored = true;
  await AsyncStorage.removeItem(DUTY_KEY).catch(() => {});
  await applyMode();
}

export function dutyWatchRunning(): boolean {
  return dutyWatch;
}

/**
 * At launch, with the app in front: pick a delivery's tracking back up if the
 * last run ended mid-job — Android killed the process, service and all, and
 * did not bring it back. The server's next `stop` ends it as usual.
 */
export async function resumeTrackingAfterRestart(): Promise<void> {
  if (!SUPPORTED || IN_EXPO_GO) return;
  if ((await trackedJob()) === null) return;
  if (!(await hasLocationPermission())) return;
  await applyMode();
}

export function trackedOrderId(): number | null {
  return activeOrderId;
}
