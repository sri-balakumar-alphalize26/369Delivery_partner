import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Photos a job still owes, after its pickup code or the customer's code.
 *
 * The code is already accepted when the camera opens, so nothing on the server
 * holds the rider to the photos. This list does: while it has an entry the app
 * keeps the rider on the photo screen, and it lives in storage so closing the
 * app or a restart lands back there with the photos already taken.
 */

export type PhotoStage = 'pickup' | 'delivery';

export const MIN_PHOTOS = 2;
export const MAX_PHOTOS = 4;

export interface Shot {
  uri: string;
  /** `S00042_051026_173915.jpg` - see `photoFileName`. */
  name: string;
  /** Up on the server; a retry after a dropped signal skips it. */
  sent: boolean;
}

export interface OwedPhotos {
  orderId: number;
  stage: PhotoStage;
  /** The order number for the file names. A delivered job leaves /orders, so it is kept here. */
  ref: string;
  customerName: string;
  shots: Shot[];
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

/** The oldest job still owing photos: where the app sends the rider back to. */
export async function firstOwed(): Promise<OwedPhotos | null> {
  return (await load())[0] ?? null;
}

export async function updateShots(orderId: number, stage: PhotoStage, shots: Shot[]): Promise<void> {
  const all = await load();
  await save(all.map((e) => (e.orderId === orderId && e.stage === stage ? { ...e, shots } : e)));
}

export async function clearOwed(orderId: number, stage: PhotoStage): Promise<void> {
  const all = await load();
  await save(all.filter((e) => !(e.orderId === orderId && e.stage === stage)));
}
