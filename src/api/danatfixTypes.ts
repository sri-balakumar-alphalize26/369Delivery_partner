/**
 * Website repair bookings (Store ▸ Website Bookings, Odoo module
 * `danatfix_repair_booking`) as the Service side shows them.
 *
 * The shapes are the module's own `screen_data` rows - the list the Store's
 * Live Screen draws - so the app and the counter always agree. Its steps are
 * its own: New → Calling customer → Accepted → Done, or Cancelled.
 *
 * Kept free of React so a Node test can import it.
 */

export type BookingState = 'new' | 'calling' | 'accepted' | 'done' | 'cancelled';

/** The Live Screen's buttons, sent to `screen_act`. */
export type BookingAction = 'accept' | 'call' | 'done' | 'cancel';

export interface RepairBookingLine {
  id: number;
  device: string;
  model: string;
  issue: string;
  qty: number;
}

export interface RepairBooking {
  id: number;
  /** WB/00012 */
  name: string;
  /** The reference the customer saw on WhatsApp. */
  web_ref: string;
  state: BookingState;
  customer: string;
  phone: string;
  phone_digits: string;
  email: string;
  area: string;
  address: string;
  map_url: string;
  brand: string;
  source: string;
  lines: RepairBookingLine[];
  coupon: string;
  note: string;
  /** When it came in, UTC as Odoo writes it: "2026-10-12 10:55:08". */
  created: string;
  taken_by: string;
  decided_via: string;
}

export interface BookingsResponse {
  rows: RepairBooking[];
  /** How many are still New. */
  new: number;
}

/** What `screen_act` sends back: the fresh list, and a note when another tap was first. */
export interface BookingActResult extends BookingsResponse {
  warning?: string;
}

/** A finished booking, for the history list. */
export interface PastBooking {
  id: number;
  name: string;
  state: BookingState;
  customer_name: string;
  area: string;
  summary: string;
  write_date: string;
  accepted_by_name: string;
}

/** The buttons each state allows - danatfix's own `_FROM` table. */
export const BOOKING_ACTIONS: Record<BookingState, BookingAction[]> = {
  new: ['accept', 'call', 'cancel'],
  calling: ['accept', 'done', 'cancel'],
  accepted: ['done', 'cancel'],
  done: [],
  cancelled: [],
};

export const BOOKING_STATE_LABEL: Record<BookingState, string> = {
  new: 'NEW',
  calling: 'CALLING',
  accepted: 'ACCEPTED',
  done: 'DONE',
  cancelled: 'CANCELLED',
};

/** "iPhone 13 — Screen ×2" */
export function lineText(l: RepairBookingLine): string {
  const what = [l.device, l.model].filter(Boolean).join(' ');
  const issue = l.qty > 1 ? `${l.issue} ×${l.qty}` : l.issue;
  return what ? `${what} — ${issue}` : issue;
}

/** Odoo's "YYYY-MM-DD HH:MM:SS" (UTC) as a Date. */
export function odooUtc(s: string): Date {
  return new Date(`${s.replace(' ', 'T')}Z`);
}
