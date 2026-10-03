import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
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
  DECLINE_REASONS,
  DELIVERY_REASONS,
  headingFor,
  isAtShop,
  PRIMARY_ACTIONS,
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
import { secondsUntil } from '../../../src/lib/clock';
import {
  hasLocationPermission,
  keepTracking,
  startTracking,
  stopTracking,
  trackedOrderId,
} from '../../../src/location/tracking';
import { stopOfferAlert } from '../../../src/hooks/useOfferAlert';
import { useSession } from '../../../src/store/session';
import {
  GlassBarState,
  glass,
  glassBand,
  gradius,
  gshadow,
  gspace,
} from '../../../src/theme/glass';
import { Field } from '../../../src/ui/Field';
import { LoadingArt } from '../../../src/ui/LoadingArt';
import { LocationPrimer } from '../../../src/ui/LocationPrimer';
import { CodeSheet } from '../../../src/ui/CodeSheet';
import { OtpInput } from '../../../src/ui/OtpInput';
import { MAP_ENABLED, RouteMap } from '../../../src/ui/RouteMap';
import { ProofPhoto, proofSent } from '../../../src/ui/ProofPhoto';
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
 * The template also shows a per-order fee ("You earn"), a distance and an ETA.
 * None of the three exists in the contract, so none is drawn — a number here
 * would be trusted and wrong.
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
 */
