/**
 * Headless walk of the whole delivery flow against the mock adapter.
 *
 * The mock mirrors the published contract exactly — same statuses, same
 * allowed_actions, same error codes, same field shapes — so this exercises the
 * logic every screen depends on without needing a phone, a token or the tunnel.
 *
 * Run:  npx tsc scripts/flow-test.ts --outDir <dir> --module commonjs \
 *         --target es2020 --skipLibCheck --esModuleInterop && node <dir>/scripts/flow-test.js
 */

import { mockAdapter as api, mockFlags } from '../src/api/mock/adapter';
import { MOCK_DELIVERY_OTP, MOCK_PICKUP_OTP, mockFailedId } from '../src/api/mock/fixtures';
import {
  Action,
  ApiError,
  COUNT_BUCKET,
  CountBucket,
  DeliveryStatus,
  headingFor,
  inBucket,
} from '../src/api/types';
import { coords, shopName } from '../src/lib/format';

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

function sameActions(got: Action[], want: Action[]) {
  return got.length === want.length && want.every((a) => got.includes(a));
}

async function expectError(
  label: string,
  fn: () => Promise<unknown>,
  code: string
) {
  try {
    await fn();
    check(label, false, 'no error thrown');
  } catch (err) {
    const e = err as ApiError;
    check(label, e.code === code, `got "${e.code}": ${e.message}`);
  }
}

