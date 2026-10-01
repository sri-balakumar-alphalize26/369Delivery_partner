/**
 * Smoke-tests the LIVE Delivery Partner API against the app's own parsing helpers.
 *
 * The flow test proves the logic against the mock. This proves the shapes
 * against the real server — which is where every serious defect so far has
 * come from, because a mock written from the app's assumptions can only ever
 * confirm them. The currency object, the nested order envelope and the shop
 * object were all invisible until someone called the live database.
 *
 * It speaks to Odoo exactly as the app does: REST under /api/delivery, the
 * database in `X-Odoo-Database`, the rider as a Bearer token from a WhatsApp
 * code. It imports the real `src/lib/format.ts` rather than reimplementing it,
 * so a pass here means the shipped code survives the shipped payload.
 *
 * Run:
 *   # 1. Have Odoo send the rider a sign-in code on WhatsApp.
 *   node scripts/live-check.mjs <baseUrl> <db> send-code <phone>
 *
 *   # 2. Compile the helpers once, then sign in with that code and check.
 *   npx tsc src/lib/format.ts --outDir <dir> --module es2020 --target es2020 \
 *     --moduleResolution node --skipLibCheck
 *   node scripts/live-check.mjs <baseUrl> <db> check <formatJsPath> --phone <phone> --code <code>
 *   node scripts/live-check.mjs <baseUrl> <db> check <formatJsPath> --token <accessToken>
 *
 * Signing in with --phone/--code keeps the token in this process only - it is
 * never printed - tries one refresh the way the app does on a 401, and signs
 * out at the end, so no App Session is left behind.
 *
 * The contract is the senior's Delivery_Developer_Flow.pdf, section 3.
 */

const [, , BASE, DB, MODE, ...rest] = process.argv;

function usage() {
  console.error(
    'usage:\n' +
      '  node scripts/live-check.mjs <baseUrl> <db> send-code <phone>\n' +
      '  node scripts/live-check.mjs <baseUrl> <db> check <formatJsPath> (--phone <p> --code <c> | --token <t>)'
  );
  process.exit(2);
}

if (!BASE || !DB || !['send-code', 'check'].includes(MODE)) usage();

const digits = (s) => String(s ?? '').replace(/\D/g, '').replace(/^00/, '');
/** The `mobile` the sign-in calls take, as the API documents it: +96899887766. */
const mobileOf = (s) => `+${digits(s)}`;

/** One call, the way `src/api/rest/client.ts` makes it. Returns status and body. */
async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'X-Odoo-Database': DB,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    throw new Error(`${path} returned ${res.status} as ${ct || 'no content-type'}`);
  }
  return { status: res.status, body: await res.json() };
}

/** Keys and value types, never values: a sign-in answer holds live credentials. */
function shape(obj) {
  return Object.fromEntries(
    Object.entries(obj ?? {}).map(([k, v]) => [k, Array.isArray(v) ? 'array' : typeof v])
  );
}

if (MODE === 'send-code') {
  if (!digits(rest[0])) usage();
  const mobile = mobileOf(rest[0]);
  const r = await api('/api/delivery/auth/request-code', { method: 'POST', body: { mobile } });
  console.log(`request-code for ${mobile}: HTTP ${r.status}`, JSON.stringify(r.body));
  process.exit(r.status < 400 ? 0 : 1);
}

// === check ===
const FORMAT_PATH = rest[0];
const flag = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
if (!FORMAT_PATH) usage();

const { shopName, coords, money, promisedAt } = await import(
  FORMAT_PATH.startsWith('file:') ? FORMAT_PATH : `file:///${FORMAT_PATH.replace(/\\/g, '/')}`
);

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

/** Anything that reaches JSX must be a primitive, or React Native throws. */
function renderable(v) {
  return v === null || v === undefined || typeof v !== 'object';
}

console.log(`\nLive check against ${BASE} (${DB})\n`);

let token = flag('token');
const signedInHere = !token;

