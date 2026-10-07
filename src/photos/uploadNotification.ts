import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import type { UploadState } from './uploader';

/**
 * "Uploading photos · S00042 · 2 of 4 · 63%" in the notification shade while
 * the parcel photos go up after Send.
 *
 * It is a foreground service, not only a notice: with the phone in a pocket,
 * Android would otherwise pause the app and the upload with it. Silent, on its
 * own quiet channel, and gone once every photo is up. The service is declared
 * `dataSync` by plugins/withPhotoUploadService.js.
 *
 * Notifee only: it does not exist in Expo Go, where the upload simply runs
 * while the app is open.
 */

const CHANNEL = 'photo-upload';
const ID = 'photo-upload';
const MIN_GAP_MS = 1000;

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

/** Ends the service's task: resolved when the uploads are done. */
let release: (() => void) | null = null;
let channelReady = false;
let shown = false;
let lastAt = 0;
let lastPhase = '';

/**
 * Notifee runs this while the service is up; the service lives until the
 * promise settles. Called once, at start-up, from the root layout.
 */
export function registerUploadService(): void {
  const n = notifee();
  if (!n) return;
  n.default.registerForegroundService(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
}

async function ensureChannel(n: Notifee): Promise<void> {
  if (channelReady) return;
  await n.default.createChannel({
    id: CHANNEL,
    name: 'Photo uploads',
    description: 'Parcel photos going up after you press Send. Silent.',
    importance: n.AndroidImportance.LOW,
  });
  channelReady = true;
}

function textOf(s: UploadState): { title: string; body: string } {
  if (s.phase === 'waiting') {
    return {
      title: 'Waiting for signal',
      body: `${s.left} parcel photo${s.left === 1 ? '' : 's'} will upload when you are back online`,
    };
  }
  return {
    title: `Uploading photos · ${s.ref}`,
    body: `Photo ${s.index} of ${s.count} · ${Math.round(s.fraction * 100)}%`,
  };
}

/** Shows or updates it: at most once a second, unless sending/waiting changed. */
export async function showUploadNotification(s: UploadState): Promise<void> {
  const n = notifee();
  if (!n || s.phase === 'idle') return;
  const now = Date.now();
  if (shown && s.phase === lastPhase && now - lastAt < MIN_GAP_MS) return;
  lastAt = now;
  lastPhase = s.phase;
  try {
    await ensureChannel(n);
    const { title, body } = textOf(s);
    await n.default.displayNotification({
      id: ID,
      title,
      body,
      android: {
        channelId: CHANNEL,
        asForegroundService: true,
        foregroundServiceTypes: [n.AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_DATA_SYNC],
        ongoing: true,
        onlyAlertOnce: true,
        autoCancel: false,
        smallIcon: 'notification_icon',
        color: '#0F3D2E',
        pressAction: { id: 'default' },
        progress:
          s.phase === 'waiting'
            ? { max: 100, current: 0, indeterminate: true }
            : { max: 100, current: Math.round(s.fraction * 100) },
      },
    });
    shown = true;
  } catch (err) {
    // Android refuses a new foreground service started from the background;
    // the upload still runs while the app is awake.
    console.warn('[photos] upload notification:', (err as Error)?.message);
  }
}

export async function hideUploadNotification(): Promise<void> {
  const n = notifee();
  if (!n || !shown) return;
  shown = false;
  lastPhase = '';
  try {
    await n.default.stopForegroundService();
    await n.default.cancelNotification(ID);
  } catch {
    // Already gone.
  }
  release?.();
  release = null;
}
