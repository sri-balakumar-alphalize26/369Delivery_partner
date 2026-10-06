import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  Pressable,
  ScrollView,
  useWindowDimensions,
  Vibration,
  View,
} from 'react-native';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomInset } from '../../../src/hooks/useBottomInset';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { peekServer } from '../../../src/api/config';
import { api } from '../../../src/api/endpoints';
import {
  enqueue,
  isQueueable,
  OutboxEntry,
  stepLabel,
  usePendingStep,
} from '../../../src/api/outbox';
import { openNavigation, openWhatsApp, whatsappUrl } from '../../../src/lib/navigate';
import {
  ACTION_LABEL,
  Action,
  ActionResult,
  ApiError,
  DeliveryOrder,
  DropPoint,
  DECLINE_REASONS,
  DELIVERY_REASONS,
  headingFor,
  isAtShop,
  isDropLocked,
  JobProblem,
  JobReport,
  Money,
  PRIMARY_ACTIONS,
  stopLabel,
  trackingWanted,
} from '../../../src/api/types';
import {
  dueIn,
  money,
  coords,
  promisedAt,
  routeSummary,
  shopInfo,
  shopName,
  shopPhone,
  timeOnly,
} from '../../../src/lib/format';
import { useNow } from '../../../src/hooks/useNow';
import { secondsUntil, serverNow } from '../../../src/lib/clock';
import {
  hasLocationPermission,
  keepTracking,
  startTracking,
  stopTracking,
  trackedOrderId,
} from '../../../src/location/tracking';
import { stopOfferAlert } from '../../../src/hooks/useOfferAlert';
import { shopTimeZone, useSession } from '../../../src/store/session';
import { photoProblem, takePhoto } from '../../../src/ui/takePhoto';
import * as Notifications from 'expo-notifications';
import { playNearCustomer } from '../../../src/lib/sounds';
import { claimNearAuto } from '../../../src/push/nearAutoLedger';
import { TRIP_CHANNEL, ensureTripChannel } from '../../../src/push/register';
import {
  GlassBarState,
  glass,
  glassBand,
  gradius,
  gshadow,
  gspace,
} from '../../../src/theme/glass';
import { Field } from '../../../src/ui/Field';
import { confirm, notice as showNotice } from '../../../src/ui/ConfirmSheet';
import { LoadingArt } from '../../../src/ui/LoadingArt';
import { LocationPrimer } from '../../../src/ui/LocationPrimer';
import { CodeSheet } from '../../../src/ui/CodeSheet';
import { ServerPhoto } from '../../../src/ui/ServerPhoto';
import { LocationAlwaysBanner } from '../../../src/ui/LocationAlwaysBanner';
import { SosShield } from '../../../src/ui/SosSheet';
import { QuickReplies } from '../../../src/ui/QuickReplies';
import { useTripNotification } from '../../../src/push/useTripNotification';
import { OtpInput } from '../../../src/ui/OtpInput';
import { MAP_ENABLED, RouteMap } from '../../../src/ui/RouteMap';
import { owePhotos, PhotoStage } from '../../../src/photos/owed';
import { photoFileName, photoRef } from '../../../src/lib/photoName';
import { Image } from 'expo-image';
import { PayQr } from '../../../src/ui/PayQr';
import { currentFix } from '../../../src/location/currentFix';
import { metresBetween } from '../../../src/lib/routeGeometry';
import { hasFeature } from '../../../src/api/features';
import { GlassButton } from '../../../src/ui/glass/GlassButton';
import { GlassCard } from '../../../src/ui/glass/GlassCard';
import { GlassCheckRow } from '../../../src/ui/glass/GlassCheckRow';
import { GlassHeader } from '../../../src/ui/glass/GlassHeader';
import { GlassIcon, GlassIconName } from '../../../src/ui/glass/GlassIcon';
import { GlassPill } from '../../../src/ui/glass/GlassPill';
import { GlassProgress } from '../../../src/ui/glass/GlassProgress';
import { GlassScreen } from '../../../src/ui/glass/GlassScreen';
import { GlassText } from '../../../src/ui/glass/GlassText';

/**
 * The job screen, in the Glass Light style.
 *
 * Every button on it still comes from `allowed_actions`. There is no local
 * state machine and no "what comes next" logic — the contract's first rule is
 * that Odoo decides the workflow and the app renders it, so when the flow
 * changes in Odoo this screen follows with no new release.
 *
 * Three layouts, chosen by which action Odoo is offering rather than by any
 * state we keep: the offer screen while the job is only offered, the handover
 * screen when the delivery code is due, and the sheet-over-map for everything
 * between.
 *
 * The per-trip fee ("You earn") is drawn only when the server sends
 * `rider_fee` — Delivery Partners only, worked out on the server, never here.
 */

/**
 * Navigate to wherever the rider is heading next: the shop until the parcel is
 * collected (or while it goes back), the customer after.
 *
 * This always opened the customer's address — including from the button beside
 * the SHOP's name on the pickup sheet, sending a rider on their way to collect
 * straight past the shop. The shop's pin is real; customer rows still carry no
 * coordinates, so they fall back to the written address inside
 * `openNavigation`.
 *
 * The start is filled in too: where the rider is, from the map's own fix; or,
 * on the way to the customer before a fix arrives, the shop they just left.
 * With neither, Google Maps uses its own "Your location".
 *
 * On the way to a customer it also tells the server this is where the rider is
 * going now (`heading`), so an Express customer's tracking page goes live and
 * they get "You're next". `onHeading` refreshes the list's stop numbers.
 */
function navigateTo(
  order: DeliveryOrder,
  riderAt: { latitude: number; longitude: number } | null,
  onHeading?: () => void
) {
  const shop = shopInfo(order.shop);
  if (headingFor(order.delivery_status) === 'shop') {
    void openNavigation({
      latitude: shop?.latitude,
      longitude: shop?.longitude,
      address: shop?.address || shopName(order.shop),
      origin: riderAt,
    });
  } else {
    tellHeading(order, onHeading);
    const shopAt = coords(shop?.latitude, shop?.longitude);
    void openNavigation({
      latitude: order.latitude,
      longitude: order.longitude,
      address: order.delivery_address,
      origin: riderAt ?? shopAt,
    });
  }
}

/**
 * The job `heading` was last sent for, this app session. One value, not a set:
 * the server keeps a single current stop, so going A, then B, then back to A
 * must send A again.
 */
let headingSentTo: number | null = null;

/** Parcel on the road: the only states the server takes `heading` in. */
const ON_ROAD: readonly DeliveryOrder['delivery_status'][] = [
  'picked',
  'dispatched',
  'out_for_delivery',
];

/**
 * Best effort and silent: nothing waits on it and a failure shows nothing,
 * because without it the server takes the nearest drop as next. A failed send
 * is forgotten so the next tap tries again.
 */
function tellHeading(order: DeliveryOrder, onDone?: () => void) {
  const id = order.delivery_order_id;
  if (!ON_ROAD.includes(order.delivery_status)) return;
  if (order.is_current_stop || headingSentTo === id) return;
  headingSentTo = id;
  void api.heading(id).then((r) => {
    if (r.success) onDone?.();
    else if (headingSentTo === id) headingSentTo = null;
  });
}

/**
 * How wide the reading column may get.
 *
 * The map wants the whole width; text does not. Only binds on a tablet — a phone
 * is narrower than this and is unaffected.
 */
const SHEET_MAX_W = 720;

/**
 * Jobs whose shop has been sent a pickup code this app session.
 *
 * The code used to reach the shop only when the rider tapped "resend": nothing
 * else issued it, so a rider opened the code panel at the counter and the shop
 * had nothing to read out. Opening the panel now tells Odoo the rider has
 * arrived, once per job. Module-level so leaving the screen and coming back
 * does not send a second code that voids the one the shop is holding.
 *
 * The older `rider_request` handover only. In branch mode (the default since
 * delivery 19.0.22.0.0) the arrival is its own button, "I'm at the counter".
 */
const shopToldFor = new Set<number>();

/** Jobs whose "the counter has your code" has already buzzed - once each. */
const codeReadyFor = new Set<number>();

/** Arrival prompts already announced with a buzz, per job - once each. */
const buzzedFor = new Set<string>();

/** How close counts, per prompt: the shop door, the street, the doorstep. */
const AT_SHOP_M = 150;
const NEAR_CUSTOMER_M = 300;
const AT_DOOR_M = 50;

/** Seconds before the customer can be sent another code, when the server names none. */
const RESEND_WAIT_S = 60;

/** What the rider reads when a resend is refused and the server gave no words. */
const RESEND_REFUSED: Record<string, string> = {
  whatsapp_failed: 'WhatsApp did not send the code. Try again in a moment, or call the customer.',
  too_soon: 'A code was sent a moment ago. Wait for the timer, then try again.',
  limit: 'No more codes can be sent for this job. Call the office if the customer still has none.',
  wrong_state: 'Press Reached first, then ask for a new code.',
};

