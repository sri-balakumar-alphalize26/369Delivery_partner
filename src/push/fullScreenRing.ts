import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * A new job rung like an incoming call, the way Zepto and Blinkit do it.
 *
 * On a locked phone the screen turns on and the app opens straight onto the
 * offer (a full-screen notification, Android's "incoming call" path), with the
 * app's own ring looping until the rider acts or it times out. Unlocked, it is
 * a heads-up banner with "Open job" and "Not now".
 *
 * expo-notifications cannot post a full-screen notification, so this uses
 * notifee. Notifee is a native module: in Expo Go it does not exist, and
 * everything falls back to the plain alarm notification the app used before.
 *
 * The channel, `jobs-ring`, rings through Do Not Disturb. Android fixes a
 * channel's sound and settings the first time it is made, which is why this is
 * a new channel rather than a change to `jobs-alarm`. Android only honours the
 * DND bypass once the rider has given the app Do Not Disturb access (the phone
 * setup checklist), and on Android 14+ the full-screen ring needs its own
 * switch too (same checklist).
 */

export const RING_CHANNEL = 'jobs-ring';
/** How long an unanswered offer keeps ringing. */
const RING_MS = 30_000;

type Notifee = typeof import('@notifee/react-native');

let lib: Notifee | null | undefined;
/** Notifee, or null where it is not built in (Expo Go, web). */
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

/** The ring channel, made the same way by whichever library posts first. */
export async function ensureRingChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const n = notifee();
  if (n) {
    await n.default.createChannel({
      id: RING_CHANNEL,
      name: 'New job offers (ring)',
      description: 'Rings like a call when a job is offered, even in Do Not Disturb.',
      importance: n.AndroidImportance.HIGH,
      visibility: n.AndroidVisibility.PUBLIC,
      sound: 'new_job',
      vibration: true,
      vibrationPattern: [300, 700, 400, 700, 400, 700],
      bypassDnd: true,
      lights: true,
      lightColor: '#A3E635',
    });
    return;
  }
  await Notifications.setNotificationChannelAsync(RING_CHANNEL, {
    name: 'New job offers (ring)',
    description: 'Rings when a job is offered, even in Do Not Disturb.',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'new_job.wav',
    vibrationPattern: [0, 700, 400, 700, 400, 700],
    enableVibrate: true,
    bypassDnd: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    lightColor: '#A3E635',
  });
}

/** Ring one offer. Never throws: the vibration and the list still say it. */
export async function ringJob(job: { id: number; title: string; body: string }): Promise<void> {
  try {
    await ensureRingChannel();
    const n = notifee();
    if (n) {
      await n.default.displayNotification({
        id: `offer-${job.id}`,
        title: job.title,
        body: job.body,
        data: { delivery_order_id: String(job.id) },
        android: {
          channelId: RING_CHANNEL,
          category: n.AndroidCategory.CALL,
          importance: n.AndroidImportance.HIGH,
          visibility: n.AndroidVisibility.PUBLIC,
          smallIcon: 'notification_icon',
          color: '#0F3D2E',
          loopSound: true,
          lightUpScreen: true,
          autoCancel: true,
          timeoutAfter: RING_MS,
          // Locked phone: straight onto the offer, as a call screen does.
          fullScreenAction: { id: 'default' },
          pressAction: { id: 'default' },
          actions: [
            { title: 'Open job', pressAction: { id: 'open', launchActivity: 'default' } },
            { title: 'Not now', pressAction: { id: 'dismiss' } },
          ],
        },
      });
      return;
    }
    await Notifications.scheduleNotificationAsync({
      content: {
        title: job.title,
        body: job.body,
        data: { delivery_order_id: job.id },
        sound: 'new_job.wav',
        priority: Notifications.AndroidNotificationPriority.MAX,
      },
      trigger: { channelId: RING_CHANNEL },
    });
  } catch (err) {
    console.warn('[offer] could not ring:', (err as Error)?.message);
  }
}

/** Stop a job's ring, once the rider has opened, taken or declined it. */
export async function stopRing(id: number): Promise<void> {
  const n = notifee();
  if (!n) return;
  await n.default.cancelNotification(`offer-${id}`).catch(() => {});
}

/**
 * The job a ring was answered for: from a tap, "Open job", the full-screen
 * launch, or the launch that started the app. `onOpen` gets its id; "Not now"
 * just stops the ring. Returns an unsubscribe.
 */
export function onRingAnswered(onOpen: (id: number) => void): () => void {
  const n = notifee();
  if (!n) return () => {};
  const { EventType } = n;
  const handle = (type: number, detail: { notification?: { id?: string; data?: Record<string, unknown> }; pressAction?: { id: string } }) => {
    const id = Number(detail.notification?.data?.delivery_order_id);
    if (!Number.isFinite(id)) return;
    if (type === EventType.ACTION_PRESS && detail.pressAction?.id === 'dismiss') {
      void stopRing(id);
      return;
    }
    if (type === EventType.PRESS || type === EventType.ACTION_PRESS) {
      void stopRing(id);
      onOpen(id);
    }
  };
  const off = n.default.onForegroundEvent(({ type, detail }) => handle(type, detail));
  n.default
    .getInitialNotification()
    .then((initial) => {
      if (!initial) return;
      const id = Number(initial.notification.data?.delivery_order_id);
      if (Number.isFinite(id)) {
        void stopRing(id);
        onOpen(id);
      }
    })
    .catch(() => {});
  return off;
}

/**
 * Taps on the ring while the app is in the background. Notifee asks for this
 * to be registered once, at start-up; "Not now" only stops the ring, and an
 * "Open job" launches the app, which `onRingAnswered` then routes.
 */
export function registerRingBackgroundHandler(): void {
  const n = notifee();
  if (!n) return;
  n.default.onBackgroundEvent(async ({ type, detail }) => {
    const id = Number(detail.notification?.data?.delivery_order_id);
    if (!Number.isFinite(id)) return;
    if (type === n.EventType.ACTION_PRESS && detail.pressAction?.id === 'dismiss') {
      await stopRing(id);
    }
  });
}

/** Stop every offer still ringing: the rider is dealing with jobs in the app. */
export async function stopAllRings(): Promise<void> {
  const n = notifee();
  if (!n) return;
  try {
    const shown = await n.default.getDisplayedNotifications();
    await Promise.all(
      shown
        .map((d) => d.notification.id)
        .filter((id): id is string => !!id && id.startsWith('offer-'))
        .map((id) => n.default.cancelNotification(id))
    );
  } catch {
    // Nothing ringing.
  }
}
