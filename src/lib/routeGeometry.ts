/**
 * The maths that makes the rider follow the road.
 *
 * A marker animated straight between GPS fixes cuts every corner and, when the
 * signal wobbles, wanders through buildings. What the quick-commerce apps
 * actually do is snap the fix onto the route and move the rider ALONG it: the
 * position becomes a single number — metres travelled — and the coordinate is
 * read back off the polyline. Corners are then the road's corners, and a fix
 * thrown twenty metres sideways slides along the line instead of leaving it.
 *
 * Deliberately free of React and of `react-native-maps`, so it can be checked by
 * a plain Node script. `scripts/geometry-test.ts` does exactly that, because the
 * likeliest bug here — longitude and latitude the wrong way round, which is the
 * order OpenRouteService uses — produces no error at all. It just draws a route
 * across the Arabian Sea.
 */

/** The shape `react-native-maps` wants, declared here so this file imports nothing. */
export type LatLng = { latitude: number; longitude: number };

/** Mean Earth radius, metres. */
const R = 6_371_000;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/**
 * Great-circle distance in metres.
 *
 * Haversine rather than the equirectangular approximation used for projection
 * below: this one is also used to decide whether the rider is on this job at
 * all, over tens of kilometres, where the cheap version starts to drift.
 */
export function metresBetween(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Initial bearing from a to b, degrees clockwise from north. */
export function bearingBetween(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLon = toRad(b.longitude - a.longitude);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * A route with its distances worked out once.
 *
 * `projectOntoLeg` walks every segment on each GPS fix and `pointAtDistance`
 * runs on every animation frame, so measuring the polyline on each call would
 * be the one genuinely hot piece of work here. Measure once, at the point the
 * route arrives.
 */
export type Leg = {
  points: LatLng[];
  /** Metres from the start of the route to each point; same length as `points`. */
  cumulative: number[];
  /** Total length in metres. */
  length: number;
};

export function measure(points: LatLng[]): Leg {
  const cumulative: number[] = new Array(points.length);
  let total = 0;

  for (let i = 0; i < points.length; i += 1) {
    if (i > 0) total += metresBetween(points[i - 1], points[i]);
    cumulative[i] = total;
  }

  return { points, cumulative, length: total };
}

/**
 * Local metres east and north of a reference point.
 *
 * Projection onto a segment is a straight-line problem, and over the few hundred
 * metres of one segment the curvature of the Earth is irrelevant. Doing it flat
 * keeps the projection to arithmetic; using haversine per candidate segment
 * would be both slower and no more accurate at this scale.
 */
function toLocal(p: LatLng, origin: LatLng): { x: number; y: number } {
  return {
    x: toRad(p.longitude - origin.longitude) * Math.cos(toRad(origin.latitude)) * R,
    y: toRad(p.latitude - origin.latitude) * R,
  };
}

/**
 * Where on the route a position really is.
 *
 * `along` is how far the rider has travelled, in metres, and is what gets
 * animated. `offset` is how far they are from the line — small means GPS noise
 * worth snapping away, large means they have taken a different road and the
 * route is stale.
 *
 * An empty or single-point route returns zero for both: a caller with no route
 * has nothing to snap to and should fall back to the raw fix.
 */
export function projectOntoLeg(leg: Leg, p: LatLng): { along: number; offset: number } {
  if (leg.points.length < 2) return { along: 0, offset: 0 };

  let best = { along: 0, offset: Infinity };

  for (let i = 0; i < leg.points.length - 1; i += 1) {
    const a = leg.points[i];
    const b = leg.points[i + 1];

    // Work relative to the segment's own start, so the flat approximation is
    // only ever asked to cover one segment.
    const pb = toLocal(b, a);
    const pp = toLocal(p, a);

    const segLenSq = pb.x * pb.x + pb.y * pb.y;

    // A zero-length segment — routers do emit duplicate points — would divide
    // by zero. The distance to it is just the distance to its start.
    let t = segLenSq === 0 ? 0 : (pp.x * pb.x + pp.y * pb.y) / segLenSq;
    // Clamped, so a point beyond either end projects onto the end itself rather
    // than onto the infinite line through the segment.
    t = Math.max(0, Math.min(1, t));

    const dx = pp.x - pb.x * t;
    const dy = pp.y - pb.y * t;
    const offset = Math.hypot(dx, dy);

    if (offset < best.offset) {
      // Scale `t` by the length already measured for this segment rather than
      // by the flat one computed above. The two differ — haversine against a
      // local plane — by a metre or so over a long segment, and using the flat
      // value here would let `along` overshoot the next cumulative mark, so a
      // rider standing on the last point of the route would read as past its
      // end. Taken from `cumulative`, t = 1 lands exactly on it.
      const measured = leg.cumulative[i + 1] - leg.cumulative[i];
      best = { along: leg.cumulative[i] + measured * t, offset };
    }
  }

  return best;
}

/**
 * The coordinate a given distance along the route, and the direction the road
 * is pointing there.
 *
 * The bearing comes from the segment rather than from the phone's compass on
 * purpose: a compass reading swings about while a rider waits at lights, and a
 * marker that spins on the spot looks broken. The road does not move.
 */
export function pointAtDistance(
  leg: Leg,
  along: number
): { coordinate: LatLng; bearing: number } {
  const { points, cumulative } = leg;

  if (points.length === 0) {
    return { coordinate: { latitude: 0, longitude: 0 }, bearing: 0 };
  }
  if (points.length === 1) return { coordinate: points[0], bearing: 0 };

  const clamped = Math.max(0, Math.min(leg.length, along));

  // Binary search for the segment holding this distance. Linear would be fine
  // at a few hundred points, but this runs on every animation frame.
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] <= clamped) lo = mid;
    else hi = mid;
  }

  const a = points[lo];
  const b = points[hi];
  const segLen = cumulative[hi] - cumulative[lo];
  const t = segLen === 0 ? 0 : (clamped - cumulative[lo]) / segLen;

  return {
    coordinate: {
      latitude: a.latitude + (b.latitude - a.latitude) * t,
      longitude: a.longitude + (b.longitude - a.longitude) * t,
    },
    bearing: bearingBetween(a, b),
  };
}

/**
 * The part of the route still ahead of the rider.
 *
 * Drawing the whole polyline leaves a bright line trailing behind the marker
 * over ground already covered, which reads as part of the journey. Splitting it
 * lets the road behind fade back.
 */
export function splitAt(leg: Leg, along: number): { behind: LatLng[]; ahead: LatLng[] } {
  if (leg.points.length < 2) return { behind: [], ahead: leg.points };

  const { coordinate } = pointAtDistance(leg, along);
  const behind: LatLng[] = [];
  const ahead: LatLng[] = [];

  for (let i = 0; i < leg.points.length; i += 1) {
    if (leg.cumulative[i] <= along) behind.push(leg.points[i]);
    else ahead.push(leg.points[i]);
  }

  // The split point belongs to both halves, or the two lines meet with a gap.
  behind.push(coordinate);
  ahead.unshift(coordinate);

  return { behind, ahead };
}
