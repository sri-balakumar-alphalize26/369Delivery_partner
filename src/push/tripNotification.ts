import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { metresBetween } from '../lib/routeGeometry';

/**
 * The job in hand, pinned on the lock screen and in the notification shade,
 * the way Uber and the delivery apps show a live trip:
 *
 *   Going to the customer · S00042
 *   Fatma Al Balushi · 1.2 km · about 17:42
 *
 * Silent, on its own quiet channel, and updated in place as the rider moves
 * (no new buzz each time). Tapping it opens the job. It goes when tracking
 * stops - the job ended - or when the job screen says the job is over.
 *
 * The job screen feeds it the step and the route; with the screen off, the
 * location task (`tracking.ts`) refreshes the distance from the destination
 * the screen left here.
 */

export const TRIP_LIVE_CHANNEL = 'trip-live';
const MIN_GAP_MS = 15_000;

export interface TripInfo {
  orderId: number;
  /** "Going to the customer · S00042". */
  title: string;
  /** Who is at the other end: "Fatma Al Balushi". */
  who: string;
  /** Where the rider is heading, for the background distance. */
  dest?: { latitude: number; longitude: number } | null;
  /** From the route, when there is one. */
  distanceM?: number;
  /** "17:42", worked out by the screen in the shop's zone. */
  eta?: string;
}

type Notifee = typeof import('@notifee/react-native');
let lib: Notifee | null | undefined;
function notifee(): Notifee | null {
  if (lib !== undefined) return lib;
  lib = null;
  if (Platform.OS !== 'android') return lib;
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return lib;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    lib = require('@notifee/react-native') as Notifee;
  } catch {
    lib = null;
  }
  return lib;
}

let current: TripInfo | null = null;
let shownKey = '';
let lastAt = 0;
let channelReady = false;

function distanceText(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

function bodyOf(t: TripInfo): string {
  return [t.who, t.distanceM !== undefined ? distanceText(t.distanceM) : null, t.eta ? `about ${t.eta}` : null]
    .filter(Boolean)
    .join(' · ');
}

async function ensureChannel(): Promise<void> {
  if (channelReady || Platform.OS !== 'android') return;
  const n = notifee();
  if (n) {
    await n.default.createChannel({
      id: TRIP_LIVE_CHANNEL,
      name: 'Current job',
      description: 'The job you are on, pinned while you ride. Silent.',
      importance: n.AndroidImportance.LOW,
      visibility: n.AndroidVisibility.PUBLIC,
    });
  } else {
    await Notifications.setNotificationChannelAsync(TRIP_LIVE_CHANNEL, {
      name: 'Current job',
      description: 'The job you are on, pinned while you ride. Silent.',
      importance: Notifications.AndroidImportance.LOW,
      sound: null,
      enableVibrate: false,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }
  channelReady = true;
}

async function post(t: TripInfo): Promise<void> {
  await ensureChannel();
  const id = `trip-${t.orderId}`;
  const body = bodyOf(t);
  const n = notifee();
  if (n) {
    await n.default.displayNotification({
      id,
      title: t.title,
      body,
      data: { delivery_order_id: String(t.orderId) },
      android: {
        channelId: TRIP_LIVE_CHANNEL,
        ongoing: true,
        onlyAlertOnce: true,
        autoCancel: false,
        smallIcon: 'notification_icon',
        color: '#0F3D2E',
        pressAction: { id: 'default' },
      },
    });
    return;
  }
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: {
      title: t.title,
      body,
      data: { delivery_order_id: t.orderId },
      sticky: true,
      sound: false,
    },
    trigger: { channelId: TRIP_LIVE_CHANNEL },
  });
}

/** Show or update the pinned job. At most once every 15 s unless the step changed. */
export async function showTrip(t: TripInfo): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const key = `${t.orderId}|${t.title}`;
    const now = Date.now();
    current = t;
    if (key === shownKey && now - lastAt < MIN_GAP_MS) return;
    shownKey = key;
    lastAt = now;
    await post(t);
  } catch {
    // A missing pinned card is never worth more than a log line.
  }
}

/** From the background location task: the same job, a fresh distance. */
export async function tripMoved(at: { latitude: number; longitude: number }): Promise<void> {
  if (!current?.dest) return;
  await showTrip({ ...current, distanceM: metresBetween(at, current.dest), eta: undefined });
}

/** The job is over or no longer this rider's: take the card away. */
export async function clearTrip(): Promise<void> {
  const t = current;
  current = null;
  shownKey = '';
  if (!t || Platform.OS !== 'android') return;
  const id = `trip-${t.orderId}`;
  try {
    const n = notifee();
    if (n) await n.default.cancelNotification(id);
    else await Notifications.dismissNotificationAsync(id);
  } catch {
    // Already gone.
  }
}
