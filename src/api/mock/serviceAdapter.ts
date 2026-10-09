import {
  SERVICE_IN_HAND,
  SERVICE_MAX_PHOTOS,
  SERVICE_MIN_PHOTOS,
  SERVICE_TERMINAL,
  ServiceAction,
  ServiceApi,
  ServiceJob,
  ServiceStatus,
  ServiceStepResult,
} from '../serviceTypes';
import { ApiError } from '../types';
import { mockFlags } from './adapter';
import { makeServiceJob, MOCK_SIGNOFF_CODE } from './serviceFixtures';
import { demo } from './shared';

/**
 * An in-memory stand-in for the service module the senior is building, shaped
 * like the delivery one: the fake server holds the state table and sends
 * `allowed_actions`; the app draws them.
 *
 * Offers reach an agent who is on duty, works in Service, and has nothing in
 * hand in either line - the partner_app busy rule. Each offer has 90 seconds.
 */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const utcNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const OFFER_SECONDS = 90;
/** How long after one offer ends before the next can come. */
const OFFER_GAP_MS = 40_000;
/** A visit starting later than this is booked for later, not taken for now. */
const SOON_MS = 60 * 60_000;

const ACTIONS_FOR: Record<ServiceStatus, ServiceAction[]> = {
  offered: ['accept', 'decline'],
  scheduled: ['start_travel', 'report_issue'],
  accepted: ['start_travel', 'report_issue'],
  on_the_way: ['arrived', 'report_issue'],
  arrived: ['start_work', 'needs_revisit', 'report_issue'],
  working: ['finish_work', 'needs_revisit', 'report_issue'],
  finished: ['verify_signoff', 'report_issue'],
  signed_off: [],
  revisit: [],
  cancelled: [],
  failed: [],
};

const state = {
  jobs: [] as ServiceJob[],
  history: [] as ServiceJob[],
  lastOfferAt: 0,
  signoffSent: new Set<number>(),
};

// One visit already booked for this evening, so Schedule is not empty.
{
  const booked = makeServiceJob(3 * 60);
  booked.status = 'scheduled';
  booked.allowed_actions = ACTIONS_FOR.scheduled;
  state.jobs.push(booked);
}

/** For the flow test: let the next offer come now rather than after the gap. */
export function serviceOfferNow(): void {
  state.lastOfferAt = 0;
}

demo.serviceBusyRef = () => {
  const j = state.jobs.find((x) => SERVICE_IN_HAND.includes(x.status));
  return j ? j.ref : null;
};

function guard() {
  if (mockFlags.offline) {
    throw new ApiError('network', 'Could not reach the server. Check your connection.');
  }
}

function find(id: number): ServiceJob {
  const j = state.jobs.find((x) => x.id === id) ?? state.history.find((x) => x.id === id);
  if (!j) throw new ApiError('not_found', 'That job could not be found.', { status: 404 });
  return j;
}

function requireAction(j: ServiceJob, action: ServiceAction) {
  if (!j.allowed_actions.includes(action)) {
    throw new ApiError('wrong_state', 'That is not possible right now.', { status: 409 });
  }
}

function move(j: ServiceJob, to: ServiceStatus, message = 'Done.'): ServiceStepResult {
  j.status = to;
  j.allowed_actions = ACTIONS_FOR[to];
  if (SERVICE_TERMINAL.includes(to)) {
    state.jobs = state.jobs.filter((x) => x.id !== j.id);
    state.history.unshift(j);
  }
  return { job: { ...j }, message };
}