async function main() {
  console.log('\n=== 1. Off duty — nothing is offered ===');
  const identity = await api.me();
  check('rider starts off duty', identity.rider.on_duty === false);
  check('/auth/me carries the timezone', identity.timezone === 'Asia/Muscat');
  check('/auth/me carries the currency', identity.currency.decimals === 3);

  const idle = await api.orders();
  // Named for what it actually proves. It read "no jobs at all while off duty",
  // which sounded like a duty gate but was vacuous: nothing has been offered
  // yet, both jobs are still in To Dispatch, so the array is empty for a reason
  // that has nothing to do with duty. It passed just as happily while the
  // screen showed offers to an off-duty rider. Section 12 does the real work.
  check(
    'the list starts empty, before anything has been offered',
    idle.orders.length === 0,
    idle.orders.map((o) => o.delivery_status).join(',')
  );
  check('response reports on_duty false', idle.on_duty === false);

  console.log('\n=== 2. Clocking on picks up what was waiting ===');
  const on = await api.duty(true);
  check('now on duty', on.on_duty === true);
  check('two jobs were waiting', on.jobs_picked_up === 2, String(on.jobs_picked_up));
  check('duty_since is UTC', /Z$/.test(on.duty_since), on.duty_since);
  check('message is written for the rider', /2 job\(s\) were waiting/.test(on.message ?? ''));

  console.log('\n=== 3. Listing jobs, in the contract shapes ===');
  const list = await api.orders();
  check(
    'both offers returned, and nothing else',
    list.orders.length === 2 &&
      list.orders.every((o) => o.delivery_status === 'offered'),
    list.orders.map((o) => o.delivery_status).join(',')
  );
  check('counts.assigned is 2', list.counts.assigned === 2);
  check('response carries a timezone', list.timezone === 'Asia/Muscat');
  check('server_time is UTC', /Z$/.test(list.server_time ?? ''), list.server_time);

  const job = list.orders[0];
  check('status is offered', job.delivery_status === 'offered');
  check(
    'only action is accept',
    sameActions(job.allowed_actions, ['accept']),
    job.allowed_actions.join(',')
  );
  // The bug this whole change exists for: currency is an object, not a string.
  check('currency is an object', typeof job.currency === 'object');
  check('currency.code is OMR', job.currency.code === 'OMR');
  check('currency.decimals is 3, not 2', job.currency.decimals === 3);
  check('promised_by is UTC', /Z$/.test(job.promised_by), job.promised_by);

  const id = job.delivery_order_id;
  const secondId = list.orders[1].delivery_order_id;

  console.log('\n=== 3b. Shapes that broke against the real server ===');
  // GET /orders/{id} answers { success, order: {...} } on res-test1, not a flat
  // envelope. Returning the envelope left every field undefined and the job
  // screen reading "That job is gone", so the adapter must unwrap it.
  const detail = await api.order(id);
  check('order(id) returns the order itself, not an envelope', detail.delivery_order_id === id,
    JSON.stringify(Object.keys(detail).slice(0, 3)));
  check('detail carries timestamps', !!detail.timestamps, JSON.stringify(detail.timestamps));
  check('an untouched step is "" not missing', detail.timestamps?.accepted === '');

  // `shop` became an object when the backend shipped N2. The app rendered it
  // straight into JSX, which crashes React Native with "Objects are not valid
  // as a React child" — the same failure the currency object caused. Anything
  // that reaches a screen must go through shopName().
  check('shop is the object the server sends', typeof job.shop === 'object',
    typeof job.shop);
  check('shopName() resolves the object', shopName(job.shop) === 'Muscat Branch',
    shopName(job.shop));
  check('shopName() still resolves a bare string', shopName('Old Branch') === 'Old Branch');
  check('items_summary ships with it', typeof job.items_summary === 'string');

  // Neither null nor 0,0 is a place. 0,0 is the Atlantic; a map would pin it.
  check('null coords resolve to null', coords(null, null) === null);
  check('0,0 is rejected too', coords(0, 0) === null);
  check('a real fix survives', coords(23.588, 58.3829)?.latitude === 23.588);

  // This line asserted the opposite until the demo was geocoded, because the
  // fixture was null like every res-test1 row. It was checking the fixture,
  // not the guard — the guard is covered by the three checks above. The demo
  // now carries real Muscat coordinates so the map has something to draw, and
  // both ends of the journey are needed for that.
  check('demo delivery is geocoded, so the map can draw it',
    coords(job.latitude, job.longitude) !== null,
    JSON.stringify([job.latitude, job.longitude]));
  check('demo shop is geocoded too, so the map has a from as well as a to',
    typeof job.shop === 'object' && coords(job.shop.latitude, job.shop.longitude) !== null);

  // Terminal work belongs to /history. The server used to leak it into
  // /orders — a real bug, since fixed on their side and verified live — so
  // this asserts the fix, not the behaviour the mock once mirrored.
  check(
    'no terminal job leaks into /orders',
    list.orders.every(
      (o) => !['delivered', 'returned', 'cancelled', 'failed'].includes(o.delivery_status)
    ),
    list.orders.map((o) => o.delivery_status).join(',')
  );

  console.log('\n=== 4. Acting out of state is refused ===');
  await expectError('dispatch before accept -> wrong_state', () => api.dispatch(id), 'wrong_state');
  await expectError(
    'delivery OTP before accept -> wrong_state',
    () => api.verifyDeliveryOtp(id, MOCK_DELIVERY_OTP),
    'wrong_state'
  );
  await expectError('unknown job -> not_found', () => api.order(999999), 'not_found');

  console.log('\n=== 5. Accept ===');
  const acc = await api.accept(id);
  check('status accepted', acc.status === 'accepted');
  check(
    'next actions are pickup OTP + report',
    sameActions(acc.allowed_actions, ['verify_pickup_otp', 'report_issue']),
    acc.allowed_actions.join(',')
  );
  check('tracking still off', acc.tracking?.enabled === false);

  console.log('\n=== 6. Pickup code (from the shop) ===');
  await api.requestPickupOtp(id);
  await expectError('wrong pickup code -> bad_otp', () => api.verifyPickupOtp(id, '000000'), 'bad_otp');
  const picked = await api.verifyPickupOtp(id, MOCK_PICKUP_OTP);
  check('status picked', picked.status === 'picked');
  check(
    'can now dispatch',
    picked.allowed_actions.includes('dispatch'),
    picked.allowed_actions.join(',')
  );

  console.log('\n=== 7. Leaving the shop ===');
  const disp = await api.dispatch(id);
  check('status dispatched', disp.status === 'dispatched');
  check('tracking STILL off before /start', disp.tracking?.enabled === false);

  const locBefore = await api.sendLocation(id, { latitude: 23.5, longitude: 58.3, accuracy: 10 });
  check('GPS before /start is told to stop', locBefore.stop === true);

  console.log('\n=== 8. Start delivery — the only moment GPS may begin ===');
  const start = await api.start(id);
  check('status out_for_delivery', start.status === 'out_for_delivery');
  check('tracking.enabled turns TRUE here', start.tracking?.enabled === true);

  const locDuring = await api.sendLocation(id, { latitude: 23.5, longitude: 58.3, accuracy: 10 });
  check('GPS accepted during delivery', locDuring.stop === false);

  console.log('\n=== 9. Delivery code (from the customer) ===');
  // '000000', as the pickup case uses, and never a literal that a demo code
  // might one day become — this line read '111111' until that became the real
  // code, at which point the check silently started proving the opposite.
  await expectError(
    'wrong delivery code -> bad_otp',
    () => api.verifyDeliveryOtp(id, '000000'),
    'bad_otp'
  );
  const done = await api.verifyDeliveryOtp(id, MOCK_DELIVERY_OTP);
  check('status delivered', done.status === 'delivered');
  check('no actions left', done.allowed_actions.length === 0);
  check('tracking off again', done.tracking?.enabled === false);
  check('delivered_at is UTC', /Z$/.test(done.delivered_at ?? ''), done.delivered_at);

  const locAfter = await api.sendLocation(id, { latitude: 23.5, longitude: 58.3, accuracy: 10 });
  check('GPS after delivery is told to stop', locAfter.stop === true);

  console.log('\n=== 10. The return path, end to end ===');
  await api.accept(secondId);
  await api.verifyPickupOtp(secondId, MOCK_PICKUP_OTP);
  const returning = await api.returnToShop(secondId);
  check('status returning', returning.status === 'returning');
  check(
    'only action is confirm_return',
    sameActions(returning.allowed_actions, ['confirm_return']),
    returning.allowed_actions.join(',')
  );
  // Previously a dead button: the action was offered and nothing was wired to it.
  const returned = await api.confirmReturn(secondId);
  check('status returned', returned.status === 'returned');
  check('no actions left', returned.allowed_actions.length === 0);

  const afterReturn = await api.orders();
  check(
    'a returned job leaves the active list',
    afterReturn.orders.every((o) => o.delivery_order_id !== secondId)
  );
  // ...but a terminal row must still render if one ever arrives, because
  // legacy `failed` jobs predate the server's fix and are still fetchable.
  const legacy = await api.order(mockFailedId);
  check('a legacy failed job is still fetchable', legacy.delivery_status === 'failed');
  check('...and offers no actions', legacy.allowed_actions.length === 0);

  console.log('\n=== 11. Losing the race to another rider ===');
  await new Promise((r) => setTimeout(r, 8500));
  const next = await api.orders();
  const fresh = next.orders.find((o) => o.delivery_status === 'offered');
  check('a new job arrived while on duty', !!fresh);
  if (fresh) {
    mockFlags.stealNextOrder = true;
    await expectError(
      'accept a taken job -> wrong_state',
      () => api.accept(fresh.delivery_order_id),
      'wrong_state'
    );
  }

  console.log('\n=== 12. Clocking off withdraws un-accepted offers ===');

  // Section 11 stole the offer and scheduled its replacement six seconds out,
  // so without this wait there is nothing offered to withdraw and the whole
  // section proves nothing.
  await new Promise((r) => setTimeout(r, 7000));

  // Without this the rest proves nothing: an empty list after clocking off is
  // only meaningful if something was there before it.
  const beforeOff = await api.orders();
  const offeredIds = beforeOff.orders
    .filter((o) => o.delivery_status === 'offered')
    .map((o) => o.delivery_order_id);
  const keptIds = beforeOff.orders
    .filter((o) => o.delivery_status !== 'offered')
    .map((o) => o.delivery_order_id);
  check('an offer is on the list before clocking off', offeredIds.length > 0,
    beforeOff.orders.map((o) => o.delivery_status).join(','));

  const off = await api.duty(false);
  check('now off duty', off.on_duty === false);
  check('duty_since cleared', off.duty_since === '');

  const afterOff = await api.orders();
  check('response reports on_duty false', afterOff.on_duty === false);

  const stillListed = afterOff.orders.map((o) => o.delivery_order_id);
  // The bug this covers: offers handed over while on duty stayed on the rider's
  // screen for the life of the session, badged NEW JOB, under a banner saying
  // no new jobs would be offered.
  check(
    'every un-accepted offer is withdrawn',
    offeredIds.every((id) => !stillListed.includes(id)),
    `still listed: ${offeredIds.filter((id) => stillListed.includes(id)).join(',')}`
  );
  // Guards the opposite mistake. Work already accepted must survive clocking
  // off, or a parcel is stranded mid-route.
  check(
    'work already in hand survives',
    keptIds.every((id) => stillListed.includes(id)),
    `lost: ${keptIds.filter((id) => !stillListed.includes(id)).join(',')}`
  );

  // Proves they went back to To Dispatch rather than being thrown away.
  const backOn = await api.duty(true);
  check(
    'the withdrawn offers return on clocking back on',
    backOn.jobs_picked_up >= offeredIds.length,
    `picked up ${backOn.jobs_picked_up}, withdrew ${offeredIds.length}`
  );

  console.log('\n=== 12b. Which end of the job the rider is heading for ===');
  // A delivery is two trips. Verified on screen for `accepted` and `picked`
  // only, so the rest are covered here — `returning` most of all, since it is
  // the one that flips back to the shop and is easiest to get wrong.
  check('offered heads to the shop', headingFor('offered') === 'shop');
  check('accepted heads to the shop', headingFor('accepted') === 'shop');
  check('picked heads to the customer', headingFor('picked') === 'customer');
  check('dispatched heads to the customer', headingFor('dispatched') === 'customer');
  check('out_for_delivery heads to the customer', headingFor('out_for_delivery') === 'customer');
  check('returning heads BACK to the shop', headingFor('returning') === 'shop');

  console.log('\n=== 12c. The counts and the jobs behind them ===');
  // Home's tiles open the jobs behind their own number, so the grouping a count
  // is tallied with and the grouping a list is filtered with have to be the same
  // one. They are: COUNT_BUCKET, read by both.

  const owner = new Map<DeliveryStatus, CountBucket>();
  let overlap = '';
  for (const key of Object.keys(COUNT_BUCKET) as CountBucket[]) {
    for (const st of COUNT_BUCKET[key]) {
      if (owner.has(st)) overlap += `${st} in ${owner.get(st)} and ${key}; `;
      owner.set(st, key);
    }
  }
  check('no status falls in two buckets', overlap === '', overlap);

  // Not an oversight. Odoo lists a returning job and counts it nowhere, which is
  // the reason the jobs screen keeps an unfiltered "All".
  check('returning is counted in no bucket, by design', !owner.has('returning'));

  const snap = await api.orders();

  // The three linked tiles hold no terminal status, so every row they count is
  // also a row they list. This is the equality a rider sees: tap "2", get two.
  for (const key of ['assigned', 'picked_up', 'out_for_delivery'] as CountBucket[]) {
    const listed = snap.orders.filter((o) => inBucket(o.delivery_status, key)).length;
    check(
      `${key}: the tile's number is exactly what the filter shows`,
      listed === snap.counts[key],
      `counted ${snap.counts[key]}, listed ${listed}`
    );
  }

  // And the reason the fourth tile is not a link.
  const listedDelivered = snap.orders.filter((o) =>
    inBucket(o.delivery_status, 'delivered')
  ).length;
  check(
    'delivered is counted but never listed, so it cannot be opened',
    listedDelivered === 0,
    `${listedDelivered} delivered row(s) in the list`
  );

  console.log('\n=== 13. No signal ===');
  mockFlags.offline = true;
  await expectError('any call while offline -> network', () => api.orders(), 'network');
  mockFlags.offline = false;

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('CRASHED', e);
  process.exit(1);
});
