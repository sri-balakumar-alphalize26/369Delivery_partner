import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../../src/api/endpoints';
import {
  ACTION_LABEL,
  Action,
  ActionResult,
  ApiError,
  DeliveryOrder,
  PRIMARY_ACTIONS,
} from '../../../src/api/types';
import { money, promisedAt } from '../../../src/lib/format';
import { startTracking, stopTracking } from '../../../src/location/tracking';
import { useSession } from '../../../src/store/session';
import { glass, gradius, gshadow, gspace } from '../../../src/theme/glass';
import { LoadingArt } from '../../../src/ui/LoadingArt';
import { OtpBoxes } from '../../../src/ui/OtpBoxes';
import { OtpInput } from '../../../src/ui/OtpInput';
import { StaticMap } from '../../../src/ui/StaticMap';
import { GlassButton } from '../../../src/ui/glass/GlassButton';
import { GlassCard } from '../../../src/ui/glass/GlassCard';
import { GlassIcon, GlassIconName } from '../../../src/ui/glass/GlassIcon';
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

function navigateTo(order: DeliveryOrder) {
  const { latitude: lat, longitude: lng, delivery_address } = order;

  const url =
    lat && lng
      ? Platform.OS === 'android'
        ? `google.navigation:q=${lat},${lng}`
        : `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`
      : `https://maps.google.com/?q=${encodeURIComponent(delivery_address)}`;

  Linking.openURL(url).catch(() =>
    Linking.openURL(
      lat && lng
        ? `https://maps.google.com/?q=${lat},${lng}`
        : `https://maps.google.com/?q=${encodeURIComponent(delivery_address)}`
    ).catch(() => {})
  );
}

export default function Job() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = Number(id);
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // The shop's zone, from /auth/me — never the phone's own.
  const timezone = useSession((s) => s.timezone);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  /** Set from a 409 so a stale screen re-renders without a reload. */
  const [override, setOverride] = useState<Action[] | null>(null);

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
      if (!started) {
        setError(
          'Location permission is required to deliver. Allow location "All the time" in Settings.'
        );
      }
    } else {
      await stopTracking();
    }

    await qc.invalidateQueries();

    if (res.status === 'delivered' || res.status === 'returned') {
      router.replace('/');
    }
  }

  async function run(action: Action) {
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
          res = await api.returnToShop(orderId);
          break;
        case 'confirm_return':
          // The contract's prose says only the shop closes a return, while its
          // state table offers this action to the rider. Render what Odoo
          // offers and let Odoo refuse it — a 409 re-renders from the truth.
          res = await api.confirmReturn(orderId);
          break;
        case 'report_issue':
          res = await api.reportIssue(orderId, 'Reported from the app');
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
            {order.shop} → {order.customer_name}
          </GlassText>

          <GlassCard style={{ marginTop: gspace.xl }}>
            <GlassText variant="label" tone="soft" upper>
              Pick up from
            </GlassText>
            <GlassText variant="bodyStrong" style={{ marginTop: gspace.xs }}>
              {order.shop}
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

          {secondary.map((a) => (
            <GhostLink key={a} label={ACTION_LABEL[a]} onPress={() => run(a)} disabled={busy} />
          ))}
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
          <GlassText
            variant="title"
            tone="white"
            style={{ flex: 1, textAlign: 'center', marginRight: 40 }}
          >
            Delivering
          </GlassText>
        </View>

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

          <View style={{ alignItems: 'center', marginTop: gspace.xxl }}>
            {cod ? (
              <>
                <GlassText variant="body" tone="soft">
                  Collect this cash before handing over
                </GlassText>
                <GlassText variant="amountLg" nums style={{ marginTop: gspace.xs }}>
                  {money(order.amount_to_collect, order.currency)}
                </GlassText>
              </>
            ) : (
              <GlassText variant="subtitle" tone="green">
                Already paid — collect nothing
              </GlassText>
            )}
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
              Ask the customer for the 6-digit code from their app or SMS.
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

          {secondary.map((a) => (
            <GhostLink key={a} label={ACTION_LABEL[a]} onPress={() => run(a)} disabled={busy} />
          ))}
        </ScrollView>
      </GlassScreen>
    );
  }

  /* ----------------------------------------------------------------- *
   * En route — glass sheet over the map.
   * ----------------------------------------------------------------- */
  const mapH = Math.round(height * 0.4);

  return (
    <GlassScreen>
      <StaticMap
        latitude={order.latitude}
        longitude={order.longitude}
        width={width}
        height={mapH}
      />

      <View style={{ position: 'absolute', top: insets.top + gspace.sm, left: gspace.xl }}>
        <RoundButton icon="chev" mirrored onPress={() => router.back()} />
      </View>

      <ScrollView
        style={{ marginTop: -gspace.xxl }}
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
              minHeight: height - mapH,
            },
            gshadow.glass,
          ]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <View style={{ flex: 1, paddingRight: gspace.md }}>
              <GlassText variant="label" tone="faint" upper>
                Order {order.delivery_order_name}
              </GlassText>
              <GlassText variant="title" style={{ marginTop: 2 }} numberOfLines={1}>
                {order.shop}
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

          {/* Collect and Items only. The template's "You earn" has no field
              behind it, and there is no distance or ETA in the contract. */}
          <View style={{ flexDirection: 'row', gap: gspace.md, marginTop: gspace.lg }}>
            <Tile
              label="Collect"
              value={cod ? money(order.amount_to_collect, order.currency) : 'Paid'}
              tone={cod ? glass.red : glass.green}
            />
            <Tile label="Items" value={String(order.products?.length ?? 0)} />
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
              <OtpInput
                label="Pickup code"
                hint="The shop staff will read this out when they hand the parcel over."
                value={otp}
                onChange={setOtp}
                error={otpError}
              />
              <GhostLink
                label="Ask the shop to resend"
                disabled={busy}
                onPress={() => api.requestPickupOtp(orderId).catch(() => {})}
              />
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

          {secondary.map((a) => (
            <GhostLink key={a} label={ACTION_LABEL[a]} onPress={() => run(a)} disabled={busy} />
          ))}
        </View>
      </ScrollView>
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
