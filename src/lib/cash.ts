import { Currency, PastJob } from '../api/types';
import { asUtc } from './format';

/**
 * Cash the rider has taken at the door today, from `/history`.
 *
 * Until now the app only ever summed cash on jobs still being carried - money
 * not collected yet. What a rider actually holds at the end of a shift is the
 * other half: the cash-on-delivery jobs already delivered. Nothing showed it.
 *
 * "Today" is the shop's day, not the phone's: a rider whose phone sits in
 * another zone would otherwise see last night's 23:30 delivery as today's, or
 * lose this morning's.
 *
 * Known limit: `/history` sends the amount still *due*. If the office records
 * the payment after the delivery, that job reads as paid and drops out of this
 * total. Fixing that needs the server to keep what was collected at the door
 * (`sa_cod_collected` in the cash-handover spec).
 */

export interface CashRow {
  orderId: number;
  code: string;
  customer: string;
  amount: number;
  /** UTC, as `/history` sends it. */
  at: string;
}

export interface CashToday {
  total: number;
  currency: Currency | undefined;
  rows: CashRow[];
}

/** YYYY-MM-DD of an instant in a zone, or in the device's zone when none is given. */
function dayKey(ms: number, timeZone?: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(ms));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    // An unknown zone throws even with ICU present; fall back to UTC rather
    // than to the phone, which is the one clock this file must not trust.
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/**
 * Delivered cash-on-delivery jobs whose delivery falls on today's date in the
 * shop's zone, newest first, and what they add up to.
 *
 * `now` is server time (`serverNow()` / `useNow()`), so a phone with the wrong
 * date still gets the right day.
 */
export function cashToday(jobs: PastJob[] | undefined, now: number, timeZone?: string): CashToday {
  const today = dayKey(now, timeZone);
  const rows: CashRow[] = [];
  let currency: Currency | undefined;

  for (const job of jobs ?? []) {
    if (job.delivery_status !== 'delivered') continue;
    if (job.payment_status !== 'cod') continue;
    const amount = Number(job.amount_to_collect ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (!job.finished_at) continue;

    const at = Date.parse(asUtc(job.finished_at));
    if (Number.isNaN(at) || dayKey(at, timeZone) !== today) continue;

    currency = currency ?? job.currency;
    rows.push({
      orderId: job.delivery_order_id,
      code: job.job_code || job.delivery_order_name,
      customer: job.customer_name,
      amount,
      at: job.finished_at,
    });
  }

  rows.sort((a, b) => Date.parse(asUtc(b.at)) - Date.parse(asUtc(a.at)));

  // Summed in the currency's smallest unit, so 0.1 + 0.2 does not print as
  // 0.30000000000000004 and three-decimal rial adds up exactly.
  const dp = typeof currency?.decimals === 'number' ? currency.decimals : 2;
  const scale = 10 ** dp;
  const total = rows.reduce((sum, r) => sum + Math.round(r.amount * scale), 0) / scale;

  return { total, currency, rows };
}
