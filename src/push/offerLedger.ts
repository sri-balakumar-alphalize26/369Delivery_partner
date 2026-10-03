import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Which offers have already been announced, shared by the two things that
 * announce them: `useOfferAlert` while the app is open, and the duty watch's
 * `checkOffers` while it is not. One ledger so one offer rings once, whichever
 * of the two saw it first.
 *
 * Saved, because the duty watch can run in a fresh JavaScript context after
 * Android restarts the service, with none of the open app's memory. Without
 * this the first check after such a restart would ring for every offer the
 * rider has already been told about.
 */

const KEY = 'd369.offers.announced';

const ids = new Set<number>();
let loaded: Promise<void> | null = null;

/** Read the saved ids, merged into whatever was added before they arrived. */
export function loadLedger(): Promise<void> {
  if (!loaded) {
    loaded = AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        for (const id of JSON.parse(raw) as number[]) ids.add(id);
      })
      .catch(() => {});
  }
  return loaded;
}

function persist(): void {
  AsyncStorage.setItem(KEY, JSON.stringify([...ids])).catch(() => {});
}

export function announced(id: number): boolean {
  return ids.has(id);
}

export function markAnnounced(id: number): void {
  if (ids.has(id)) return;
  ids.add(id);
  persist();
}

/**
 * Forget anything no longer on offer: the set cannot grow all shift, and a job
 * offered a second time announces itself again.
 */
export function keepOnly(live: Set<number>): void {
  let changed = false;
  for (const id of ids) {
    if (!live.has(id)) {
      ids.delete(id);
      changed = true;
    }
  }
  if (changed) persist();
}

/** A sign-out and back in takes a fresh baseline, not the last rider's. */
export function clearLedger(): void {
  ids.clear();
  persist();
}
