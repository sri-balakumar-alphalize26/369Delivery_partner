import { router } from 'expo-router';
import { create } from 'zustand';
import { useSession } from '../store/session';
import { WORKSPACE_HOME, WORKSPACE_LABEL } from '../theme/workspace';
import { showToast } from '../ui/Toast';
import { JobRef } from './jobRef';

export { jobFromData } from './jobRef';
export type { JobRef } from './jobRef';

/**
 * One way to open a job from outside the screen it lives on: a tapped
 * notification, the lock-screen ring, the in-app offer alert, the "paused"
 * card. A delivery opens on the Delivery side, a service visit on the Service
 * side - switching sides first, with a short note, when the other one is open.
 *
 * A tap that arrives before sign-in is restored (the phone was locked, the app
 * closed) is held and opened once the session is back, with "Opening your
 * job…" on screen meanwhile (`OpeningJobHost`). An alert for a line this
 * person does not work in is dropped: they never see that side.
 */

export function jobPath(job: JobRef): string {
  return job.kind === 'service' ? `/service/${job.id}` : `/order/${job.id}`;
}

let pending: JobRef | null = null;

/**
 * A tapped job on its way to the screen, for what the rider sees meanwhile:
 * `opening` while signing back in (the "Opening your job…" cover), `signin`
 * when the sign-in has to be done again (a note on Connect). Null once the
 * job is on screen, or was dropped.
 */
export const useOpeningJob = create<{ job: JobRef | null; phase: 'opening' | 'signin' | null }>(
  () => ({ job: null, phase: null })
);

function opened() {
  useOpeningJob.setState({ job: null, phase: null });
}

/** The pause between landing on a side's home and opening the job on top of it. */
const AFTER_SWITCH_MS = 150;

export function openJob(job: JobRef): void {
  const s = useSession.getState();
  if (!s.ready || !s.connected) {
    pending = job;
    useOpeningJob.setState({ job, phase: s.ready ? 'signin' : 'opening' });
    return;
  }
  if (!s.lines.includes(job.kind)) {
    console.log(`[alert] ${job.kind} job ${job.id} ignored: not one of this person's lines`);
    opened();
    return;
  }
  const path = jobPath(job) as never;
  if (s.workspace !== job.kind) {
    s.setWorkspace(job.kind);
    showToast(`Switched to ${WORKSPACE_LABEL[job.kind]}`);
    // Land on the side's home first, so Back from the job stays on this side.
    router.replace(WORKSPACE_HOME[job.kind]);
    setTimeout(() => {
      router.push(path);
      opened();
    }, AFTER_SWITCH_MS);
    return;
  }
  router.push(path);
  opened();
}

/** Sign-in came back refused: the held job waits for the rider to sign in again. */
export function heldForSignIn(): void {
  if (pending) useOpeningJob.setState({ job: pending, phase: 'signin' });
}

/**
 * The cover has waited long enough. It goes; the job stays held and still
 * opens by itself once the sign-in is back.
 */
export function stopWaitingOnScreen(): void {
  if (useOpeningJob.getState().phase === 'opening') useOpeningJob.setState({ phase: null });
}

/** Open a tap that came in before the session was back. Called once connected. */
export function flushPendingJob(): void {
  const job = pending;
  pending = null;
  if (job) openJob(job);
}
