import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { peekServer } from '../api/config';
import { LatLng, Leg, pointAtDistance } from '../lib/routeGeometry';

/**
 * Where the rider is, once per second, from whichever source this build has.
 *
 * The map used to take this from `showsUserLocation` and `onUserLocationChange`,
 * which cannot be separated: that one flag both emits the position events and
 * draws Google's blue dot. Drawing a scooter of our own on top of it would put
 * two riders on the map, so the position has to come from somewhere else.
 *
 * That reverses a deliberate comment in `RouteMapView` — "not a second GPS
 * subscription of our own... the contract's rules are not worth bending for a
 * smoother marker" — and the distinction is worth stating plainly. The
 * contract's twenty-second floor governs what is SENT TO ODOO, and
 * `src/location/tracking.ts` still honours it exactly. How often the phone reads
 * its own GPS is a separate question, and this costs nothing extra anyway:
 * `showsUserLocation` was already running the same stream.
 */

export type Fix = {
  coordinate: LatLng;
  /** Degrees clockwise from north, or null when the phone cannot say. */
  heading: number | null;
  at: number;
};

/** Roughly 30km/h — a Muscat scooter on ordinary roads. */
const SIM_SPEED_MPS = 8.3;
const SIM_TICK_MS = 1000;

/** Matches the simulated tick, so real and demo fixes animate over the same gap. */
const WATCH_INTERVAL_MS = 1000;
const WATCH_DISTANCE_M = 5;

export function useRiderPosition(leg: Leg | null): Fix | null {
  const [fix, setFix] = useState<Fix | null>(null);

  /**
   * Demo mode drives a rider along the route instead of reading GPS, because a
   * phone on a desk never moves and the whole point of this screen is movement.
   * Read once per mount: switching servers sends the rider back through Connect,
   * which remounts everything below it.
   */
  const simulated = peekServer().useMock;

  /* ----------------------------------------------------------------- *
   * Real GPS.
   * ----------------------------------------------------------------- */
  useEffect(() => {
    if (simulated || Platform.OS === 'web') return;

    let alive = true;
    let sub: Location.LocationSubscription | null = null;

    (async () => {
      /**
       * CHECKED, never requested — the same rule the map has always followed.
       * This mounts with the job screen, so asking here would raise Android's
       * dialog the instant a rider opens a job, cold and ahead of the explainer
       * that exists to precede it. Permission is the tracker's business, asked
       * for at /start behind `LocationPrimer`.
       */
      const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (!alive || !perm?.granted) return;

      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: WATCH_INTERVAL_MS,
          distanceInterval: WATCH_DISTANCE_M,
        },
        (p) => {
          // Android reports -1 rather than null when it has no bearing, and a
          // stationary phone has none at all. Either way the road's own
          // direction is the better answer, so hand back null and let the
          // caller take the bearing off the route.
          const h = p.coords.heading;
          setFix({
            coordinate: { latitude: p.coords.latitude, longitude: p.coords.longitude },
            heading: typeof h === 'number' && h >= 0 ? h : null,
            at: Date.now(),
          });
        }
      );

      // The screen may have gone while the subscription was being set up.
      if (!alive) {
        sub.remove();
        sub = null;
      }
    })();

    return () => {
      alive = false;
      sub?.remove();
    };
  }, [simulated]);

  /* ----------------------------------------------------------------- *
   * The demo ride.
   * ----------------------------------------------------------------- */
  const along = useRef(0);

  useEffect(() => {
    if (!simulated || !leg || leg.length === 0) return;

    along.current = 0;

    const timer = setInterval(() => {
      along.current = Math.min(leg.length, along.current + SIM_SPEED_MPS * (SIM_TICK_MS / 1000));
      const { coordinate, bearing } = pointAtDistance(leg, along.current);
      setFix({ coordinate, heading: bearing, at: Date.now() });
      // Holds at the door rather than looping. A rider who has arrived has
      // arrived; restarting the run would misrepresent the state of the job.
    }, SIM_TICK_MS);

    return () => clearInterval(timer);
  }, [simulated, leg]);

  return fix;
}