/** Metres as a rider reads them: "650 m", "1.2 km". */
function distanceText(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`;
}


/**
 * At the counter in branch mode, with the arrival told and no code yet: the
 * branch has still to press Dispatch.
 */
function waitingForBranch(order: DeliveryOrder | undefined): boolean {
  return (
    !!order &&
    order.pickup_handover === 'branch' &&
    !!order.arrived_at_shop &&
    !order.pickup_code_ready &&
    order.allowed_actions.includes('verify_pickup_otp')
  );
}

type ArrivalPrompt = { kind: 'shop' | 'near' | 'door'; metres: number };

/**
 * Which arrival prompt applies, if any: at the shop with the pickup code due,
 * close to the customer before "near", at the door before "Reached". Only a
 * prompt - the rider still taps. GPS wanders by tens of metres, and a wrong
 * "near" would message the customer for nothing; the big delivery apps gate
 * these steps on distance but leave the swipe to the rider for the same reason.
 */
function arrivalPrompt(
  order: DeliveryOrder,
  override: Action[] | null,
  at: { latitude: number; longitude: number } | null,
  reachedHere: boolean
): ArrivalPrompt | null {
  if (!at) return null;
  const actions = override ?? order.allowed_actions;
  const primary = PRIMARY_ACTIONS.find((a) => actions.includes(a)) ?? null;
  const shop = shopInfo(order.shop);
  const shopAt = coords(shop?.latitude, shop?.longitude);
  const customerAt = coords(order.latitude, order.longitude);
  if (primary === 'verify_pickup_otp' && shopAt) {
    const m = metresBetween(at, shopAt);
    return m <= AT_SHOP_M ? { kind: 'shop', metres: m } : null;
  }
  if (primary === 'start_delivery' && customerAt) {
    const m = metresBetween(at, customerAt);
    return m <= NEAR_CUSTOMER_M ? { kind: 'near', metres: m } : null;
  }
  const reached = reachedHere || !!order.reached_customer_on;
  if (primary === 'verify_delivery_otp' && !reached && customerAt) {
    const m = metresBetween(at, customerAt);
    return m <= AT_DOOR_M ? { kind: 'door', metres: m } : null;
  }
  return null;
}

/** Why tracking would not start, in words a rider can act on. */
const TRACKING_ERROR: Record<
  Exclude<Awaited<ReturnType<typeof startTracking>>, { ok: true }>['reason'],
  string
> = {
  services_off: 'Location is switched off on this phone. Turn it on to start the delivery.',
  foreground_denied: 'This delivery needs your location. Allow it to carry on.',
  background_denied:
    'Location must be allowed "All the time" so the shop can follow the delivery while the app is closed.',
};

export default function Job() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = Number(id);
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  // After `heading`: every job's stop number may have moved, not just this one's.
  const refreshRun = () => {
    void qc.invalidateQueries({ queryKey: ['orders'] });
    void qc.invalidateQueries({ queryKey: ['order', orderId] });
  };

  /**
   * The real distance to the bottom of the screen.
   *
   * `useSafeAreaInsets` is reduced by whatever the navigator thinks is sitting
   * down there, and this route hides the tab bar — so the bar stopped occupying
   * the strip while the inset stayed spent on it, and the secondary actions were
   * drawn inside Android's navigation bar. Measured on a screenshot: ink at
   * y=1890-1908 on a 1920-tall screen. `initialWindowMetrics` reports the window
   * as the OS sees it, unadjusted, so the larger of the two is always safe.
   */
  const bottomInset = useBottomInset();
  const { height: screenH } = useWindowDimensions();
  // The shop's zone, from /auth/me — never the phone's own.
  const timezone = useSession((s) => s.timezone);
  // When the server marks "near the customer" by itself (delivery 19.0.22.1.0).
  const autoNear = useSession((s) => s.autoNear);
  /** Set while the rider waits inside the server's radius, for the faster poll. */
  const waitNearRef = useRef(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  /** Set from a 409 so a stale screen re-renders without a reload. */
  const [override, setOverride] = useState<Action[] | null>(null);
  /**
   * The deadline of the offer whose time ran out on this screen. A deadline,
   * not a flag: the same job offered again comes with a new one, and must not
   * open with its buttons still greyed from the round before.
   */
  const [expiredOffer, setExpiredOffer] = useState<string | null>(null);
  /** Which action is waiting on a reason, if any. */
  const [reasonFor, setReasonFor] = useState<Action | null>(null);
  /** Which action is waiting on the location explainer, if any. */
  const [primerFor, setPrimerFor] = useState<Action | null>(null);
  const [reasonNote, setReasonNote] = useState('');
  /** The reason ticked on the reason screen; nothing is sent until Send. */
  const [reasonPick, setReasonPick] = useState<string | null>(null);
  /** A photo for the report, named like the parcel photos. */
  const [reportShot, setReportShot] = useState<{ uri: string; name: string } | null>(null);
  /** Whether the code panel is up. The code itself still lives in `otp`. */
  const [codeOpen, setCodeOpen] = useState(false);
  /**
   * Good news from the server — "the shop has been sent the code". Shown in
   * the code panel's hint, never in red: this used to go through `error`.
   */
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * When the customer may be sent another code (server clock, ms). Set by
   * Reached and by each resend; the code panel counts down to it.
   */
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [resending, setResending] = useState(false);
  /** The server's words once this job has had all the codes it may (5). */
  const [resendClosed, setResendClosed] = useState<string | null>(null);
  /**
   * "I'm at the counter" went through. The job's own `arrived_at_shop` says
   * so too, but only from the next fetch; this keeps the button from coming
   * back in between.
   */
  const [arrivedHere, setArrivedHere] = useState(false);
  /** "Delivered – enter customer code" tapped before "I am near": the door screen. */
  const [skipToDoor, setSkipToDoor] = useState(false);
  // The screen can be reused for another job; the shortcut belongs to one.
  useEffect(() => setSkipToDoor(false), [orderId]);
  /** The pickup code was accepted: the drop is unlocked. Said once, in green. */
  const [unlockedNote, setUnlockedNote] = useState<string | null>(null);
  /** The customer shared a new place for this delivery: the map has moved. */
  const [dropNote, setDropNote] = useState<string | null>(null);
  /** After "Report a problem": that it reached the office, so the rider is not left guessing. */
  const [reportedNote, setReportedNote] = useState<string | null>(null);

  /**
   * Ticks the countdown. Called up here with the other hooks because the
   * layouts below return early, and a hook after a return runs on some renders
   * and not others.
   */
  const now = useNow();
  /**
   * Which items the rider has ticked off at the counter.
   *
   * Local to this phone and sent nowhere: no field on the contract carries it,
   * and Odoo alone decides whether the pickup may go ahead. Persisted per job,
   * so stepping out of the app at a busy counter does not lose the count.
   * AsyncStorage rather than lib/storage — that one is the OS keystore, which is
   * for the credential, not for a scratch list.
   */
  /**
   * Real distance and time, handed up by the map once the routing service
   * answers. Null whenever there is no route — no key, no signal, or no
   * coordinates to route to — and the screen then claims nothing, as it did
   * before there was any source for these at all.
   */
  const [leg, setLeg] = useState<{ distanceM: number; durationS: number } | null>(null);
  /**
   * Where the phone is: from the job map every few seconds, or on an offer one
   * fix of its own. Drives the arrival prompts and the offer's distances.
   */
  const [riderAt, setRiderAt] = useState<{ latitude: number; longitude: number } | null>(null);

  /**
   * Whether the customer has been sent their delivery code.
   *
   * Odoo offers the code from "Rider Near Customer" on, but sends it only when
   * the rider says they are at the door (`reachedCustomer`), which is never in
   * `allowed_actions`. So the door step is the app's to show: remembered per
   * job, so reopening the screen at the door does not send a second code, and
   * read from the job too when the server sends `reached_customer_on`.
   */
  const reachedKey = `d369.reached.${orderId}`;
  const [reachedHere, setReachedHere] = useState(false);

  function markReached(on: boolean) {
    setReachedHere(on);
    (on ? AsyncStorage.setItem(reachedKey, '1') : AsyncStorage.removeItem(reachedKey)).catch(
      () => {}
    );
  }

  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(reachedKey)
      .then((raw) => {
        if (live && raw) setReachedHere(true);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [reachedKey]);

  /**
   * A step this job tapped with no signal, waiting in the outbox.
   *
   * When a queued "Reached" goes through, `useOutbox` records it under the same
   * key as a live one; re-read it then, so a rider still standing at the door
   * sees the code panel open by itself rather than a button asking to send a
   * code the customer already has.
   */
  const pending = usePendingStep(orderId);
  const pendingBefore = useRef<OutboxEntry | undefined>(undefined);
  useEffect(() => {
    const before = pendingBefore.current;
    pendingBefore.current = pending;
    if (!before || pending || before.step !== 'reached') return;
    AsyncStorage.getItem(reachedKey)
      .then((raw) => {
        if (!raw) return;
        setReachedHere(true);
        setNotice('The customer has been sent their code on WhatsApp.');
        setResendAt(serverNow() + RESEND_WAIT_S * 1000);
        setOtp('');
        setCodeOpen(true);
      })
      .catch(() => {});
  }, [pending, reachedKey]);

  /**
   * Leaving the job counts as having dealt with the offer, so anything still
   * buzzing from `useOfferAlert` stops here.
   */
  useEffect(() => stopOfferAlert, []);

  /**
   * Android's back closes the reason picker or the location explainer, not
   * the job. Both are full-screen early returns rather than modals, so without
   * this the system back popped the whole job — from one question away from
   * the door. The code sheet is a Modal and closes itself.
   */
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (reasonFor) {
        setReasonFor(null);
        return true;
      }
      if (primerFor) {
        setPrimerFor(null);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [reasonFor, primerFor]);

  /**
   * Expo Router reuses this component from one job to the next, so everything
   * above belongs to whichever job was open last until it is cleared. Without
   * this, the empty `allowed_actions` of a job just delivered blanks out every
   * button on the next job opened, and a half-typed code follows the rider
   * from one door to another.
   */
  const [shownFor, setShownFor] = useState(orderId);
  if (shownFor !== orderId) {
    setShownFor(orderId);
    setOverride(null);
    setExpiredOffer(null);
    setOtp('');
    setError(null);
    setOtpError(null);
    setCodeOpen(false);
    setLeg(null);
    setRiderAt(null);
    setArrivedHere(false);
    setUnlockedNote(null);
    setReportedNote(null);
    setDropNote(null);
  }

  const { data: order, isLoading, dataUpdatedAt, error: orderError } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => api.order(orderId),
    // Faster while the rider stands at the counter waiting for the branch to
    // press Dispatch: the code boxes should open while staff are still saying
    // it. Push wakes this too, when it arrives.
    // The same near the customer, while the server is about to mark it.
    refetchInterval: (q) =>
      waitingForBranch(q.state.data) ||
      waitNearRef.current ||
      q.state.data?.delivery_status === 'handover_waiting'
        ? 5_000
        : 15_000,
  });

  /**
   * Rider A after the handover: the moment rider B types the code the job is
   * B's, and this rider can no longer read it. Say so and leave, rather than
   * showing the last thing known - "on the way" - for ever.
   */
  const handedOver =
    order?.delivery_status === 'handover_waiting' &&
    orderError instanceof ApiError &&
    (orderError.code === 'not_found' || orderError.status === 403 || orderError.status === 404);
  useEffect(() => {
    if (!handedOver) return;
    qc.removeQueries({ queryKey: ['order', orderId] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
    void showNotice('Parcel handed over', 'The other rider has the parcel now. Thank you.');
    router.replace('/');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handedOver]);

  /**
   * A reply's actions stand in for the job's only until the job is read again.
   * Kept longer, they outlived steps the server took on its own: after the
   * pickup code, the server's automatic "near the customer" left the screen
   * offering "I am near the customer" from the old reply.
   */
  useEffect(() => {
    setOverride(null);
  }, [dataUpdatedAt]);

  /**
   * The branch has pressed Dispatch: buzz, and open the code boxes if the bag
   * is checked. Once per job - a new code from the counter keeps the flag up.
   */
  const codeReady =
    !!order &&
    order.pickup_handover === 'branch' &&
    !!order.pickup_code_ready &&
    order.allowed_actions.includes('verify_pickup_otp');
  useEffect(() => {
    if (!codeReady || !order || codeReadyFor.has(orderId)) return;
    codeReadyFor.add(orderId);
    Vibration.vibrate([0, 300, 150, 300]);
    // The shop pressed Dispatch: open the code box. The rider no longer ticks
    // the bag, so nothing holds this back.
    setOtp('');
    setOtpError(null);
    setCodeOpen(true);
    // Only the moment the flag goes up; later polls must not reopen it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeReady, orderId]);

  /**
   * A job opened while it is already on the road — the shop dispatched it on
   * its own screen, or the app restarted mid-trip — picks its reporting back
   * up. Never asks for permission here; the next step's tap does that, behind
   * the explainer.
   */
  const shouldTrack = !!order && trackingWanted(order.delivery_status, order.tracking);
  // The job pinned on the lock screen while it is live (tripNotification.ts).
  useTripNotification(order, shouldTrack, leg, riderAt, timezone);
  useEffect(() => {
    if (shouldTrack) void keepTracking(orderId);
  }, [shouldTrack, orderId]);

  /** An offer has no live map to report from: one fix, for its distances. */
  const isOffer = order?.delivery_status === 'offered';
  useEffect(() => {
    if (!isOffer) return;
    let live = true;
    currentFix().then((f) => {
      if (live && f) setRiderAt({ latitude: f.latitude, longitude: f.longitude });
    });
    return () => {
      live = false;
    };
  }, [isOffer, orderId]);

  /** The arrival prompt now showing, if any; it buzzes once when it first does. */
  const prompt = order ? arrivalPrompt(order, override, riderAt, reachedHere) : null;
  const promptKind = prompt?.kind ?? null;
  /**
   * The server marks the job near by itself once the heartbeat has stayed this
   * close for its dwell time - only on a real customer pin, never a looked-up one.
   */
  const autoNearHere =
    !!autoNear?.enabled &&
    order?.location_source === 'customer_pin' &&
    prompt?.kind === 'near' &&
    prompt.metres <= autoNear.radius_m;
  waitNearRef.current = autoNearHere;
  /**
   * A drop point that arrives while the screen is open is the customer's
   * shared location: buzz once and say the map moved. One already there when
   * the screen opened is old news, and the rider's own waiting spot is no news.
   */
  const dropAt = order?.drop_point?.at ?? '';
  const dropSeen = useRef<string | null>(null);
  useEffect(() => {
    if (!order) return;
    if (dropSeen.current === null) {
      dropSeen.current = dropAt;
      return;
    }
    if (!dropAt || dropAt === dropSeen.current) return;
    dropSeen.current = dropAt;
    const label = order.drop_point?.label;
    if (label?.startsWith('Where the rider is waiting')) return;
    Vibration.vibrate([0, 300, 150, 300]);
    setDropNote(`New location from the customer${label ? `: ${label}` : ''}. The map has moved.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropAt, orderId]);
  const nearAuto = !!order?.near_customer_auto;
  useEffect(() => {
    // Once per job, shared with the push listener: the server's own push for
    // this has rung already when it arrived first.
    if (!nearAuto || !claimNearAuto(orderId)) return;
    playNearCustomer();
    Vibration.vibrate([0, 300, 150, 300]);
    // A banner too, for a phone in a pocket. Silent: the chime above is the sound.
    const name = order?.customer_name ?? 'The customer';
    ensureTripChannel()
      .then(() =>
        Notifications.scheduleNotificationAsync({
          content: {
            title: 'Marked near the customer',
            body: `${name} has been told you're close. At the door, tap Reached to send their code.`,
            data: { delivery_order_id: orderId },
            sound: false,
          },
          trigger: { channelId: TRIP_CHANNEL },
        })
      )
      .catch(() => {});
  }, [nearAuto, orderId]);
  useEffect(() => {
    if (!promptKind) return;
    const key = `${orderId}:${promptKind}`;
    if (buzzedFor.has(key)) return;
    buzzedFor.add(key);
    Vibration.vibrate(300);
  }, [promptKind, orderId]);

  if (isLoading) {
    return (
      <GlassScreen>
        <LoadingArt />
      </GlassScreen>
    );
  }

  // A job that resolved to nothing is not a wait — it gets an answer, not the
  // loading loop.
  if (!order) {
    return (
      <GlassScreen>
        <View style={{ paddingTop: insets.top + gspace.xxxl, paddingHorizontal: gspace.xl }}>
          <GlassCard>
            <GlassText variant="title">That job is gone</GlassText>
            <GlassButton
              title="Back"
              onPress={() => router.replace('/')}
              style={{ marginTop: gspace.lg }}
            />
          </GlassCard>
        </View>
      </GlassScreen>
    );
  }

  const actions = override ?? order.allowed_actions;
  /**
   * Pickup at the branch (Rider_App_Pickup_Flow.pdf): the rider says "I'm at
   * the counter", the branch presses Dispatch and reads out the code. Odoo
   * offers `arrived_shop` beside `verify_pickup_otp` before and after the
   * arrival, so whether it is still due is read off `arrived_at_shop`. In the
   * older handover modes it is left out and the code panel tells the shop, as
   * before.
   */
  const branch = order.pickup_handover === 'branch';
  const arrivalDue =
    branch && actions.includes('arrived_shop') && !order.arrived_at_shop && !arrivedHere;
  const primary: Action | null = arrivalDue
    ? 'arrived_shop'
    : skipToDoor && actions.includes('verify_delivery_otp')
      ? 'verify_delivery_otp'
      : (PRIMARY_ACTIONS.find((a) => actions.includes(a)) ?? null);
  const secondary = actions.filter((a) => a !== primary && a !== 'arrived_shop');
  /** Arrived, and the branch has not pressed Dispatch yet. */
  const awaitingCode = branch && primary === 'verify_pickup_otp' && !order.pickup_code_ready;
  /**
   * The customer's street address, pin, phone, note and pay link are withheld
   * until the pickup code is verified; only the area and the distance are real.
   */
  const locked = isDropLocked(order);
  const area = order.customer_area || '';
  const dropKm = order.shop_to_customer_m ? distanceText(order.shop_to_customer_m) : '';

  // The job's state, as the list already shows it. Shared so a chip in a
  // header and a badge on a card can never disagree.
  const band = glassBand[order.delivery_status as GlassBarState] ?? glassBand.idle;

  /**
   * Whether this step wants a code. Decides only whether the primary button
   * opens the code panel or fires the action; the panel gates its own submit on
   * six digits, which is why no flag out here greys out the very button a rider
   * taps in order to enter the code.
   */
  const needsOtp =
    primary === 'verify_pickup_otp' ||
    primary === 'verify_handover' ||
    primary === 'verify_delivery_otp';
  const cod = order.payment_status === 'cod';

  /** The promise as pressure, counted against the server's clock. */
  const due = dueIn(order.promised_by, now);

  /** When the counter packed it, or empty — only the 369 Mart bridge sends it. */
  const packedAt = timeOnly(order.packed_at ?? undefined, timezone);


  /** At the counter waiting on the pickup code — the moment to check the bag. */
  const collecting = primary === 'verify_pickup_otp' || primary === 'verify_handover';
  /** Rider B taking a parcel over from a rider whose bike broke down. */
  const takeover = order.pickup_from?.kind === 'rider' ? order.pickup_from : null;

  /**
   * Every line ticked, or nothing to tick. Collect waits for it: these are
   * mostly high-value electronics, and a bag that leaves the counter short is
   * a second trip and an unhappy customer. It can never strand a job - the
   * shop can still press Dispatch on its own screen, and the job then arrives
   * here already collected.
   */

  /** Applies whatever Odoo says came back, including any tracking instruction. */
  async function applyResult(res: ActionResult) {
    setOverride(res.allowed_actions);
    setOtp('');

    // From Accept until Delivered the customer's map follows this phone. A
    // reply saying nothing about either (a code request) changes nothing.
    const says = res.tracking !== undefined || !!res.status;
    if (says && trackingWanted(res.status, res.tracking)) {
      const started = await startTracking(orderId);
      // One message per cause. This was a single sentence about Settings, which
      // was wrong advice for a rider whose permissions were fine and whose
      // location switch was simply off.
      if (!started.ok) setError(TRACKING_ERROR[started.reason]);
    } else if (says && trackedOrderId() === orderId) {
      await stopTracking();
    }

    await qc.invalidateQueries();

    // `removed`: declined, and now another rider's — nothing left here.
    if (res.removed || res.status === 'delivered' || res.status === 'returned') {
      router.replace('/');
    }
  }

  /**
   * Returning a parcel and reporting a problem both need a reason, and the
   * reason codes are a list the two teams agreed rather than either inventing.
   * So these two actions open the picker instead of firing straight away —
   * the app used to send a hardcoded "Reported from the app", which told the
   * office nothing.
   */
  async function run(action: Action) {
    // The rider is dealing with the job, so whatever is buzzing can stop.
    stopOfferAlert();

    // One step at a time: the next one is only possible once Odoo has heard
    // the one still waiting, and its buttons come from the answer to it.
    if (pending) {
      setError(`Still waiting for signal to send "${stepLabel(pending.step)}".`);
      return;
    }

    // Declining cannot be undone — the job goes to someone else and is never
    // offered back — so it too goes through the reason screen, whose "Never
    // mind" is the way out of a stray tap beside Accept.
    if (action === 'confirm_return') {
      const ok = await confirm({
        title: 'Parcel back at the shop?',
        message: 'This closes the job as returned. Confirm only once the shop has the parcel.',
        okLabel: 'Confirm return',
      });
      if (!ok) return;
    }

    if (action === 'return_to_shop' || action === 'report_issue' || action === 'decline') {
      setError(null);
      setOtpError(null);
      setReasonNote('');
      setReasonPick(null);
      setReportShot(null);
      setReasonFor(action);
      return;
    }

    /**
     * Explain before Android asks.
     *
     * `start_delivery` is the one action that triggers a permission prompt, and
     * it fires while the rider is at a shop counter holding a parcel — the
     * worst possible moment to meet a dialog with no context and every reason
     * to dismiss it. On Android a refusal is close to permanent, so the cost of
     * asking badly is a rider who can never be tracked again.
     */
    // With "Customer Follows From Accept" on, tracking starts at accept, so
    // the explainer comes before that tap instead.
    const tracksHere =
      action === 'start_delivery' || (action === 'accept' && hasFeature('track_from_accept'));
    if (tracksHere && !(await hasLocationPermission())) {
      setError(null);
      setPrimerFor(action);
      return;
    }

    await fire(action);
  }

  async function fire(
    action: Action,
    reason?: string,
    photo?: { uri: string; name?: string } | null,
    note?: string
  ) {
    setBusy(true);
    setError(null);
    setOtpError(null);

    try {
      let res: ActionResult;
      switch (action) {
        case 'accept':
          res = await api.accept(orderId);
          break;
        case 'decline':
          res = await api.decline(orderId, reason);
          break;
        case 'arrived_shop': {
          // Where the rider is goes along, for the server's arrival check.
          // Never queued: "I'm here" sent later from somewhere else would
          // ring the counter for a rider who is not standing at it.
          const fix = await currentFix();
          res = await api.arrivedAtShop(orderId, fix);
          break;
        }
        case 'verify_pickup_otp':
          res = await api.verifyPickupOtp(orderId, otp);
          // Branch mode: the reply is already `dispatched` and carries the job
          // unlocked, so the address is on screen without waiting for a fetch.
          if (res.order) qc.setQueryData(['order', orderId], res.order);
          // The older handover modes: the code, then /dispatch at once, so one
          // tap is the counter's Dispatch - "Collected by Rider", the one step
          // that messages the customer. Should it fail, Odoo still offers
          // `dispatch` and the screen shows it as the next button.
          if (res.allowed_actions.includes('dispatch')) {
            try {
              res = await api.dispatch(orderId);
            } catch (err) {
              if (err instanceof ApiError && err.code === 'network') {
                // The code is accepted; "Collected" goes by itself with the signal.
                await enqueue(orderId, 'dispatch');
              } else {
                setError(
                  err instanceof ApiError
                    ? err.message
                    : 'Code accepted. Tap "Collected – leaving the shop" to carry on.'
                );
              }
            }
          }
          break;
        case 'dispatch':
          res = await api.dispatch(orderId);
          break;
        case 'start_delivery':
          res = await api.start(orderId);
          break;
        case 'verify_delivery_otp':
          res = await api.verifyDeliveryOtp(orderId, otp);
          break;
        case 'return_to_shop':
          res = await api.returnToShop(orderId, reason);
          break;
        case 'confirm_return':
          // Only the shop confirms a return now, and Odoo no longer offers
          // this. An older server might; its refusal re-renders from the truth.
          res = await api.confirmReturn(orderId);
          break;
        case 'report_issue':
          res = await api.reportIssue(orderId, reason ?? 'other', undefined, {
            ...(photo ? { photoUri: photo.uri, photoName: photo.name } : {}),
            ...(note ? { note } : {}),
          });
          break;
        case 'verify_handover':
          // Rider B: rider A's code. The reply carries the job, now B's and
          // unlocked, the same as a verified pickup code.
          res = await api.verifyHandover(orderId, otp);
          if (res.order) qc.setQueryData(['order', orderId], res.order);
          break;
        case 'cancel_handover':
          res = await api.cancelHandover(orderId);
          break;
        default:
          return;
      }
      // Done with the door: a later job with this id must start fresh.
      if (action === 'verify_delivery_otp' || action === 'return_to_shop') markReached(false);
      // The panel has done its job. A wrong code keeps it open, showing the
      // server's message against the boxes.
      setCodeOpen(false);
      // The last panel's words belong to the last step.
      setNotice(null);
      if (action === 'cancel_handover') {
        setReportedNote(res.message || 'Back on the delivery.');
      }
      if (action === 'report_issue') {
        setReportedNote(res.message || 'The office has been told. They will call you if they need to.');
      }
      if (action === 'arrived_shop') {
        setArrivedHere(true);
        // "Tell the counter you are here..." - instructions, not an error.
        setNotice(res.message ?? null);
      }
      if (
        (action === 'verify_pickup_otp' || action === 'verify_handover') &&
        order?.customer_location_locked
      ) {
        const name = res.order?.customer_name || order.customer_name;
        setUnlockedNote(res.message ?? `Code accepted. Head to ${name}.`);
      }
      // A code accepted means 2 to 4 parcel photos are owed now, before
      // anything else. Stored first, so a crash in between still lands there.
      const photoStage: PhotoStage | null =
        action === 'verify_pickup_otp'
          ? 'pickup'
          : action === 'verify_delivery_otp'
            ? 'delivery'
            : null;
      if (photoStage && order) {
        await owePhotos({
          orderId,
          stage: photoStage,
          ref: photoRef(res.order ?? order),
          customerName: res.order?.customer_name || order.customer_name,
          // For the thank-you screen after the delivery photos.
          ...(photoStage === 'delivery'
            ? { fee: order.rider_fee ?? null, deliveredAt: res.delivered_at ?? new Date().toISOString() }
            : {}),
        });
      }
      if (res.status === 'released') {
        // A vehicle problem before pickup: the job went to the next rider.
        await qc.invalidateQueries({ queryKey: ['orders'] });
        void showNotice(
          'Given to another rider',
          res.message || 'The next free rider has been offered this job.'
        );
        router.replace('/');
        return;
      }
      await applyResult(res);
      if (photoStage) {
        router.replace({
          pathname: '/photos/[id]',
          params: { id: String(orderId), stage: photoStage },
        });
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'network' && isQueueable(action)) {
        // No signal: the step waits in the outbox and goes by itself later.
        // The banner under the job says so; nothing here is an error.
        // A report keeps its words; a photo cannot wait, so it stays behind.
        await enqueue(orderId, action, reason, action === 'report_issue' ? note : undefined);
        setCodeOpen(false);
      } else if (
        err instanceof ApiError &&
        (action === 'accept' || action === 'decline') &&
        (err.code === 'offer_expired' || err.code === 'not_found')
      ) {
        // Too late: the time ran out and the next rider has it. Nothing here
        // is this rider's any more.
        stopOfferAlert();
        await qc.invalidateQueries({ queryKey: ['orders'] });
        void showNotice('Offer expired', 'It went to another rider.');
        router.replace('/');
      } else if (err instanceof ApiError) {
        // Their message is written for riders — never replace it.
        if (err.code === 'bad_otp') {
          setOtpError(err.message);
          setOtp('');
        } else if (err.code === 'wait') {
          // "Customer not there": the return opens when the wait ends.
          const at = timeOnly(err.waitUntil, timezone);
          setError(
            at
              ? `You can return the parcel after ${at}. The customer has been messaged.`
              : err.message
          );
        } else if (err.code === 'otp_required') {
          // The customer has no live code after all: back to "Reached".
          markReached(false);
          setCodeOpen(false);
          setError(err.message);
        } else {
          setError(err.message);
        }
        // A wrong_state error carries the truth; re-render from it.
        if (err.allowedActions) setOverride(err.allowedActions);
        await qc.invalidateQueries({ queryKey: ['order', orderId] });
      } else {
        setError('Something went wrong. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * At the door - the shop guide's "Reached Customer Location". Odoo sends the
   * customer their 6-digit code now, and the code panel opens for it.
   */
  async function reachCustomer() {
    setError(null);
    setOtpError(null);
    setBusy(true);
    try {
      const res = await api.reachedCustomer(orderId);
      markReached(true);
      setNotice(res.message ?? 'The customer has been sent their code on WhatsApp.');
      setResendAt(serverNow() + (res.retry_after_seconds ?? RESEND_WAIT_S) * 1000);
      setOtp('');
      setCodeOpen(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'network') {
        // Sent by the outbox once there is signal; the code panel opens then.
        await enqueue(orderId, 'reached');
      } else if (err instanceof ApiError) {
        setError(err.message);
        if (err.allowedActions) setOverride(err.allowedActions);
      } else {
        setError('Could not send the customer their code. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * "Didn't get it? Resend code" in the customer's code panel. A new code
   * voids the old one, so any digits typed are cleared.
   */
  async function resendCode() {
    setOtpError(null);
    setResending(true);
    try {
      const res = await api.resendCustomerCode(orderId);
      setResendAt(serverNow() + (res.retry_after ?? RESEND_WAIT_S) * 1000);
      const words = res.message || RESEND_REFUSED[res.reason ?? ''];
      if (res.sent) {
        setOtp('');
        setNotice(res.message || 'A new code has been sent. The old one no longer works.');
      } else if (res.reason === 'limit') {
        // retry_after is 0 here, but asking again can only be refused.
        setResendClosed(words ?? RESEND_REFUSED.limit);
      } else {
        setOtpError(words ?? RESEND_REFUSED.whatsapp_failed);
      }
      // The last of the five: say so now, rather than on a sixth press.
      if (res.sent && res.limit && res.resends !== undefined && res.resends >= res.limit) {
        setResendClosed(RESEND_REFUSED.limit);
      }
    } catch (err) {
      setOtpError(
        err instanceof ApiError ? err.message : 'Could not send a new code. Try again.'
      );
    } finally {
      setResending(false);
    }
  }

  /**
   * Open the code panel. For the pickup code, this is also the moment the
   * rider is at the counter, so the shop is sent its code — once per job; see
   * `shopToldFor`.
   */
  function openCode() {
    setCodeOpen(true);
    // Branch mode told the counter with "I'm at the counter" already.
    if (primary !== 'verify_pickup_otp' || branch || shopToldFor.has(orderId)) return;
    shopToldFor.add(orderId);
    setNotice('Checking with the shop…');
    // Where the rider is goes along, for the fleet module's arrival check.
    currentFix()
      .then((fix) => api.arrivedAtShop(orderId, fix))
      .then((res) => {
        setNotice(res.message ?? null);
      })
      .catch((err) => {
        // Let the next open try again.
        shopToldFor.delete(orderId);
        setNotice(null);
        setOtpError(
          err instanceof ApiError
            ? err.message
            : 'Could not reach the server. Ask the counter for the pickup code.'
        );
      });
  }

  /**
   * "Remind the counter", in branch mode: rings the Shop Queue card again. It
   * makes no code - only the branch's Dispatch does.
   */
  async function remindCounter() {
    setError(null);
    setBusy(true);
    try {
      const res = await api.requestPickupOtp(orderId);
      setNotice(res.message ?? 'The counter has been reminded.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the counter. Try again.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Three different people, and the screen has to be clear which it is dialling.
   *
   * There was one `call` here and it always reached the customer — including
   * from the button beside the SHOP's name on the pickup sheet, while the rider
   * was still on their way to collect. `shop.phone` has been in the contract
   * since N2 and was read nowhere.
   */
  const dial = (number: string) => {
    if (!number) return;
    Linking.openURL(`tel:${number}`).catch(() => setError('This phone cannot make calls.'));
  };
  const callCustomer = () => dial(order.customer_mobile);
  const callShop = () => dial(shopPhone(order.shop));
  // The orders arrive over WhatsApp, so it is the channel both already use.
  const canMessageCustomer = !!whatsappUrl(order.customer_mobile);
  const canMessageShop = !!whatsappUrl(shopPhone(order.shop));
  const messageCustomer = () => openWhatsApp(order.customer_mobile);
  const messageShop = () => openWhatsApp(shopPhone(order.shop));

  /** Set on Connect. With no number the link is not drawn at all. */
  const supportNumber = peekServer().supportPhone;
  const callSupport = () => dial(supportNumber);

  /* ----------------------------------------------------------------- *
   * Why this app wants your location.
   *
   * Its own step for the same reason the reason picker is: one question on
   * the screen at a time. Shown before Android's dialog, never instead of it
   * — Continue is what actually triggers the system prompt.
   * ----------------------------------------------------------------- */
  if (primerFor) {
    return (
      <GlassScreen>
        <View style={{ paddingTop: insets.top + gspace.sm, paddingLeft: gspace.xl }}>
          <RoundButton icon="chev" mirrored onPress={() => setPrimerFor(null)} />
        </View>
        <LocationPrimer
          busy={busy}
          onContinue={() => {
            const action = primerFor;
            setPrimerFor(null);
            void fire(action);
          }}
          onSkip={() => setPrimerFor(null)}
        />
      </GlassScreen>
    );
  }

  /* ----------------------------------------------------------------- *
   * Why did it go wrong?
   *
   * Its own step rather than a sheet layered over each of the three layouts
   * below — a rider standing at a door needs one question on the screen, and
   * this way the picker exists once instead of three times.
   * ----------------------------------------------------------------- */
  if (reasonFor) {
    const returning = reasonFor === 'return_to_shop';
    const declining = reasonFor === 'decline';
    const reasons: readonly { code: string; label: string }[] = declining
      ? DECLINE_REASONS
      : DELIVERY_REASONS;
    /*
     * Pick, then send (owner's pick, "D" of five drawn). A tap used to send at
     * once and start the next step - a slip on a bumpy road became a report
     * the office acted on. Now a tap only ticks a reason; Send sends it, with
     * the rider's note and a photo for a report.
     */
    const reporting = reasonFor === 'report_issue';
    const note = reasonNote.trim();
    // Every step waits for a reason: the office sees why, and a stray tap on
    // "Decline job" cannot give a job away.
    const canSend = !!reasonPick;
    const close = () => {
      setReasonFor(null);
      setReasonNote('');
      setReasonPick(null);
      setReportShot(null);
    };
    const send = async () => {
      const action = reasonFor;
      const code = reasonPick ?? '';
      // Giving a job away or taking a parcel back cannot be undone: ask once.
      if (action === 'decline' || action === 'return_to_shop') {
        const ok = await confirm(
          action === 'decline'
            ? {
                title: 'Decline this job?',
                message: 'It goes to the next rider at once and is not offered to you again.',
                okLabel: 'Decline',
              }
            : {
                title: 'Return the parcel to the shop?',
                message: 'The delivery stops here. The shop is told and closes the return.',
                okLabel: 'Return to shop',
              }
        );
        if (!ok) return;
      }
      // The server keeps a report photo with any reason ("Problem photos",
      // delivery 19.0.22.6.0).
      close();
      if (action === 'report_issue') void fire(action, code || 'other', reportShot, note || undefined);
      // The return and decline routes take one reason string, no note field.
      else void fire(action, code);
    };
    const shoot = async () => {
      const shot = await takePhoto();
      if ('error' in shot) {
        const why = photoProblem(shot.error);
        if (why) setError(why);
        return;
      }
      const ref = order ? photoRef(order) : `order${orderId}`;
      const takenAt = new Date(serverNow());
      try {
        // The company's zone, never the phone's: see `photoFileName`.
        setReportShot({ uri: shot.uri, name: photoFileName(ref, takenAt, await shopTimeZone()) });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Couldn't name the photo. Try again.");
      }
    };
    return (
      <GlassScreen>
        <GlassHeader
          title={declining ? 'Decline this job' : returning ? 'Return to shop' : 'Report a problem'}
          onBack={close}
        />
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: gspace.xl,
            paddingBottom: gspace.xxxl + bottomInset,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <GlassText variant="title">
            {declining
              ? 'Why decline this job?'
              : returning
                ? 'Why are you returning it?'
                : 'What is the problem?'}
          </GlassText>
          <GlassText variant="body" tone="soft" style={{ marginTop: gspace.xs }}>
            {declining
              ? 'Pick one. The office sees why.'
              : returning
                ? 'The shop closes the return. This tells them what happened.'
                : 'Pick one, then press Send. The office is told, and the next step starts by itself.'}
          </GlassText>

          {/* Declining: which job this is, so the rider turns down the right one,
              and that it cannot be undone. */}
          {declining ? <DeclineSummary order={order} riderAt={riderAt} timezone={timezone} /> : null}

          <View style={{ marginTop: gspace.lg, gap: gspace.sm }} accessibilityRole="radiogroup">
            {reasons.map((r) => {
              const on = reasonPick === r.code;
              const icon = declining ? DECLINE_ICON[r.code] : undefined;
              return (
                <Pressable
                  key={r.code}
                  disabled={busy}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() => setReasonPick(on ? null : r.code)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: on ? glass.accentSoft : glass.fillStrong,
                    borderRadius: gradius.button,
                    borderWidth: on ? 2 : 1,
                    borderColor: on ? glass.band : glass.border,
                    paddingVertical: on ? gspace.md - 1 : gspace.md,
                    paddingHorizontal: on ? gspace.lg - 1 : gspace.lg,
                    opacity: busy ? 0.6 : pressed ? 0.8 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      borderWidth: on ? 6 : 2,
                      borderColor: on ? glass.band : glass.border,
                      backgroundColor: glass.white,
                      marginRight: gspace.md,
                    }}
                  />
                  {icon ? (
                    <GlassIcon
                      name={icon}
                      size={18}
                      color={on ? glass.band : glass.inkSoft}
                      style={{ marginRight: gspace.sm }}
                    />
                  ) : null}
                  <GlassText variant="bodyStrong" style={{ flex: 1 }}>
                    {r.label}
                  </GlassText>
                </Pressable>
              );
            })}
          </View>

          {/* A report carries the rider's words (500 characters on the server)
              and, with any reason, a photo ("Problem photos", 19.0.22.6.0). */}
          {reporting ? (
            <View style={{ marginTop: gspace.xl }}>
              <Field
                label={reasonPick === 'other' ? 'What happened' : 'Add a note (optional)'}
                placeholder="A short line is enough — the office reads these"
                value={reasonNote}
                onChangeText={setReasonNote}
                maxLength={500}
                multiline
              />
              {reportShot ? (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Image
                    source={{ uri: reportShot.uri }}
                    style={{ width: 64, height: 64, borderRadius: gradius.chip }}
                    contentFit="cover"
                  />
                  <View style={{ flex: 1, marginLeft: gspace.md }}>
                    <GlassText variant="bodyStrong">Photo added</GlassText>
                    <View style={{ flexDirection: 'row', columnGap: gspace.lg }}>
                      <GhostLink label="Retake" onPress={shoot} disabled={busy} />
                      <GhostLink label="Remove" onPress={() => setReportShot(null)} disabled={busy} />
                    </View>
                  </View>
                </View>
              ) : (
                <Pressable
                  onPress={shoot}
                  disabled={busy}
                  accessibilityRole="button"
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderWidth: 1,
                    borderStyle: 'dashed',
                    borderColor: glass.orangeLine,
                    backgroundColor: glass.white,
                    borderRadius: gradius.button,
                    paddingVertical: gspace.md,
                    paddingHorizontal: gspace.lg,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <GlassIcon
                    name="camera"
                    size={18}
                    color={glass.orange}
                  />
                  <GlassText
                    variant="bodyStrong"
                    tone="orange"
                    style={{ marginLeft: gspace.sm }}
                  >
                    {reasonPick === 'damaged' ? 'Add a photo of the damage (optional)' : 'Add a photo (optional)'}
                  </GlassText>
                </Pressable>
              )}
            </View>
          ) : null}

          {declining ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                marginTop: gspace.xl,
                padding: gspace.md,
                borderRadius: gradius.card,
                backgroundColor: glass.redSoft,
              }}
            >
              <GlassIcon name="alert" size={18} color={glass.red} />
              <GlassText variant="body" style={{ flex: 1, marginLeft: gspace.sm, color: glass.red }}>
                The job goes to the next rider at once. It will not be offered to you again.
              </GlassText>
            </View>
          ) : null}

          <GlassButton
            title={declining ? 'Decline job' : returning ? 'Return to shop' : 'Send report'}
            kind={declining || returning ? 'danger' : 'green'}
            icon={reporting ? 'nav' : declining ? 'close' : undefined}
            onPress={() => void send()}
            disabled={!canSend}
            loading={busy}
            style={{ marginTop: gspace.xl }}
          />
          {declining ? (
            // The safe way out as a real button, not small grey words.
            <GlassButton
              title="Keep this job"
              kind="ghost"
              icon="check"
              onPress={close}
              disabled={busy}
              style={{ marginTop: gspace.md }}
            />
          ) : (
            <GhostLink label="Never mind" disabled={busy} onPress={close} />
          )}
        </ScrollView>
      </GlassScreen>
    );
  }

  /* ----------------------------------------------------------------- *
   * Rider A after a vehicle problem with the parcel on board
   * (Rider_App_Report_Problem.pdf). The server is finding another rider to
   * come here; this phone shows the code that rider types to take over.
   * Only "bike fixed" and another report are possible meanwhile.
   * ----------------------------------------------------------------- */
  if (order.delivery_status === 'handover_waiting') {
    const relay = order.relay;
    const code = (order.handover_code || relay?.handover_code || '').trim();
    const to = relay?.to_rider ?? null;
    const state = relay?.relay_state ?? 'searching';
    const searching = state === 'searching' || state === 'offered';
    // One look per state: amber while searching, green when a rider is coming,
    // red when nobody is free and the office has to step in.
    const look =
      state === 'none'
        ? { bg: glass.redSoft, fg: glass.red, icon: 'alert' as const }
        : state === 'accepted'
          ? { bg: glass.greenSoft, fg: glass.green, icon: 'bike' as const }
          : { bg: glass.orangeSoft, fg: glass.orange, icon: 'bike' as const };
    const headline =
      state === 'none'
        ? 'No rider is free right now'
        : state === 'accepted'
          ? `${to?.name ?? 'A rider'} is on the way`
          : state === 'offered'
            ? `Asking ${to?.name ?? 'a rider'}…`
            : 'Finding a rider for you…';
    const detail =
      state === 'none'
        ? 'The office has been told and will call you. Stay with the parcel.'
        : state === 'accepted'
          ? 'Wait here with the parcel. Show them the code below when they reach you.'
          : state === 'offered'
            ? 'The nearest free rider has been asked to take over. Waiting for their answer.'
            : 'The nearest free rider will be asked to come and take the parcel.';
    // Where the handover stands, as four steps the rider can follow.
    const stepAt = state === 'accepted' ? 2 : 1;
    const steps = [
      'You reported the vehicle problem',
      'A free rider takes the job',
      'They ride to where you are',
      'They type your code and take the parcel',
    ];
    const tone = state === 'none' ? ('red' as const) : state === 'accepted' ? ('green' as const) : ('orange' as const);
    return (
      <GlassScreen>
        <View
          style={{
            backgroundColor: glass.band,
            paddingTop: insets.top + gspace.md,
            paddingBottom: gspace.lg,
            paddingHorizontal: gspace.xl,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <RoundButton icon="chev" mirrored translucent onPress={() => router.back()} />
          <GlassText variant="title" tone="white" style={{ flex: 1, textAlign: 'center' }}>
            Handover
          </GlassText>
          <View style={{ minWidth: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: gspace.sm }}>
            <GlassPill label={band.label} bg={band.bg} fg={band.fg} />
            <SosShield orderId={order.delivery_order_id} orderRef={photoRef(order)} />
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{
            padding: gspace.xl,
            paddingBottom: gspace.xxxl + bottomInset,
            gap: gspace.lg,
          }}
        >
          {/* Who is coming, or that nobody is. */}
          <View
            style={{
              backgroundColor: look.bg,
              borderRadius: gradius.card,
              borderWidth: 1,
              borderColor: look.fg,
              padding: gspace.xl,
              flexDirection: 'row',
              alignItems: 'center',
              gap: gspace.lg,
            }}
          >
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: glass.white,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {searching ? (
                <ActivityIndicator color={look.fg} />
              ) : (
                <GlassIcon name={look.icon} color={look.fg} size={28} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <GlassText variant="subtitle" tone={tone}>
                {headline}
              </GlassText>
              <GlassText variant="body" tone="soft" style={{ marginTop: gspace.xs }}>
                {detail}
              </GlassText>
            </View>
          </View>
          {to?.phone && state !== 'none' ? (
            <GlassButton
              title={`Call ${to.name}`}
              kind="ghost"
              icon="phone"
              onPress={() => dial(to.phone)}
            />
          ) : null}

          {/* The code, one digit per box, readable at arm's length. */}
          <GlassCard>
            <GlassText variant="label" tone="soft">
              HANDOVER CODE
            </GlassText>
            <View
              style={{ flexDirection: 'row', justifyContent: 'center', gap: gspace.sm, marginTop: gspace.md }}
              accessible
              accessibilityLabel={`Handover code ${code.split('').join(' ')}`}
            >
              {(code || '······').split('').map((d, i) => (
                <View
                  key={i}
                  style={{
                    flex: 1,
                    maxWidth: 72,
                    aspectRatio: 0.8,
                    borderRadius: gradius.button,
                    borderWidth: 2,
                    borderColor: glass.band,
                    backgroundColor: glass.fillLight,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <GlassText variant="amountLg">{d}</GlassText>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: gspace.md }}>
              <GlassIcon name="lock" color={glass.inkSoft} size={16} />
              <GlassText variant="caption" tone="soft" style={{ flex: 1, marginLeft: gspace.sm }}>
                Give it only to the rider who takes the parcel, face to face.
              </GlassText>
            </View>
          </GlassCard>

          {/* What happens now. */}
          <GlassCard>
            <GlassText variant="label" tone="soft">
              WHAT HAPPENS NOW
            </GlassText>
            <View style={{ marginTop: gspace.md, gap: gspace.md }}>
              {steps.map((label, i) => {
                const done = i < stepAt;
                const now = i === stepAt && state !== 'none';
                return (
                  <View key={label} style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 13,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: done ? glass.green : now ? glass.orangeSoft : glass.fill,
                        borderWidth: now ? 2 : 0,
                        borderColor: glass.orange,
                      }}
                    >
                      {done ? (
                        <GlassIcon name="check" color={glass.white} size={14} />
                      ) : (
                        <GlassText variant="caption" tone={now ? 'orange' : 'faint'}>
                          {i + 1}
                        </GlassText>
                      )}
                    </View>
                    <GlassText
                      variant={now ? 'bodyStrong' : 'body'}
                      tone={done || now ? 'ink' : 'faint'}
                      style={{ flex: 1, marginLeft: gspace.md }}
                    >
                      {label}
                    </GlassText>
                  </View>
                );
              })}
            </View>
          </GlassCard>

          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <GlassIcon name="bell" color={glass.inkSoft} size={16} />
            <GlassText variant="caption" tone="soft" style={{ flex: 1, marginLeft: gspace.sm }}>
              {order.customer_name || 'The customer'} has been told the delivery will be a little late.
            </GlassText>
          </View>

          {error ? (
            <GlassText variant="bodyStrong" tone="red">
              {error}
            </GlassText>
          ) : null}

          {actions.includes('cancel_handover') ? (
            <GlassButton
              title={ACTION_LABEL.cancel_handover}
              icon="bike"
              loading={busy}
              onPress={async () => {
                const ok = await confirm({
                  title: 'Cancel the handover?',
                  message: 'The other rider is not coming. You carry on with the delivery yourself.',
                  okLabel: 'Cancel handover',
                  cancelLabel: 'Keep waiting',
                });
                if (ok) void fire('cancel_handover');
              }}
            />
          ) : null}
          <StrongAction
            label="Get a new code"
            icon="lock"
            disabled={busy}
            onPress={() => {
              setError(null);
              api
                .newHandoverCode(orderId)
                .then(() => qc.invalidateQueries({ queryKey: ['order', orderId] }))
                .catch((err) =>
                  setError(err instanceof ApiError ? err.message : 'Could not reach the server.')
                );
            }}
          />
          <TroubleRow
            actions={actions.includes('report_issue') ? ['report_issue'] : []}
            onAction={(a) => void run(a)}
            disabled={busy}
          />
        </ScrollView>
      </GlassScreen>
    );
  }

  /* ----------------------------------------------------------------- *
   * Offer — not accepted yet.
   *
   * One rider at a time, against the clock: Accept or Decline before
   * `offer_expires_at`, or the server calls the next rider. Decline comes
   * from `allowed_actions` like every other button. The template's "You
   * earn", distance and estimated time are still dropped — no field exists
   * behind any of them.
   * ----------------------------------------------------------------- */
  if (primary === 'accept') {
    const offerGone = !!order.offer_expires_at && expiredOffer === order.offer_expires_at;
    const expireOffer = () => {
      setExpiredOffer(order.offer_expires_at ?? null);
      stopOfferAlert();
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['order', orderId] });
    };
    const offerShop = shopInfo(order.shop);
    const offerShopAt = coords(offerShop?.latitude, offerShop?.longitude);
    const offerCustomerAt = coords(order.latitude, order.longitude);
    // As the crow flies, said with "≈": a quick sense of the trip before the
    // road route has loaded, and the only one when it cannot load.
    const trip = [
      riderAt && offerShopAt ? `${distanceText(metresBetween(riderAt, offerShopAt))} to the shop` : null,
      offerShopAt && offerCustomerAt
        ? `${distanceText(metresBetween(offerShopAt, offerCustomerAt))} shop → customer`
        : // Before pickup the customer's pin is withheld; the server's own
          // measure stands in.
          dropKm
          ? `${dropKm} shop → customer`
          : null,
      !offerShopAt && riderAt && offerCustomerAt
        ? `${distanceText(metresBetween(riderAt, offerCustomerAt))} to the customer`
        : null,
    ]
      .filter(Boolean)
      .join('  ·  ');
    const itemCount = order.products?.reduce((n, p) => n + (p.quantity || 1), 0) ?? 0;
    return (
      <GlassScreen>
        {/* The same band and back button as Orders, Earnings and a past job,
            so the offer does not arrive looking like a different app. */}
        <GlassHeader
          title="New job offer"
          onBack={() => router.back()}
          right={<GlassPill label={band.label} bg={band.bg} fg={band.fg} />}
        />
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: gspace.xl,
            paddingBottom: gspace.xxxl + bottomInset,
          }}
        >
          <GlassText variant="hero" numberOfLines={2}>
            {shopName(order.shop)} → {order.customer_name}
          </GlassText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: gspace.sm, marginTop: gspace.xs }}>
            <GlassText variant="caption" tone="soft" nums>
              {order.delivery_order_name}
              {order.job_code ? ` · ${order.job_code}` : ''}
            </GlassText>
            {order.delivery_type ? <GlassPill label={order.delivery_type} tone="soft" /> : null}
            {stopLabel(order) ? <GlassPill label={stopLabel(order)!} tone="soft" /> : null}
          </View>

          {/* What a rider weighs an offer on, in one glance: the money, the
              load, and the clock. All three ship on the offer already. */}
          <View style={{ flexDirection: 'row', gap: gspace.md, marginTop: gspace.lg }}>
            <Tile
              label={cod ? 'Collect cash' : 'Payment'}
              value={cod ? money(order.amount_to_collect, order.currency) : 'Paid'}
              tone={cod ? glass.red : glass.green}
            />
            <Tile label="Items" value={String(itemCount || order.products?.length || '—')} />
            <Tile
              label="Due"
              value={due?.text ?? '—'}
              tone={due?.late ? glass.red : undefined}
            />
          </View>
          {order.rider_fee ? <FeeLine label="You earn on this trip" fee={order.rider_fee} /> : null}

          {/* Where the shop is from here. The shop's pin is real on the live
              server even while customer rows carry none; `heading` resolves to
              the shop for an offer, so the line drawn is the ride to collect. */}
          {trip ? (
            <GlassText variant="bodyStrong" tone="indigo" nums style={{ marginTop: gspace.md }}>
              ≈ {trip}
            </GlassText>
          ) : null}

          {MAP_ENABLED && (offerShopAt || offerCustomerAt) ? (
            <GlassCard padding={0} style={{ marginTop: gspace.lg, overflow: 'hidden' }}>
              <RouteMap
                latitude={order.latitude}
                longitude={order.longitude}
                shopLatitude={offerShop?.latitude ?? null}
                shopLongitude={offerShop?.longitude ?? null}
                heading={headingFor(order.delivery_status)}
                onRoute={setLeg}
                onRiderMove={setRiderAt}
                height={Math.round(screenH * 0.26)}
              />
            </GlassCard>
          ) : null}

          <GlassCard style={{ marginTop: gspace.lg }}>
            <GlassText variant="label" tone="soft" upper>
              {/* A job with no shop is collected from the warehouse (19.0.21.4.0). */}
              {order.pickup_from?.kind === 'rider'
                ? 'Take over from (bike broke down)'
                : offerShop?.is_warehouse
                  ? 'Pick up from the warehouse'
                  : 'Pick up from'}
            </GlassText>
            <GlassText variant="bodyStrong" style={{ marginTop: gspace.xs }}>
              {shopName(order.shop) || 'Shop not recorded'}
            </GlassText>
            {offerShop?.address ? (
              <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
                {offerShop.address}
              </GlassText>
            ) : null}
            {/* By road, from the route the map drew; absent until it has one. */}
            {leg && leg.distanceM > 0 ? (
              <GlassText variant="caption" tone="indigo" nums style={{ marginTop: gspace.xs }}>
                {routeSummary(leg.distanceM, leg.durationS)} from here
              </GlassText>
            ) : null}
            {/* The counter has already packed it: the parcel is waiting, not
                being got ready. */}
            {packedAt ? (
              <GlassText variant="caption" tone="soft" nums style={{ marginTop: 2 }}>
                Packed and ready since {packedAt}
              </GlassText>
            ) : null}

            <View
              style={{
                borderBottomWidth: 1,
                borderColor: glass.divider,
                marginVertical: gspace.lg,
              }}
            />

            <GlassText variant="label" tone="soft" upper>
              Deliver to
            </GlassText>
            <GlassText variant="bodyStrong" style={{ marginTop: gspace.xs }}>
              {order.customer_name}
            </GlassText>
            {locked ? (
              <>
                {area ? (
                  <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
                    {area}
                  </GlassText>
                ) : null}
                <GlassText variant="caption" tone="faint" style={{ marginTop: 2 }}>
                  Full address once the branch hands you the parcel.
                </GlassText>
              </>
            ) : (
              <>
                <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
                  {order.delivery_address}
                </GlassText>
                <DeliveryNote note={order.delivery_note} />
              </>
            )}
            {order.promised_by ? (
              <GlassText variant="caption" tone="soft" nums style={{ marginTop: gspace.sm }}>
                Promised {promisedAt(order.promised_by, timezone)}
              </GlassText>
            ) : null}
          </GlassCard>

          {/* What is in the bag. Products ship on the list since N2; older
              servers send only the one-line summary. */}
          {order.products?.length || order.items_summary ? (
            <GlassCard style={{ marginTop: gspace.lg }}>
              <GlassText variant="label" tone="soft" upper>
                Items
              </GlassText>
              {order.products?.length ? (
                order.products.map((p, i) => (
                  <View
                    key={`${p.name}-${i}`}
                    style={{ flexDirection: 'row', marginTop: i === 0 ? gspace.sm : gspace.xs }}
                  >
                    <GlassText variant="body" style={{ flex: 1, paddingRight: gspace.md }}>
                      {p.name}
                    </GlassText>
                    <GlassText variant="bodyStrong" nums>
                      ×{p.quantity}
                      {p.uom ? ` ${p.uom}` : ''}
                    </GlassText>
                  </View>
                ))
              ) : (
                <GlassText variant="body" style={{ marginTop: gspace.sm }}>
                  {order.items_summary}
                </GlassText>
              )}
            </GlassCard>
          ) : null}

          {error ? (
            <GlassText variant="bodyStrong" tone="red" style={{ marginTop: gspace.lg }}>
              {error}
            </GlassText>
          ) : null}
          {pending ? <PendingLine entry={pending} /> : null}
          {/* Without background location the near-customer message cannot fire. */}
          {shouldTrack ? <LocationAlwaysBanner /> : null}

          {order.offer_expires_at ? (
            <View style={{ alignItems: 'center', marginTop: gspace.xxl }}>
              <OfferCountdown expiresAt={order.offer_expires_at} onExpired={expireOffer} />
            </View>
          ) : null}

          <GlassButton
            title={ACTION_LABEL[primary]}
            kind="orange"
            icon="check"
            onPress={() => run(primary)}
            loading={busy}
            disabled={offerGone}
            style={{ marginTop: order.offer_expires_at ? gspace.lg : gspace.xxl }}
          />

          {/* An offer has no "something wrong" yet: Decline sits there plainly. */}
          <TroubleRow
            heading={null}
            actions={secondary}
            onAction={(a) => run(a)}
            onCallSupport={supportNumber ? callSupport : undefined}
            disabled={busy || offerGone}
          />
        </ScrollView>
      </GlassScreen>
    );
  }

  /* ----------------------------------------------------------------- *
   * Handover — near the customer. "Reached" first, which has Odoo send the
   * customer their code; then the code itself.
   * ----------------------------------------------------------------- */
  if (primary === 'verify_delivery_otp') {
    const reached = reachedHere || !!order.reached_customer_on;
    return (
      <GlassScreen>
        <View
          style={{
            backgroundColor: glass.green,
            paddingTop: insets.top + gspace.md,
            paddingBottom: gspace.xl,
            paddingHorizontal: gspace.xl,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <RoundButton icon="chev" mirrored translucent onPress={() => router.back()} />
          <GlassText variant="title" tone="white" style={{ flex: 1, textAlign: 'center' }}>
            Delivering
          </GlassText>
          {/* The same state the card badge shows, from the same table, so the
              header and the list cannot say different things about one job. */}
          <View style={{ minWidth: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: gspace.sm }}>
            <GlassPill label={band.label} bg={band.bg} fg={band.fg} />
            <SosShield orderId={order.delivery_order_id} orderRef={photoRef(order)} />
          </View>
        </View>

        {/* The leg where the rider is actually driving to the door, and the
            one place a map earns its space most. It was the only job layout
            without one. `heading` resolves to the customer here. */}
        <RouteMap
          latitude={order.latitude}
          longitude={order.longitude}
          shopLatitude={shopInfo(order.shop)?.latitude ?? null}
          shopLongitude={shopInfo(order.shop)?.longitude ?? null}
          heading={headingFor(order.delivery_status)}
          onRoute={setLeg}
                onRiderMove={setRiderAt}
          height={Math.round(screenH * 0.32)}
        />

        {/* Same reason as the sheet: edge-to-edge stops Android resizing for
            the keyboard, so the delivery code and its button would sit under
            it. */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior="padding"
          keyboardVerticalOffset={bottomInset}
        >
        <ScrollView
          contentContainerStyle={{
            padding: gspace.xl,
            paddingBottom: gspace.xxxl + bottomInset,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <GlassCard>
            <GlassText variant="title">{order.customer_name}</GlassText>
            <GlassText variant="body" tone="soft" style={{ marginTop: 2 }}>
              {order.delivery_address}
            </GlassText>
            <DeliveryNote note={order.delivery_note} />
            {/* No pin: the map has no door to draw the road to. Say why, and
                that Navigate still works — it goes by the written address. A
                pin looked up from the typed address is only near the door. */}
            {order.latitude == null || order.longitude == null ? (
              <GlassText variant="caption" tone="faint" style={{ marginTop: gspace.xs }}>
                No map pin for this address yet — Navigate uses the written address.
              </GlassText>
            ) : order.location_source === 'geocoded' ? (
              <GlassText variant="caption" tone="faint" style={{ marginTop: gspace.xs }}>
                Map pin is approximate, found from the typed address.
              </GlassText>
            ) : null}

            {/* How far the door still is, from the road the map drew rather
                than from a straight line across the city. Absent unless there
                is a route behind it. */}
            {leg && leg.distanceM > 0 ? (
              <GlassText variant="bodyStrong" tone="indigo" nums style={{ marginTop: gspace.sm }}>
                {routeSummary(leg.distanceM, leg.durationS)} away
              </GlassText>
            ) : null}

            <View style={{ flexDirection: 'row', gap: gspace.md, marginTop: gspace.lg }}>
              <GlassButton
                title="Navigate"
                kind="dark"
                icon="nav"
                onPress={() => navigateTo(order, riderAt, refreshRun)}
                style={{ flex: 1 }}
              />
              {order.customer_mobile ? (
                <GlassButton
                  title="Call"
                  kind="ghost"
                  icon="phone"
                  onPress={callCustomer}
                  style={{ flex: 1 }}
                />
              ) : null}
              {canMessageCustomer ? <WhatsAppSquare onPress={messageCustomer} /> : null}
            </View>
            {/* One-tap messages at the door ("I'm at the gate"). */}
            {canMessageCustomer ? <QuickReplies order={order} stage="door" /> : null}
          </GlassCard>

          {/* A tinted panel rather than centred body text. This is the one
              thing on the screen a rider must not forget, and as plain
              paragraph it read like a caption between two cards. */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginTop: gspace.lg,
              padding: gspace.lg,
              borderRadius: gradius.chip,
              backgroundColor: cod ? glass.orangeSoft : glass.greenSoft,
              borderWidth: 1,
              borderColor: cod ? glass.orangeLine : glass.greenSoft,
            }}
          >
            <View style={{ flex: 1, paddingRight: gspace.md }}>
              <GlassText variant="label" tone={cod ? 'orange' : 'green'} upper>
                {cod ? 'Cash on delivery' : 'Already paid'}
              </GlassText>
              <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
                {cod ? 'Collect before handing over' : 'Collect nothing'}
              </GlassText>
            </View>
            {cod ? (
              <GlassText variant="subtitle" nums>
                {money(order.amount_to_collect, order.currency)}
              </GlassText>
            ) : null}
          </View>

          {/* Card instead of cash: the customer scans the pay page with their
              own phone. The job polls every 15s, so once the payment lands it
              turns paid, `pay_url` goes null, and this and the cash prompt above
              give way to "Already paid" by themselves. */}
          {cod && order.pay_url ? (
            <GlassCard style={{ marginTop: gspace.lg }}>
              <GlassText
                variant="label"
                tone="soft"
                upper
                style={{ textAlign: 'center', marginBottom: gspace.md }}
              >
                Or the customer pays by card
              </GlassText>
              <PayQr url={order.pay_url} />
            </GlassCard>
          ) : null}

          {/* The same panel as the pickup code, so two codes in one flow cannot
              end up looking like different controls. */}
          <CodeSheet
            visible={codeOpen && primary === 'verify_delivery_otp'}
            title="Enter the customer's code"
            hint={notice ?? 'Ask the customer for the 6-digit code Odoo sent them on WhatsApp.'}
            sentTo={order.customer_mobile}
            value={otp}
            onChange={setOtp}
            error={otpError}
            busy={busy}
            canSubmit={otp.length === 6}
            submitLabel={ACTION_LABEL.verify_delivery_otp}
            submitKind="green"
            onSubmit={() => run('verify_delivery_otp')}
            onClose={() => setCodeOpen(false)}
            onResend={() => void resendCode()}
            resendAt={resendAt}
            resending={resending}
            resendClosed={resendClosed}
          />

          {error ? (
            <GlassText variant="bodyStrong" tone="red" style={{ marginTop: gspace.lg }}>
              {error}
            </GlassText>
          ) : null}
          {pending ? <PendingLine entry={pending} /> : null}
          {/* Without background location the near-customer message cannot fire. */}
          {shouldTrack ? <LocationAlwaysBanner /> : null}

          {reportedNote ? <ArrivalBanner text={reportedNote} /> : null}
          {order.problem ? (
            <ProblemBanner problem={order.problem} drop={order.drop_point ?? null} />
          ) : null}
          {order.reports?.length ? <ReportsCard reports={order.reports} timezone={timezone} /> : null}
          {dropNote ? <ArrivalBanner text={dropNote} /> : null}
          {order.near_customer_auto && !reached ? (
            <ArrivalBanner
              text={`Marked near the customer automatically${
                order.near_customer_at ? ` at ${timeOnly(order.near_customer_at, timezone)}` : ''
              }. They have been told you are close.`}
            />
          ) : null}
          {prompt?.kind === 'door' ? (
            <ArrivalBanner text="You're at the door. Send the customer their code." />
          ) : null}

          {/* At the door first: Odoo sends the customer their code only now,
              so it is live for the minutes it is needed. Then the code. */}
          <GlassButton
            title={reached ? ACTION_LABEL.verify_delivery_otp : 'Reached – send the customer code'}
            kind="green"
            icon={reached ? 'check' : 'pin'}
            onPress={() => (reached ? setCodeOpen(true) : void reachCustomer())}
            loading={busy}
            style={{ marginTop: gspace.xxl }}
          />

          {/* The office may have sent the code from the job form, or this
              phone may have been swapped mid-job: no need to send another. */}
          {!reached ? (
            <StrongAction
              label="Customer already has a code"
              icon="lock"
              onPress={() => setCodeOpen(true)}
              disabled={busy}
            />
          ) : null}
          <TroubleRow
            actions={secondary}
            onAction={(a) => run(a)}
            onCallSupport={supportNumber ? callSupport : undefined}
            disabled={busy}
          />
        </ScrollView>
        </KeyboardAvoidingView>
      </GlassScreen>
    );
  }

  /* ----------------------------------------------------------------- *
   * En route.
   *
   * A map sits behind this sheet again. The one deleted in b32f0b0 was a
   * still image of the destination alone, so with `latitude` and `longitude`
   * always null it could only draw a grey panel. `RouteMap` draws the rider
   * instead, which the phone knows without asking Odoo anything, and adds the
   * destination pin and the line to it if and when the backend starts
   * geocoding. It is never the empty rectangle that one became.
   *
   * `RouteMap` returns null with no style URL configured, and the sheet then
   * takes the whole screen exactly as it did before.
   * ----------------------------------------------------------------- */
  // The sheet leads with whoever the rider is on the way to, and only they get
  // buttons. Both ends had their own call and WhatsApp before, so a collected
  // job showed two sets, with Navigate beside a shop it no longer went to.
  const toCustomer = headingFor(order.delivery_status) === 'customer';
  return (
    <GlassScreen>
      {/* The shop is an object since N2 but a bare string on older captures,
          so read coordinates off it only when it is the object. */}
      <RouteMap
        latitude={order.latitude}
        longitude={order.longitude}
        shopLatitude={shopInfo(order.shop)?.latitude ?? null}
        shopLongitude={shopInfo(order.shop)?.longitude ?? null}
        heading={headingFor(order.delivery_status)}
        onRoute={setLeg}
                onRiderMove={setRiderAt}
        /* Smaller at the counter: a rider entering the pickup code is standing
           at the shop, so a map half the screen tall is showing them where they
           already are. */
        height={Math.round(screenH * (collecting ? 0.28 : 0.4))}
      />

      {/* Over the map when there is one, in normal flow when there is not —
          absolute against a missing map would drop it onto the sheet. */}
      {/* Back button and state chip ride over the map, at its two corners.
          Without a map they fall into normal flow, or they would land on the
          sheet. The chip is the same one the card badge uses. */}
      <View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: gspace.xl,
          },
          MAP_ENABLED
            ? { position: 'absolute', top: insets.top + gspace.sm, left: 0, right: 0, zIndex: 1 }
            : { paddingTop: insets.top + gspace.sm },
        ]}
      >
        <RoundButton icon="chev" mirrored onPress={() => router.back()} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: gspace.sm }}>
          {/* Only with a route behind it. Guarded on the distance rather than
              on the object: a response that arrived without a summary would
              otherwise read "0 m", which is worse than saying nothing. */}
          {leg && leg.distanceM > 0 ? (
            <GlassPill
              label={routeSummary(leg.distanceM, leg.durationS)}
              bg={glass.white}
              fg={glass.ink}
            />
          ) : null}
          <GlassPill label={band.label} bg={band.bg} fg={band.fg} />
          {/* Emergency help, in the same corner as on Home (SosSheet.tsx). */}
          <SosShield orderId={order.delivery_order_id} orderRef={photoRef(order)} />
        </View>
      </View>

      {/* The code boxes sit low on this screen, so the keyboard covered them
          and the button under them. app.json turns edge-to-edge on, which
          stops Android resizing the window for the keyboard, so the inset has
          to be added here rather than left to the system. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={bottomInset}
      >
      <ScrollView
        style={{ marginTop: gspace.lg }}
        contentContainerStyle={{ paddingBottom: gspace.xxxl + bottomInset }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            {
              backgroundColor: glass.fillStrong,
              borderTopLeftRadius: gradius.card,
              borderTopRightRadius: gradius.card,
              borderWidth: 1,
              borderColor: glass.border,
              padding: gspace.xl,
              /* Full width on a phone, a centred column on a tablet. Unbounded,
                 an item name and its "x2" ended up a metre apart. */
              width: '100%',
              maxWidth: SHEET_MAX_W,
              alignSelf: 'center',
            },
            gshadow.glass,
          ]}
        >
          {/* How far through the job, from the timestamps the contract has
              been sending since N2 and the app ignored entirely. */}
          <View style={{ marginBottom: gspace.xl }}>
            <GlassProgress order={order} timezone={timezone} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <View style={{ flex: 1, paddingRight: gspace.md }}>
              <GlassText variant="label" tone="faint" upper>
                Order {order.delivery_order_name}
              </GlassText>
              <GlassText variant="title" style={{ marginTop: 2 }} numberOfLines={1}>
                {toCustomer ? order.customer_name : shopName(order.shop)}
              </GlassText>
              {toCustomer && order.delivery_address ? (
                <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }} numberOfLines={2}>
                  {order.delivery_address}
                </GlassText>
              ) : null}
              {toCustomer ? <DeliveryNote note={order.delivery_note} /> : null}
            </View>
            <View style={{ flexDirection: 'row', gap: gspace.sm }}>
              {/* Before pickup the shop, after it the customer; like WhatsApp,
                  drawn only when there is a number to reach. */}
              {(toCustomer ? order.customer_mobile : shopPhone(order.shop)) ? (
                <RoundButton icon="phone" onPress={toCustomer ? callCustomer : callShop} />
              ) : null}
              {(toCustomer ? canMessageCustomer : canMessageShop) ? (
                <RoundButton
                  icon="whatsapp"
                  onPress={toCustomer ? messageCustomer : messageShop}
                />
              ) : null}
              <RoundButton icon="nav" filled onPress={() => navigateTo(order, riderAt, refreshRun)} />
            </View>
          </View>

          {/* One-tap messages on the way to the customer ("I'm on my way"). */}
          {toCustomer && canMessageCustomer ? <QuickReplies order={order} stage="way" /> : null}

          {/* The other end of the job, as a plain line: where the parcel goes
              next, or where it came from. */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: glass.fill,
              borderRadius: gradius.chip,
              borderWidth: 1,
              borderColor: glass.border,
              padding: gspace.md,
              marginTop: gspace.lg,
            }}
          >
            <GlassIcon
              name={toCustomer ? 'store' : 'pin'}
              color={toCustomer ? glass.inkSoft : glass.orange}
              size={18}
            />
            <GlassText variant="body" style={{ flex: 1, marginLeft: gspace.sm }} numberOfLines={2}>
              {toCustomer
                ? `From: ${shopName(order.shop) || 'the shop'}`
                : locked
                  ? `Then: ${[order.customer_name, area, dropKm].filter(Boolean).join(' · ')}`
                  : `Then: ${order.customer_name} · ${order.delivery_address}`}
            </GlassText>
          </View>

          {order.promised_by ? (
            <GlassText variant="caption" tone="soft" nums style={{ marginTop: gspace.sm }}>
              Promised {promisedAt(order.promised_by, timezone)}
            </GlassText>
          ) : null}

          {/* Collect, Items and Due. `promised_by` was only ever shown on the
              list, so the rider had to go back a screen to see when a job was
              due. The trip's pay follows, for a Delivery Partner. */}
          <View style={{ flexDirection: 'row', gap: gspace.md, marginTop: gspace.lg }}>
            <Tile
              label="Collect"
              value={cod ? money(order.amount_to_collect, order.currency) : 'Paid'}
              tone={cod ? glass.red : glass.green}
            />
            {/* Units, as the offer counts them: one line of ×2 is 2 items. */}
            <Tile
              label="Items"
              value={String((order.products ?? []).reduce((n, p) => n + (Number(p.quantity) || 1), 0))}
            />
            {/* Counting down rather than a clock reading — the same label the
                cards carry, so one job cannot read two ways. */}
            <Tile
              label="Due"
              value={due?.text ?? (timeOnly(order.promised_by, timezone) || '—')}
              tone={due?.late ? glass.red : undefined}
            />
          </View>
          {order.rider_fee ? <FeeLine label="You earn on this trip" fee={order.rider_fee} /> : null}

          {order.products?.length ? (
            <View style={{ marginTop: gspace.lg }}>
              {/* The shop packs and checks the bag, the way Zomato and Blinkit
                  do it; the rider does not tick items and is not blocked by
                  them. This is the manifest, shown so the rider knows what the
                  bag should hold — anything wrong goes through Report a problem. */}
              {collecting ? (
                <GlassText variant="label" tone="soft" upper style={{ marginBottom: gspace.xs }}>
                  In the bag
                </GlassText>
              ) : null}
              {order.products.map((p, i) => (
                <GlassCheckRow key={`${p.name}-${i}`} name={p.name} quantity={p.quantity} />
              ))}
            </View>
          ) : null}

          {unlockedNote && toCustomer ? <ArrivalBanner text={unlockedNote} /> : null}
          {reportedNote ? <ArrivalBanner text={reportedNote} /> : null}
          {order.problem ? (
            <ProblemBanner problem={order.problem} drop={order.drop_point ?? null} />
          ) : null}
          {order.reports?.length ? <ReportsCard reports={order.reports} timezone={timezone} /> : null}
          {dropNote ? <ArrivalBanner text={dropNote} /> : null}

          {prompt?.kind === 'shop' && arrivalDue ? (
            <ArrivalBanner text={`You're at the branch. Tap "${ACTION_LABEL.arrived_shop}".`} />
          ) : prompt?.kind === 'shop' && !branch ? (
            <ArrivalBanner text="You're at the shop. Ask the counter for the pickup code." />
          ) : prompt?.kind === 'near' ? (
            <ArrivalBanner
              text={
                autoNearHere
                  ? `About ${distanceText(prompt.metres)} from the customer. You will be marked near automatically in about ${autoNear?.dwell_seconds ?? 20} s, or tap now.`
                  : `About ${distanceText(prompt.metres)} from the customer. Tap "I am near the customer" so they get ready.`
              }
            />
          ) : null}

          {/* The code has its own panel now. See src/ui/CodeSheet.tsx for why it
              stopped living at the foot of this sheet, under everything else. */}
          <CodeSheet
            visible={codeOpen && collecting}
            title={takeover ? 'Enter the handover code' : 'Enter the pickup code'}
            hint={
              takeover
                ? `Type the 6-digit code shown on ${takeover.name}'s phone.`
                : branch
                ? 'Type the 6-digit code shown on the branch screen. The counter reads it out once they press Dispatch.'
                : (notice ??
                  'Ask the counter for the 6-digit pickup code. If the job has no shop, it comes to your WhatsApp.')
            }
            value={otp}
            onChange={setOtp}
            error={otpError}
            busy={busy}
            canSubmit={otp.length === 6}
            submitLabel={ACTION_LABEL.verify_pickup_otp}
            onSubmit={() => run('verify_pickup_otp')}
            onClose={() => setCodeOpen(false)}
            // No resend: the pickup code goes to the shop's WhatsApp when the
            // job has a shop, and to the rider's only when it has none.
            // /pickup/request-otp always goes to the shop, so a rider-side
            // resend could never reach the rider.
          />

          {error ? (
            <GlassText variant="bodyStrong" tone="red" style={{ marginTop: gspace.lg }}>
              {error}
            </GlassText>
          ) : null}
          {pending ? <PendingLine entry={pending} /> : null}
          {/* Without background location the near-customer message cannot fire. */}
          {shouldTrack ? <LocationAlwaysBanner /> : null}

          {/* At the counter in branch mode: staff check the rider is there,
              press Dispatch, and a code pops up on their screen. */}
          {awaitingCode ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginTop: gspace.lg,
                paddingVertical: gspace.md,
                paddingHorizontal: gspace.lg,
                borderRadius: gradius.card,
                backgroundColor: glass.fill,
                borderWidth: 1,
                borderColor: glass.border,
              }}
            >
              <ActivityIndicator color={glass.indigo} />
              <GlassText variant="body" style={{ flex: 1, marginLeft: gspace.md }}>
                {notice ??
                  "Tell the counter you're here. They'll press Dispatch and read you the pickup code."}
              </GlassText>
            </View>
          ) : branch && primary === 'verify_pickup_otp' ? (
            <ArrivalBanner text="The counter has your code. Type the 6 digits they read out." />
          ) : null}

          {/* Only what Odoo permits, in the order Odoo permits it. */}
          {primary ? (
            <GlassButton
              title={ACTION_LABEL[primary]}
              kind="indigo"
              icon="check"
              onPress={() => (needsOtp ? openCode() : run(primary))}
              loading={busy}
              style={{ marginTop: gspace.xl }}
            />
          ) : (
            <GlassText variant="body" tone="soft" style={{ marginTop: gspace.xl }}>
              {/* No action is not always "finished": a job the shop is still
                  packing has none either, and read as done. */}
              {order.delivery_status === 'to_assign'
                ? 'The office is still assigning this job. Nothing to do yet.'
                : order.delivery_status === 'ready'
                  ? 'Packed at the shop. It will be offered to a rider in a moment.'
                  : isAtShop(order.delivery_status)
                  ? "The shop is packing this order. You'll be called when it's ready."
                  : 'This job is finished. Nothing left to do.'}
            </GlassText>
          )}

          {awaitingCode ? (
            <StrongAction label="Remind the counter" icon="bell" onPress={remindCounter} disabled={busy} />
          ) : null}

          <TroubleRow
            actions={secondary}
            // "Collect – enter pickup code" before "I'm at the counter" opens the
            // code panel; sent as an action it went with no code and was refused.
            onAction={(a) => {
              if (a === 'verify_pickup_otp') {
                setArrivedHere(true);
                setOtp('');
                setOtpError(null);
                setCodeOpen(true);
              } else if (a === 'verify_delivery_otp') {
                // The door screen, where the rider sends or types the customer's code.
                setSkipToDoor(true);
                setOtp('');
                setOtpError(null);
              } else {
                void run(a);
              }
            }}
            onCallSupport={supportNumber ? callSupport : undefined}
            disabled={busy}
          />
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </GlassScreen>
  );
}