if (!token) {
  const code = flag('code');
  if (!digits(flag('phone')) || !code) usage();
  console.log('=== sign in ===');
  const r = await api('/api/delivery/auth/verify-code', {
    method: 'POST',
    body: { mobile: mobileOf(flag('phone')), code },
  });
  console.log(`        verify-code: HTTP ${r.status}, shape ${JSON.stringify(shape(r.body))}`);
  // Documented reply: {success, token, expires_at, rider}.
  const data = r.body?.data && typeof r.body.data === 'object' ? r.body.data : r.body;
  token = data?.token ?? data?.access_token;
  check('code accepted', r.status < 400 && r.body?.success !== false, r.body?.message);
  check('token returned', typeof token === 'string' && token.length > 0);
  check('expires_at returned', typeof data?.expires_at === 'string', String(data?.expires_at));
  check('rider returned', !!data?.rider);
  if (!token) {
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(1);
  }

  // The refresh the app makes on a 401: trade the token for a new one.
  console.log('\n=== refresh ===');
  const fresh = await api('/api/delivery/auth/refresh', {
    method: 'POST',
    body: { token },
    token,
  });
  console.log(`        refresh: HTTP ${fresh.status}, shape ${JSON.stringify(shape(fresh.body))}`);
  const next = fresh.body?.token ?? fresh.body?.access_token;
  check('refresh answers a new token', typeof next === 'string' && next.length > 0, fresh.body?.message);
  if (typeof next === 'string' && next) token = next;
}

const get = (path) => api(path, { token });

console.log('\n=== me ===');
const { body: me } = await get('/api/delivery/auth/me');
check('success', me.success === true, me.message);
check('rider carries on_duty', typeof me.rider?.on_duty === 'boolean');
check('rider carries duty_since', typeof me.rider?.duty_since === 'string');
check('timezone present', typeof me.timezone === 'string', me.timezone);
check('currency is an object with decimals', typeof me.currency?.decimals === 'number');
check('money() renders it', typeof money(12.5, me.currency) === 'string', money(12.5, me.currency));
console.log(`        signed in as ${me.rider?.name} (#${me.rider?.id}), currency ${me.currency?.code}`);
console.log(`        me shape ${JSON.stringify(shape(me))}`);

console.log('\n=== orders ===');
const { body: list } = await get('/api/delivery/orders');
check('success', list.success === true, list.message);
check('counts present', typeof list.counts?.delivered === 'number');
check('on_duty present', typeof list.on_duty === 'boolean');
check('server_time is UTC', /Z$/.test(list.server_time ?? ''), list.server_time);
check('orders is an array', Array.isArray(list.orders), typeof list.orders);

const orders = list.orders ?? [];
console.log(`        ${orders.length} order(s) returned`);

// The app's COUNT_BUCKET (src/api/types.ts), transcribed: this file compares the
// app's assumption with Odoo's behaviour, so a second copy is the instrument.
const BUCKET = {
  assigned: ['offered', 'accepted', 'awaiting_shop', 'preparing', 'ready'],
  picked_up: ['picked', 'dispatched'],
  out_for_delivery: ['out_for_delivery'],
  delivered: ['delivered'],
};

const tally = {};
for (const o of orders) tally[o.delivery_status] = (tally[o.delivery_status] ?? 0) + 1;
console.log('        counts returned:', JSON.stringify(list.counts ?? {}));
console.log('        statuses in orders[]:', JSON.stringify(tally));

for (const key of ['assigned', 'picked_up', 'out_for_delivery']) {
  const listed = orders.filter((o) => BUCKET[key].includes(o.delivery_status)).length;
  check(
    `counts.${key} matches the rows behind it`,
    listed === (list.counts?.[key] ?? 0),
    `Odoo counted ${list.counts?.[key]}, but ${listed} row(s) are in [${BUCKET[key].join(', ')}]`
  );
}

