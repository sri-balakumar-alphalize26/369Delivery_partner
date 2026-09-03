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
import { Action, ApiError } from '../src/api/types';
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
  check(
    'no jobs at all while off duty',
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
  check('ungeocoded coords resolve to null', coords(job.latitude, job.longitude) === null,
    JSON.stringify([job.latitude, job.longitude]));
  check('0,0 is rejected too', coords(0, 0) === null);
  check('a real fix survives', coords(23.588, 58.3829)?.latitude === 23.588);

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
  await expectError(
    'wrong delivery code -> bad_otp',
    () => api.verifyDeliveryOtp(id, '111111'),
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

  console.log('\n=== 12. Clocking off stops new work ===');
  const off = await api.duty(false);
  check('now off duty', off.on_duty === false);
  check('duty_since cleared', off.duty_since === '');
  const afterOff = await api.orders();
  check('response reports on_duty false', afterOff.on_duty === false);

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
