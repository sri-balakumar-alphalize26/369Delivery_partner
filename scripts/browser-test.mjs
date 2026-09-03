/**
 * Drives the real app through the whole delivery flow in a browser and
 * screenshots every step.
 *
 * The flow test proves the logic against the mock and the live check proves the
 * shapes against res-test1; this proves the screens actually render and the
 * flow is walkable. It runs against the built-in demo data, so it needs no
 * token and no live server.
 *
 * Written for the Glass Light UI. The previous version tested the "Big Type +
 * Status Colour" design and broke wholesale when that was replaced — most
 * notably it tapped a "Go on duty" button that is now a Switch, so it never got
 * past the first step. The assertions below deliberately avoid anything that a
 * re-skin would invalidate: no palette values, no layout rules. What is checked
 * is that the rider can complete the job, and that nothing leaks a raw object
 * into the screen.
 *
 * Uses the Edge already installed on the machine rather than downloading one.
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
 * delivery, the second already paid, and they are walked down different paths —
 * so they are named rather than picked positionally.
 */
const COD_JOB = 'API Demo Customer';
const PAID_JOB = 'Fatma Al Balushi';

/** OMR takes three decimals, and the amount arrives with its own currency. */
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

/** Waits for text to appear, reporting rather than throwing so later steps run. */
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
 * Fails if the text is VISIBLE. The navigator keeps a popped screen mounted and
 * aria-hidden rather than unmounting it, so a plain count still finds the job
 * the rider has just finished with.
 */
async function expectNoText(page, text, label) {
  const showing = await page.evaluate((needle) => {
    let found = 0;
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let el;
    while ((el = walk.nextNode())) {
      if (el.children.length) continue; // the leaf carries the text
      if (!(el.textContent || '').includes(needle)) continue;
      if (el.closest('[aria-hidden="true"]')) continue; // parked screen
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      found++;
    }
    return found;
  }, text);
  log(showing === 0, label, showing ? `${showing} on screen` : '');
}

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

/**
 * Opens a job by customer name.
 *
 * The Glass job card is not pressable as a whole — it carries its own "Open
 * order" button, and every card on the list has one. So find which card holds
 * this customer and press that card's button, rather than tapping the name and
 * hoping the press bubbles.
 */
async function openJob(page, customer) {
  const idx = await page.evaluate((name) => {
    const isButton = (el) =>
      el.children.length === 0 && (el.textContent || '').trim() === 'Open order';
    const buttons = [...document.querySelectorAll('*')].filter(isButton);

    for (let i = 0; i < buttons.length; i++) {
      let node = buttons[i];
      for (let up = 0; up < 12 && node; up++) {
        node = node.parentElement;
        if (!node) break;
        // Stop at the card boundary. Climbing past it reaches the scroll
        // container, which holds every customer on the list — which is how
        // this used to open whichever job happened to be first.
        const buttonsInside = [...node.querySelectorAll('*')].filter(isButton).length;
        if (buttonsInside > 1) break;
        if ((node.textContent || '').includes(name)) return i;
      }
    }
    return -1;
  }, customer);

  if (idx < 0) {
    log(false, `open "${customer}"`, 'no card holds that customer');
    return false;
  }
  await page.getByText('Open order', { exact: true }).nth(idx).click();
  await page.waitForTimeout(1800);
  return true;
}

/**
 * Types a 6-digit code, whichever input the screen is using.
 *
 * Pickup uses `OtpInput`, a plain field with a "000000" placeholder. Delivery
 * uses `OtpBoxes`, which paints six boxes and keeps one real TextInput
 * off-screen at opacity 0 — so Playwright refuses to fill it as "not visible"
 * and it has to be forced.
 */
async function enterCode(page, code) {
  // Only a VISIBLE plain field counts: the navigator parks the previous screen
  // rather than unmounting it, so the pickup input is still in the DOM while
  // the delivery screen is showing, and filling that one would do nothing.
  const plain = page.getByPlaceholder('000000');
  const n = await plain.count();
  for (let i = 0; i < n; i++) {
    if (await plain.nth(i).isVisible()) {
      await plain.nth(i).fill(code);
      return true;
    }
  }

  const hidden = page.locator('input:not([type="checkbox"])').last();
  if (await hidden.count()) {
    await hidden.fill(code, { force: true });
    return true;
  }

  log(false, 'enter the code', 'no code input on screen');
  return false;
}

/**
 * Duty is a Switch now, not a button. react-native-web renders it as a real
 * checkbox input, so drive that rather than any label text.
 */
