/**
 * Smoke-tests the LIVE Odoo module against the app's own parsing helpers.
 *
 * The flow test proves the logic against the mock. This proves the shapes
 * against the real server — which is where every serious defect so far has
 * come from, because a mock written from the app's assumptions can only ever
 * confirm them. The currency object, the nested order envelope and the shop
 * object were all invisible until someone called the live database.
 *
 * It speaks to Odoo exactly as the app does: sign in at
 * /web/session/authenticate, keep the session cookie, call `sa.rider.rpc`
 * through /web/dataset/call_kw. It imports the real `src/lib/format.ts` rather
 * than reimplementing it, so a pass here means the shipped code survives the
 * shipped payload.
 *
 * Run:
 *   npx tsc src/lib/format.ts --outDir <dir> --module es2020 --target es2020 \
 *     --moduleResolution node --skipLibCheck
 *   node scripts/live-check.mjs <baseUrl> <db> <mobile> <password> <formatJsPath>
 *
 * The password is an argument, never a file — it is a live credential.
 */

const [, , BASE, DB, LOGIN, PASSWORD, FORMAT_PATH] = process.argv;

if (!BASE || !DB || !LOGIN || !PASSWORD || !FORMAT_PATH) {
  console.error(
    'usage: node scripts/live-check.mjs <baseUrl> <db> <mobile> <password> <path-to-compiled-format.js>'
  );
  process.exit(2);
}

const { shopName, coords, money, promisedAt } = await import(
  FORMAT_PATH.startsWith('file:') ? FORMAT_PATH : `file:///${FORMAT_PATH.replace(/\\/g, '/')}`
);

const MODEL = 'sa.rider.rpc';
let passed = 0;
let failed = 0;

