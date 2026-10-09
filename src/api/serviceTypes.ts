import { Currency } from './types';

/**
 * On-site Service: a technician's repair or install visit, offered and worked
 * through like a delivery.
 *
 * The senior's service module is not on any server yet, so these shapes are
 * the app's side of the contract, written to mirror the delivery API: the
 * server decides the steps and sends `allowed_actions`; the app draws them and
 * nothing else. Until that module lands, only the demo server answers.
 *
 * Kept free of React so a Node test can import it.
 */

export type ServiceStatus =
  | 'offered'
  // Taken, for a slot later on. Not busy: deliveries carry on until the
  // technician starts travelling to it.
  | 'scheduled'
  | 'accepted' // taken for now: parts check, then Start travel
  | 'on_the_way'
  | 'arrived' // before photos, then Start work
  | 'working'
  | 'finished' // after photos, then the customer signs off
  | 'signed_off'
  | 'revisit' // closed: another visit is needed
  | 'cancelled'
  | 'failed';

export type ServiceAction =
  | 'accept'
  | 'decline'
  | 'start_travel'
  | 'arrived'
  | 'start_work'
  | 'finish_work'
  | 'verify_signoff'
  | 'needs_revisit'
  | 'report_issue';

export const SERVICE_TERMINAL: readonly ServiceStatus[] = [
  'signed_off',
  'revisit',
  'cancelled',
  'failed',
];

/** A visit in hand: makes the agent busy for delivery. */
export const SERVICE_IN_HAND: readonly ServiceStatus[] = [
  'accepted',
  'on_the_way',
  'arrived',
  'working',
  'finished',
];

export interface ServicePart {
  name: string;
  qty: number;
  /** Already in the technician's kit, or to collect from the store counter. */
  source: 'kit' | 'store';
}

export interface ServiceJob {
  id: number;
  /** As the office knows it: "SJ/00021". */
  ref: string;
  kind: 'repair' | 'install';
  /** "HP 15s · screen replacement" */
  title: string;
  device: string;
  /** What the customer reported: "Screen cracked". */
  fault: string;
  /** What to do: "Replace the 15.6\" screen". */
  task: string;
  customer_name: string;
  customer_mobile: string;
  address: string;
  area: string;
  latitude: number | null;
  longitude: number | null;
  /** The booked slot, UTC. */
  slot_start: string;
  slot_end: string;
  /** From the agent's last position, when the server knows it. */
  distance_m: number | null;
  /** What the customer pays at the end; 0 when paid online. */
  charge: number;
  payment_status: 'cod' | 'paid';
  currency: Currency;
  status: ServiceStatus;
  allowed_actions: ServiceAction[];
  offer_expires_at?: string | null;
  parts: ServicePart[];
  parts_used: { name: string; qty: number }[];
  note: string;
  photo_counts: { before: number; after: number };
  /** When work started, and the seconds worked before any pause (UTC). */
  work_started_at?: string | null;
  signed_off_at?: string | null;
  /** Problem reports on this visit, oldest first. */
  reports?: { at: string; reason: string; note?: string }[];
}

export interface ServiceCounts {
  signed_off_today: number;
  signed_off_week: number;
  signed_off_month: number;
  revisits: number;
  /** Cash still to collect from visits in hand. */
  cash_to_collect: number;
  /** Cash collected today: the shop's money, not pay. */
  cash_collected: number;
}

export interface ServiceJobsResponse {
  /** Offers and visits in hand, plus today's booked visits not yet started. */
  jobs: ServiceJob[];
  /** Finished visits, newest first. */
  history: ServiceJob[];
  counts: ServiceCounts;
  server_time?: string;
}

export interface ServiceStepResult {
  job: ServiceJob;
  message?: string;
  /** Set on decline: the offer has left this agent. */
  removed?: boolean;
}

export const SERVICE_DECLINE_REASONS: { key: string; label: string }[] = [
  { key: 'too far', label: 'Too far from me' },
  { key: 'not trained', label: 'Not trained for this device' },
  { key: 'no time', label: 'No time for this slot' },
  { key: 'other', label: 'Something else' },
];

export const SERVICE_REVISIT_REASONS: { key: string; label: string }[] = [
  { key: 'part missing', label: 'Part not in my kit' },
  { key: 'workshop', label: 'Needs the workshop' },
  { key: 'quote', label: 'Customer wants a quote first' },
  { key: 'other', label: 'Something else' },
];

export const SERVICE_PROBLEM_REASONS: { key: string; label: string }[] = [
  { key: 'customer absent', label: 'Customer not there' },
  { key: 'wrong address', label: 'Address is wrong' },
  { key: 'cancelled at door', label: 'Customer cancelled at the door' },
  { key: 'unsafe', label: 'Unsafe to work' },
  { key: 'other', label: 'Something else' },
];

/** The chip on a visit, by status. */
export const SERVICE_STATUS_LABEL: Record<ServiceStatus, string> = {
  offered: 'NEW JOB',
  scheduled: 'BOOKED',
  accepted: 'ACCEPTED',
  on_the_way: 'ON THE WAY',
  arrived: 'ARRIVED',
  working: 'WORKING',
  finished: 'SIGN-OFF',
  signed_off: 'DONE',
  revisit: 'REVISIT',
  cancelled: 'CANCELLED',
  failed: 'FAILED',
};

/** Two photos at least, four at most, per stage - the delivery rule. */
export const SERVICE_MIN_PHOTOS = 2;
export const SERVICE_MAX_PHOTOS = 4;

export interface ServiceApi {
  jobs(): Promise<ServiceJobsResponse>;
  job(id: number): Promise<ServiceJob>;
  accept(id: number): Promise<ServiceStepResult>;
  decline(id: number, reason: string): Promise<ServiceStepResult>;
  startTravel(id: number): Promise<ServiceStepResult>;
  arrived(id: number): Promise<ServiceStepResult>;
  startWork(id: number): Promise<ServiceStepResult>;
  finishWork(
    id: number,
    work: { parts_used: { name: string; qty: number }[]; note: string }
  ): Promise<ServiceStepResult>;
  /** Sends the customer their sign-off code on WhatsApp. */
  sendSignoffCode(id: number): Promise<{ message: string; retry_after_seconds: number }>;
  verifySignoff(id: number, code: string): Promise<ServiceStepResult>;
  needsRevisit(id: number, reason: string): Promise<ServiceStepResult>;
  reportIssue(id: number, reason: string, note?: string): Promise<ServiceStepResult>;
  /** One before/after photo has gone up. */
  addPhoto(id: number, stage: 'before' | 'after', uri: string): Promise<ServiceStepResult>;
}