/**
 * "You're at the shop" and its kin: a nudge when the phone is close enough,
 * never a step taken for the rider (see `arrivalPrompt`).
 */
/**
 * What the server is doing about a reported problem, with the wait counted
 * down to the second so the rider knows when a return opens.
 */
function ProblemBanner({ problem, drop }: { problem: JobProblem; drop: DropPoint | null }) {
  const now = useNow(1000);
  const left = problem.wait_until ? Math.max(secondsUntil(problem.wait_until, now) ?? 0, 0) : 0;
  const clock = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
  const waiting = left > 0;
  let text: string;
  if (['customer_refused', 'payment_refused', 'damaged'].includes(problem.reason)) {
    text = 'You can return the parcel to the shop now.';
  } else if (problem.waiting_for === 'customer_location') {
    text = waiting
      ? `Waiting for the customer to share their location. You can return the parcel in ${clock}.`
      : 'The customer has not shared a location. You can return the parcel now.';
  } else if (drop?.label?.startsWith('Where the rider is waiting')) {
    text = waiting
      ? `The customer was sent where you are waiting. You can return the parcel in ${clock}.`
      : 'The customer was sent where you are waiting. You can return the parcel now.';
  } else if (problem.wait_until) {
    text = waiting
      ? `The customer has been messaged. You can return the parcel in ${clock}.`
      : 'The customer did not come. You can return the parcel now.';
  } else {
    return null;
  }
  return <ArrivalBanner text={text} />;
}

