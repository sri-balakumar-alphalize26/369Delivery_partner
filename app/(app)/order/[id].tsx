import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../../src/api/endpoints';
import {
  ACTION_LABEL,
  Action,
  ActionResult,
  ApiError,
  DeliveryOrder,
  DELIVERY_REASONS,
  headingFor,
  PRIMARY_ACTIONS,
} from '../../../src/api/types';
import { money, promisedAt, shopName, timeOnly } from '../../../src/lib/format';
import {
  hasLocationPermission,
  startTracking,
  stopTracking,
} from '../../../src/location/tracking';
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
import { OtpBoxes } from '../../../src/ui/OtpBoxes';
import { OtpInput } from '../../../src/ui/OtpInput';
import { MAP_ENABLED, RouteMap } from '../../../src/ui/RouteMap';
import { GlassButton } from '../../../src/ui/glass/GlassButton';
import { GlassCard } from '../../../src/ui/glass/GlassCard';
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
 * Navigate by written address, always.
 *
 * The backend settled this: nothing in the flow geocodes an address, so
 * `latitude` and `longitude` will always be null — "stop drawing the map and
 * navigate on delivery_address". A coordinate branch here would be dead code
 * pretending to be a fallback.
 */
function navigateTo(order: DeliveryOrder) {
  const url = `https://maps.google.com/?q=${encodeURIComponent(order.delivery_address)}`;
  Linking.openURL(url).catch(() => {});
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
  const { height: screenH } = useWindowDimensions();
  // The shop's zone, from /auth/me — never the phone's own.
  const timezone = useSession((s) => s.timezone);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  /** Set from a 409 so a stale screen re-renders without a reload. */
  const [override, setOverride] = useState<Action[] | null>(null);
  /** Seconds left on the server's resend window, counted down locally. */
  const [cooldown, setCooldown] = useState(0);
  /** Which action is waiting on a reason, if any. */
  const [reasonFor, setReasonFor] = useState<Action | null>(null);
  /** Which action is waiting on the location explainer, if any. */
  const [primerFor, setPrimerFor] = useState<Action | null>(null);
  const [reasonNote, setReasonNote] = useState('');

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

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
    setOtp('');
    setError(null);
    setOtpError(null);
    setCooldown(0);
  }

  const { data: order, isLoading } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => api.order(orderId),
    refetchInterval: 15_000,
  });

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

  const needsOtp = primary === 'verify_pickup_otp' || primary === 'verify_delivery_otp';
  const canSubmit = !needsOtp || otp.length === 6;
  const cod = order.payment_status === 'cod';

  /** Applies whatever Odoo says came back, including any tracking instruction. */
  async function applyResult(res: ActionResult) {
    setOverride(res.allowed_actions);
    setOtp('');

    if (res.tracking?.enabled) {
      // The ONLY place tracking may start. Sending GPS before this is forbidden.
      const started = await startTracking(orderId);
      // One message per cause. This was a single sentence about Settings, which
      // was wrong advice for a rider whose permissions were fine and whose
      // location switch was simply off.
      if (!started.ok) setError(TRACKING_ERROR[started.reason]);
    } else {
      await stopTracking();
    }

    await qc.invalidateQueries();

    if (res.status === 'delivered' || res.status === 'returned') {
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
    if (action === 'return_to_shop' || action === 'report_issue') {
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
    if (action === 'start_delivery' && !(await hasLocationPermission())) {
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
        case 'verify_pickup_otp':
          res = await api.verifyPickupOtp(orderId, otp);
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
          // The contract's prose says only the shop closes a return, while its
          // state table offers this action to the rider. Render what Odoo
          // offers and let Odoo refuse it — a 409 re-renders from the truth.
          res = await api.confirmReturn(orderId);
          break;
        case 'report_issue':
          res = await api.reportIssue(orderId, reason ?? 'other');
          break;
        default:
          return;
      }
      await applyResult(res);
    } catch (err) {
      if (err instanceof ApiError) {
        // Their message is written for riders — never replace it.
        if (err.code === 'bad_otp') {
          setOtpError(err.message);
          setOtp('');
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

  const call = () => Linking.openURL(`tel:${order.customer_mobile}`).catch(() => {});

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
    return (
      <GlassScreen>
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + gspace.xxl,
            paddingHorizontal: gspace.xl,
            paddingBottom: gspace.xxxl + insets.bottom,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <GlassText variant="title">
            {returning ? 'Why are you returning it?' : 'What is the problem?'}
          </GlassText>
          <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm }}>
            {returning
              ? 'The shop closes the return. This tells them what happened.'
              : 'This is logged against the job. It does not change anything you can do.'}
          </GlassText>

          <View style={{ marginTop: gspace.xl, gap: gspace.sm }}>
            {DELIVERY_REASONS.map((r) => (
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
   * No Decline button: the contract gives `offered` only `accept`, so a rider
   * cannot refuse a job, and there is no expiry to count down. The template's
   * timer pill, "You earn", distance and estimated time are all dropped for
   * the same reason — no field exists behind any of them.
   * ----------------------------------------------------------------- */
  if (primary === 'accept') {
    return (
      <GlassScreen>
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + gspace.md,
            paddingHorizontal: gspace.xl,
            paddingBottom: gspace.xxxl + insets.bottom,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <RoundButton icon="chev" mirrored onPress={() => router.back()} />
            <GlassText variant="label" tone="orange" upper style={{ marginLeft: gspace.md }}>
              New job offer
            </GlassText>
          </View>

          <GlassText variant="hero" style={{ marginTop: gspace.lg }} numberOfLines={2}>
            {shopName(order.shop)} → {order.customer_name}
          </GlassText>

          <GlassCard style={{ marginTop: gspace.xl }}>
            <GlassText variant="label" tone="soft" upper>
              Pick up from
            </GlassText>
            <GlassText variant="bodyStrong" style={{ marginTop: gspace.xs }}>
              {shopName(order.shop)}
            </GlassText>

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

          <View style={{ alignItems: 'center', marginTop: gspace.xxl }}>
            {cod ? (
              <>
                <GlassText variant="body" tone="soft">
                  Cash to collect from customer
                </GlassText>
                <GlassText variant="amount" nums style={{ marginTop: gspace.xs }}>
                  {money(order.amount_to_collect, order.currency)}
                </GlassText>
              </>
            ) : (
              <GlassText variant="subtitle" tone="green">
                Already paid — collect nothing
              </GlassText>
            )}
          </View>

          {error ? (
            <GlassText variant="bodyStrong" tone="red" style={{ marginTop: gspace.lg }}>
              {error}
            </GlassText>
          ) : null}

          <GlassButton
            title={ACTION_LABEL[primary]}
            kind="orange"
            icon="check"
            onPress={() => run(primary)}
            loading={busy}
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
            {secondary.map((a) => (
              <GhostLink key={a} label={ACTION_LABEL[a]} onPress={() => run(a)} disabled={busy} />
            ))}
          </View>
        </ScrollView>
      </GlassScreen>
    );
  }

  /* ----------------------------------------------------------------- *
   * Handover — the delivery code is due.
   * ----------------------------------------------------------------- */
  if (primary === 'verify_delivery_otp') {
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
          shopLatitude={typeof order.shop === 'object' ? order.shop.latitude : null}
          shopLongitude={typeof order.shop === 'object' ? order.shop.longitude : null}
          heading={headingFor(order.delivery_status)}
          height={Math.round(screenH * 0.32)}
        />

        {/* Same reason as the sheet: edge-to-edge stops Android resizing for
            the keyboard, so the delivery code and its button would sit under
            it. */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior="padding"
          keyboardVerticalOffset={insets.bottom}
        >
        <ScrollView
          contentContainerStyle={{
            padding: gspace.xl,
            paddingBottom: gspace.xxxl + insets.bottom,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <GlassCard>
            <GlassText variant="title">{order.customer_name}</GlassText>
            <GlassText variant="body" tone="soft" style={{ marginTop: 2 }}>
              {order.delivery_address}
            </GlassText>

            <View style={{ flexDirection: 'row', gap: gspace.md, marginTop: gspace.lg }}>
              <GlassButton
                title="Navigate"
                kind="dark"
                icon="nav"
                onPress={() => navigateTo(order)}
                style={{ flex: 1 }}
              />
              <GlassButton
                title="Call"
                kind="ghost"
                icon="phone"
                onPress={call}
                style={{ flex: 1 }}
              />
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

          <GlassCard style={{ marginTop: gspace.xxl }}>
            <GlassText variant="label" tone="soft" upper>
              Delivery code
            </GlassText>
            <GlassText
              variant="body"
              tone="soft"
              style={{ marginTop: gspace.xs, marginBottom: gspace.lg }}
            >
              {/* WhatsApp, not SMS: the backend confirmed there is no SMS
                  gateway configured and no plan to add one. */}
              Ask the customer for the 6-digit code Odoo sent them on WhatsApp.
            </GlassText>
            <OtpBoxes value={otp} onChange={setOtp} error={otpError} />
          </GlassCard>

          {error ? (
            <GlassText variant="bodyStrong" tone="red" style={{ marginTop: gspace.lg }}>
              {error}
            </GlassText>
          ) : null}

          <GlassButton
            title={ACTION_LABEL[primary]}
            kind="green"
            icon="check"
            onPress={() => run(primary)}
            loading={busy}
            disabled={!canSubmit}
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
            {secondary.map((a) => (
              <GhostLink key={a} label={ACTION_LABEL[a]} onPress={() => run(a)} disabled={busy} />
            ))}
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
  return (
    <GlassScreen>
      {/* The shop is an object since N2 but a bare string on older captures,
          so read coordinates off it only when it is the object. */}
      <RouteMap
        latitude={order.latitude}
        longitude={order.longitude}
        shopLatitude={typeof order.shop === 'object' ? order.shop.latitude : null}
        shopLongitude={typeof order.shop === 'object' ? order.shop.longitude : null}
        heading={headingFor(order.delivery_status)}
        height={Math.round(screenH * 0.4)}
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
        <GlassPill label={band.label} bg={band.bg} fg={band.fg} />
      </View>

      {/* The code boxes sit low on this screen, so the keyboard covered them
          and the button under them. app.json turns edge-to-edge on, which
          stops Android resizing the window for the keyboard, so the inset has
          to be added here rather than left to the system. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={insets.bottom}
      >
      <ScrollView
        style={{ marginTop: gspace.lg }}
        contentContainerStyle={{ paddingBottom: gspace.xxxl + insets.bottom }}
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
                {shopName(order.shop)}
              </GlassText>
            </View>
            <View style={{ flexDirection: 'row', gap: gspace.sm }}>
              <RoundButton icon="phone" onPress={call} />
              <RoundButton icon="nav" filled onPress={() => navigateTo(order)} />
            </View>
          </View>

          {/* Where the parcel goes once the shop is done. */}
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
            <GlassIcon name="pin" color={glass.orange} size={18} />
            <GlassText variant="body" style={{ flex: 1, marginLeft: gspace.sm }} numberOfLines={2}>
              Then: {order.customer_name} · {order.delivery_address}
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
            <Tile label="Due" value={timeOnly(order.promised_by, timezone) || '—'} />
          </View>

          {order.products?.length ? (
            <View style={{ marginTop: gspace.lg }}>
              {order.products.map((p, i) => (
                <View
                  key={`${p.name}-${i}`}
                  style={{
                    flexDirection: 'row',
                    paddingVertical: gspace.sm,
                    borderBottomWidth: 1,
                    borderBottomColor: glass.divider,
                  }}
                >
                  <GlassText variant="body" style={{ flex: 1 }}>
                    {p.name}
                  </GlassText>
                  <GlassText variant="body" tone="soft" nums>
                    x{p.quantity}
                  </GlassText>
                </View>
              ))}
            </View>
          ) : null}

          {primary === 'verify_pickup_otp' ? (
            <View style={{ marginTop: gspace.lg }}>
              {/* The label row carries the resend, right-aligned. Below the
                  boxes it read as a second action of equal weight to entering
                  the code, which it is not. */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <GlassText variant="label" tone="soft" upper>
                  Pickup code
                </GlassText>
                {/* Verified on res-test1: with no WhatsApp session this answers
                    success:false — "Could not send the pickup code." — while
                    still issuing it. Swallowing that left the button doing
                    nothing visible, so the server's own wording is shown. */}
                <ResendLink
                  label={
                    cooldown > 0
                      ? `Ask shop to resend (${cooldown}s)`
                      : 'Ask shop to resend'
                  }
                  disabled={busy || cooldown > 0}
                  onPress={async () => {
                  setError(null);
                  setOtpError(null);
                  try {
                    const res = await api.requestPickupOtp(orderId);
                    if (res.message) setError(res.message);
                    // The server enforces the window; obey the number it sends
                    // rather than a constant of our own.
                    setCooldown(res.retry_after_seconds ?? 0);
                  } catch (err) {
                    setError(
                      err instanceof ApiError
                        ? err.message
                        : 'Could not reach the shop. Ask them to read the code out.'
                      );
                    }
                  }}
                />
              </View>

              <GlassText variant="body" tone="soft" style={{ marginTop: gspace.xs }}>
                The shop staff will read this out when they hand the parcel over.
              </GlassText>

              {/* Six bordered squares, the same component the delivery code
                  uses. This was OtpInput, which draws bare digits on a rule —
                  so the two codes in one flow looked like different controls. */}
              <View style={{ marginTop: gspace.lg }}>
                <OtpBoxes value={otp} onChange={setOtp} error={otpError} />
              </View>
            </View>
          ) : null}

          {error ? (
            <GlassText variant="bodyStrong" tone="red" style={{ marginTop: gspace.lg }}>
              {error}
            </GlassText>
          ) : null}

          {/* Only what Odoo permits, in the order Odoo permits it. */}
          {primary ? (
            <GlassButton
              title={ACTION_LABEL[primary]}
              kind="indigo"
              icon="check"
              onPress={() => run(primary)}
              loading={busy}
              disabled={!canSubmit}
              style={{ marginTop: gspace.xl }}
            />
          ) : (
            <GlassText variant="body" tone="soft" style={{ marginTop: gspace.xl }}>
              This job is finished. Nothing left to do.
            </GlassText>
          )}

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
          </View>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </GlassScreen>
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
/**
 * The resend, sized to sit on a label row rather than stand on its own line.
 *
 * `GhostLink` pads itself out to a full-width tap target, which is right for a
 * secondary action at the foot of a screen and wrong beside a heading.
 */
function ResendLink({
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
      hitSlop={8}
      style={({ pressed }) => ({ opacity: disabled ? 0.4 : pressed ? 0.6 : 1 })}
    >
      <GlassText variant="caption" tone="orange" nums>
        {label}
      </GlassText>
    </Pressable>
  );
}

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
