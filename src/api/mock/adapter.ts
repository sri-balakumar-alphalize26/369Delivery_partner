import {
  Action,
  ActionResult,
  ApiAdapter,
  ApiError,
  DeliveryOrder,
  DeliveryStatus,
  DutyResult,
  Identity,
  inBucket,
  LocationResult,
  OrdersResponse,
  OrderTimestamps,
  Rider,
  RiderLocationResult,
  TakeVehicleResult,
  Vehicle,
  VehiclesResponse,
} from '../types';
import {
  MOCK_DELIVERY_OTP,
  MOCK_PICKUP_OTP,
  MOCK_TIMEZONE,
  OMR,
  makeFailed,
  makeOffer,
} from './fixtures';

/**
 * An in-memory stand-in for Odoo, matching the published contract exactly —
 * same statuses, same allowed_actions, same error codes, same field shapes.
 *
 * It exists so the whole app stays testable without a token or a live tunnel,
 * and so the error paths that matter (wrong state, bad OTP, lockout, off duty)
 * can actually be exercised rather than hoped about.
 */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** UTC to the second, the way the contract writes every timestamp. */
const utcNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Toggled from the Profile screen to force the paths that are hard to hit. */
export const mockFlags = {
  /** The next accept loses the race to another rider. */
  stealNextOrder: false,
  offline: false,
};

/**
 * The contract's state table. It lives here, in the fake SERVER — deliberately
 * never in the app, because the app must render `allowed_actions` and nothing else.
 */
const ACTIONS_FOR: Record<DeliveryStatus, Action[]> = {
  // The shop is still on it: the rider waits to be called.
  awaiting_shop: [],
  preparing: [],
  ready: [],
  to_assign: [],
  offered: ['accept', 'decline'],
  accepted: ['verify_pickup_otp', 'report_issue'],
  picked: ['dispatch', 'return_to_shop', 'report_issue'],
  // "Collected by Rider".
  dispatched: ['start_delivery', 'return_to_shop', 'report_issue'],
  // "Rider Near Customer". The code is offered at once, as on the server, but
  // the customer has none until `reachedCustomer` - see `codeSentFor`.
  out_for_delivery: ['verify_delivery_otp', 'return_to_shop', 'report_issue'],
  delivered: [],
  // Only the shop confirms a return, in Odoo — nothing for the rider to do.
  returning: [],
  returned: [],
  cancelled: [],
  // Undocumented but live on res-test1, and terminal like the rest.
  failed: [],
};

/**
 * Finished work. Dropped from `/orders`, and nowhere else to be found: the app
 * has no history call — `ApiAdapter` declares none and neither adapter answers
 * one — so a delivered job leaves the phone entirely.
 *
 * `failed` is legacy: nothing has set it since Odoo module 19.0.6.0.0, where a
 * failed WhatsApp nudge stopped being treated as a failed delivery. Old rows
 * still carry it, so it stays mapped and terminal.
 */
const TERMINAL: DeliveryStatus[] = ['delivered', 'returned', 'cancelled', 'failed'];

/**
 * Jobs whose customer has been sent a delivery code - the server's
 * `sa_arrived_customer_on`, a time on the job rather than a status.
 */
const codeSentFor = new Set<number>();

const rider: Rider = {
  id: 18,
  name: 'API Test Rider',
  mobile: '96899990001',
  kind: 'own',
  on_duty: false,
  duty_since: '',
};

/**
 * Two bikes from the Fleet app, so demo mode shows the vehicle picker the way
 * a server with `delivery_fleet_ops` does. Not required: a rider may skip it.
 */
const VEHICLES: Vehicle[] = [
  { id: 1, name: 'Honda/Wave 110/MCT 4412', plate: 'MCT 4412', model: 'Wave 110', brand: 'Honda', type: 'bike', grounded: false },
  { id: 2, name: 'Yamaha/YBR 125/MCT 7730', plate: 'MCT 7730', model: 'YBR 125', brand: 'Yamaha', type: 'bike', grounded: false },
];