/**
 * Every "Report a problem" on this job, newest first: the reason, the rider's
 * own words and photos, and whether the shop has pressed Done on it yet. The
 * server keeps them all (Rider_App_Report_Notes.pdf), oldest first.
 */
function ReportsCard({ reports, timezone }: { reports: JobReport[]; timezone?: string }) {
  const newestFirst = [...reports].reverse();
  return (
    <View
      style={{
        marginTop: gspace.lg,
        paddingVertical: gspace.md,
        paddingHorizontal: gspace.lg,
        borderRadius: gradius.card,
        backgroundColor: glass.fillStrong,
        borderWidth: 1,
        borderColor: glass.border,
        gap: gspace.md,
      }}
    >
      <GlassText variant="bodyStrong">Your reports</GlassText>
      {newestFirst.map((r) => {
        const label =
          r.reason_label || DELIVERY_REASONS.find((d) => d.code === r.reason)?.label || r.reason;
        return (
          <View key={r.id}>
            <GlassText variant="bodyStrong">
              {[timeOnly(r.at, timezone), label].filter(Boolean).join(' · ')}
            </GlassText>
            {r.note ? (
              <GlassText variant="body" style={{ marginTop: 2 }}>
                “{r.note}”
              </GlassText>
            ) : null}
            {r.photos?.length ? (
              <View style={{ flexDirection: 'row', gap: gspace.sm, marginTop: gspace.sm }}>
                {r.photos.map((p) => (
                  <ServerPhoto key={p.id} path={p.url} />
                ))}
              </View>
            ) : null}
            <GlassText
              variant="body"
              tone={r.handled_at ? 'green' : 'soft'}
              style={{ marginTop: 2 }}
            >
              {r.handled_at ? 'Seen by the shop' : 'Waiting for the shop'}
            </GlassText>
          </View>
        );
      })}
    </View>
  );
}

