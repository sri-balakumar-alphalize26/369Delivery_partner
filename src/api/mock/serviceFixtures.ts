import { ServiceJob } from '../serviceTypes';
import { OMR } from './fixtures';

/**
 * Sample repair and install visits for demo mode, in the same Muscat the
 * delivery demo uses, so the two sides of the app sit on one map.
 */

const VISITS: Omit<
  ServiceJob,
  | 'id'
  | 'ref'
  | 'slot_start'
  | 'slot_end'
  | 'status'
  | 'allowed_actions'
  | 'offer_expires_at'
  | 'parts_used'
  | 'note'
  | 'photo_counts'
  | 'currency'
>[] = [
  {
    kind: 'repair',
    title: 'HP 15s · screen replacement',
    device: 'HP 15s laptop',
    fault: 'Screen cracked',
    task: 'Replace the 15.6" screen',
    customer_name: 'Priya R',
    customer_mobile: '+96891234001',
    address: 'Flat 12, Al Noor Building, Way 2810',
    area: 'Al Khuwair',
    latitude: 23.5921,
    longitude: 58.4232,
    distance_m: 2300,
    charge: 18,
    payment_status: 'cod',
    parts: [
      { name: 'HP 15s screen 15.6"', qty: 1, source: 'store' },
      { name: 'Screen adhesive', qty: 1, source: 'kit' },
    ],
  },
  {
    kind: 'install',
    title: 'Split AC · installation',
    device: 'Gree 1.5 ton split AC',
    fault: 'New unit, not fitted',
    task: 'Fit indoor and outdoor units, test cooling',
    customer_name: 'Mohan K',
    customer_mobile: '+96891234002',
    address: 'Villa 21, Way 4410',
    area: 'Al Ghubrah',
    latitude: 23.5862,
    longitude: 58.3921,
    distance_m: 4100,
    charge: 0,
    payment_status: 'paid',
    parts: [
      { name: 'Copper pipe 3 m', qty: 1, source: 'kit' },
      { name: 'Wall bracket', qty: 1, source: 'kit' },
    ],
  },
  {
    kind: 'install',
    title: 'Printer · setup',
    device: 'Canon G3010',
    fault: 'New printer, needs Wi-Fi setup',
    task: 'Set up on Wi-Fi and print a test page',
    customer_name: 'Ravi S',
    customer_mobile: '+96891234003',
    address: 'Office 4, Ruwi High Street',
    area: 'Ruwi',
    latitude: 23.5906,
    longitude: 58.545,
    distance_m: 6200,
    charge: 5,
    payment_status: 'cod',
    parts: [],
  },
];

let seq = 20;

/** `mins` from now, UTC, on the minute. */
function at(mins: number): string {
  const d = new Date(Date.now() + mins * 60_000);
  d.setSeconds(0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** A new visit. `startsIn` minutes from now, an hour long. */
export function makeServiceJob(startsIn: number): ServiceJob {
  seq += 1;
  const base = VISITS[seq % VISITS.length];
  return {
    ...base,
    parts: base.parts.map((p) => ({ ...p })),
    id: 9000 + seq,
    ref: `SJ/${String(seq).padStart(5, '0')}`,
    slot_start: at(startsIn),
    slot_end: at(startsIn + 60),
    status: 'offered',
    allowed_actions: ['accept', 'decline'],
    offer_expires_at: null,
    parts_used: [],
    note: '',
    photo_counts: { before: 0, after: 0 },
    currency: OMR,
    work_started_at: null,
    signed_off_at: null,
    reports: [],
  };
}

/** The customer's sign-off code in demo mode, like the delivery demo's codes. */
export const MOCK_SIGNOFF_CODE = '111111';
