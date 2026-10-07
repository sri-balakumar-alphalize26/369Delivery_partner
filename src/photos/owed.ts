import AsyncStorage from '@react-native-async-storage/async-storage';
import { Money } from '../api/types';
import { dropPhotos } from './shrink';

/**
 * Photos a job still owes, after its pickup code or the customer's code.
 *
 * The code is already accepted when the camera opens, so nothing on the server
 * holds the rider to the photos. This list does: while it has an entry the app
 * keeps the rider on the photo screen, and it lives in storage so closing the
 * app or a restart lands back there with the photos already taken.
 *
 * Send marks the entry `submitted`: the rider is free to go, and the uploader
 * (`uploader.ts`) sends its photos in the background, clearing it once all are up.
 */

export type PhotoStage = 'pickup' | 'delivery';

export const MIN_PHOTOS = 2;
export const MAX_PHOTOS = 4;

export interface Shot {
  uri: string;
  /** `S00042_051026_173915.jpg` - see `photoFileName`. */
  name: string;
  /** When it was taken, server clock (ms). The name is made again from it at send time. */
  takenAt?: number;
  /** Up on the server; a retry after a dropped signal skips it. */
  sent: boolean;
  /** The lighter copy that goes up (`shrinkPhoto`), made once. */
  small?: string;
}

export interface OwedPhotos {
  orderId: number;
  stage: PhotoStage;
  /** The order number for the file names. A delivered job leaves /orders, so it is kept here. */
  ref: string;
  customerName: string;
  /** A Delivery Partner's pay for the trip, for the thank-you screen. Null for an office rider. */
  fee?: Money | null;
  /** When the server marked it delivered, UTC. Delivery stage only. */
  deliveredAt?: string;
  shots: Shot[];
  /** Send pressed: the photos are final and upload in the background. */
  submitted?: boolean;
}

const KEY = 'd369.owedPhotos';

let cache: OwedPhotos[] | null = null;
const listeners = new Set<() => void>();

async function load(): Promise<OwedPhotos[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as OwedPhotos[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function save(next: OwedPhotos[]): Promise<void> {
  cache = next;
  for (const fn of listeners) fn();
  await AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
}

export function onOwedChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Opens the debt. Taking the code twice keeps the photos already taken. */
export async function owePhotos(entry: Omit<OwedPhotos, 'shots'>): Promise<void> {
  const all = await load();
  if (all.some((e) => e.orderId === entry.orderId && e.stage === entry.stage)) return;
  await save([...all, { ...entry, shots: [] }]);
}

export async function getOwed(orderId: number, stage: PhotoStage): Promise<OwedPhotos | null> {
  return (await load()).find((e) => e.orderId === orderId && e.stage === stage) ?? null;
}

/** The oldest job whose photos are still to be taken: where the app sends the rider back to. */
export async function firstUnsubmitted(): Promise<OwedPhotos | null> {
  return (await load()).find((e) => !e.submitted) ?? null;
}

/** The oldest job whose photos are taken and still going up. */
export async function nextToUpload(): Promise<OwedPhotos | null> {
  return (await load()).find((e) => e.submitted && e.shots.some((s) => !s.sent)) ?? null;
}

/** Sent jobs left behind: the app closed between the last upload and clearing it. */
export async function clearFinished(): Promise<void> {
  for (const e of await load()) {
    if (e.submitted && e.shots.every((s) => s.sent)) await clearOwed(e.orderId, e.stage);
  }
}

/** Photos taken, sent off with Send, and not up yet - for the upload bar. */
export async function pendingCount(): Promise<number> {
  return (await load())
    .filter((e) => e.submitted)
    .reduce((n, e) => n + e.shots.filter((s) => !s.sent).length, 0);
}

/** Send: the photos are final, and the rider may leave. */
export async function submitOwed(orderId: number, stage: PhotoStage): Promise<void> {
  const all = await load();
  await save(
    all.map((e) => (e.orderId === orderId && e.stage === stage ? { ...e, submitted: true } : e))
  );
}

export async function updateShots(orderId: number, stage: PhotoStage, shots: Shot[]): Promise<void> {
  const all = await load();
  await save(all.map((e) => (e.orderId === orderId && e.stage === stage ? { ...e, shots } : e)));
}

/** Ends the debt and deletes its files: all sent, or the server will take no more. */
export async function clearOwed(orderId: number, stage: PhotoStage): Promise<void> {
  const all = await load();
  const gone = all.find((e) => e.orderId === orderId && e.stage === stage);
  await save(all.filter((e) => e !== gone));
  if (gone) dropPhotos(gone.shots.flatMap((s) => [s.uri, s.small]));
}
