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

/**
 * Delivery and service offers are numbered by different models, so the same
 * number can be one of each. A service offer is kept as its negative.
 */
type Kind = 'delivery' | 'service';
const key = (id: number, kind: Kind) => (kind === 'service' ? -id : id);

export function announced(id: number, kind: Kind = 'delivery'): boolean {
  return ids.has(key(id, kind));
}

export function markAnnounced(id: number, kind: Kind = 'delivery'): void {
  const k = key(id, kind);
  if (ids.has(k)) return;
  ids.add(k);
  persist();
}

/**
 * Forget any offer of this kind no longer on offer: the set cannot grow all
 * shift, and a job offered a second time announces itself again. The other
 * kind's entries are left alone.
 */
export function keepOnly(live: Set<number>, kind: Kind = 'delivery'): void {
  let changed = false;
  for (const k of ids) {
    if (kind === 'service' ? k >= 0 : k < 0) continue;
    if (!live.has(Math.abs(k))) {
      ids.delete(k);
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
