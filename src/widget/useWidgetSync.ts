import { useEffect } from 'react';
import { useOrders } from '../hooks/useOrders';
import { photoRef } from '../lib/photoName';
import { useSession } from '../store/session';
import { updateWidget } from './widgetTask';

/**
 * Keeps the home-screen widget in step with the app: duty, today's deliveries
 * and the job in hand, whenever the job list refreshes.
 */
export function useWidgetSync(connected: boolean): void {
  const { data } = useOrders();
  const onDuty = useSession((s) => !!s.rider?.on_duty);
  const job = data?.orders?.find((o) => o.delivery_status !== 'offered');
  const first = job?.customer_name?.trim().split(/\s+/)[0];
  const now = job ? `${photoRef(job)} → ${first ?? ''}`.trim() : null;
  const deliveredToday = data?.counts?.delivered_today ?? 0;

  useEffect(() => {
    if (!connected) return;
    void updateWidget({ onDuty: data?.on_duty ?? onDuty, deliveredToday, now });
  }, [connected, onDuty, data?.on_duty, deliveredToday, now]);
}