async function toggleDuty(page) {
  try {
    const sw = page.locator('input[type="checkbox"]').first();
    await sw.waitFor({ timeout: 12000 });
    await sw.click({ force: true });
    await page.waitForTimeout(1800);
    return true;
  } catch {
    log(false, 'toggle duty switch', 'no switch found');
    return false;
  }
}

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

  // ---- 1. Connect ------------------------------------------------------
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => {
    try {
      localStorage.clear();
    } catch {}
  });

  await page.goto(`${BASE}/connect`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await expectText(page, 'Use demo data', 'connect screen renders');
  console.log(`        ${await shoot(page, 'connect')}`);

  // ---- 2. Into the app -------------------------------------------------
  await tap(page, 'Continue');
  await page.waitForTimeout(2500);
  await expectText(page, 'API Test Rider', 'signed in as the demo rider');

  // Nothing is offered to an off-duty rider, so the screen must say why
  // rather than showing an empty list for no stated reason.
  await expectText(page, 'You are off duty', 'off-duty state is explained');
  await expectNoText(page, COD_JOB, 'no job offered while off duty');
  console.log(`        ${await shoot(page, 'off-duty')}`);

  // ---- 3. Going on duty collects what was waiting ----------------------
  await toggleDuty(page);
  await expectText(page, 'You are online', 'switch flips to online');
  await expectText(page, 'job(s) were waiting', 'server reports what was waiting');
  await expectText(page, COD_JOB, 'the waiting job appears');

  // The regression this whole thread turned on: currency is an object with its
  // own decimals. Formatted from a local table it read "[object Object] 12.50".
  await expectText(page, COD_AMOUNT, 'money uses currency.decimals (3 for OMR)');
  console.log(`        ${await shoot(page, 'on-duty')}`);

  // ---- 4. The job ------------------------------------------------------
  await openJob(page, COD_JOB);
  await expectText(page, 'Accept this job', 'only accept is offered');
  console.log(`        ${await shoot(page, 'job-offered')}`);

  await tap(page, 'Accept this job');
  await page.waitForTimeout(1800);
  await expectText(page, 'Pickup code', 'pickup code panel appears');
  console.log(`        ${await shoot(page, 'accepted')}`);

  // ---- 5. Wrong code, then the right one -------------------------------
  await enterCode(page, '000000');
  await tap(page, 'Enter pickup code');
  await page.waitForTimeout(1400);
  await expectText(page, 'Invalid or expired code', 'server error shown verbatim');
  console.log(`        ${await shoot(page, 'wrong-code')}`);

  await enterCode(page, PICKUP_OTP);
  await tap(page, 'Enter pickup code');
  await page.waitForTimeout(1800);
  await expectText(page, 'Leaving the shop', 'advanced to picked');
  console.log(`        ${await shoot(page, 'picked')}`);

  // ---- 6. Dispatch, then set off ---------------------------------------
  await tap(page, 'Leaving the shop');
  await page.waitForTimeout(1800);
  await expectText(page, 'Start delivery', 'advanced to dispatched');

  await tap(page, 'Start delivery');
  await page.waitForTimeout(2000);
  await expectText(page, 'Delivery code', 'out for delivery');
  console.log(`        ${await shoot(page, 'out-for-delivery')}`);

  // ---- 7. Deliver ------------------------------------------------------
  await enterCode(page, DELIVERY_OTP);
  await tap(page, 'Enter delivery code');
  await page.waitForTimeout(2800);
  await expectText(page, 'API Test Rider', 'delivered, back on home');
  console.log(`        ${await shoot(page, 'delivered')}`);

  // ---- 8. The return path ----------------------------------------------
  // "Confirm return" used to render as the main button and do nothing at all,
  // because no endpoint was wired to the action Odoo was offering.
  await openJob(page, PAID_JOB);
  await tap(page, 'Accept this job');
  await page.waitForTimeout(1800);
  await enterCode(page, PICKUP_OTP);
  await tap(page, 'Enter pickup code');
  await page.waitForTimeout(1800);

  await tap(page, 'Return to shop');
  await page.waitForTimeout(1200);
  // Returning now asks why, from the reason list both teams agreed on, rather
  // than sending a hardcoded string the office could not act on.
  await expectText(page, 'Why are you returning it?', 'return asks for a reason');
  await tap(page, 'Customer not there');
  await page.waitForTimeout(1800);
  await expectText(page, 'Confirm return', 'returning offers confirm_return');
  console.log(`        ${await shoot(page, 'returning')}`);

  await tap(page, 'Confirm return');
  await page.waitForTimeout(2800);
  await expectText(page, 'API Test Rider', 'return closes and lands on home');
  console.log(`        ${await shoot(page, 'returned')}`);

  // ---- 9. The other tabs -----------------------------------------------
  // Exact match: with exact:false the home heading "Active orders · N" wins
  // over the tab, and the tap lands on a heading that does nothing.
  await page.getByText('Orders', { exact: true }).first().click();
  await page.waitForTimeout(1500);
  await expectText(page, 'Your jobs', 'orders tab renders');
  console.log(`        ${await shoot(page, 'orders-tab')}`);

  await tap(page, 'Earnings');
  await page.waitForTimeout(1500);
  // There is no pay model in Odoo and /history returns earnings: 0. This screen
  // must keep saying so rather than growing an invented figure.
  await expectText(page, 'Payouts are not set up yet', 'earnings stays honest');
  console.log(`        ${await shoot(page, 'earnings-tab')}`);

  await tap(page, 'Profile');
  await page.waitForTimeout(1500);
  await expectText(page, 'Demo controls', 'profile renders');
  console.log(`        ${await shoot(page, 'profile-tab')}`);

  // ---- rules that survive a re-skin ------------------------------------
  // Deliberately not palette or layout rules: the previous version failed the
  // build on any box-shadow, which was true of the old design and false of this
  // one. These two are true of any skin, and the first is the failure that
  // actually reached users twice — currency, then shop.
  const leaks = await page.evaluate(() =>
    (document.body.innerText || '').split(/\s+/).filter((w) => w === '[object').length
  );
  log(leaks === 0, 'no raw object rendered into the UI', `${leaks} found`);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  log(!overflow, 'no horizontal overflow at 390px');

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