const DECLINE_ICON: Record<string, GlassIconName> = {
  'too far': 'compass',
  busy: 'clock',
  'vehicle problem': 'bike',
  other: 'alert',
};

/** The job being turned down: shop to customer area, distance, items, pay, time left. */
function DeclineSummary({
  order,
  riderAt,
  timezone,
}: {
  order: DeliveryOrder;
  riderAt: { latitude: number; longitude: number } | null;
  timezone?: string;
}) {
  const shop = shopInfo(order.shop);
  const shopAt = coords(shop?.latitude, shop?.longitude);
  // Units, as the offer screen counts them ("Items 2" for one line of two).
  const units = (order.products ?? []).reduce((n, p) => n + (Number(p.quantity) || 0), 0);
  const facts = [
    riderAt && shopAt ? `${distanceText(metresBetween(riderAt, shopAt))} to the shop` : null,
    units ? `${units} item${units === 1 ? '' : 's'}` : null,
    order.promised_by ? `Promised ${timeOnly(order.promised_by, timezone)}` : null,
  ].filter(Boolean);
  return (
    <View
      style={{
        marginTop: gspace.lg,
        padding: gspace.lg,
        borderRadius: gradius.card,
        backgroundColor: glass.fillStrong,
        borderWidth: 1,
        borderColor: glass.border,
      }}
    >
      <GlassText variant="label" tone="faint" upper>
        {order.delivery_order_name}
      </GlassText>
      <GlassText variant="subtitle" style={{ marginTop: 2 }} numberOfLines={2}>
        {shopName(order.shop)} → {order.customer_name}
      </GlassText>
      {order.customer_area ? (
        <GlassText variant="caption" tone="soft">
          {order.customer_area}
        </GlassText>
      ) : null}
      {facts.length ? (
        <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm }}>
          {facts.join(' · ')}
        </GlassText>
      ) : null}
      {order.rider_fee ? <FeeLine label="You would earn" fee={order.rider_fee} /> : null}
      {order.offer_expires_at ? (
        <View style={{ marginTop: gspace.md }}>
          <OfferCountdown expiresAt={order.offer_expires_at} onExpired={() => {}} />
        </View>
      ) : null}
    </View>
  );
}

