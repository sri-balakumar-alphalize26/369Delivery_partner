/**
 * Headless walk of the whole delivery flow against the mock adapter.
 *
 * The mock mirrors the published contract exactly — same statuses, same
 * allowed_actions, same error codes — so this exercises the logic every screen
 * depends on without needing a phone, a token or the tunnel.
 *
 * Run:  npx tsc scripts/flow-test.ts --outDir <dir> --module commonjs \
 *         --target es2020 --skipLibCheck --esModuleInterop && node <dir>/scripts/flow-test.js
 */

import { mockAdapter as api, mockFlags } from '../src/api/mock/adapter';
import { MOCK_DELIVERY_OTP, MOCK_PICKUP_OTP } from '../src/api/mock/fixtures';
import { Action, ApiError } from '../src/api/types';

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
  console.log('\n=== 1. Listing jobs ===');
  const list = await api.orders();
  const job = list.orders[0];
  check('one job returned', list.orders.length === 1);
  check('status is offered', job.delivery_status === 'offered');
  check(
    'only action is accept',
    sameActions(job.allowed_actions, ['accept']),
    job.allowed_actions.join(',')
  );
  check('counts.assigned is 1', list.counts.assigned === 1);
  const id = job.delivery_order_id;

  console.log('\n=== 2. Acting out of state is refused ===');
  await expectError('dispatch before accept -> wrong_state', () => api.dispatch(id), 'wrong_state');
  await expectError(
    'delivery OTP before accept -> wrong_state',
    () => api.verifyDeliveryOtp(id, MOCK_DELIVERY_OTP),
    'wrong_state'
  );
  await expectError('unknown job -> not_found', () => api.order(999999), 'not_found');

  console.log('\n=== 3. Accept ===');
  const acc = await api.accept(id);
  check('status accepted', acc.status === 'accepted');
  check(
    'next actions are pickup OTP + report',
    sameActions(acc.allowed_actions, ['verify_pickup_otp', 'report_issue']),
    acc.allowed_actions.join(',')
  );
  check('tracking still off', acc.tracking?.enabled === false);

  console.log('\n=== 4. Pickup code (from the shop) ===');
  await api.requestPickupOtp(id);
  await expectError('wrong pickup code -> bad_otp', () => api.verifyPickupOtp(id, '000000'), 'bad_otp');
  const picked = await api.verifyPickupOtp(id, MOCK_PICKUP_OTP);
  check('status picked', picked.status === 'picked');
  check(
    'can now dispatch',
    picked.allowed_actions.includes('dispatch'),
    picked.allowed_actions.join(',')
  );

  console.log('\n=== 5. Leaving the shop ===');
  const disp = await api.dispatch(id);
  check('status dispatched', disp.status === 'dispatched');
  check('tracking STILL off before /start', disp.tracking?.enabled === false);

  const locBefore = await api.sendLocation(id, { latitude: 23.5, longitude: 58.3, accuracy: 10 });
  check('GPS before /start is told to stop', locBefore.stop === true);

  console.log('\n=== 6. Start delivery — the only moment GPS may begin ===');
  const start = await api.start(id);
  check('status out_for_delivery', start.status === 'out_for_delivery');
  check('tracking.enabled turns TRUE here', start.tracking?.enabled === true);

  const locDuring = await api.sendLocation(id, { latitude: 23.5, longitude: 58.3, accuracy: 10 });
  check('GPS accepted during delivery', locDuring.stop === false);

  console.log('\n=== 7. Delivery code (from the customer) ===');
  await expectError(
    'wrong delivery code -> bad_otp',
    () => api.verifyDeliveryOtp(id, '111111'),
    'bad_otp'
  );
  const done = await api.verifyDeliveryOtp(id, MOCK_DELIVERY_OTP);
  check('status delivered', done.status === 'delivered');
  check('no actions left', done.allowed_actions.length === 0);
  check('tracking off again', done.tracking?.enabled === false);
  check('delivered_at present', !!done.delivered_at);

  const locAfter = await api.sendLocation(id, { latitude: 23.5, longitude: 58.3, accuracy: 10 });
  check('GPS after delivery is told to stop', locAfter.stop === true);

  console.log('\n=== 8. Losing the race to another rider ===');
  await new Promise((r) => setTimeout(r, 8500));
  const next = await api.orders();
  const nextId = next.orders[0].delivery_order_id;
  mockFlags.stealNextOrder = true;
  await expectError('accept a taken job -> wrong_state', () => api.accept(nextId), 'wrong_state');

  console.log('\n=== 9. No signal ===');
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