const fleet = {
  vehicle: null as Vehicle | null,
  default_vehicle_id: 1,
  vehicle_required: false,
  proof_required: false,
  features: ['vehicles', 'location', 'geofence', 'fuel', 'proof'],
};

const state = {
  /** Jobs already handed to this rider. */
  orders: [] as DeliveryOrder[],
  /**
   * Confirmed orders with nobody on duty to take them — the contract's
   * "To Dispatch". Two wait from the start, so clocking on demonstrates the
   * thing the endpoint exists for.
   */
  pending: [makeOffer(), makeOffer()] as DeliveryOrder[],
  /** One job that already went wrong, so the unknown-status path is exercised. */
  finished: [makeFailed()] as DeliveryOrder[],
  pickupAttempts: 0,
  deliveryAttempts: 0,
  /** Set once /start has been called, mirroring tracking.enabled. */
  tracking: false,
};

function guard() {
  if (mockFlags.offline) {
    throw new ApiError('network', 'Could not reach the server. Check your connection.');
  }
}

function find(id: number): DeliveryOrder {
  const o =
    state.orders.find((x) => x.delivery_order_id === id) ??
    state.finished.find((x) => x.delivery_order_id === id);
  // The contract returns 404 for another rider's job too — the same answer, deliberately.
  if (!o) throw new ApiError('not_found', 'That job could not be found.', { status: 404 });
  return o;
}

/** Rejects an action the current state does not permit, the way Odoo would. */
function requireAction(o: DeliveryOrder, action: Action) {
  if (!o.allowed_actions.includes(action)) {
    throw new ApiError('wrong_state', 'That is not possible right now.', {
      status: 409,
      statusName: o.delivery_status,
      allowedActions: o.allowed_actions,
    });
  }
}

/**
 * Which `timestamps` field each status writes, where one exists.
 *
 * The names do not line up — status `picked`, field `picked_up` — which is
 * exactly why this is a table rather than an index by status.
 */
const TIMESTAMP_FOR: Partial<Record<DeliveryStatus, keyof OrderTimestamps>> = {
  offered: 'offered',
  accepted: 'accepted',
  picked: 'picked_up',
  dispatched: 'dispatched',
  out_for_delivery: 'out_for_delivery',
  delivered: 'delivered',
};

function advance(o: DeliveryOrder, to: DeliveryStatus): ActionResult {
  o.delivery_status = to;
  o.allowed_actions = ACTIONS_FOR[to];
  o.tracking = { enabled: state.tracking };

  /**
   * Stamp the step, as res-test1 does.
   *
   * The mock advanced the status and left `timestamps` frozen at its fixture
   * values, so a job could reach `delivered` with every field still ''. The
   * server sets these, and the progress rail on the job screen reads them, so
   * a mock that does not is hiding the difference rather than mirroring it.
   *
   * Mapped rather than indexed by status: the status is `picked` and the field
   * is `picked_up`, so `to in o.timestamps` would quietly skip that one step
   * and leave the rail short by a dot. States with no timestamp of their own —
   * `returning`, `cancelled`, `failed` — stamp nothing.
   */
  const stamp = TIMESTAMP_FOR[to];
  if (stamp && o.timestamps) o.timestamps[stamp] = utcNow();
  return {
    status: to,
    allowed_actions: o.allowed_actions,
    tracking: o.tracking,
    message: 'Done.',
  };
}

/**
 * A new job only reaches a rider who is on duty. Off duty it waits in
 * To Dispatch, which is what makes the duty endpoint load-bearing.
 */
function offer() {
  const job = makeOffer();
  if (rider.on_duty) state.orders.push(job);
  else state.pending.push(job);
}