function ArrivalBanner({ text }: { text: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: gspace.lg,
        paddingVertical: gspace.md,
        paddingHorizontal: gspace.lg,
        borderRadius: gradius.card,
        backgroundColor: glass.greenSoft,
        borderWidth: 1,
        borderColor: glass.green,
      }}
    >
      <GlassIcon name="pin" color={glass.green} size={18} />
      <GlassText variant="bodyStrong" tone="green" style={{ flex: 1, marginLeft: gspace.sm }}>
        {text}
      </GlassText>
    </View>
  );
}

/**
 * "Accept within 0:42", counted once a second against the server's clock.
 *
 * Its own component so the per-second tick redraws one line rather than the
 * whole job screen and its map. Says so once the time is up, and tells the
 * screen, which greys the buttons out and lets the next poll take the job away.
 */
function OfferCountdown({
  expiresAt,
  onExpired,
}: {
  expiresAt: string;
  onExpired: () => void;
}) {
  const now = useNow(1000);
  const left = secondsUntil(expiresAt, now);
  const gone = left === 0;

  useEffect(() => {
    if (gone) onExpired();
    // Once, when the time runs out — not again on every re-render after.
  }, [gone]); // eslint-disable-line react-hooks/exhaustive-deps

  if (left === null) return null;
  if (gone) {
    return (
      <GlassText variant="bodyStrong" tone="red">
        Offer expired – it went to another rider.
      </GlassText>
    );
  }
  const mins = Math.floor(left / 60);
  const secs = String(left % 60).padStart(2, '0');
  return (
    <GlassText variant="title" tone={left <= 10 ? 'red' : 'orange'} nums>
      Accept within {mins}:{secs}
    </GlassText>
  );
}

