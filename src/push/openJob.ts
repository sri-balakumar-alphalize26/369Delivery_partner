import { router } from 'expo-router';
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
 * closed) is held and opened once the session is back. An alert for a line
 * this person does not work in is dropped: they never see that side.
 */

export function jobPath(job: JobRef): string {
  return job.kind === 'service' ? `/service/${job.id}` : `/order/${job.id}`;
}

let pending: JobRef | null = null;

/** The pause between landing on a side's home and opening the job on top of it. */
const AFTER_SWITCH_MS = 150;

export function openJob(job: JobRef): void {
  const s = useSession.getState();
  if (!s.ready || !s.connected) {
    pending = job;
    return;
  }
  if (!s.lines.includes(job.kind)) {
    console.log(`[alert] ${job.kind} job ${job.id} ignored: not one of this person's lines`);
    return;
  }
  const path = jobPath(job) as never;
  if (s.workspace !== job.kind) {
    s.setWorkspace(job.kind);
    showToast(`Switched to ${WORKSPACE_LABEL[job.kind]}`);
    // Land on the side's home first, so Back from the job stays on this side.
    router.replace(WORKSPACE_HOME[job.kind]);
    setTimeout(() => router.push(path), AFTER_SWITCH_MS);
    return;
  }
  router.push(path);
}

/** Open a tap that came in before the session was back. Called once connected. */
export function flushPendingJob(): void {
  const job = pending;
  pending = null;
  if (job) openJob(job);
}