function navigateTo(
  order: DeliveryOrder,
  riderAt: { latitude: number; longitude: number } | null
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
 */
const shopToldFor = new Set<number>();

/** Arrival prompts already announced with a buzz, per job - once each. */
const buzzedFor = new Set<string>();

/** How close counts, per prompt: the shop door, the street, the doorstep. */
const AT_SHOP_M = 150;
const NEAR_CUSTOMER_M = 300;
const AT_DOOR_M = 50;

/** Metres as a rider reads them: "650 m", "1.2 km". */
function distanceText(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`;
}

/**
 * One line of the bag check, by what it is as well as where it sits: when the
 * office edits an order, a tick must not carry over to a different item that
 * has moved into its place.
 */
function tickKey(p: { name: string; quantity: number }, i: number): string {
  return `${i}|${p.name}|${p.quantity}`;
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
  const bottomInset = Math.max(insets.bottom, initialWindowMetrics?.insets.bottom ?? 0);
  const { height: screenH } = useWindowDimensions();
  // The shop's zone, from /auth/me — never the phone's own.
  const timezone = useSession((s) => s.timezone);
  // Fleet features, when the server has the fleet module: the door photo.
  const proofOn = useSession((s) => !!s.fleet?.features.includes('proof'));
  const proofRequired = useSession((s) => !!s.fleet?.proof_required);
  const [, setProofTick] = useState(0);

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
  /** Seconds left on the server's resend window, counted down locally. */
  const [cooldown, setCooldown] = useState(0);
  /** Which action is waiting on a reason, if any. */
  const [reasonFor, setReasonFor] = useState<Action | null>(null);
  /** Which action is waiting on the location explainer, if any. */
  const [primerFor, setPrimerFor] = useState<Action | null>(null);
  const [reasonNote, setReasonNote] = useState('');
  /** Whether the code panel is up. The code itself still lives in `otp`. */
  const [codeOpen, setCodeOpen] = useState(false);
  /**
   * Good news from the server — "the shop has been sent the code". Shown in
   * the code panel's hint, never in red: this used to go through `error`.
   */
  const [notice, setNotice] = useState<string | null>(null);

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
  /** Lines of the bag check ticked, by `tickKey`. */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** Said once the shop has been told what is missing from the bag. */
  const [bagNote, setBagNote] = useState<string | null>(null);
  const pickKey = `d369.picklist.${orderId}`;

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
        setOtp('');
        setCodeOpen(true);
      })
      .catch(() => {});
  }, [pending, reachedKey]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(pickKey)
      .then((raw) => {
        if (!live || !raw) return;
        const saved = JSON.parse(raw) as unknown[];
        setPicked(new Set(saved.filter((x): x is string => typeof x === 'string')));
      })
      // An unreadable list is an empty one — never a screen that will not open.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pickKey]);

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
    setCooldown(0);
    setCodeOpen(false);
    setPicked(new Set());
    setLeg(null);
    setRiderAt(null);
    setBagNote(null);
  }

  const { data: order, isLoading } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => api.order(orderId),
    refetchInterval: 15_000,
  });

  /**
   * A job opened while it is already on the road — the shop dispatched it on
   * its own screen, or the app restarted mid-trip — picks its reporting back
   * up. Never asks for permission here; the next step's tap does that, behind
   * the explainer.
   */
  const shouldTrack = !!order && trackingWanted(order.delivery_status, order.tracking);
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
  const primary = PRIMARY_ACTIONS.find((a) => actions.includes(a)) ?? null;
  const secondary = actions.filter((a) => a !== primary);

  // The job's state, as the list already shows it. Shared so a chip in a
  // header and a badge on a card can never disagree.
  const band = glassBand[order.delivery_status as GlassBarState] ?? glassBand.idle;

  /**
   * Whether this step wants a code. Decides only whether the primary button
   * opens the code panel or fires the action; the panel gates its own submit on
   * six digits, which is why no flag out here greys out the very button a rider
   * taps in order to enter the code.
   */
  const needsOtp = primary === 'verify_pickup_otp' || primary === 'verify_delivery_otp';
  const cod = order.payment_status === 'cod';

  /** The promise as pressure, counted against the server's clock. */
  const due = dueIn(order.promised_by, now);

  /** When the counter packed it, or empty — only the 369 Mart bridge sends it. */
  const packedAt = timeOnly(order.packed_at ?? undefined, timezone);


  /** At the counter waiting on the pickup code — the moment to check the bag. */
  const collecting = primary === 'verify_pickup_otp';

  /**
   * Every line ticked, or nothing to tick. Collect waits for it: these are
   * mostly high-value electronics, and a bag that leaves the counter short is
   * a second trip and an unhappy customer. It can never strand a job - the
   * shop can still press Dispatch on its own screen, and the job then arrives
   * here already collected.
   */
  const products = order.products ?? [];
  const unticked = products.filter((p, i) => !picked.has(tickKey(p, i)));
  const allChecked = unticked.length === 0;

  /** One tap to tell the shop exactly what is not in the bag. */
  function reportMissing() {
    const list = unticked.map((p) => `${p.name} x${p.quantity}`).join('; ');
    Alert.alert(
      'Tell the shop these are missing?',
      unticked.map((p) => `• ${p.name} ×${p.quantity}`).join('\n'),
      [
        { text: 'Look again', style: 'cancel' },
        {
          text: 'Tell the shop',
          onPress: () =>
            void fire('report_issue', `item_missing: ${list}`).then(() =>
              setBagNote(
                'The shop has been told. Wait for them to hand it over and tick it, or for the office to change the order.'
              )
            ),
        },
      ]
    );
  }

  /**
   * Tick one item off.
   *
   * Never sent anywhere. It does hold Collect back until every line is ticked
   * (see `allChecked`) - the owner's call for high-value stock - and the
   * shop's own Dispatch stays the way round it.
   */
  function togglePicked(key: string) {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
    AsyncStorage.setItem(pickKey, JSON.stringify([...next])).catch(() => {});
  }

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
    if (action === 'return_to_shop' || action === 'report_issue' || action === 'decline') {
      setError(null);
      setOtpError(null);
      setReasonNote('');
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

  async function fire(action: Action, reason?: string) {
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
        case 'verify_pickup_otp':
          res = await api.verifyPickupOtp(orderId, otp);
          // The documented sequence: the code, then /dispatch at once, so one
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
          res = await api.reportIssue(orderId, reason ?? 'other');
          break;
        default:
          return;
      }
      if (action === 'verify_pickup_otp') {
        setPicked(new Set());
        AsyncStorage.removeItem(pickKey).catch(() => {});
      }
      // Done with the door: a later job with this id must start fresh.
      if (action === 'verify_delivery_otp' || action === 'return_to_shop') markReached(false);
      // The panel has done its job. A wrong code keeps it open, showing the
      // server's message against the boxes.
      setCodeOpen(false);
      // The last panel's words belong to the last step.
      setNotice(null);
      await applyResult(res);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'network' && isQueueable(action)) {
        // No signal: the step waits in the outbox and goes by itself later.
        // The banner under the job says so; nothing here is an error.
        await enqueue(orderId, action, reason);
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
        Alert.alert('Offer expired', 'It went to another rider.');
        router.replace('/');
      } else if (err instanceof ApiError) {
        // Their message is written for riders — never replace it.
        if (err.code === 'bad_otp') {
          setOtpError(err.message);
          setOtp('');
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
   * Ask the shop to send the pickup code again.
   *
   * Verified on res-test1: with no WhatsApp session this answers success:false
   * — "Could not send the pickup code." — while still issuing the code.
   * Swallowing that left the button doing nothing visible, so the server's own
   * wording is shown.
   */
  async function requestOtp() {
    setError(null);
    setOtpError(null);
    try {
      const res = await api.requestPickupOtp(orderId);
      // Good news goes in the panel's hint, not in red under the screen.
      setNotice(res.message ?? null);
      // The server enforces the window; obey the number it sends rather than a
      // constant of our own.
      setCooldown(res.retry_after_seconds ?? 0);
    } catch (err) {
      setOtpError(
        err instanceof ApiError
          ? err.message
          : 'Could not reach the shop. Ask them to read the code out.'
      );
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
   * The customer has no code, or lost it: Odoo sends a fresh one and the old
   * one stops working - the shop guide's "Resend Customer Code".
   */
  async function resendCustomerCode() {
    setOtpError(null);
    setBusy(true);
    try {
      const res = await api.reachedCustomer(orderId);
      markReached(true);
      setNotice(res.message ?? 'A new code has been sent to the customer.');
      setOtp('');
    } catch (err) {
      setOtpError(
        err instanceof ApiError ? err.message : 'Could not send a new code. Try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Open the code panel. For the pickup code, this is also the moment the
   * rider is at the counter, so the shop is sent its code — once per job; see
   * `shopToldFor`.
   */
  function openCode() {
    setCodeOpen(true);
    if (primary !== 'verify_pickup_otp' || shopToldFor.has(orderId)) return;
    shopToldFor.add(orderId);
    setNotice('Checking with the shop…');
    // Where the rider is goes along, for the fleet module's arrival check.
    currentFix()
      .then((fix) => api.arrivedAtShop(orderId, fix))
      .then((res) => {
        setNotice(res.message ?? 'The shop has been sent the code.');
        setCooldown(res.retry_after_seconds ?? 0);
      })
      .catch((err) => {
        // Let the next open try again, and leave "resend" as the way out.
        shopToldFor.delete(orderId);
        setNotice(null);
        setOtpError(
          err instanceof ApiError
            ? err.message
            : 'Could not reach the shop. Tap "Ask the shop for a code".'
        );
      });
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
    Linking.openURL(`tel:${number}`).catch(() => {});
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
    return (
      <GlassScreen>
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + gspace.xxl,
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
          <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm }}>
            {declining
              ? 'It goes to the next rider at once, and is not offered to you again.'
              : returning
                ? 'The shop closes the return. This tells them what happened.'
                : 'This is logged against the job. It does not change anything you can do.'}
          </GlassText>

          <View style={{ marginTop: gspace.xl, gap: gspace.sm }}>
            {reasons.map((r) => (
              <Pressable
                key={r.code}
                disabled={busy}
                accessibilityRole="button"
                onPress={() => {
                  if (r.code === 'other') {
                    setReasonNote(' ');
                    return;
                  }
                  setReasonFor(null);
                  void fire(reasonFor, r.code);
                }}
                style={({ pressed }) => [
                  {
                    backgroundColor: glass.fillStrong,
                    borderRadius: gradius.card,
                    borderWidth: 1,
                    borderColor: glass.border,
                    paddingVertical: gspace.lg,
                    paddingHorizontal: gspace.xl,
                    opacity: pressed || busy ? 0.6 : 1,
                  },
                ]}
              >
                <GlassText variant="bodyStrong">{r.label}</GlassText>
              </Pressable>
            ))}
          </View>

          {/* Free text is only asked for behind "Something else" — the server
              accepts it alongside the codes, so nothing is lost either way. */}
          {reasonNote ? (
            <View style={{ marginTop: gspace.lg }}>
              <Field
                label="In your words"
                placeholder="A short line is enough — the office reads these"
                value={reasonNote.trimStart()}
                onChangeText={(v) => setReasonNote(v || ' ')}
                multiline
                autoFocus
              />
              <GlassButton
                title="Send"
                loading={busy}
                onPress={() => {
                  const note = reasonNote.trim();
                  setReasonFor(null);
                  void fire(reasonFor, note ? `other: ${note}` : 'other');
                }}
                style={{ marginTop: gspace.lg }}
              />
            </View>
          ) : null}

          {/* A reason helps the shop choose who to call next, but it is the
              rider's to give: the decline itself never waits on one. */}
          {declining ? (
            <GhostLink
              label="Decline without a reason"
              disabled={busy}
              onPress={() => {
                setReasonFor(null);
                void fire('decline', '');
              }}
            />
          ) : null}
          <GhostLink
            label="Never mind"
            disabled={busy}
            onPress={() => {
              setReasonFor(null);
              setReasonNote('');
            }}
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
              Pick up from
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
            <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
              {order.delivery_address}
            </GlassText>
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

          {/* Side by side rather than stacked. Full-width one under another,
              they read as three primary actions competing with the real one. */}
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'center',
              columnGap: gspace.xl,
            }}
          >
            {secondary.map((a) => (
              <GhostLink
                key={a}
                label={ACTION_LABEL[a]}
                onPress={() => run(a)}
                disabled={busy || offerGone}
              />
            ))}
            {/* Last, and only when a number is configured. A rider reaches for
                this when the job itself has stopped working. */}
            {supportNumber ? (
              <GhostLink label="Call support" onPress={callSupport} disabled={busy} />
            ) : null}
          </View>
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
          <View style={{ minWidth: 40, alignItems: 'flex-end' }}>
            <GlassPill label={band.label} bg={band.bg} fg={band.fg} />
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
            {/* No pin: the map has no door to draw the road to. Say why, and
                that Navigate still works — it goes by the written address. */}
            {order.latitude == null || order.longitude == null ? (
              <GlassText variant="caption" tone="faint" style={{ marginTop: gspace.xs }}>
                No map pin for this address yet — Navigate uses the written address.
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
                onPress={() => navigateTo(order, riderAt)}
                style={{ flex: 1 }}
              />
              <GlassButton
                title="Call"
                kind="ghost"
                icon="phone"
                onPress={callCustomer}
                style={{ flex: 1 }}
              />
              {canMessageCustomer ? <WhatsAppSquare onPress={messageCustomer} /> : null}
            </View>
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

          {/* The parcel at the door, before the code — on a server that keeps it. */}
          {proofOn && primary === 'verify_delivery_otp' ? (
            <ProofPhoto
              orderId={orderId}
              required={proofRequired}
              onSent={() => setProofTick((n) => n + 1)}
            />
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
            onResend={resendCustomerCode}
          />

          {error ? (
            <GlassText variant="bodyStrong" tone="red" style={{ marginTop: gspace.lg }}>
              {error}
            </GlassText>
          ) : null}
          {pending ? <PendingLine entry={pending} /> : null}

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
            // Held back until the required photo is in; the server refuses the
            // code without it anyway, and a refusal after typing six digits is
            // the worse way to find out.
            disabled={reached && proofOn && proofRequired && !proofSent(orderId)}
            style={{ marginTop: gspace.xxl }}
          />

          {/* Side by side rather than stacked. Full-width one under another,
              they read as three primary actions competing with the real one. */}
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'center',
              columnGap: gspace.xl,
            }}
          >
            {/* The office may have sent the code from the job form, or this
                phone may have been swapped mid-job: no need to send another. */}
            {!reached ? (
              <GhostLink
                label="Customer already has a code"
                onPress={() => setCodeOpen(true)}
                disabled={busy}
              />
            ) : null}
            {secondary.map((a) => (
              <GhostLink key={a} label={ACTION_LABEL[a]} onPress={() => run(a)} disabled={busy} />
            ))}
            {/* Last, and only when a number is configured. A rider reaches for
                this when the job itself has stopped working. */}
            {supportNumber ? (
              <GhostLink label="Call support" onPress={callSupport} disabled={busy} />
            ) : null}
          </View>
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
            </View>
            <View style={{ flexDirection: 'row', gap: gspace.sm }}>
              <RoundButton icon="phone" onPress={toCustomer ? callCustomer : callShop} />
              {(toCustomer ? canMessageCustomer : canMessageShop) ? (
                <RoundButton
                  icon="whatsapp"
                  onPress={toCustomer ? messageCustomer : messageShop}
                />
              ) : null}
              <RoundButton icon="nav" filled onPress={() => navigateTo(order, riderAt)} />
            </View>
          </View>

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
                : `Then: ${order.customer_name} · ${order.delivery_address}`}
            </GlassText>
          </View>

          {order.promised_by ? (
            <GlassText variant="caption" tone="soft" nums style={{ marginTop: gspace.sm }}>
              Promised {promisedAt(order.promised_by, timezone)}
            </GlassText>
          ) : null}

          {/* Collect, Items and Due. The template's "You earn" has no field
              behind it, and there is still no distance or ETA in the contract —
              but `promised_by` is real and was only ever shown on the list, so
              the rider had to go back a screen to see when a job was due. */}
          <View style={{ flexDirection: 'row', gap: gspace.md, marginTop: gspace.lg }}>
            <Tile
              label="Collect"
              value={cod ? money(order.amount_to_collect, order.currency) : 'Paid'}
              tone={cod ? glass.red : glass.green}
            />
            <Tile label="Items" value={String(order.products?.length ?? 0)} />
            {/* Counting down rather than a clock reading — the same label the
                cards carry, so one job cannot read two ways. */}
            <Tile
              label="Due"
              value={due?.text ?? (timeOnly(order.promised_by, timezone) || '—')}
              tone={due?.late ? glass.red : undefined}
            />
          </View>

          {order.products?.length ? (
            <View style={{ marginTop: gspace.lg }}>
              {/* At the counter this manifest becomes a checklist, so the rider
                  can tick each line against what the shop is actually handing
                  over. Everywhere else in the job it stays the plain list it
                  was — there is nothing to check off once the bag is aboard. */}
              {collecting ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: gspace.xs,
                  }}
                >
                  <GlassText variant="label" tone="soft" upper>
                    Check the bag
                  </GlassText>
                  <GlassText variant="caption" tone="soft" nums>
                    {products.length - unticked.length} of {products.length}
                  </GlassText>
                </View>
              ) : null}
              {collecting ? (
                <GlassText
                  variant="caption"
                  tone={allChecked ? 'green' : 'orange'}
                  style={{ marginBottom: gspace.xs }}
                >
                  {allChecked
                    ? `All ${products.length} checked - ready to collect.`
                    : 'Tick each item once it is in the bag.'}
                </GlassText>
              ) : null}

              {order.products.map((p, i) => (
                <GlassCheckRow
                  key={`${p.name}-${i}`}
                  name={p.name}
                  quantity={p.quantity}
                  checked={collecting && picked.has(tickKey(p, i))}
                  onToggle={collecting ? () => togglePicked(tickKey(p, i)) : undefined}
                />
              ))}
            </View>
          ) : null}

          {prompt?.kind === 'shop' ? (
            <ArrivalBanner
              text={
                allChecked
                  ? "You're at the shop. Ask the counter for the pickup code."
                  : "You're at the shop. Check the bag, then enter the pickup code."
              }
            />
          ) : prompt?.kind === 'near' ? (
            <ArrivalBanner
              text={`About ${distanceText(prompt.metres)} from the customer. Tap "I am near the customer" so they get ready.`}
            />
          ) : null}

          {/* The code has its own panel now. See src/ui/CodeSheet.tsx for why it
              stopped living at the foot of this sheet, under everything else. */}
          <CodeSheet
            visible={codeOpen && primary === 'verify_pickup_otp'}
            title="Enter the pickup code"
            hint={
              notice ?? 'The shop staff will read this out when they hand the parcel over.'
            }
            value={otp}
            onChange={setOtp}
            error={otpError}
            busy={busy}
            canSubmit={otp.length === 6}
            submitLabel={ACTION_LABEL.verify_pickup_otp}
            onSubmit={() =>
              allChecked ? run('verify_pickup_otp') : setOtpError('Tick every item in the bag first.')
            }
            onClose={() => setCodeOpen(false)}
            // The shop's own wait, from the server, rather than the card's 30s.
            onResend={requestOtp}
            resendIn={cooldown}
          />

          {error ? (
            <GlassText variant="bodyStrong" tone="red" style={{ marginTop: gspace.lg }}>
              {error}
            </GlassText>
          ) : null}
          {pending ? <PendingLine entry={pending} /> : null}

          {/* Only what Odoo permits, in the order Odoo permits it. */}
          {primary ? (
            <GlassButton
              title={ACTION_LABEL[primary]}
              kind="indigo"
              icon="check"
              onPress={() => (needsOtp ? openCode() : run(primary))}
              loading={busy}
              disabled={collecting && !allChecked}
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

          {collecting && !allChecked && actions.includes('report_issue') ? (
            <GhostLink label="Item missing? Tell the shop" onPress={reportMissing} disabled={busy} />
          ) : null}
          {collecting && bagNote ? (
            <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm, textAlign: 'center' }}>
              {bagNote}
            </GlassText>
          ) : null}

          {/* Side by side rather than stacked. Full-width one under another,
              they read as three primary actions competing with the real one. */}
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'center',
              columnGap: gspace.xl,
            }}
          >
            {secondary.map((a) => (
              <GhostLink key={a} label={ACTION_LABEL[a]} onPress={() => run(a)} disabled={busy} />
            ))}
            {/* Last, and only when a number is configured. A rider reaches for
                this when the job itself has stopped working. */}
            {supportNumber ? (
              <GhostLink label="Call support" onPress={callSupport} disabled={busy} />
            ) : null}
          </View>
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