/** A stat tile in the sheet. */
function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: glass.fill,
        borderRadius: gradius.chip,
        borderWidth: 1,
        borderColor: glass.border,
        padding: gspace.md,
      }}
    >
      <GlassText variant="caption" tone="soft">
        {label}
      </GlassText>
      <GlassText
        variant="subtitle"
        nums
        style={{ color: tone ?? glass.ink, marginTop: 2 }}
        numberOfLines={1}
      >
        {value}
      </GlassText>
    </View>
  );
}

/**
 * The customer's landmark, flat or gate note, in bold under the address — the
 * line that finds the right door in a building with forty (delivery 19.0.21.4.0).
 */
function DeliveryNote({ note }: { note?: string }) {
  const text = note?.trim();
  if (!text) return null;
  return (
    <GlassText variant="bodyStrong" style={{ marginTop: gspace.xs }}>
      {text}
    </GlassText>
  );
}

/** This trip's pay, exactly as the server worked it out. Delivery Partners only. */
function FeeLine({ label, fee }: { label: string; fee: Money }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: gspace.md,
        padding: gspace.md,
        borderRadius: gradius.chip,
        backgroundColor: glass.greenSoft,
      }}
    >
      <GlassIcon name="cash" size={18} color={glass.green} />
      <GlassText variant="body" style={{ flex: 1, marginLeft: gspace.sm }}>
        {label}
      </GlassText>
      <GlassText variant="subtitle" nums style={{ color: glass.green }}>
        {fee.formatted}
      </GlassText>
    </View>
  );
}

