import { create } from 'zustand';
import { api } from '../api/endpoints';
import { ApiError } from '../api/types';
import { photoFileName } from '../lib/photoName';
import { shopTimeZone } from '../store/session';
import { notice } from '../ui/ConfirmSheet';
import {
  clearFinished,
  clearOwed,
  getOwed,
  nextToUpload,
  pendingCount,
  updateShots,
} from './owed';
import { shrinkPhoto } from './shrink';
import { hideUploadNotification, showUploadNotification } from './uploadNotification';

/**
 * The parcel photos going up after Send, while the rider gets on with the job.
 *
 * One photo at a time, oldest job first. Each is made lighter (`shrinkPhoto`),
 * sent, and marked sent in storage before the next starts, so a signal lost at
 * photo 3 leaves 1 and 2 on the server and a retry starts at 3. The server
 * keeps one copy of a name it has already seen (`duplicate: true`), so a photo
 * that did arrive before its answer was lost is harmless to send again.
 *
 * `usePhotoUploads` starts it on Send, when the signal returns, when the app
 * comes back to the front and every 20 s; a notification keeps the app running
 * meanwhile with the phone in a pocket (`uploadNotification.ts`).
 */

export interface UploadState {
  /** Nothing to send; sending now; photos left but no signal. */
  phase: 'idle' | 'sending' | 'waiting';
  ref: string;
  /** The photo going up, 1-based, of how many left at the start of this job's run. */
  index: number;
  count: number;
  /** 0 to 1 for the photo going up. */
  fraction: number;
  /** Every photo still to send, every job. */
  left: number;
}

const IDLE: UploadState = { phase: 'idle', ref: '', index: 0, count: 0, fraction: 0, left: 0 };

export const useUploads = create<UploadState>(() => IDLE);

/**
 * A problem report's photo going up. Not queued like the parcel photos - the
 * report's answer decides the next step - but shown in the same bar.
 */
export const useReportUpload = create<{ ref: string; fraction: number } | { ref: null }>(
  () => ({ ref: null })
);

function set(next: Partial<UploadState>) {
  useUploads.setState(next);
  void showUploadNotification(useUploads.getState());
}

let running: Promise<void> | null = null;

/** Sends every photo waiting. One run at a time: a second call joins the first. */
export function drainPhotos(): Promise<void> {
  if (!running) {
    running = run().finally(() => {
      running = null;
    });
  }
  return running;
}

async function run(): Promise<void> {
  await clearFinished();
  for (;;) {
    const entry = await nextToUpload();
    if (!entry) {
      useUploads.setState(IDLE);
      await hideUploadNotification();
      return;
    }
    const { orderId, stage, ref } = entry;
    const todo = entry.shots.filter((s) => !s.sent).length;
    let done = 0;

    try {
      // Every photo of the stage named in the one zone, the company's, from
      // the moment it was taken - never the phone's zone.
      const zone = await shopTimeZone();
      for (let i = 0; i < entry.shots.length; i++) {
        // Read again each time: the stored list is the truth, not this copy.
        const now = await getOwed(orderId, stage);
        if (!now) break;
        const shot = now.shots[i];
        if (!shot || shot.sent) continue;

        done += 1;
        set({
          phase: 'sending',
          ref,
          index: done,
          count: todo,
          fraction: 0,
          left: await pendingCount(),
        });

        const name = shot.takenAt ? photoFileName(ref, new Date(shot.takenAt), zone) : shot.name;
        const small = shot.small ?? (await shrinkPhoto(shot.uri));
        if (small !== shot.small) {
          await updateShots(
            orderId,
            stage,
            now.shots.map((s, j) => (j === i ? { ...s, small, name } : s))
          );
        }

        let lastTick = 0;
        await api.uploadProof(orderId, small, name, stage, (fraction) => {
          // The bar and the notification need a few frames a second, not every packet.
          const t = Date.now();
          if (fraction < 1 && t - lastTick < 250) return;
          lastTick = t;
          set({ fraction });
        });

        const after = await getOwed(orderId, stage);
        if (after) {
          await updateShots(
            orderId,
            stage,
            after.shots.map((s, j) => (j === i ? { ...s, name, sent: true } : s))
          );
        }
      }
      // All up: the debt is paid and its files go.
      const left = await getOwed(orderId, stage);
      if (left && left.shots.every((s) => s.sent)) await clearOwed(orderId, stage);
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      // The server holds the most it keeps, the job closed for photos 24 h
      // after it ended, or it said no in some other way that a retry will not
      // change. Nothing more can go up for it; the rest still can. (Without
      // this a refusal would be retried every 20 s, the notification stuck.)
      // Only the server's own JSON refusals: an HTML page (a proxy, a dead
      // tunnel, a wrong database - `unknown`, `no_database`) is not its word.
      const status = e?.status ?? 0;
      const final =
        e?.code === 'too_many_photos' ||
        e?.code === 'wrong_state' ||
        (status >= 400 &&
          status < 500 &&
          ![401, 408, 429].includes(status) &&
          !['unauthorized', 'unknown', 'no_database', 'network'].includes(e?.code ?? ''));
      if (e && final) {
        await clearOwed(orderId, stage);
        void notice(
          `Photos · ${ref}`,
          e.code === 'too_many_photos' ? 'The shop already has 4 photos for this parcel.' : e.message
        );
        continue;
      }
      if (!e || (e.code !== 'network' && e.code !== 'unauthorized')) {
        console.warn('[photos] upload failed:', (err as Error)?.message);
      }
      // No signal (or a refusal to look at later): wait for the next try.
      set({ phase: 'waiting', fraction: 0, left: await pendingCount() });
      if (e?.code === 'unauthorized') await hideUploadNotification();
      return;
    }
  }
}
