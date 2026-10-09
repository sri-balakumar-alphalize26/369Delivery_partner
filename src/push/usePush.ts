import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { router as appRouter, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { registerForPush } from './register';
import { claimNearAuto } from './nearAutoLedger';
import { feedback } from '../lib/feedback';
import { onRingAnswered } from './fullScreenRing';
import { flushPendingJob, jobFromData, openJob } from './openJob';
import { useSession } from '../store/session';
import { WORKSPACE_HOME } from '../theme/workspace';

/**
 * Wires push into the running app: register once connected, refresh on arrival,
 * and open the job when the rider taps the banner.
 *
 * Push is the *fast* path for hearing about a job. `useOrders` keeps polling
 * every 10s regardless, so a dropped notification, a denied permission or a
 * missing Firebase config makes the app slower, never broken.
 */
/**
 * When a push last landed.
 *
 * The offer alert below polls as well as listening, so without this a live push
 * and the refetch it triggers would both announce the same job — two banners for
 * one offer. The alert checks this and stays quiet when the push has spoken.
 */
let lastPushAt = 0;

export function pushArrivedRecently(withinMs = 8000): boolean {
  return lastPushAt > 0 && Date.now() - lastPushAt < withinMs;
}

export function usePush(connected: boolean) {
  const qc = useQueryClient();
  const router = useRouter();

  // Register once per connection. Registering while disconnected would have no
  // server to send the token to.
  useEffect(() => {
    if (!connected) return;
    // register.ts remembers the token, so sign-out can deactivate it without
    // this hook having to hand it anywhere.
    registerForPush();
  }, [connected]);

  useEffect(() => {
    // A push means Odoo has something new. Refetch immediately rather than
    // leaving the rider on stale data for up to the next poll.
    const received = Notifications.addNotificationReceivedListener((n) => {
      lastPushAt = Date.now();
      // The server's own "near the customer" push rang already: the job screen
      // must not chime again when its next poll sees the same change.
      const data = n.request.content.data as
        | { type?: string; delivery_order_id?: string; status?: string }
        | undefined;
      // A job cancelled, or gone to another rider: a falling tone and a long buzz.
      if (data?.status === 'passed' || data?.status === 'cancelled') feedback.jobGone();
      if (data?.type === 'near_customer_auto' && data.delivery_order_id) {
        claimNearAuto(Number(data.delivery_order_id));
      }
      qc.invalidateQueries({ queryKey: ['orders'] });
      // The open job too: `pickup_code_ready` is the counter having pressed
      // Dispatch, and the rider is standing there waiting for the code boxes.
      qc.invalidateQueries({ queryKey: ['order'] });
      qc.invalidateQueries({ queryKey: ['service-jobs'] });
      qc.invalidateQueries({ queryKey: ['service-job'] });
    });

    // Tapping the banner should land on the job it was about - on its own side.
    const tapped = Notifications.addNotificationResponseReceivedListener((res) => {
      if (handled.has(res.notification.request.identifier)) return;
      handled.add(res.notification.request.identifier);
      openFor(res, qc);
    });

    return () => {
      received.remove();
      tapped.remove();
    };
  }, [qc, router]);

  // The call-style ring answered: a tap, "Open job", or the full-screen launch
  // on a locked phone. Straight onto the offer, switching sides if need be.
  // Listened for from the start: a launch tap is held by `openJob` until the
  // session is back.
  useEffect(() => {
    return onRingAnswered((job) => {
      qc.invalidateQueries({ queryKey: [job.kind === 'service' ? 'service-jobs' : 'orders'] });
      openJob(job);
    });
  }, [qc]);

  // A tap held while signing back in is opened now.
  useEffect(() => {
    if (connected) flushPendingJob();
  }, [connected]);

  /**
   * A tap that started the app.
   *
   * The duty watch rings from the lock screen, often with the app closed, and a
   * tap then launches it before any listener above exists — so the job it was
   * about would be lost. Asked for once the rider is connected, since opening a
   * job before the session is back would only meet the Connect screen.
   */
  useEffect(() => {
    if (!connected) return;
    let live = true;
    Notifications.getLastNotificationResponseAsync()
      .then((res) => {
        if (!live || !res) return;
        const key = res.notification.request.identifier;
        if (handled.has(key)) return;
        handled.add(key);
        // Spent: the next launch must not reopen this job.
        Notifications.clearLastNotificationResponseAsync().catch(() => {});
        openFor(res, qc);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [connected, qc, router]);
}

/** Open the job a tapped notification was about, on the side it belongs to. */
function openFor(res: Notifications.NotificationResponse, qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['orders'] });
  qc.invalidateQueries({ queryKey: ['service-jobs'] });

  const data = res.notification.request.content.data as Record<string, unknown> | undefined;

  // "Moved on to another rider" and "cancelled" are about a job that is no
  // longer this rider's: opening it would only answer `not_found`. The
  // refreshed list is where the news shows.
  if (data?.status === 'passed' || data?.status === 'cancelled') {
    appRouter.replace(WORKSPACE_HOME[useSession.getState().workspace]);
    return;
  }

  // Only navigate on a real id — a malformed payload should leave the rider
  // where they are rather than on a broken screen.
  const job = jobFromData(data);
  if (job) openJob(job);
}

/** Notification taps already acted on, so a cold-start tap opens its job once. */
const handled = new Set<string>();
