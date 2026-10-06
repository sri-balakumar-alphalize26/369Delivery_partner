import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { api } from './endpoints';
import { uuid } from './rest/client';
import { ACTION_LABEL, ActionResult, ApiError } from './types';

/**
 * Steps tapped with no signal, kept until there is one.
 *
 * A rider in a lift, a basement car park or a tower's stairwell taps "I am near
 * the customer" and gets "Could not reach the server". Before this they had to
 * stand still and tap again until it went through; now the step waits here and
 * goes by itself when the signal is back.
 *
 * Only steps whose answer the rider does not need on the spot are queued. Accept
 * is not (the job may already be someone else's), nor decline, nor either code:
 * a code is only worth anything once the server has said yes to it, and a
 * parcel handed over on a code nobody checked is the one mistake this app
 * exists to prevent.
 *
 * Every entry keeps the Idempotency-Key it was queued with, and is re-sent under
 * it. A send that reached Odoo and lost its answer on the way back therefore
 * cannot run twice — on a server that honours the key. Until the delivery API
 * confirms it does, a refused re-send is read as "already done or no longer
 * possible" and the job is simply refetched.
 */

export type OutboxStep =
  | 'dispatch'
  | 'start_delivery'
  | 'reached'
  | 'report_issue'
  | 'return_to_shop';

export interface OutboxEntry {
  key: string;
  orderId: number;
  step: OutboxStep;
  reason?: string;
  /** A report's own words, sent with it when the signal is back. */
  note?: string;
  queuedAt: number;
}

const QUEUEABLE: string[] = ['dispatch', 'start_delivery', 'report_issue', 'return_to_shop'];

/** Whether a job-screen action may wait for signal. `reached` is not an action. */
export function isQueueable(action: string): action is OutboxStep {
  return QUEUEABLE.includes(action);
}

export function stepLabel(step: OutboxStep): string {
  return step === 'reached' ? 'Reached' : ACTION_LABEL[step];
}

const KEY = 'd369.outbox';

const useOutboxStore = create<{ entries: OutboxEntry[] }>(() => ({ entries: [] }));

let loaded: Promise<void> | null = null;

/** Read once from storage, so a queue survives the app being closed. */
function load(): Promise<void> {
  if (!loaded) {
    loaded = AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as OutboxEntry[];
        if (Array.isArray(saved)) useOutboxStore.setState({ entries: saved });
      })
      // An unreadable queue is an empty one, never a screen that will not open.
      .catch(() => {});
  }
  return loaded;
}

function save(entries: OutboxEntry[]): void {
  useOutboxStore.setState({ entries });
  AsyncStorage.setItem(KEY, JSON.stringify(entries)).catch(() => {});
}

function remove(key: string): void {
  save(useOutboxStore.getState().entries.filter((e) => e.key !== key));
}

/** Queue a step. A second tap on a step already waiting is the same step. */
export async function enqueue(
  orderId: number,
  step: OutboxStep,
  reason?: string,
  note?: string
): Promise<OutboxEntry> {
  await load();
  const entries = useOutboxStore.getState().entries;
  const same = entries.find((e) => e.orderId === orderId && e.step === step);
  if (same) return same;
  const entry: OutboxEntry = {
    key: uuid(),
    orderId,
    step,
    reason,
    ...(note ? { note } : {}),
    queuedAt: Date.now(),
  };
  save([...entries, entry]);
  return entry;
}

/** The step this job is waiting to send, if any. */
export function usePendingStep(orderId: number): OutboxEntry | undefined {
  return useOutboxStore((s) => s.entries.find((e) => e.orderId === orderId));
}

export function hasPending(): boolean {
  return useOutboxStore.getState().entries.length > 0;
}

/** On sign-out: the next rider on this phone inherits nothing. */
export function clearOutbox(): void {
  save([]);
}

function send(e: OutboxEntry): Promise<ActionResult> {
  switch (e.step) {
    case 'dispatch':
      return api.dispatch(e.orderId, e.key);
    case 'start_delivery':
      return api.start(e.orderId, e.key);
    case 'reached':
      return api.reachedCustomer(e.orderId, e.key);
    case 'report_issue':
      return api.reportIssue(e.orderId, e.reason ?? 'other', e.key, e.note ? { note: e.note } : undefined);
    case 'return_to_shop':
      return api.returnToShop(e.orderId, e.reason, e.key);
  }
}

export interface SendOutcome {
  entry: OutboxEntry;
  /** Present when the server took it. Absent with no refusal: it had already. */
  result?: ActionResult;
  /** The server said no. Its message is written for riders. */
  refusal?: ApiError;
}

let draining = false;

/**
 * Send what is waiting, oldest first. Stops at the first send that still finds
 * no signal, so the order the rider tapped in is the order Odoo hears.
 */
export async function drainOutbox(onSent: (o: SendOutcome) => Promise<void>): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    await load();
    for (;;) {
      const entry = useOutboxStore.getState().entries[0];
      if (!entry) return;

      // Only the send itself is tried here. What follows a send that went
      // through (starting tracking, refetching) must never be able to report
      // that step as failed.
      let outcome: SendOutcome;
      try {
        outcome = { entry, result: await send(entry) };
      } catch (err) {
        if (!(err instanceof ApiError)) console.warn(`[outbox] ${entry.step} failed:`, (err as Error)?.message);
        const e =
          err instanceof ApiError ? err : new ApiError('unknown', 'Could not send that step.');
        // Still no signal, or signed out: leave it for the next try.
        if (e.code === 'network' || e.code === 'unauthorized') return;
        // The key was already used: the first send got through.
        outcome = e.code === 'uuid_reused' ? { entry } : { entry, refusal: e };
      }

      remove(entry.key);
      try {
        await onSent(outcome);
      } catch (err) {
        console.warn(`[outbox] after ${entry.step}:`, (err as Error)?.message);
      }
    }
  } finally {
    draining = false;
  }
}
