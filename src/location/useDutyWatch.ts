import { useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';
import { useOrders } from '../hooks/useOrders';
import { useSession } from '../store/session';
import {
  DutyWatchResult,
  resumeTrackingAfterRestart,
  startDutyWatch,
  stopDutyWatch,
} from './tracking';

/**
 * Starts the duty watch when the rider goes on duty and stops it when they go
 * off, sign out, or the server says the shift is over.
 *
 * Mounted once, at the root, beside `useOfferAlert`. It runs while the app is in
 * front — the only time Android lets a foreground service start — and tries
 * again each time the app comes back, which is also how a permission granted in
 * Settings takes effect without a restart.
 */

/** Why the watch is not running, for the card on Home. Null: running, or off duty. */
export type DutyWatchProblem = Exclude<DutyWatchResult, { ok: true }>['reason'] | null;

const useDutyWatchStore = create<{ problem: DutyWatchProblem }>(() => ({ problem: null }));

export function useDutyWatchProblem(): DutyWatchProblem {
  return useDutyWatchStore((s) => s.problem);
}

let wanted = false;

/** Start, or try again after the rider granted what was missing. */
export async function retryDutyWatch(): Promise<void> {
  if (!wanted) return;
  const res = await startDutyWatch();
  useDutyWatchStore.setState({ problem: res.ok ? null : res.reason });
}

export function useDutyWatch(connected: boolean): void {
  const { data } = useOrders();
  const riderOnDuty = useSession((s) => s.rider?.on_duty);
  // The server's word from the last list; the stored rider until there is one.
  const onDuty = connected && (data?.on_duty ?? riderOnDuty ?? false);

  useEffect(() => {
    wanted = onDuty;
    if (onDuty) {
      void retryDutyWatch();
    } else {
      useDutyWatchStore.setState({ problem: null });
      void stopDutyWatch();
    }
  }, [onDuty]);

  useEffect(() => {
    // A delivery the last run was tracking when Android ended it.
    void resumeTrackingAfterRestart();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void retryDutyWatch();
    });
    return () => sub.remove();
  }, []);
}
