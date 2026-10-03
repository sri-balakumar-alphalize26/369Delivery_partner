/**
 * Pure checks for `cashToday` (src/lib/cash.ts): which delivered jobs count as
 * cash collected today, and how they add up.
 *
 * Run:
 *   npx tsc scripts/cash-test.ts --outDir <dir> --module commonjs --target es2020 \
 *     --skipLibCheck --esModuleInterop
 *   node <dir>/scripts/cash-test.js
 */
import { PastJob } from '../src/api/types';
import { cashToday } from '../src/lib/cash';

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

const AED = { code: 'AED', symbol: 'AED', decimals: 3 };

function job(over: Partial<PastJob>): PastJob {
  return {
    delivery_order_id: 1,
    delivery_order_name: 'DT/OUT/00001',
    job_code: 'D1',
    sales_order: 'S00001',
    customer_name: 'Customer',
    customer_mobile: '',
    delivery_address: '',
    shop: null,
    payment_status: 'cod',
    amount_to_collect: 10,
    currency: AED,
    delivery_status: 'delivered',
    allowed_actions: [],
    finished_at: '2026-10-03T05:00:00Z',
    ...over,
  } as PastJob;
}

// 3 Oct 2026, 10:00 in Dubai (UTC+4) = 06:00 UTC.
const NOW = Date.parse('2026-10-03T06:00:00Z');
const DUBAI = 'Asia/Dubai';

console.log('\n=== counts the right jobs ===');
{
  const r = cashToday(
    [
      job({ delivery_order_id: 1, amount_to_collect: 30, finished_at: '2026-10-03T05:21:00Z' }),
      job({ delivery_order_id: 2, payment_status: 'paid', amount_to_collect: 0 }),
      job({ delivery_order_id: 3, delivery_status: 'returned' }),
      job({ delivery_order_id: 4, delivery_status: 'cancelled' }),
      job({ delivery_order_id: 5, finished_at: '2026-10-02T10:00:00Z' }),
      job({ delivery_order_id: 6, amount_to_collect: 0 }),
      job({ delivery_order_id: 7, amount_to_collect: 585.5, finished_at: '2026-10-03T05:50:00Z' }),
    ],
    NOW,
    DUBAI
  );
  check('two delivered cash jobs today', r.rows.length === 2, JSON.stringify(r.rows.map((x) => x.orderId)));
  check('total 615.5', r.total === 615.5, String(r.total));
  check('newest first', r.rows[0]?.orderId === 7, String(r.rows[0]?.orderId));
  check('currency carried', r.currency?.code === 'AED');
}

console.log("\n=== the shop's day, not the phone's ===");
{
  // 2 Oct 21:30 UTC = 3 Oct 01:30 in Dubai: today for the shop.
  const late = job({ delivery_order_id: 8, finished_at: '2026-10-02T21:30:00Z' });
  // 2 Oct 19:30 UTC = 2 Oct 23:30 in Dubai: yesterday for the shop.
  const before = job({ delivery_order_id: 9, finished_at: '2026-10-02T19:30:00Z' });
  const r = cashToday([late, before], NOW, DUBAI);
  check('01:30 Dubai counts as today', r.rows.some((x) => x.orderId === 8));
  check('23:30 Dubai the day before does not', !r.rows.some((x) => x.orderId === 9));
}

console.log('\n=== adding up exactly ===');
{
  const r = cashToday(
    [
      job({ delivery_order_id: 10, amount_to_collect: 0.1 }),
      job({ delivery_order_id: 11, amount_to_collect: 0.2 }),
    ],
    NOW,
    DUBAI
  );
  check('0.1 + 0.2 = 0.3', r.total === 0.3, String(r.total));
}

console.log('\n=== nothing to show ===');
{
  const r = cashToday(undefined, NOW, DUBAI);
  check('no history: zero, no rows', r.total === 0 && r.rows.length === 0);
  const bad = cashToday([job({ finished_at: 'not a date' })], NOW, DUBAI);
  check('unparseable time is skipped', bad.rows.length === 0);
  const zone = cashToday([job({})], NOW, 'Not/AZone');
  check('unknown zone falls back to UTC, no crash', zone.rows.length === 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
