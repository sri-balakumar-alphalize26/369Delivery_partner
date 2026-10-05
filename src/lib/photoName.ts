import { DeliveryOrder } from '../api/types';

/**
 * The order number a photo is filed under: the sale order the shop knows it by
 * ("S00042"), else the delivery's own name. Slashes and spaces would make a
 * path or a broken name on the server, so they go.
 */
export function photoRef(order: Pick<DeliveryOrder, 'sales_order' | 'delivery_order_name' | 'delivery_order_id'>): string {
  const raw = order.sales_order || order.delivery_order_name || `order${order.delivery_order_id}`;
  return raw.replace(/[\/\\\s]+/g, '-');
}

/**
 * `<order>_<DDMMYY>_<HHmmss>.jpg`, in 24-hour time, in the shop's zone:
 * `S00042_051026_173915.jpg`. The owner's rule - the server keeps the name as
 * sent, and it is how the office finds a photo.
 *
 * Stamped when the photo is taken, not when it is sent: a photo sent an hour
 * later from somewhere with signal still says when the parcel looked like that.
 */
export function photoFileName(ref: string, takenAt: Date, timeZone?: string): string {
  let parts: Record<string, string>;
  try {
    parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(takenAt)
        .map((p) => [p.type, p.value])
    );
  } catch {
    // An unknown zone name throws; the phone's own clock is the next best.
    const two = (n: number) => String(n).padStart(2, '0');
    parts = {
      day: two(takenAt.getDate()),
      month: two(takenAt.getMonth() + 1),
      year: two(takenAt.getFullYear() % 100),
      hour: two(takenAt.getHours()),
      minute: two(takenAt.getMinutes()),
      second: two(takenAt.getSeconds()),
    };
  }
  const { day, month, year, hour, minute, second } = parts;
  return `${ref}_${day}${month}${year}_${hour}${minute}${second}.jpg`;
}
