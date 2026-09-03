/**
 * Drives the real app through the whole delivery flow in a browser and
 * screenshots every step.
 *
 * The headless flow test proves the logic; this proves the screens actually
 * render and the flow is walkable. It runs against the built-in demo data, so
 * it needs no token and no live server.
 *
 * Uses the Edge already installed on the machine (channel: 'msedge') rather
 * than downloading a browser.
 *
 * Run:  node scripts/browser-test.mjs [baseUrl] [outDir]
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:8090';
const OUT = process.argv[3] ?? './shots';

const PICKUP_OTP = '482913';
const DELIVERY_OTP = '739214';

/**
 * The two jobs waiting in the demo data, by customer. The first is cash on
 * delivery, the second already paid — and they are walked down different
 * paths, so they are named rather than picked positionally.
 */
const COD_JOB = 'API Demo Customer';
const PAID_JOB = 'Fatma Al Balushi';

/** OMR is a three-decimal currency, and the amount comes with its own currency. */
const COD_AMOUNT = 'OMR 12.500';

mkdirSync(OUT, { recursive: true });

let step = 0;
const failures = [];

function log(ok, label, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(label);
}

async function shoot(page, name) {
  step += 1;
  const file = join(OUT, `${String(step).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

/** Waits for text to appear, and reports rather than throwing so later steps still run. */
async function expectText(page, text, label) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ timeout: 12000 });
    log(true, label);
    return true;
  } catch {
    log(false, label, `"${text}" not found`);
    return false;
  }
}

/**
 * Reports a failure if the text is VISIBLE — for things that must never render.
 *
 * Visibility matters: the navigator keeps a screen mounted after it is popped,
 * so a plain count still finds the job the rider has just finished with.
 */
async function expectNoText(page, text, label) {
  const showing = await page.evaluate((needle) => {
    let found = 0;
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let el;
    while ((el = walk.nextNode())) {
      if (el.children.length) continue; // the leaf carries the text
      if (!(el.textContent || '').includes(needle)) continue;
      // The navigator parks a popped screen rather than unmounting it: still
      // laid out, but aria-hidden and pointer-events:none. Not on screen.
      if (el.closest('[aria-hidden="true"]')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      found++;
    }
    return found;
  }, text);

  log(showing === 0, label, showing ? `${showing} on screen` : '');
}

/** Taps by visible text. Reports rather than throwing, so later steps still run. */
async function tap(page, name) {
  try {
    const el = page.getByText(name, { exact: false }).first();
    await el.waitFor({ timeout: 12000 });
    await el.click();
    await page.waitForTimeout(900);
    return true;
  } catch {
    log(false, `tap "${name}"`, 'not found');
    return false;
  }
}

/** Reads the background colour of the status band at the top of the screen. */
async function barColour(page) {
  return page.evaluate(() => {
    const seen = [];
    for (const el of document.querySelectorAll('div')) {
      const r = el.getBoundingClientRect();
      // A full-width strip near the very top, tall enough to be the band.
      if (r.top < 8 && r.width > 300 && r.height > 24 && r.height < 140) {
        const bg = getComputedStyle(el).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') seen.push(bg);
      }
    }
    return seen[seen.length - 1] ?? null;
  });
}

const rgb = (c) => (c ?? '').replace(/\s/g, '');

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  console.log(`\nDriving ${BASE}\n`);

  // ---- 1. Connect -------------------------------------------------------
  // Clear any saved session first, so each run starts like a fresh install.
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => {
    try {
      localStorage.clear();
    } catch {}
  });

  // A fresh install connects to demo data on its own and lands on Jobs, so
  // Connect is reached deliberately rather than by redirect.
  await page.goto(`${BASE}/connect`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await expectText(page, 'Connect', 'connect screen renders');
  await expectText(page, 'Use demo data', 'demo toggle present');
  console.log(`        ${await shoot(page, 'connect')}`);

  // ---- 2. Into the app --------------------------------------------------
  await tap(page, 'Continue');
  await page.waitForTimeout(2500);
  await expectText(page, 'API Test Rider', 'signed in as the demo rider');

  // ---- 3. Off duty ------------------------------------------------------
  // Nothing is offered to an off-duty rider, so this screen must explain
  // itself rather than showing an empty list for no stated reason.
  await expectText(page, 'You are off duty', 'off-duty state is explained');
  await expectNoText(page, COD_JOB, 'no jobs offered while off duty');
  const idleBar = await barColour(page);
  console.log(`        ${await shoot(page, 'off-duty')}`);

  // ---- 4. Clocking on picks up what was waiting -------------------------
  await tap(page, 'Go on duty');
  await page.waitForTimeout(2000);
  await expectText(page, 'job(s) were waiting', 'server reports what was waiting');
  await expectText(page, 'Your jobs', 'more than one job is listed');
  await expectText(page, PAID_JOB, 'the second job is reachable too');

  // The regression this change exists for: currency is an object with its own
  // decimals. Formatted from a local table it read "[object Object] 12.50".
  await expectText(page, COD_AMOUNT, 'money uses currency.decimals (3 for OMR)');
  await expectNoText(page, '[object Object]', 'currency object never leaks into the UI');
  console.log(`        ${await shoot(page, 'jobs-on-duty')}`);

  // ---- 5. The job -------------------------------------------------------
  await tap(page, COD_JOB);
  await page.waitForTimeout(1200);
  await expectText(page, 'Accept this job', 'only accept is offered');
  await expectText(page, COD_AMOUNT, 'cash to collect carries three decimals');
  console.log(`        ${await shoot(page, 'job-offered')}`);

  // ---- 6. Accept --------------------------------------------------------
  await tap(page, 'Accept this job');
  await page.waitForTimeout(1500);
  await expectText(page, 'Pickup code', 'pickup code panel appears');
  const acceptedBar = await barColour(page);
  log(
    rgb(acceptedBar) === 'rgb(0,66,179)',
    'bar turns brand blue after accept',
    acceptedBar ?? 'no bar found'
  );
  console.log(`        ${await shoot(page, 'accepted-pickup-code')}`);

  // ---- 7. Wrong code ----------------------------------------------------
  await page.getByPlaceholder('000000').first().fill('000000');
  await tap(page, 'Enter pickup code');
  await page.waitForTimeout(1200);
  await expectText(page, 'Invalid or expired code', 'server error message shown verbatim');
  console.log(`        ${await shoot(page, 'wrong-pickup-code')}`);

  // ---- 8. Right code ----------------------------------------------------
  await page.getByPlaceholder('000000').first().fill(PICKUP_OTP);
  await tap(page, 'Enter pickup code');
  await page.waitForTimeout(1500);
  await expectText(page, 'Leaving the shop', 'advanced to picked');
  console.log(`        ${await shoot(page, 'picked')}`);

  // ---- 9. Dispatch then start ------------------------------------------
  await tap(page, 'Leaving the shop');
  await page.waitForTimeout(1500);
  await expectText(page, 'Start delivery', 'advanced to dispatched');
  console.log(`        ${await shoot(page, 'dispatched')}`);

  await tap(page, 'Start delivery');
  await page.waitForTimeout(1800);
  await expectText(page, 'Delivery code', 'out for delivery, delivery code panel up');
  const deliveringBar = await barColour(page);
  log(
    rgb(deliveringBar) === 'rgb(22,163,74)',
    'bar turns green at out_for_delivery',
    deliveringBar ?? 'no bar found'
  );
  console.log(`        ${await shoot(page, 'out-for-delivery')}`);

  // ---- 10. Deliver ------------------------------------------------------
  await page.getByPlaceholder('000000').first().fill(DELIVERY_OTP);
  await tap(page, 'Enter delivery code');
  await page.waitForTimeout(2500);
  await expectText(page, 'Delivered', 'delivery completed');
  console.log(`        ${await shoot(page, 'delivered')}`);

  // ---- 11. The return path ----------------------------------------------
  // "Confirm return" used to render as the main button and do nothing at all,
  // because no endpoint was wired to the action Odoo was offering.
  await expectText(page, 'Your job', 'back on the jobs list after delivering');
  console.log(`        ${await shoot(page, 'jobs-after-delivery')}`);

  await tap(page, PAID_JOB);
  await page.waitForTimeout(2000);
  console.log(`        ${await shoot(page, 'return-job-opened')}`);
  await tap(page, 'Accept this job');
  await page.waitForTimeout(1500);
  await page.getByPlaceholder('000000').first().fill(PICKUP_OTP);
  await tap(page, 'Enter pickup code');
  await page.waitForTimeout(1500);

  await tap(page, 'Return to shop');
  await page.waitForTimeout(1500);
  await expectText(page, 'Confirm return', 'returning offers confirm_return');
  console.log(`        ${await shoot(page, 'returning')}`);

  await tap(page, 'Confirm return');
  await page.waitForTimeout(2500);
  // Closing the return sends the rider back to Jobs, and the finished job is
  // gone from the active list.
  await expectText(page, 'API Test Rider', 'confirm return completes and returns to Jobs');
  await expectNoText(page, PAID_JOB, 'a returned job leaves the active list');
  console.log(`        ${await shoot(page, 'returned')}`);

  // ---- 12. Profile ------------------------------------------------------
  await tap(page, 'Profile');
  await page.waitForTimeout(1500);
  await expectText(page, 'Demo controls', 'profile shows demo controls');
  await expectText(page, 'On duty', 'profile reflects duty state');
  console.log(`        ${await shoot(page, 'profile')}`);

  // ---- design rules -----------------------------------------------------
  const chrome = await page.evaluate(() => {
    let shadows = 0;
    let borders = 0;
    for (const el of document.querySelectorAll('div')) {
      const r = el.getBoundingClientRect();
      // Only surfaces the design system owns. Platform controls draw their own
      // chrome — react-native-web's Switch thumb is a 20x20 shadowed circle —
      // and a card, panel or button is never that small.
      if (r.width < 32 || r.height < 32) continue;
      const s = getComputedStyle(el);
      if (s.boxShadow && s.boxShadow !== 'none') shadows++;
      const w = parseFloat(s.borderTopWidth || '0');
      // Hairlines are 1px and deliberate; anything thicker is a box.
      if (w > 1.5) borders++;
    }
    return { shadows, borders };
  });
  log(chrome.shadows === 0, 'no shadows anywhere', `${chrome.shadows} found`);
  log(chrome.borders === 0, 'no borders thicker than a hairline', `${chrome.borders} found`);

  console.log(`\n  idle bar: ${idleBar}`);
  if (errors.length) {
    console.log(`\n  ${errors.length} console error(s):`);
    for (const e of [...new Set(errors)].slice(0, 8)) console.log(`    - ${e.slice(0, 160)}`);
  } else {
    console.log('\n  no console errors');
  }

  await browser.close();

  console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILED`}\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('CRASHED', e);
  process.exit(1);
});
