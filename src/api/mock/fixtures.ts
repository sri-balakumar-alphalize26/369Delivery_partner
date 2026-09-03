import { Currency, DeliveryOrder, Shop } from '../types';

/**
 * Shaped exactly like the live examples in the contract, down to the currency
 * object and the Muscat addresses, so switching adapters changes nothing on
 * screen — and so a wrong assumption about a field shape fails here rather
 * than on a rider's phone.
 */

/** The contract's own example, verbatim. OMR is a three-decimal currency. */
export const OMR: Currency = { code: 'OMR', symbol: 'ر.ع.', decimals: 3 };

export const MOCK_TIMEZONE = 'Asia/Muscat';

/**
 * The shop object as res-test1 actually returns it — an object since the
 * backend shipped N2, with no image and no coordinates on any row yet.
 *
 * It is the object rather than the old string on purpose. The mock hid the
 * currency object and the nested order envelope by carrying the shape the app
 * assumed instead of the shape the server sends; it must not hide a third.
 */
export const MOCK_SHOP: Shop = {
  id: 12,
  name: 'Muscat Branch',
  image_url: null,
  latitude: null,
  longitude: null,
  address: '',
  phone: '96899990000',
};

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
    shop: MOCK_SHOP,
    items_summary: '3 item(s) - 4 unit(s)',
    payment_status: cod ? 'cod' : 'paid',
    amount_to_collect: cod ? 12.5 : 0,
    currency: OMR,
    delivery_status: 'offered',
    delivery_type: seq % 2 === 0 ? 'quick' : 'express',
    // UTC, with the Z the contract says every datetime carries.
    promised_by: '2026-09-05T12:48:26Z',
    allowed_actions: ['accept'],
    products: [
      { name: 'Amul Gold Milk 500ml', quantity: 2, uom: 'Units' },
      { name: 'Brown Bread', quantity: 1, uom: 'Units' },
      { name: 'Farm Eggs (6 pcs)', quantity: 1, uom: 'Units' },
    ],
    // Null on every res-test1 row — no delivery address has been geocoded, so
    // the app must navigate by address. Was 0.0, which maps as the Atlantic.
    latitude: null,
    longitude: null,
    tracking: { enabled: false },
    // The detail call carries these. An empty string means "not yet" — the
    // server sends the key regardless, so the app must not treat "" as missing.
    timestamps: {
      offered: '2026-09-03T09:23:27Z',
      accepted: '',
      picked_up: '',
      dispatched: '',
      out_for_delivery: '',
      delivered: '',
    },
  };
}

/**
 * A job that ended badly. `failed` is not in the published contract but is
 * live on res-test1, so the demo carries one — otherwise the app is never
 * shown a status it does not recognise until a rider hits one.
 */
export function makeFailed(): DeliveryOrder {
  return {
    ...makeOffer(),
    delivery_status: 'failed',
    allowed_actions: [],
  };
}

/** Both codes are 6 digits, matching the contract. */
export const MOCK_PICKUP_OTP = '482913';
export const MOCK_DELIVERY_OTP = '739214';
