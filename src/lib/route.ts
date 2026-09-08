import { LatLng, Leg, measure } from './routeGeometry';

/**
 * The road between two points, from OpenRouteService.
 *
 * Chosen over Google Directions for one practical reason: ORS issues a key on a
 * free signup with no card, and the card is the same blocker that already keeps
 * this app on the map key Expo Go bundles rather than one of its own. Quality is
 * lower than Google's, which matters less than it sounds — the Navigate button
 * still hands the written address to Google Maps for the actual driving. This
 * line is for orientation, and for an ETA that is finally real.
 *
 * Everything here degrades to `null`: no key, no signal, a rejected request or a
 * shape we do not recognise all end the same way, with the map drawing the
 * straight dashed leg it drew before. A missing route must never be able to take
 * the job screen down.
 */

/**
 * The new host, not the one the docs still mostly show.
 *
 * ORS is deprecating `api.openrouteservice.org` in favour of `api.heigit.org`,
 * and the path moved with it — the old `/v2/...` is a 404 on the new host,
 * while `/openrouteservice/v2/...` answers. Both were probed: the old host and
 * this one each return 403 to a bad key, which is the endpoint existing and
 * refusing the credential rather than the path being wrong.
 *
 * Pointed at the new one now because the old one is on notice, and a routing
 * host that disappears takes the map line and the ETA with it.
 */
const HOST = 'https://api.heigit.org/openrouteservice/v2/directions/driving-car';

/** Long enough to be worth waiting for, short enough not to stall the screen. */
const TIMEOUT_MS = 12_000;

export type Route = {
  leg: Leg;
  /** Metres along the road, not as the crow flies. */
  distanceM: number;
  /** Seconds, ORS's own estimate for a car. */
  durationS: number;
};

/**
 * ORS takes and returns `[longitude, latitude]` — the reverse of the order used
 * everywhere else in this app, and of the order the map library wants.
 *
 * That reversal is the single likeliest bug in this feature and it is a silent
 * one: swapped, Muscat's 23.6N 58.4E becomes 58.4N 23.6E, which is a real place
 * in the Baltic. No error, no warning, just a route drawn across the wrong
 * continent. So the conversion happens here and nowhere else, and
 * `scripts/geometry-test.ts` asserts it in both directions.
 */
function toOrs(p: LatLng): string {
  return `${p.longitude},${p.latitude}`;
}

/** The GeoJSON ORS answers with, as much of it as this needs. */
type Directions = {
  features?: {
    geometry?: { coordinates?: [number, number][] };
    properties?: { summary?: { distance?: number; duration?: number } };
  }[];
};

/**
 * Pulled out of the fetch so it can be tested against a captured response
 * without a key or a network — see the note above about how quietly this fails
 * when it is wrong.
 */
export function parseDirections(
  body: unknown
): { points: LatLng[]; distanceM: number; durationS: number } | null {
  const feature = (body as Directions)?.features?.[0];
  const raw = feature?.geometry?.coordinates;
  if (!Array.isArray(raw) || raw.length < 2) return null;

  const points: LatLng[] = [];
  for (const pair of raw) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const [longitude, latitude] = pair;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') continue;
    points.push({ latitude, longitude });
  }
  if (points.length < 2) return null;

  const summary = feature?.properties?.summary;
  return {
    points,
    distanceM: typeof summary?.distance === 'number' ? summary.distance : 0,
    durationS: typeof summary?.duration === 'number' ? summary.duration : 0,
  };
}

/**
 * One route per key, kept for the life of the process.
 *
 * The free tier allows about two thousand routes a day, which sounds generous
 * until a re-render asks for one. Callers fetch once per leg, and this catches
 * the rest: a screen revisited, a component remounted, React calling an effect
 * twice in development. The promise is cached rather than the result, so two
 * callers racing on mount make one request between them.
 */
const cache = new Map<string, Promise<Route | null>>();

/** So the missing-key notice is said once a run rather than once a leg. */
let warnedNoKey = false;

/** Rounded to about eleven metres — finer than that is a different GPS fix, not a different route. */
function keyFor(from: LatLng, to: LatLng): string {
  const r = (n: number) => n.toFixed(4);
  return `${r(from.latitude)},${r(from.longitude)}>${r(to.latitude)},${r(to.longitude)}`;
}

/**
 * The key is passed in rather than read from config here, so this file imports
 * nothing: `scripts/geometry-test.ts` can then exercise the parsing in plain
 * Node, where `expo-secure-store` cannot load at all.
 */
export async function fetchRoute(
  from: LatLng,
  to: LatLng,
  key: string
): Promise<Route | null> {
  /**
   * No key is the expected state until someone signs up, so this is not an
   * error — but it must not be silent either. Returning null without a word is
   * indistinguishable on a device from a route that failed to draw for any
   * other reason, which cost a whole debugging session once. Said once per run,
   * not per leg, so it cannot become noise.
   */
  if (!key) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.warn('[route] no OpenRouteService key — drawing the straight leg instead');
    }
    return null;
  }

  const cacheKey = keyFor(from, to);
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const pending = (async (): Promise<Route | null> => {
    // AbortController rather than Promise.race: a request left running would
    // hold the connection and still count against the daily quota.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);

    try {
      const url =
        `${HOST}?api_key=${encodeURIComponent(key)}` +
        `&start=${toOrs(from)}&end=${toOrs(to)}`;

      const res = await fetch(url, { signal: abort.signal });
      if (!res.ok) {
        // 403 is a bad or missing key, 429 the quota. Both are worth seeing in
        // the log and neither is worth showing a rider.
        console.warn(`[route] openrouteservice answered ${res.status}`);
        return null;
      }

      const parsed = parseDirections(await res.json());
      if (!parsed) {
        console.warn('[route] could not read the route out of the response');
        return null;
      }

      return {
        leg: measure(parsed.points),
        distanceM: parsed.distanceM,
        durationS: parsed.durationS,
      };
    } catch (err) {
      console.warn('[route] failed:', (err as Error)?.message);
      return null;
    } finally {
      clearTimeout(timer);
    }
  })();

  cache.set(cacheKey, pending);

  // A failure must not be cached forever — the next leg, or a recovered
  // network, deserves a fresh attempt.
  const result = await pending;
  if (!result) cache.delete(cacheKey);
  return result;
}
