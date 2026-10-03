import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { peekServer } from '../api/config';
import { MOCK_SHOP } from '../api/mock/fixtures';
import { coords } from '../lib/format';
import { LatLng } from '../lib/routeGeometry';

/**
 * Where the rider is, for Home's "you are here" card.
 *
 * Lighter than `useRiderPosition`, which feeds a map someone is driving by.
 * Nobody navigates from this card, so Balanced accuracy every five seconds is
 * plenty, and it runs only while `active` — on duty, with Home the tab in view.
 *
 * Permission is CHECKED, never asked: the card asks only when the rider taps
 * its button. Coming back to the app looks again, which is how a change made in
 * Settings is noticed.
 */

export type HereFix = { coordinate: LatLng; heading: number | null };

export type HerePerm =
  | { kind: 'unknown' }
  | { kind: 'granted' }
  /** `canAsk` false: refused for good, and only Settings can change it. */
  | { kind: 'denied'; canAsk: boolean };

const WATCH_INTERVAL_MS = 5_000;
const WATCH_DISTANCE_M = 10;
/** A position the phone already holds, for a dot before the first fresh fix. */
const LAST_KNOWN_MAX_AGE_MS = 120_000;

function toFix(p: Location.LocationObject): HereFix {
  // Android reports -1 rather than null when it has no bearing.
  const h = p.coords.heading;
  return {
    coordinate: { latitude: p.coords.latitude, longitude: p.coords.longitude },
    heading: typeof h === 'number' && h >= 0 ? h : null,
  };
}

export function useHerePosition(active: boolean): {
  perm: HerePerm;
  fix: HereFix | null;
  recheck: () => void;
} {
  const [perm, setPerm] = useState<HerePerm>({ kind: 'unknown' });
  const [fix, setFix] = useState<HereFix | null>(null);
  const [tick, setTick] = useState(0);
  const simulated = peekServer().useMock;

  // Back from Settings, or from Android's own dialog: look again.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') setTick((n) => n + 1);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!active || Platform.OS === 'web') return;

    // A phone on a desk is not where the demo is: stand the rider at its shop.
    if (simulated) {
      const shop = coords(MOCK_SHOP.latitude, MOCK_SHOP.longitude);
      setPerm({ kind: 'granted' });
      setFix(shop ? { coordinate: shop, heading: null } : null);
      return;
    }

    let alive = true;
    let sub: Location.LocationSubscription | null = null;

    (async () => {
      const p = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (!alive) return;
      if (!p?.granted) {
        setPerm({ kind: 'denied', canAsk: p?.canAskAgain !== false });
        return;
      }
      setPerm({ kind: 'granted' });

      const known = await Location.getLastKnownPositionAsync({
        maxAge: LAST_KNOWN_MAX_AGE_MS,
      }).catch(() => null);
      if (alive && known) setFix(toFix(known));

      // Rejects with location services off; the card then keeps "Finding…"
      // and the duty card's sharing row says what is wrong.
      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: WATCH_INTERVAL_MS,
          distanceInterval: WATCH_DISTANCE_M,
        },
        (pos) => setFix(toFix(pos))
      ).catch(() => null);

      // The card may have gone while the subscription was being set up.
      if (!alive) {
        sub?.remove();
        sub = null;
      }
    })();

    return () => {
      alive = false;
      sub?.remove();
    };
  }, [active, simulated, tick]);

  return { perm, fix, recheck: () => setTick((n) => n + 1) };
}
