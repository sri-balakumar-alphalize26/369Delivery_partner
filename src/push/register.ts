import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '../api/endpoints';

/**
 * Push registration.
 *
 * Odoo decides *when* to notify; Firebase is only the pipe that carries the
 * notification onto the phone, and Expo's service is the relay in between. The
 * app's job is just to hand Odoo a token it can send to.
 *
 * Mirrors the working implementation in the KRA_KPI app, including two details
 * learned there the hard way — see the projectId note in registerForPush, and
 * unregisterPush.
 *
 * Everything here degrades to `null` rather than throwing. Push is the fast
 * path for hearing about a job, not the only one: `useOrders` still polls, so
 * an app with no Firebase config, a denied permission or a dropped notification
 * is a slower app, never a broken one.
 */

/**
 * The token this device last registered, so sign-out can deactivate it without
 * every caller having to carry it around.
 */
let current: string | null = null;

/** Where `eas init` writes the project id. Without it, token minting throws. */
function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: string } }
    | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

/**
 * Ask permission, ensure the Android channel exists, mint a token and hand it
 * to Odoo. Returns the token, or null with a logged reason.
 */
export async function registerForPush(): Promise<string | null> {
  try {
    // Android needs the channel to exist BEFORE anything arrives, or the OS
    // shows no heads-up banner however high the priority is.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('jobs', {
        name: 'New jobs',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#3730A3',
      });
    }

    // Only prompt if we do not already have it — repeatedly asking is how an
    // app gets permanently denied.
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') {
      console.warn('[push] permission not granted — falling back to polling');
      return null;
    }

    const id = projectId();
    if (!id) {
      // Expected until `eas init` has been run. Not an error worth alarming
      // anyone about: the app polls exactly as it does today.
      console.warn('[push] no EAS projectId — push inactive, polling continues');
      return null;
    }

    const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
    if (!token) {
      console.warn('[push] no token returned');
      return null;
    }

    await api.registerPush({
      token,
      platform: Platform.OS,
      // Which EAS project minted this token. Expo rejects a send whose messages
      // span two project ids — and rejects the WHOLE request, so a single stale
      // token from an old project can silence every other rider. The server
      // groups its sends by this.
      projectId: id,
    });

    current = token;
    return token;
  } catch (err) {
    // Includes the emulator case, where token minting fails outright.
    console.warn('[push] registration failed:', (err as Error)?.message);
    return null;
  }
}

/**
 * Best-effort deactivation on sign-out, so a phone that has been handed on
 * stops receiving another rider's jobs.
 */
export async function unregisterPush(token: string | null): Promise<void> {
  if (!token) return;
  try {
    await api.unregisterPush(token);
    if (current === token) current = null;
  } catch (err) {
    console.warn('[push] unregister failed:', (err as Error)?.message);
  }
}

/** Deactivate whatever this device registered. Safe to call when there is none. */
export async function unregisterCurrentPush(): Promise<void> {
  await unregisterPush(current);
}

/** The token this device holds, for diagnostics. Null until registration succeeds. */
export function currentPushToken(): string | null {
  return current;
}

/**
 * Fire a notification from the phone itself.
 *
 * Local notifications never touch FCM, so this works over the Expo QR with no
 * Firebase config and no rebuild — which is the only way to exercise the chain
 * before the APK is rebuilt and the Odoo endpoints exist.
 *
 * It proves everything except delivery: permission, the Android channel, the
 * foreground handler, and tap-to-open-order. The payload deliberately matches
 * what a real push will carry, so the routing is tested rather than approximated.
 */
export async function sendTestNotification(orderId?: number): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      // The same channel a real push uses — if this is missing there is no
      // heads-up banner, which is itself the thing being tested.
      await Notifications.setNotificationChannelAsync('jobs', {
        name: 'New jobs',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#3730A3',
      });
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'New job offered',
        body: orderId ? 'Tap to open the job' : 'Test notification — no active job to open',
        data: orderId ? { delivery_order_id: orderId } : {},
        sound: true,
      },
      // null fires immediately; NotificationTriggerInput permits it.
      trigger: null,
    });
  } catch (err) {
    console.warn('[push] test notification failed:', (err as Error)?.message);
  }
}