/** What the server would do between calls: offers lapse, new ones arrive. */
async function tick() {
  const now = Date.now();
  const before = state.jobs.length;
  state.jobs = state.jobs.filter(
    (j) => !(j.status === 'offered' && j.offer_expires_at && Date.parse(j.offer_expires_at) < now)
  );
  if (state.jobs.length < before) state.lastOfferAt = now;

  const free = !demo.deliveryBusyRef() && !demo.serviceBusyRef();
  const hasOffer = state.jobs.some((j) => j.status === 'offered');
  if (
    demo.onDuty() &&
    demo.worksIn !== 'delivery' &&
    free &&
    !hasOffer &&
    now - state.lastOfferAt > OFFER_GAP_MS
  ) {
    const offer = makeServiceJob(20);
    offer.offer_expires_at = new Date(now + OFFER_SECONDS * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z');
    state.jobs.unshift(offer);
    state.lastOfferAt = now;
  }
}

function sameDay(iso: string | null | undefined, ref: Date) {
  if (!iso) return false;
  const d = new Date(iso);
  return d.toDateString() === ref.toDateString();
}

export const serviceMockAdapter: ServiceApi = {
  async jobs() {
    await wait(200);
    guard();
    await tick();
    const now = new Date();
    const signed = state.history.filter((j) => j.status === 'signed_off');
    const today = signed.filter((j) => sameDay(j.signed_off_at, now));
    const weekAgo = Date.now() - 7 * 86_400_000;
    const monthAgo = Date.now() - 30 * 86_400_000;
    return {
      jobs: state.jobs.map((j) => ({ ...j })),
      history: state.history.map((j) => ({ ...j })),
      counts: {
        signed_off_today: today.length,
        signed_off_week: signed.filter((j) => Date.parse(j.signed_off_at ?? '') > weekAgo).length,
        signed_off_month: signed.filter((j) => Date.parse(j.signed_off_at ?? '') > monthAgo).length,
        revisits: state.history.filter((j) => j.status === 'revisit').length,
        cash_to_collect: state.jobs
          .filter((j) => SERVICE_IN_HAND.includes(j.status) && j.payment_status === 'cod')
          .reduce((a, j) => a + j.charge, 0),
        cash_collected: today
          .filter((j) => j.payment_status === 'cod')
          .reduce((a, j) => a + j.charge, 0),
      },
      server_time: utcNow(),
    };
  },

  async job(id) {
    await wait(150);
    guard();
    await tick();
    return { ...find(id) };
  },

  async accept(id) {
    await wait(300);
    guard();
    const j = find(id);
    if (j.status === 'offered' && j.offer_expires_at && Date.parse(j.offer_expires_at) < Date.now()) {
      state.jobs = state.jobs.filter((x) => x.id !== id);
      throw new ApiError('offer_expired', 'This offer has expired. It went to another technician.', {
        status: 409,
      });
    }
    requireAction(j, 'accept');
    if (demo.deliveryBusyRef()) {
      throw new ApiError(
        'agent_busy',
        'You already have a delivery in hand. This job goes to the next technician.',
        { status: 409 }
      );
    }
    if (mockFlags.stealNextOrder) {
      mockFlags.stealNextOrder = false;
      state.jobs = state.jobs.filter((x) => x.id !== id);
      throw new ApiError('wrong_state', 'Another technician has already taken this job.', {
        status: 409,
      });
    }
    j.offer_expires_at = null;
    const later = Date.parse(j.slot_start) - Date.now() > SOON_MS;
    return move(j, later ? 'scheduled' : 'accepted', later ? 'Booked for later.' : 'Accepted.');
  },

  async decline(id) {
    await wait(250);
    guard();
    const j = find(id);
    requireAction(j, 'decline');
    state.jobs = state.jobs.filter((x) => x.id !== id);
    state.lastOfferAt = Date.now();
    return { job: { ...j }, removed: true, message: 'Declined.' };
  },

  async startTravel(id) {
    await wait(250);
    guard();
    const j = find(id);
    requireAction(j, 'start_travel');
    if (demo.deliveryBusyRef()) {
      throw new ApiError('agent_busy', 'Finish the delivery in hand first.', { status: 409 });
    }
    return move(j, 'on_the_way', 'The customer has been told you are on the way.');
  },

  async arrived(id) {
    await wait(250);
    guard();
    const j = find(id);
    requireAction(j, 'arrived');
    return move(j, 'arrived', 'The customer has been told you are at the door.');
  },

  async startWork(id) {
    await wait(250);
    guard();
    const j = find(id);
    requireAction(j, 'start_work');
    if (j.photo_counts.before < SERVICE_MIN_PHOTOS) {
      throw new ApiError('proof_needed', `Take ${SERVICE_MIN_PHOTOS} before photos first.`, {
        status: 409,
      });
    }
    j.work_started_at = utcNow();
    return move(j, 'working');
  },

  async finishWork(id, work) {
    await wait(250);
    guard();
    const j = find(id);
    requireAction(j, 'finish_work');
    j.parts_used = work.parts_used.map((p) => ({ ...p }));
    j.note = work.note;
    return move(j, 'finished');
  },

  async sendSignoffCode(id) {
    await wait(300);
    guard();
    const j = find(id);
    requireAction(j, 'verify_signoff');
    state.signoffSent.add(id);
    return {
      message: `The customer has been sent their code on WhatsApp. (Demo: ${MOCK_SIGNOFF_CODE})`,
      retry_after_seconds: 60,
    };
  },

  async verifySignoff(id, code) {
    await wait(300);
    guard();
    const j = find(id);
    requireAction(j, 'verify_signoff');
    if (!state.signoffSent.has(id)) {
      throw new ApiError('otp_required', 'Send the customer their code first.', { status: 409 });
    }
    if (j.photo_counts.after < SERVICE_MIN_PHOTOS) {
      throw new ApiError('proof_needed', `Take ${SERVICE_MIN_PHOTOS} after photos first.`, {
        status: 409,
      });
    }
    if (code !== MOCK_SIGNOFF_CODE) {
      throw new ApiError('bad_otp', 'That code is not right. Ask the customer to read it again.', {
        status: 400,
      });
    }
    j.signed_off_at = utcNow();
    state.lastOfferAt = Date.now();
    return move(j, 'signed_off', 'Signed off.');
  },

  async needsRevisit(id, reason) {
    await wait(250);
    guard();
    const j = find(id);
    requireAction(j, 'needs_revisit');
    j.reports = [...(j.reports ?? []), { at: utcNow(), reason }];
    state.lastOfferAt = Date.now();
    return move(j, 'revisit', 'The office will book the next visit with the customer.');
  },

  async reportIssue(id, reason, note) {
    await wait(250);
    guard();
    const j = find(id);
    requireAction(j, 'report_issue');
    j.reports = [...(j.reports ?? []), { at: utcNow(), reason, note }];
    return { job: { ...j }, message: 'The office has been told. They will call you if they need to.' };
  },

  async addPhoto(id, stage) {
    await wait(400);
    guard();
    const j = find(id);
    if (j.photo_counts[stage] >= SERVICE_MAX_PHOTOS) {
      throw new ApiError('too_many_photos', `${SERVICE_MAX_PHOTOS} photos is the most for one stage.`, {
        status: 409,
      });
    }
    j.photo_counts = { ...j.photo_counts, [stage]: j.photo_counts[stage] + 1 };
    return { job: { ...j } };
  },
};