/** A quiet secondary action, as the template draws them. */
function GhostLink({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => ({
        paddingVertical: gspace.md,
        alignItems: 'center',
        opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
      })}
    >
      <GlassText variant="body" tone="soft">
        {label}
      </GlassText>
    </Pressable>
  );
}

/*
 * The small actions under the main button, in two weights (owner's pick, "E"
 * of five drawn): a strong outline for a shortcut that belongs to the normal
 * job, and a smaller "Something wrong?" row for the ways out. They were grey
 * words in a line, which riders did not read as buttons.
 */

/** Ways out are red: they undo the job, so they must not look like the others. */
const DANGER_ACTIONS: readonly Action[] = ['return_to_shop', 'decline'];

const ACTION_ICON: Partial<Record<Action, GlassIconName>> = {
  report_issue: 'alert',
  return_to_shop: 'undo',
  decline: 'close',
  confirm_return: 'store',
};

/** Part of the normal job, full width: "Customer already has a code". */
function StrongAction({
  label,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  icon: GlassIconName;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        marginTop: gspace.md,
        height: 46,
        borderRadius: gradius.button,
        borderWidth: 1.5,
        borderColor: glass.band,
        backgroundColor: glass.white,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <GlassIcon name={icon} size={16} color={glass.band} />
      <GlassText variant="button" style={{ color: glass.band, marginLeft: gspace.sm }}>
        {label}
      </GlassText>
    </Pressable>
  );
}

/** A small button in the "Something wrong?" row; two share a line. */
function SmallAction({
  label,
  icon,
  danger,
  onPress,
  disabled,
}: {
  label: string;
  icon: GlassIconName;
  danger?: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const fg = danger ? glass.red : glass.inkSoft;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: '46%',
        minHeight: 42,
        paddingHorizontal: gspace.sm,
        borderRadius: gradius.button,
        borderWidth: 1,
        borderColor: danger ? 'rgba(185,28,28,0.45)' : glass.border,
        backgroundColor: glass.white,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <GlassIcon name={icon} size={15} color={fg} />
      <GlassText
        variant="bodyStrong"
        style={{ color: fg, fontSize: 13, marginLeft: gspace.xs, flexShrink: 1, textAlign: 'center' }}
      >
        {label}
      </GlassText>
    </Pressable>
  );
}

/**
 * The job's other actions from `allowed_actions`, plus Call support, as small
 * buttons under a quiet heading. Nothing drawn when there is nothing to offer.
 */
function TroubleRow({
  actions,
  onAction,
  onCallSupport,
  disabled,
  heading = 'Something wrong?',
}: {
  actions: Action[];
  onAction: (a: Action) => void;
  onCallSupport?: () => void;
  disabled?: boolean;
  heading?: string | null;
}) {
  if (actions.length === 0 && !onCallSupport) return null;
  return (
    <View style={{ marginTop: gspace.lg }}>
      {heading ? (
        <GlassText variant="label" tone="faint" upper style={{ marginBottom: gspace.sm }}>
          {heading}
        </GlassText>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: gspace.sm }}>
        {actions.map((a) => (
          <SmallAction
            key={a}
            label={ACTION_LABEL[a]}
            icon={ACTION_ICON[a] ?? 'chev'}
            danger={DANGER_ACTIONS.includes(a)}
            onPress={() => onAction(a)}
            disabled={disabled}
          />
        ))}
        {/* Last: a rider reaches for this when the job itself has stopped working. */}
        {onCallSupport ? (
          <SmallAction label="Call support" icon="phone" onPress={onCallSupport} disabled={disabled} />
        ) : null}
      </View>
    </View>
  );
}

/** Circular glass button — back, call, navigate. */
/** WhatsApp's own green: riders find it by colour before they read it. */
const WHATSAPP_GREEN = '#25D366';

/** Square, so it sits beside the Navigate and Call buttons without a label. */
function WhatsAppSquare({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Message on WhatsApp"
      style={({ pressed }) => ({
        width: 52,
        height: 52,
        borderRadius: gradius.button,
        borderWidth: 1,
        borderColor: glass.border,
        backgroundColor: glass.white,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <GlassIcon name="whatsapp" size={24} color={WHATSAPP_GREEN} />
    </Pressable>
  );
}

/** A step tapped with no signal, and the promise that it will go by itself. */
function PendingLine({ entry }: { entry: OutboxEntry }) {
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: glass.fill,
        borderRadius: gradius.chip,
        borderWidth: 1,
        borderColor: glass.border,
        padding: gspace.md,
        marginTop: gspace.lg,
      }}
    >
      <GlassIcon name="offline" size={18} color={glass.inkSoft} style={{ marginTop: 1 }} />
      <GlassText variant="body" tone="soft" style={{ flex: 1, marginLeft: gspace.sm }}>
        No signal. &ldquo;{stepLabel(entry.step)}&rdquo; will send by itself when you&rsquo;re
        back online.
      </GlassText>
    </View>
  );
}

function RoundButton({
  icon,
  onPress,
  filled,
  translucent,
  mirrored,
}: {
  icon: GlassIconName;
  onPress: () => void;
  filled?: boolean;
  translucent?: boolean;
  /** The icon set has no back-facing chevron, so the forward one is flipped. */
  mirrored?: boolean;
}) {
  const bg = translucent
    ? 'rgba(255,255,255,0.22)'
    : filled
      ? glass.indigo
      : glass.fillLight;
  const fg = filled || translucent ? glass.white : glass.indigo;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      hitSlop={8}
      style={({ pressed }) => [
        {
          width: 42,
          height: 42,
          borderRadius: 21,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: glass.border,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.8 : 1,
        },
        translucent ? null : gshadow.glass,
      ]}
    >
      <GlassIcon
        name={icon}
        color={fg}
        size={18}
        style={mirrored ? { transform: [{ scaleX: -1 }] } : undefined}
      />
    </Pressable>
  );
}
