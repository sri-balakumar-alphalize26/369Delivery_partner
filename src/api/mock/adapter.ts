import {
  Action,
  ActionResult,
  ApiAdapter,
  ApiError,
  DeliveryOrder,
  DeliveryStatus,
  DutyResult,
  Identity,
  LocationResult,
  OrdersResponse,
  Rider,
} from '../types';
import {
  MOCK_DELIVERY_OTP,
  MOCK_PICKUP_OTP,
  MOCK_TIMEZONE,
  OMR,
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
  offered: ['accept'],
  accepted: ['verify_pickup_otp', 'report_issue'],
  picked: ['dispatch', 'return_to_shop', 'report_issue'],
  dispatched: ['start_delivery', 'return_to_shop', 'report_issue'],
  out_for_delivery: ['verify_delivery_otp', 'return_to_shop', 'report_issue'],
  delivered: [],
  returning: ['confirm_return'],
  returned: [],
  cancelled: [],
};

const rider: Rider = {
  id: 18,
  name: 'API Test Rider',
  mobile: '96899990001',
  kind: 'own',
  on_duty: false,
  duty_since: '',
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
  const o = state.orders.find((x) => x.delivery_order_id === id);
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

function advance(o: DeliveryOrder, to: DeliveryStatus): ActionResult {
  o.delivery_status = to;
  o.allowed_actions = ACTIONS_FOR[to];
  o.tracking = { enabled: state.tracking };
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
  async me(): Promise<Identity> {
    await wait(200);
    guard();
    return { rider, timezone: MOCK_TIMEZONE, currency: OMR };
  },

  async duty(on): Promise<DutyResult> {
    await wait(350);
    guard();

    rider.on_duty = on;

    if (!on) {
      // Going off duty never takes back a job already accepted — that would
      // strand a parcel mid-route. It only stops new work being offered.
      rider.duty_since = '';
      return {
        on_duty: false,
        duty_since: '',
        jobs_picked_up: 0,
        message: 'You are off duty. No new jobs will be offered.',
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
    };
  },

  async orders(): Promise<OrdersResponse> {
    guard();
    const live = state.orders;
    return {
      counts: {
        assigned: live.filter((o) => ['offered', 'accepted'].includes(o.delivery_status))
          .length,
        picked_up: live.filter((o) => ['picked', 'dispatched'].includes(o.delivery_status))
          .length,
        out_for_delivery: live.filter((o) => o.delivery_status === 'out_for_delivery')
          .length,
        delivered: live.filter((o) => o.delivery_status === 'delivered').length,
      },
      // Finished work belongs to /history, not to the active list — otherwise a
      // returned job sits on the rider's screen forever.
      orders: live.filter(
        (o) => !['delivered', 'returned', 'cancelled'].includes(o.delivery_status)
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

  async verifyDeliveryOtp(id, otp) {
    await wait(500);
    guard();
    const o = find(id);
    requireAction(o, 'verify_delivery_otp');

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
