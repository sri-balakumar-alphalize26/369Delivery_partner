/**
 * The countdown, and the clock it counts against.
 *
 * Worth its own script because the failure it guards is invisible on a healthy
 * machine: a phone whose clock is ten minutes fast shows every job as nearly
 * late, and ten minutes slow shows an overdue job as comfortable. The device
 * running the tests always has the right time, so nothing here would ever be
 * caught by looking at a screen.
 *
 * Run:  npx tsc scripts/clock-test.ts --outDir <dir> --module commonjs \
 *         --target es2020 --skipLibCheck --esModuleInterop && node <dir>/scripts/clock-test.js
 */

import { clockOffsetMs, clockSynced, resetClock, serverNow, syncClock } from '../src/lib/clock';
import { dueIn, onDutyFor } from '../src/lib/format';

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

function eq(label: string, got: unknown, want: unknown) {
  check(label, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const MIN = 60_000;
const BASE = Date.parse('2026-09-08T12:00:00Z');

console.log('\nCounting down');
eq('twelve minutes ahead', dueIn('2026-09-08T12:12:00Z', BASE)?.text, '12 min left');
eq('and is not late', dueIn('2026-09-08T12:12:00Z', BASE)?.late, false);
eq('five minutes past', dueIn('2026-09-08T11:55:00Z', BASE)?.text, '5 min late');
eq('and is late', dueIn('2026-09-08T11:55:00Z', BASE)?.late, true);
eq('over an hour reads in hours', dueIn('2026-09-08T13:20:00Z', BASE)?.text, '1h 20m left');
eq('an hour late likewise', dueIn('2026-09-08T10:40:00Z', BASE)?.text, '1h 20m late');
eq('under a minute is "due now"', dueIn('2026-09-08T12:00:20Z', BASE)?.text, 'due now');
check('no promise means no label', dueIn(undefined, BASE) === null);
check('an unparseable promise means no label', dueIn('not-a-date', BASE) === null);

console.log('\nThe contract says every datetime is UTC');
// Its own examples sometimes omit the Z. Read as UTC per the stated rule, or a
// rider in Muscat sees every promise shift by four hours.
eq(
  'a naked timestamp is read as UTC, not local',
  dueIn('2026-09-08T12:12:00', BASE)?.text,
  '12 min left'
);

console.log('\nThe phone clock is not trusted');
resetClock();
check('starts unsynced', !clockSynced());
eq('and offset is zero', clockOffsetMs(), 0);

// A device running ten minutes FAST. Without the offset every job would look
// ten minutes closer to its deadline than it is.
const deviceNow = Date.now();
const serverIsBehindBy = 10 * MIN;
syncClock(new Date(deviceNow - serverIsBehindBy).toISOString());
check('syncs from a server_time', clockSynced());
check(
  'offset is about minus ten minutes',
  Math.abs(clockOffsetMs() + serverIsBehindBy) < 2000,
  `${Math.round(clockOffsetMs() / 1000)}s`
);
check(
  'serverNow tracks the server, not the device',
  Math.abs(serverNow() - (deviceNow - serverIsBehindBy)) < 2000
);

// The point of all of it: the same promise read through the corrected clock.
const promise = new Date(deviceNow - serverIsBehindBy + 12 * MIN).toISOString();
eq('a job 12 min out reads correctly on a fast phone', dueIn(promise, serverNow())?.text, '12 min left');
eq(
  'and would have read wrong on the raw device clock',
  dueIn(promise, Date.now())?.text,
  '2 min left'
);

resetClock();
check('a missing server_time leaves the offset alone', (() => {
  syncClock(undefined);
  return clockOffsetMs() === 0 && !clockSynced();
})());
check('an unparseable server_time is ignored', (() => {
  syncClock('rubbish');
  return clockOffsetMs() === 0 && !clockSynced();
})());

console.log('\nTime on duty');
eq('two and a quarter hours', onDutyFor('2026-09-08T09:45:00Z', BASE), '2h 15m');
eq('under an hour is minutes only', onDutyFor('2026-09-08T11:20:00Z', BASE), '40m');
check('off duty sends an empty string, and gets nothing', onDutyFor('', BASE) === null);
check('a future start is refused rather than shown negative', onDutyFor('2026-09-08T13:00:00Z', BASE) === null);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