function check(label, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ''}`);
  }
}

// Node's fetch keeps no cookie jar, so the session is picked out of Set-Cookie
// by hand and sent back on every call — the one thing the phone does for free.
let cookie = '';
let nextId = 1;

async function rpc(path, params) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: nextId++, params }),
  });

  const setCookies = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''];
  for (const c of setCookies) {
    const m = /(?:^|,\s*)session_id=([^;]+)/.exec(c);
    if (m) cookie = `session_id=${m[1]}`;
  }

  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    throw new Error(`${path} returned ${res.status} as ${ct || 'no content-type'}`);
  }
  const body = await res.json();
  if (body.error) {
    const data = body.error.data ?? {};
    throw new Error(`${path}: ${data.name ?? ''} ${data.message ?? body.error.message}`);
  }
  return body.result;
}

const call = (method, kwargs = {}) =>
  rpc(`/web/dataset/call_kw/${MODEL}/${method}`, { model: MODEL, method, args: [], kwargs });

/** Anything that reaches JSX must be a primitive, or React Native throws. */
function renderable(v) {
  return v === null || v === undefined || typeof v !== 'object';
}

console.log(`\nLive check against ${BASE} (${DB})\n`);

console.log('=== sign in ===');
const session = await rpc('/web/session/authenticate', { db: DB, login: LOGIN, password: PASSWORD });
check('uid returned', !!session?.uid, JSON.stringify(session?.uid));
check('session cookie set', cookie.startsWith('session_id='));

console.log('\n=== me ===');
const me = await call('me');
check('success', me.success === true);
check('rider carries on_duty', typeof me.rider?.on_duty === 'boolean');
check('rider carries duty_since', typeof me.rider?.duty_since === 'string');
check('timezone present', typeof me.timezone === 'string', me.timezone);
check('currency is an object with decimals', typeof me.currency?.decimals === 'number');
check('money() renders it', typeof money(12.5, me.currency) === 'string', money(12.5, me.currency));
console.log(`        signed in as ${me.rider?.name} (#${me.rider?.id}), currency ${me.currency?.code}`);

console.log('\n=== orders ===');
const list = await call('orders');
check('success', list.success === true);
check('counts present', typeof list.counts?.delivered === 'number');
check('on_duty present', typeof list.on_duty === 'boolean');
check('server_time is UTC', /Z$/.test(list.server_time ?? ''), list.server_time);
check('orders is an array', Array.isArray(list.orders), typeof list.orders);

const orders = list.orders ?? [];
console.log(`        ${orders.length} order(s) returned`);

// === Does Odoo bucket its counts the way the app assumes? ===
//
// The app's table lives in src/api/types.ts as COUNT_BUCKET, and Home's tiles
// open the jobs behind their own number with it. That table is the app's mirror
// of a grouping Odoo computes server-side — a guess until something asks the
// server. This is that something.
//
// Transcribed rather than imported: this file is plain .mjs against a live
// server, and the point of the exercise is to compare the app's assumption with
// Odoo's behaviour, so a second copy here is the instrument, not a duplicate.
const BUCKET = {
  assigned: ['offered', 'accepted'],
  picked_up: ['picked', 'dispatched'],
  out_for_delivery: ['out_for_delivery'],
  delivered: ['delivered'],
};

const tally = {};
for (const o of orders) tally[o.delivery_status] = (tally[o.delivery_status] ?? 0) + 1;

console.log('\n        counts returned:');
for (const [k, v] of Object.entries(list.counts ?? {})) {
  console.log(`          ${k.padEnd(18)} ${v}`);
}
console.log('        statuses in orders[]:');
for (const [k, v] of Object.entries(tally)) {
  console.log(`          ${k.padEnd(18)} ${v}`);
}

// The three linked buckets hold no terminal status, so every row Odoo counts
// into them it must also return. Equality is what makes a tile openable: tap
// "2", get two. A failure here is not a broken server — it means Odoo groups
// differently and COUNT_BUCKET is the thing to change.
for (const key of ['assigned', 'picked_up', 'out_for_delivery']) {
  const listed = orders.filter((o) => BUCKET[key].includes(o.delivery_status)).length;
  check(
    `counts.${key} matches the rows behind it`,
    listed === (list.counts?.[key] ?? 0),
    `Odoo counted ${list.counts?.[key]}, but ${listed} row(s) are in [${BUCKET[key].join(', ')}]`
  );
}

// Not a failure, and the reason the Delivered tile opens nothing: those rows
// are counted and then dropped from the list.
const listedDelivered = orders.filter((o) => o.delivery_status === 'delivered').length;
console.log(
  `        delivered: counted ${list.counts?.delivered ?? 0}, listed ${listedDelivered}` +
    (listedDelivered === 0 ? '  (as expected — no history call to open them)' : '')
);

// Anything Odoo returns that no bucket covers. `returning` is the known one and
// is deliberate; a new name here is a status the app has not been told about.
const uncounted = Object.keys(tally).filter(
  (st) => !Object.values(BUCKET).some((list_) => list_.includes(st))
);
if (uncounted.length) {
  console.log(`        listed but in no bucket: ${uncounted.join(', ')}`);
}

for (const o of orders) {
  const tag = `order ${o.delivery_order_id} (${o.delivery_status})`;

  // The three shapes that have each broken a screen.
  check(`${tag}: shopName() gives a string`, typeof shopName(o.shop) === 'string', typeof o.shop);
  check(`${tag}: shop is never rendered raw`, renderable(shopName(o.shop)));
  check(`${tag}: money() gives a string`, typeof money(o.amount_to_collect, o.currency) === 'string');
  check(`${tag}: promised_by is UTC`, /Z$/.test(o.promised_by ?? ''), o.promised_by);
  check(
    `${tag}: coords() is null or a real fix`,
    coords(o.latitude, o.longitude) === null || typeof coords(o.latitude, o.longitude).latitude === 'number'
  );

  // A terminal job in the active list must offer nothing.
  if (['delivered', 'returned', 'cancelled', 'failed'].includes(o.delivery_status)) {
    check(`${tag}: terminal, so no actions`, (o.allowed_actions ?? []).length === 0,
      (o.allowed_actions ?? []).join(','));
  }
}

if (orders.length) {
  const id = orders[0].delivery_order_id;
  console.log(`\n=== order ${id} ===`);
  const detail = await call('order', { job_id: id });
  check('success', detail.success === true);
  // The defect that made every job screen say "That job is gone".
  check('order is nested under `order`', !!detail.order, JSON.stringify(Object.keys(detail).slice(0, 3)));
  const ord = detail.order ?? detail;
  check('nested order has its id', ord.delivery_order_id === id);
  check('allowed_actions is an array', Array.isArray(ord.allowed_actions));
  check('timestamps present', !!ord.timestamps);
  check('an untouched step is ""', ord.timestamps?.out_for_delivery === '' || !!ord.timestamps?.delivered);
  check('tracking flag present', typeof ord.tracking?.enabled === 'boolean');
  check('shopName() on the detail too', typeof shopName(ord.shop) === 'string');
}

console.log('\n=== a refusal is an answer, not an error ===');
const missing = await call('order', { job_id: 0 });
check('success is false', missing.success === false);
check('code is not_found', missing.code === 'not_found', missing.code);
check('message written for the rider', typeof missing.message === 'string' && missing.message.length > 0);

console.log('\n=== history ===');
const hist = await call('history', { limit: 3 });
check('success', hist.success === true);
check('timezone at the top level', typeof hist.timezone === 'string');
check('history is an array', Array.isArray(hist.history));
for (const h of hist.history ?? []) {
  check(`history ${h.delivery_order_id}: earnings present`, typeof h.earnings === 'number',
    String(h.earnings));
  check(`history ${h.delivery_order_id}: finished_at is UTC`, /Z$/.test(h.finished_at ?? ''));
  check(`history ${h.delivery_order_id}: shopName() works`, typeof shopName(h.shop) === 'string');
  check(
    `history ${h.delivery_order_id}: promisedAt() renders`,
    typeof promisedAt(h.finished_at, hist.timezone) === 'string'
  );
}

await rpc('/web/session/destroy', {}).catch(() => {});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
