import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { registerForPush } from './register';
import { claimNearAuto } from './nearAutoLedger';

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
      const data = n.request.content.data as { type?: string; delivery_order_id?: string } | undefined;
      if (data?.type === 'near_customer_auto' && data.delivery_order_id) {
        claimNearAuto(Number(data.delivery_order_id));
      }
      qc.invalidateQueries({ queryKey: ['orders'] });
      // The open job too: `pickup_code_ready` is the counter having pressed
      // Dispatch, and the rider is standing there waiting for the code boxes.
      qc.invalidateQueries({ queryKey: ['order'] });
    });

    // Tapping the banner should land on the job it was about.
    const tapped = Notifications.addNotificationResponseReceivedListener((res) => {
      if (handled.has(res.notification.request.identifier)) return;
      handled.add(res.notification.request.identifier);
      openFor(res, qc, router);
    });

    return () => {
      received.remove();
      tapped.remove();
    };
  }, [qc, router]);

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
        openFor(res, qc, router);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [connected, qc, router]);
}

/** Open the job a tapped notification was about. */
function openFor(
  res: Notifications.NotificationResponse,
  qc: QueryClient,
  router: ReturnType<typeof useRouter>
) {
  qc.invalidateQueries({ queryKey: ['orders'] });

  const data = res.notification.request.content.data as
    | { delivery_order_id?: number | string; status?: string }
    | undefined;
  const id = Number(data?.delivery_order_id);

  // "Moved on to another rider" and "cancelled" are about a job that is no
  // longer this rider's: opening it would only answer `not_found`. The
  // refreshed list is where the news shows.
  if (data?.status === 'passed' || data?.status === 'cancelled') {
    router.replace('/');
    return;
  }

  // Only navigate on a real id — a malformed payload should leave the rider
  // where they are rather than on a broken screen.
  if (Number.isFinite(id) && id > 0) {
    router.push(`/order/${id}`);
  }
}

/** Notification taps already acted on, so a cold-start tap opens its job once. */
const handled = new Set<string>();
