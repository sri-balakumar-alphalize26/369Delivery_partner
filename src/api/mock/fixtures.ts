import { Currency, DeliveryOrder, Shop } from "../types";

/**
 * Shaped exactly like the live examples in the contract, down to the currency
 * object and the Muscat addresses, so switching adapters changes nothing on
 * screen — and so a wrong assumption about a field shape fails here rather
 * than on a rider's phone.
 */

/** The contract's own example, verbatim. OMR is a three-decimal currency. */
export const OMR: Currency = { code: "OMR", symbol: "ر.ع.", decimals: 3 };

export const MOCK_TIMEZONE = "Asia/Muscat";

/**
 * Real Muscat coordinates for the demo, and the one place this mock knowingly
 * runs ahead of res-test1.
 * Every other field here mirrors the server exactly, on the principle that a
 * mock which carries the shape the app assumes hides the bugs worth finding.
 * These do not: the server returns null for all of them, because nothing
 * geocodes an address yet. They are here because the map cannot be seen or
 * demonstrated without them, and waiting for the backend would mean shipping a
 * map nobody has ever watched work.
 *
 * When the backend does start geocoding, these become redundant rather than
 * wrong, and the real values simply take over.
 */
const MUSCAT = {
  /** Al Khuwair, where the branch sits. */
  shop: { latitude: 23.5975, longitude: 58.4187 },
  /** One per delivery address below, in the same order. */
  deliveries: [
    { latitude: 23.6139, longitude: 58.5922 }, // Old Muscat, the long run
    { latitude: 23.588, longitude: 58.429 }, // Al Khuwair, minutes away
    { latitude: 23.5906, longitude: 58.545 }, // Ruwi, across town
  ],
} as const;

/**
 * The shop object as res-test1 actually returns it — an object since the
 * backend shipped N2, with no image on any row yet.
 *
 * It is the object rather than the old string on purpose. The mock hid the
 * currency object and the nested order envelope by carrying the shape the app
 * assumed instead of the shape the server sends; it must not hide a third.
 */
export const MOCK_SHOP: Shop = {
  id: 12,
  name: "Muscat Branch",
  image_url: null,
  latitude: MUSCAT.shop.latitude,
  longitude: MUSCAT.shop.longitude,
  address: "",
  phone: "96899990000",
};

let seq = 524;

/** A UTC timestamp `mins` from now, with the Z the contract says every datetime carries. */
function minutesFromNow(mins: number): string {
  return new Date(Date.now() + mins * 60_000).toISOString();
}

export function makeOffer(): DeliveryOrder {
  seq += 1;
  const cod = seq % 2 === 1;

  return {
    delivery_order_id: seq,
    delivery_order_name: `WH/OUT/${String(seq - 515).padStart(5, "0")}`,
    job_code: "DEL",
    sales_order: `S000${seq - 452}`,
    customer_name: ["API Demo Customer", "Fatma Al Balushi", "Said Al Hinai"][
      seq % 3
    ],
    customer_mobile: "+96891234567",
    delivery_address: [
      "Building #12, Street 45, Muscat",
      "Villa 8, Way 3021, Al Khuwair",
      "Flat 402, Al Wadi Tower, Ruwi",
    ][seq % 3],
    shop: MOCK_SHOP,
    items_summary: "3 item(s) - 4 unit(s)",
    payment_status: cod ? "cod" : "paid",
    amount_to_collect: cod ? 12.5 : 0,
    currency: OMR,
    delivery_status: "offered",
    delivery_type: seq % 2 === 0 ? "quick" : "express",
    /**
     * Relative to now, not a fixed date.
     *
     * This was pinned to 2026-09-05, so once the countdown landed every demo job
     * read as days overdue and the label was useless. The offsets show both
     * states: one comfortably ahead, one tight, one already late, so the red
     * case is visible without waiting for a promise to expire.
     */
    promised_by: minutesFromNow([12, 35, -6][seq % 3]),
    allowed_actions: ["accept"],
    products: [
      { name: "Amul Gold Milk 500ml", quantity: 2, uom: "Units" },
      { name: "Brown Bread", quantity: 1, uom: "Units" },
      { name: "Farm Eggs (6 pcs)", quantity: 1, uom: "Units" },
    ],
    // Still null on every res-test1 row. Set here so the map has a destination
    // to draw, and kept in step with the address chosen above — a pin that
    // disagrees with the written address is worse than no pin.
    latitude: MUSCAT.deliveries[seq % 3].latitude,
    longitude: MUSCAT.deliveries[seq % 3].longitude,
    tracking: { enabled: false },
    // The detail call carries these. An empty string means "not yet" — the
    // server sends the key regardless, so the app must not treat "" as missing.
    timestamps: {
      offered: "2026-09-03T09:23:27Z",
      accepted: "",
      picked_up: "",
      dispatched: "",
      out_for_delivery: "",
      delivered: "",
    },
  };
}

/**
 * A job that ended badly. `failed` is not in the published contract but is
 * live on res-test1, so the demo carries one — otherwise the app is never
 * shown a status it does not recognise until a rider hits one.
 */
export function makeFailed(): DeliveryOrder {
  const job: DeliveryOrder = {
    ...makeOffer(),
    delivery_status: "failed",
    allowed_actions: [],
  };
  // Recorded because a terminal job is no longer returned by /orders, so a
  // test cannot discover its id from the list any more — only fetch it.
  mockFailedId = job.delivery_order_id;
  return job;
}

/** The id of the seeded `failed` job, once one has been made. */
export let mockFailedId = 0;

/**
 * Both codes are 6 digits, matching the contract.
 *
 * Deliberately the same trivial number for both, and only because this is the
 * demo: nobody presenting the app should be reading a code off a card while a
 * room watches. The real codes come from Odoo over WhatsApp and are never
 * these.
 */
export const MOCK_PICKUP_OTP = "111111";
export const MOCK_DELIVERY_OTP = "111111";