// Every action name the server uses. The app draws only names it knows
// (src/api/rest/client.ts KNOWN_ACTIONS); a new one here needs adding there.
const KNOWN = [
  'accept', 'decline', 'verify_pickup_otp', 'dispatch', 'start_delivery',
  'verify_delivery_otp', 'return_to_shop', 'confirm_return', 'report_issue',
];
const seen = new Set(orders.flatMap((o) => o.allowed_actions ?? []));
console.log(`        actions offered: ${[...seen].join(', ') || '(none)'}`);
for (const a of seen) check(`action "${a}" has a button in the app`, KNOWN.includes(a));

for (const o of orders) {
  const tag = `order ${o.delivery_order_id} (${o.delivery_status})`;
  // The list sends {"amount", "formatted"}; the app's adapter flattens it.
  const amount =
    o.amount_to_collect && typeof o.amount_to_collect === 'object'
      ? Number(o.amount_to_collect.amount)
      : Number(o.amount_to_collect);
  console.log(`        ${tag}: amount_to_collect is ${typeof o.amount_to_collect}`);
  check(`${tag}: shopName() gives a string`, typeof shopName(o.shop) === 'string', typeof o.shop);
  check(`${tag}: shop is never rendered raw`, renderable(shopName(o.shop)));
  check(`${tag}: the amount is a number`, Number.isFinite(amount), JSON.stringify(o.amount_to_collect));
  check(`${tag}: money() gives a string`, typeof money(amount, o.currency) === 'string');
  check(`${tag}: promised_by is UTC`, /Z$/.test(o.promised_by ?? ''), o.promised_by);
  check(
    `${tag}: coords() is null or a real fix`,
    coords(o.latitude, o.longitude) === null || typeof coords(o.latitude, o.longitude).latitude === 'number'
  );
}

if (orders.length) {
  const id = orders[0].delivery_order_id;
  console.log(`\n=== order ${id} ===`);
  const { body: detail } = await get(`/api/delivery/orders/${id}`);
  check('success', detail.success === true, detail.message);
  // The defect that made every job screen say "That job is gone".
  check('order is nested under `order`', !!detail.order, JSON.stringify(Object.keys(detail).slice(0, 3)));
  const ord = detail.order ?? detail;
  check('nested order has its id', ord.delivery_order_id === id);
  check('allowed_actions is an array', Array.isArray(ord.allowed_actions));
  check('timestamps present', !!ord.timestamps);
  check('tracking flag present', typeof ord.tracking?.enabled === 'boolean');
  check('shopName() on the detail too', typeof shopName(ord.shop) === 'string');
  console.log(`        order shape ${JSON.stringify(shape(ord))}`);
}

console.log('\n=== a refusal is an answer, not an error ===');
const missing = await get('/api/delivery/orders/0');
check('success is false', missing.body.success === false);
check('code is not_found', missing.body.code === 'not_found', missing.body.code);
check('message written for the rider', typeof missing.body.message === 'string' && missing.body.message.length > 0);

console.log('\n=== history ===');
const { body: hist } = await get('/api/delivery/history?limit=3');
check('success', hist.success === true, hist.message);
console.log(`        history shape ${JSON.stringify(shape(hist))}`);
const rows = hist.history ?? hist.orders ?? [];
check('history is an array', Array.isArray(rows));
for (const h of rows) {
  check(`history ${h.delivery_order_id}: shopName() works`, typeof shopName(h.shop) === 'string');
  if (h.finished_at) {
    check(
      `history ${h.delivery_order_id}: promisedAt() renders`,
      typeof promisedAt(h.finished_at, hist.timezone ?? me.timezone) === 'string'
    );
  }
}

if (signedInHere) {
  const out = await api('/api/delivery/auth/logout', {
    method: 'POST',
    body: {},
    token,
  }).catch((e) => ({ status: 0, body: { message: e.message } }));
  console.log(`\n        signed out: HTTP ${out.status} ${out.body?.message ?? ''}`);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
