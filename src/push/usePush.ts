import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { registerForPush } from './register';

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
    const received = Notifications.addNotificationReceivedListener(() => {
      lastPushAt = Date.now();
      qc.invalidateQueries({ queryKey: ['orders'] });
    });

    // Tapping the banner should land on the job it was about.
    const tapped = Notifications.addNotificationResponseReceivedListener((res) => {
      qc.invalidateQueries({ queryKey: ['orders'] });

      const data = res.notification.request.content.data as
        | { delivery_order_id?: number | string }
        | undefined;
      const id = Number(data?.delivery_order_id);

      // Only navigate on a real id — a malformed payload should leave the rider
      // where they are rather than on a broken screen.
      if (Number.isFinite(id) && id > 0) {
        router.push(`/order/${id}`);
      }
    });

    return () => {
      received.remove();
      tapped.remove();
    };
  }, [qc, router]);
}
