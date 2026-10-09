/**
 * Headless walk of the Service side against its demo server, plus the rules
 * that tie it to Delivery: Works In, one duty, and the busy lock both ways.
 *
 * Run like flow-test.ts:
 *   npx tsc scripts/service-flow-test.ts --outDir <dir> --module commonjs \
 *     --target es2020 --skipLibCheck --esModuleInterop && node <dir>/scripts/service-flow-test.js
 * With <dir> outside the project, set NODE_PATH=<project>/node_modules.
 */

import { mockAdapter as api } from '../src/api/mock/adapter';
import { serviceMockAdapter as svc, serviceOfferNow } from '../src/api/mock/serviceAdapter';
import { MOCK_SIGNOFF_CODE } from '../src/api/mock/serviceFixtures';
import { demo } from '../src/api/mock/shared';
import { MOCK_PICKUP_OTP } from '../src/api/mock/fixtures';
import { ApiError } from '../src/api/types';
import { SERVICE_IN_HAND } from '../src/api/serviceTypes';
import { jobFromData } from '../src/push/jobRef';
import { pickWorkspace } from '../src/lib/workspace';
import { staffLabel } from '../src/lib/riderKind';

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

async function expectError(label: string, fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
    check(label, false, 'no error thrown');
  } catch (err) {
    const got = err instanceof ApiError ? err.code : String(err);
    check(label, got === code, `got ${got}`);
  }
}

async function offeredVisit() {
  serviceOfferNow();
  const { jobs } = await svc.jobs();
  return jobs.find((j) => j.status === 'offered');
}

