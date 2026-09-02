import { DeliveryOrder } from '../types';

/**
 * Shaped exactly like the live examples in the contract, down to the currency
 * and the Muscat addresses, so switching adapters changes nothing on screen.
 */

let seq = 524;

export function makeOffer(): DeliveryOrder {
  seq += 1;
  const cod = seq % 2 === 1;

  return {
    delivery_order_id: seq,
    delivery_order_name: `WH/OUT/${String(seq - 515).padStart(5, '0')}`,
    job_code: 'DEL',
    sales_order: `S000${seq - 452}`,
    customer_name: ['API Demo Customer', 'Fatma Al Balushi', 'Said Al Hinai'][seq % 3],
    customer_mobile: '+96891234567',
    delivery_address: [
      'Building #12, Street 45, Muscat',
      'Villa 8, Way 3021, Al Khuwair',
      'Flat 402, Al Wadi Tower, Ruwi',
    ][seq % 3],
    shop: 'Muscat Branch',
    payment_status: cod ? 'cod' : 'paid',
    amount_to_collect: cod ? 12.5 : 0,
    currency: 'OMR',
    delivery_status: 'offered',
    delivery_type: seq % 2 === 0 ? 'quick' : 'express',
    promised_by: '2026-09-05T12:48:26',
    allowed_actions: ['accept'],
    products: [
      { name: 'Amul Gold Milk 500ml', quantity: 2, uom: 'Units' },
      { name: 'Brown Bread', quantity: 1, uom: 'Units' },
      { name: 'Farm Eggs (6 pcs)', quantity: 1, uom: 'Units' },
    ],
    latitude: 23.588,
    longitude: 58.3829,
    tracking: { enabled: false },
  };
}

/** Both codes are 6 digits, matching the contract. */
export const MOCK_PICKUP_OTP = '482913';
export const MOCK_DELIVERY_OTP = '739214';
