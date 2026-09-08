/**
 * Checks the route maths without a phone, a key or a network.
 *
 * Worth its own script because the failure mode it guards is silent. Longitude
 * and latitude the wrong way round — the order OpenRouteService uses, and the
 * reverse of everything else here — throws nothing and logs nothing. It just
 * draws Muscat's route somewhere in the Baltic. On a device that looks like a
 * broken map; here it is one failing assertion.
 *
 * Run:  npx tsc scripts/geometry-test.ts --outDir <dir> --module commonjs \
 *         --target es2020 --skipLibCheck --esModuleInterop && node <dir>/scripts/geometry-test.js
 */

import { parseDirections } from '../src/lib/route';
import {
  bearingBetween,
  measure,
  metresBetween,
  pointAtDistance,
  projectOntoLeg,
  splitAt,
} from '../src/lib/routeGeometry';

let passed = 0;
let failed = 0;

function check(label: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ''}`);
  }
}

function near(label: string, got: number, want: number, tolerance: number) {
  check(label, Math.abs(got - want) <= tolerance, `got ${got.toFixed(3)}, want ~${want}`);
}

/** The fixtures' own coordinates, so this fails if those ever get swapped too. */
const SHOP = { latitude: 23.5975, longitude: 58.4187 }; // Al Khuwair
const KHUWAIR = { latitude: 23.588, longitude: 58.429 }; // minutes away
const OLD_MUSCAT = { latitude: 23.6139, longitude: 58.5922 }; // the long run

console.log('\nDistance and bearing');
// Muscat is a real place: these two are about a kilometre and a half apart.
// Swap lat and lon anywhere upstream and this becomes thousands.
near('shop to Al Khuwair is ~1.5km', metresBetween(SHOP, KHUWAIR), 1500, 200);
near('shop to Old Muscat is ~17km', metresBetween(SHOP, OLD_MUSCAT), 17_300, 1_500);
check('a point is zero metres from itself', metresBetween(SHOP, SHOP) === 0);

// The swap is only caught if the assertion above is actually sensitive to it.
const swapped = { latitude: SHOP.longitude, longitude: SHOP.latitude };
check(
  'swapping lat and lon moves the shop thousands of km',
  metresBetween(SHOP, swapped) > 3_000_000,
  `${Math.round(metresBetween(SHOP, swapped) / 1000)}km`
);

near('due north is 0deg', bearingBetween({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }), 0, 0.1);
near('due east is 90deg', bearingBetween({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }), 90, 0.1);
near('due south is 180deg', bearingBetween({ latitude: 1, longitude: 0 }, { latitude: 0, longitude: 0 }), 180, 0.1);
near('due west is 270deg', bearingBetween({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: -1 }), 270, 0.1);

console.log('\nMeasuring a leg');
const leg = measure([SHOP, KHUWAIR, OLD_MUSCAT]);
check('cumulative starts at zero', leg.cumulative[0] === 0);
near('cumulative reaches the total', leg.cumulative[2], leg.length, 0.001);
near(
  'total is the sum of the segments',
  leg.length,
  metresBetween(SHOP, KHUWAIR) + metresBetween(KHUWAIR, OLD_MUSCAT),
  0.001
);
check('an empty leg measures zero', measure([]).length === 0);
check('a single point measures zero', measure([SHOP]).length === 0);

console.log('\nSnapping a position onto the leg');
const onLine = projectOntoLeg(leg, KHUWAIR);
near('a point on the line has no offset', onLine.offset, 0, 1);
near('and sits at that point distance', onLine.along, leg.cumulative[1], 1);

near('the start projects to zero', projectOntoLeg(leg, SHOP).along, 0, 1);
near('the end projects to the full length', projectOntoLeg(leg, OLD_MUSCAT).along, leg.length, 1);

// A rider a street off the line should snap onto it, keeping their progress.
const straight = measure([
  { latitude: 23.6, longitude: 58.4 },
  { latitude: 23.6, longitude: 58.42 },
]);
const aside = projectOntoLeg(straight, { latitude: 23.6009, longitude: 58.41 });
near('a fix beside the road reports its true offset', aside.offset, 100, 15);
near('and still snaps to the right point along it', aside.along, straight.length / 2, 30);

// Past the end, not off into the infinite line beyond it.
const beyond = projectOntoLeg(straight, { latitude: 23.6, longitude: 58.5 });
near('a fix past the end clamps to the end', beyond.along, straight.length, 1);

console.log('\nReading a point back off the leg');
const mid = pointAtDistance(straight, straight.length / 2);
near('the midpoint of a due-east leg is halfway', mid.coordinate.longitude, 58.41, 0.0005);
near('and points due east', mid.bearing, 90, 0.5);
near('distance zero is the first point', pointAtDistance(leg, 0).coordinate.latitude, SHOP.latitude, 1e-9);
near(
  'past the end clamps to the last point',
  pointAtDistance(leg, leg.length * 2).coordinate.latitude,
  OLD_MUSCAT.latitude,
  1e-9
);

console.log('\nSplitting the road behind from the road ahead');
const split = splitAt(leg, leg.cumulative[1]);
check('both halves are drawable', split.behind.length >= 2 && split.ahead.length >= 2);
check(
  'they meet at the same point',
  split.behind[split.behind.length - 1].latitude === split.ahead[0].latitude &&
    split.behind[split.behind.length - 1].longitude === split.ahead[0].longitude
);

console.log('\nReading OpenRouteService');
// Shaped as ORS answers, INCLUDING its [longitude, latitude] order.
const response = {
  features: [
    {
      geometry: {
        coordinates: [
          [58.4187, 23.5975],
          [58.4235, 23.5921],
          [58.429, 23.588],
        ],
      },
      properties: { summary: { distance: 1620.4, duration: 244.8 } },
    },
  ],
};
const parsed = parseDirections(response);
check('a well-formed response parses', parsed !== null);
if (parsed) {
  // The whole point: ORS said [58.4187, 23.5975] and this must come back as
  // latitude 23.6, not latitude 58.4.
  near('longitude-first input yields the right latitude', parsed.points[0].latitude, 23.5975, 1e-9);
  near('and the right longitude', parsed.points[0].longitude, 58.4187, 1e-9);
  check('the parsed route lands in Muscat', metresBetween(parsed.points[0], SHOP) < 50);
  near('distance comes through', parsed.distanceM, 1620.4, 0.01);
  near('duration comes through', parsed.durationS, 244.8, 0.01);
}

check('an empty body is refused', parseDirections({}) === null);
check('a null body is refused', parseDirections(null) === null);
check('a one-point route is refused', parseDirections({
  features: [{ geometry: { coordinates: [[58.4, 23.6]] } }],
}) === null);
check('a route with no summary still parses', (() => {
  const r = parseDirections({
    features: [{ geometry: { coordinates: [[58.4, 23.6], [58.41, 23.61]] } }],
  });
  return r !== null && r.distanceM === 0;
})());

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