async function main() {
  console.log('\n=== 1. Works In decides the lines ===');
  demo.worksIn = 'delivery';
  check('Delivery only → one line', (await api.partnerMe()).lines.join() === 'delivery');
  demo.worksIn = 'service';
  check('Service only → one line', (await api.partnerMe()).lines.join() === 'service');
  demo.worksIn = 'both';
  const both = await api.partnerMe();
  check('Both → two lines', both.lines.join() === 'delivery,service');
  check('free to start with', both.busy_line === 'none');
  check('saved side kept when still worked in', pickWorkspace(['delivery', 'service'], 'service') === 'service');
  check('saved side dropped when no longer worked in', pickWorkspace(['delivery'], 'service') === 'delivery');
  check('nothing saved → first line', pickWorkspace(['service'], null) === 'service');
  check('staff words: both lines', staffLabel(['delivery', 'service']) === 'Office staff');
  check('staff words: service only', staffLabel(['service']) === 'Office technician');
  check('staff words: delivery only', staffLabel(['delivery']) === 'Office rider');
  check('the demo rider is own staff', (await api.me()).rider.kind === 'own');

  console.log('\n=== 2. No offers off duty ===');
  check('off duty → no service offer', !(await offeredVisit()));

  console.log('\n=== 3. A visit, start to finish ===');
  await api.duty(true);
  const offer = await offeredVisit();
  check('on duty → a service offer arrives', !!offer);
  check('the offer has a time limit', !!offer?.offer_expires_at);
  check('offer allows accept and decline', !!offer && offer.allowed_actions.includes('accept') && offer.allowed_actions.includes('decline'));
  const id = offer!.id;

  // Delivery offers handed over by clocking on stay offered: an offer does not
  // make anyone busy, a job taken does.
  let r = await svc.accept(id);
  check('accept → accepted (slot is soon)', r.job.status === 'accepted');
  check('accepted is in hand', SERVICE_IN_HAND.includes(r.job.status));
  check('server says busy on service', (await api.partnerMe()).busy_line === 'service');

  await expectError('arrived before travelling is refused', () => svc.arrived(id), 'wrong_state');
  r = await svc.startTravel(id);
  check('start travel → on the way', r.job.status === 'on_the_way');
  r = await svc.arrived(id);
  check('arrived → arrived', r.job.status === 'arrived');
  await expectError('start work without before photos is refused', () => svc.startWork(id), 'proof_needed');
  await svc.addPhoto(id, 'before', 'file://a.jpg');
  r = await svc.addPhoto(id, 'before', 'file://b.jpg');
  check('two before photos counted', r.job.photo_counts.before === 2);
  r = await svc.startWork(id);
  check('start work → working, timer started', r.job.status === 'working' && !!r.job.work_started_at);
  r = await svc.finishWork(id, { parts_used: [{ name: 'Screen', qty: 1 }], note: 'Done' });
  check('finish work → finished, parts kept', r.job.status === 'finished' && r.job.parts_used.length === 1);
  await expectError('sign-off before the code is sent is refused', () => svc.verifySignoff(id, MOCK_SIGNOFF_CODE), 'otp_required');
  await svc.sendSignoffCode(id);
  await expectError('sign-off without after photos is refused', () => svc.verifySignoff(id, MOCK_SIGNOFF_CODE), 'proof_needed');
  await svc.addPhoto(id, 'after', 'file://c.jpg');
  await svc.addPhoto(id, 'after', 'file://d.jpg');
  await expectError('a wrong code is refused', () => svc.verifySignoff(id, '000000'), 'bad_otp');
  r = await svc.verifySignoff(id, MOCK_SIGNOFF_CODE);
  check('right code → signed off', r.job.status === 'signed_off' && !!r.job.signed_off_at);
  const after = await svc.jobs();
  check('the visit left the list', !after.jobs.some((j) => j.id === id));
  check('…and is in history', after.history.some((j) => j.id === id));
  check('signed off today counts it', after.counts.signed_off_today >= 1);
  check('free again', (await api.partnerMe()).busy_line === 'none');

  console.log('\n=== 4. Busy on Service blocks Delivery ===');
  const v2 = await offeredVisit();
  await svc.accept(v2!.id);
  await svc.startTravel(v2!.id);
  const { orders: o2 } = await api.orders();
  const dOffer = o2.find((o) => o.delivery_status === 'offered');
  if (dOffer) {
    await expectError('a delivery accept while on a visit → agent_busy', () => api.accept(dOffer.delivery_order_id), 'agent_busy');
  } else {
    check('no delivery handed over while on a visit', true);
  }
  await expectError('needs another visit before arriving is refused', () => svc.needsRevisit(v2!.id, 'part missing'), 'wrong_state');
  await svc.arrived(v2!.id);
  r = await svc.needsRevisit(v2!.id, 'part missing');
  check('needs another visit closes it as revisit', r.job.status === 'revisit');
  check('free after the revisit', (await api.partnerMe()).busy_line === 'none');

  console.log('\n=== 5. Busy on Delivery blocks Service ===');
  serviceOfferNow();
  const s3 = await offeredVisit();
  // Hand a delivery over and take it.
  await api.duty(false);
  await api.duty(true);
  const { orders: o3 } = await api.orders();
  const d3 = o3.find((o) => o.delivery_status === 'offered');
  check('a delivery offer is there to take', !!d3);
  await api.accept(d3!.delivery_order_id);
  check('server says busy on delivery', (await api.partnerMe()).busy_line === 'delivery');
  if (s3 && (await svc.jobs()).jobs.some((j) => j.id === s3.id && j.status === 'offered')) {
    await expectError('a service accept while on a delivery → agent_busy', () => svc.accept(s3.id), 'agent_busy');
    const passedBack = await svc.decline(s3.id, 'busy_other_job');
    check('the open service offer is passed back', !!passedBack.removed);
  }
  serviceOfferNow();
  check('no new service offer while on a delivery', !(await svc.jobs()).jobs.some((j) => j.status === 'offered'));
  // Finish the delivery.
  await api.verifyPickupOtp(d3!.delivery_order_id, MOCK_PICKUP_OTP);

  console.log('\n=== 6. Service-only agents get no deliveries ===');
  demo.worksIn = 'service';
  await api.duty(false);
  await api.duty(true);
  const { orders: o4 } = await api.orders();
  check('clocking on hands a service-only agent no deliveries', !o4.some((o) => o.delivery_status === 'offered'));
  demo.worksIn = 'both';

  console.log('\n=== 7. Alert payloads ===');
  check('a delivery push (old shape) opens Delivery', JSON.stringify(jobFromData({ delivery_order_id: '42' })) === '{"kind":"delivery","id":42}');
  check('a service ring opens Service', JSON.stringify(jobFromData({ job_type: 'service', job_id: '9021' })) === '{"kind":"service","id":9021}');
  check('a malformed payload opens nothing', jobFromData({ job_type: 'service' }) === null);
  check('no payload opens nothing', jobFromData(undefined) === null);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