export const mockAdapter: ApiAdapter = {
  // Demo mode has no server to sign in to: no code is sent, and any works.
  async requestCode() {
    return { message: 'Demo mode: any 6 digits will do.', retry_after_seconds: 60 };
  },
  async verifyCode() {},
  async logout() {},

  async me(): Promise<Identity> {
    await wait(200);
    guard();
    return { rider, timezone: MOCK_TIMEZONE, currency: OMR, fleet: { ...fleet } };
  },

  async vehicles(): Promise<VehiclesResponse> {
    await wait(250);
    guard();
    return {
      ...fleet,
      vehicles: VEHICLES,
      preselect_id: fleet.vehicle?.id ?? fleet.default_vehicle_id,
    };
  },

  async riderLocation(): Promise<RiderLocationResult> {
    await wait(150);
    guard();
    return { on_duty: rider.on_duty, poll_after_seconds: 60, has_new_offer: false };
  },

  async takeVehicle(vehicleId): Promise<TakeVehicleResult> {
    await wait(250);
    guard();
    if (!rider.on_duty) throw new ApiError('off_duty', 'You are no longer on duty.');
    const vehicle = VEHICLES.find((v) => v.id === vehicleId);
    if (!vehicle) {
      throw new ApiError('vehicle_unavailable', 'That vehicle is not free now. Pick another one.');
    }
    fleet.vehicle = vehicle;
    return { vehicle, message: `You are riding ${vehicle.plate} now.` };
  },

  async duty(on, vehicleId): Promise<DutyResult> {
    await wait(350);
    guard();

    if (on && vehicleId) {
      const vehicle = VEHICLES.find((v) => v.id === vehicleId);
      if (!vehicle) {
        throw new ApiError('vehicle_unavailable', 'That vehicle is not free now. Pick another one.');
      }
      fleet.vehicle = vehicle;
    }
    if (!on) fleet.vehicle = null;

    rider.on_duty = on;

    if (!on) {
      // Going off duty never takes back a job already accepted — that would
      // strand a parcel mid-route.
      //
      // An un-accepted OFFER is the exception, and this is the half that was
      // missing: `offer()` only hands a job to a rider who is on duty and
      // otherwise leaves it waiting in To Dispatch, and clocking on moves that
      // queue across. Clocking off has to move it back, or offers handed over
      // during an on-duty spell sit on the rider's screen for the life of the
      // session, badged NEW JOB, directly beneath a banner promising that no
      // new jobs will be offered. Nothing is stranded by this: an offer
      // carries no commitment, and the job returns to the pool for whoever
      // clocks on next.
      state.pending.push(...state.orders.filter((o) => o.delivery_status === 'offered'));
      state.orders = state.orders.filter((o) => o.delivery_status !== 'offered');

      rider.duty_since = '';
      return {
        on_duty: false,
        duty_since: '',
        jobs_picked_up: 0,
        message: 'You are off duty. No new jobs will be offered.',
        vehicle: null,
      };
    }

    rider.duty_since = utcNow();

    // Clocking on picks up whatever was waiting.
    const waiting = state.pending.length;
    state.orders.push(...state.pending);
    state.pending = [];

    return {
      on_duty: true,
      duty_since: rider.duty_since,
      jobs_picked_up: waiting,
      message: `You are on duty. ${waiting} job(s) were waiting.`,
      vehicle: fleet.vehicle,
    };
  },

  async orders(): Promise<OrdersResponse> {
    guard();
    const live = [...state.orders, ...state.finished];
    return {
      // Tallied through COUNT_BUCKET rather than a grouping written out again
      // here. Home's tiles open the jobs behind their own number using that same
      // table, and a tile that disagreed with the list it opened would be worse
      // than no tile at all.
      counts: {
        assigned: live.filter((o) => inBucket(o.delivery_status, 'assigned')).length,
        picked_up: live.filter((o) => inBucket(o.delivery_status, 'picked_up')).length,
        out_for_delivery: live.filter((o) =>
          inBucket(o.delivery_status, 'out_for_delivery')
        ).length,
        delivered: live.filter((o) => inBucket(o.delivery_status, 'delivered')).length,
      },
      // All four terminal states are dropped, matching the server again.
      //
      // This filter read `!== 'delivered'` for a while, mirroring a real bug:
      // the server kept returned, cancelled and failed rows in the list
      // forever. That is fixed on their side and verified live, so the mock
      // follows. The app still tolerates a terminal row appearing here —
      // legacy jobs like 530 exist — but it should not be the normal case.
      orders: live.filter(
        (o) => !TERMINAL.includes(o.delivery_status)
      ),
      on_duty: rider.on_duty,
      timezone: MOCK_TIMEZONE,
      server_time: utcNow(),
    };
  },

  async order(id) {
    guard();
    return find(id);
  },

  async accept(id) {
    await wait(400);
    guard();
    const o = find(id);
    requireAction(o, 'accept');

    if (mockFlags.stealNextOrder) {
      mockFlags.stealNextOrder = false;
      state.orders = state.orders.filter((x) => x.delivery_order_id !== id);
      setTimeout(offer, 6000);
      throw new ApiError('wrong_state', 'Another rider has already taken this job.', {
        status: 409,
        statusName: 'offered',
        allowedActions: [],
      });
    }

    return advance(o, 'accepted');
  },

  async decline(id) {
    await wait(400);
    guard();
    const o = find(id);
    requireAction(o, 'decline');
    // Passed to "another rider": gone from this one's list, and a fresh offer
    // turns up a little later so the demo never runs dry.
    state.orders = state.orders.filter((x) => x.delivery_order_id !== id);
    setTimeout(offer, 8000);
    return {
      status: 'offered',
      allowed_actions: [],
      removed: true,
      message: 'Declined. The job was passed on.',
    };
  },

  async arrivedAtShop(id) {
    await wait(300);
    guard();
    const o = find(id);
    requireAction(o, 'verify_pickup_otp');
    state.pickupAttempts = 0;
    return {
      status: o.delivery_status,
      allowed_actions: o.allowed_actions,
      message: 'The shop has been sent the pickup code.',
      retry_after_seconds: 60,
      resent: true,
    };
  },

  async requestPickupOtp(id) {
    await wait(400);
    guard();
    const o = find(id);
    requireAction(o, 'verify_pickup_otp');
    state.pickupAttempts = 0;
    return {
      status: o.delivery_status,
      allowed_actions: o.allowed_actions,
      message: 'The shop has been sent the pickup code.',
      // The server enforces a 60s window and returns what is left of it on
      // every call, so the app can time the button instead of leaving one that
      // silently does nothing.
      retry_after_seconds: 60,
    };
  },

  async verifyPickupOtp(id, otp) {
    await wait(400);
    guard();
    const o = find(id);
    requireAction(o, 'verify_pickup_otp');

    if (otp !== MOCK_PICKUP_OTP) {
      state.pickupAttempts += 1;
      throw new ApiError(
        'bad_otp',
        state.pickupAttempts >= 5
          ? 'Too many wrong attempts. Ask the shop for a new code.'
          : 'Invalid or expired code.',
        { status: 400, statusName: o.delivery_status, allowedActions: o.allowed_actions }
      );
    }

    state.pickupAttempts = 0;
    return advance(o, 'picked');
  },

  async dispatch(id) {
    await wait(350);
    guard();
    const o = find(id);
    requireAction(o, 'dispatch');
    return advance(o, 'dispatched');
  },

  async start(id) {
    await wait(350);
    guard();
    const o = find(id);
    requireAction(o, 'start_delivery');
    // This is the moment tracking becomes permitted — never before.
    state.tracking = true;
    return advance(o, 'out_for_delivery');
  },

  async reachedCustomer(id) {
    await wait(400);
    guard();
    const o = find(id);
    // The server's `/arrived {point: "customer"}`: only on the way to the door.
    if (o.delivery_status !== 'out_for_delivery') {
      throw new ApiError('wrong_state', 'That is not possible right now.', {
        status: 409,
        statusName: o.delivery_status,
        allowedActions: o.allowed_actions,
      });
    }
    // Again = a fresh code, so the count of wrong tries starts over.
    state.deliveryAttempts = 0;
    codeSentFor.add(id);
    o.reached_customer_on = utcNow();
    return {
      status: o.delivery_status,
      allowed_actions: o.allowed_actions,
      tracking: o.tracking,
      message: 'The customer has been sent their code on WhatsApp.',
    };
  },

  async verifyDeliveryOtp(id, otp) {
    await wait(500);
    guard();
    const o = find(id);
    requireAction(o, 'verify_delivery_otp');

    // No code has been sent, so none can be right - the server's otp_required.
    if (!codeSentFor.has(id)) {
      throw new ApiError(
        'otp_required',
        'The customer has no code yet. Tap Reached when you are at the door.',
        { status: 409, statusName: o.delivery_status, allowedActions: o.allowed_actions }
      );
    }

    if (otp !== MOCK_DELIVERY_OTP) {
      state.deliveryAttempts += 1;
      throw new ApiError(
        'bad_otp',
        state.deliveryAttempts >= 5
          ? 'Too many wrong attempts. Contact the office.'
          : 'Invalid or expired code.',
        { status: 400, statusName: o.delivery_status, allowedActions: o.allowed_actions }
      );
    }

    state.deliveryAttempts = 0;
    state.tracking = false;
    const res = advance(o, 'delivered');
    res.message = 'Delivery completed successfully';
    res.delivered_at = utcNow();
    o.delivered_at = res.delivered_at;

    // A fresh job turns up shortly, so the loop can be walked repeatedly.
    setTimeout(offer, 8000);
    return res;
  },

  async sendLocation(id): Promise<LocationResult> {
    guard();
    const o = find(id);
    return {
      stop: o.delivery_status !== 'out_for_delivery',
      status: o.delivery_status,
    };
  },

  // Demo mode has no server to register with. Accepting and discarding keeps
  // the adapter interface honest without pretending a token was stored.
  async registerPush() {},
  async unregisterPush() {},

  async uploadProof() {
    await wait(600);
    guard();
    return { attachment_id: Date.now() };
  },

  async fuelReport({ liters }) {
    await wait(400);
    guard();
    if (!fleet.vehicle) {
      throw new ApiError('no_vehicle', 'Take a vehicle first — fuel is logged against the bike you are riding.');
    }
    return { log_id: Date.now(), message: `Fuel logged: ${liters} L.` };
  },

  async vehicleIssue({ grounded }) {
    await wait(400);
    guard();
    if (!fleet.vehicle) {
      throw new ApiError('no_vehicle', 'Take a vehicle first — problems are logged against the bike you are riding.');
    }
    if (grounded) fleet.vehicle = { ...fleet.vehicle, grounded: true };
    return {
      log_id: Date.now(),
      grounded: !!grounded,
      message: grounded
        ? 'Reported. The vehicle is marked as not rideable; the office will follow up.'
        : 'Reported. The office will follow up.',
    };
  },

  async returnToShop(id) {
    await wait(350);
    guard();
    const o = find(id);
    requireAction(o, 'return_to_shop');
    state.tracking = false;
    return advance(o, 'returning');
  },

  async confirmReturn(id) {
    await wait(350);
    guard();
    const o = find(id);
    requireAction(o, 'confirm_return');
    return advance(o, 'returned');
  },

  async reportIssue(id) {
    await wait(300);
    guard();
    const o = find(id);
    // Logs a problem without changing state, per the contract.
    return {
      status: o.delivery_status,
      allowed_actions: o.allowed_actions,
      message: 'Reported. The office has been told.',
    };
  },
};
