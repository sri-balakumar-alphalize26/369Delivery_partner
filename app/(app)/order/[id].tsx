import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
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
import { cardColor, cardRadius, shadow, space } from '../../../src/theme/tokens';
import { Card } from '../../../src/ui/Card';
import { LoadingArt } from '../../../src/ui/LoadingArt';
import { OtpBoxes } from '../../../src/ui/OtpBoxes';
import { OtpInput } from '../../../src/ui/OtpInput';
import { StaticMap } from '../../../src/ui/StaticMap';
import { Text } from '../../../src/ui/Text';

/**
 * The job screen, in the Bold Cards style.
 *
 * Every button on it still comes from `allowed_actions`. There is no local
 * state machine and no "what comes next" logic — the contract's first rule is
 * that Odoo decides the workflow and the app renders it, so when the flow
 * changes in Odoo this screen follows with no new release.
 *
 * Three layouts, chosen by which action Odoo is offering rather than by any
 * state we keep: the orange offer screen while the job is only offered, the
 * green handover screen when the delivery code is due, and the en-route
 * sheet-over-map for everything between.
 *
 * The reference also shows a per-order fee ("You earn"), a distance and an ETA.
 * None of the three exist in the contract, so none is drawn — a number here
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
      <View style={{ flex: 1, backgroundColor: cardColor.canvas }}>
        <LoadingArt />
      </View>
    );
  }

  // A job that resolved to nothing is not a wait — it gets an answer, not the
  // loading loop.
  if (!order) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: cardColor.canvas,
          paddingTop: insets.top + space.huge,
          paddingHorizontal: space.xl,
        }}
      >
        <Card>
          <Text variant="cardTitle" style={{ color: cardColor.textPrimary }}>
            That job is gone
          </Text>
          <SheetButton label="Back" onPress={() => router.replace('/')} />
        </Card>
      </View>
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

  const call = () =>
    Linking.openURL(`tel:${order.customer_mobile}`).catch(() => {});

  /* ----------------------------------------------------------------- *
   * Offer — not accepted yet.
   *
   * There is deliberately no Decline button: the contract gives `offered`
   * only `accept`, so a rider cannot refuse a job, and there is no expiry to
   * count down either. The reference's timer pill, "You earn", distance and
   * estimated time are all dropped for the same reason — no field exists
   * behind any of them.
   * ----------------------------------------------------------------- */
  if (primary === 'accept') {
    return (
      <View style={{ flex: 1, backgroundColor: cardColor.canvas }}>
        <View
          style={{
            backgroundColor: cardColor.orange,
            paddingTop: insets.top + space.md,
            paddingHorizontal: space.xl,
            paddingBottom: space.xxl,
            borderBottomLeftRadius: cardRadius.header,
            borderBottomRightRadius: cardRadius.header,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <RoundButton icon="chevron-back" onPress={() => router.back()} translucent />
            <Text
              variant="cardLabel"
              upper
              style={{ color: cardColor.card, marginLeft: space.md }}
            >
              New job offer
            </Text>
          </View>
          <Text
            variant="cardTitle"
            style={{ color: cardColor.card, marginTop: space.lg }}
            numberOfLines={2}
          >
            {order.shop} → {order.customer_name}
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={{
            padding: space.xl,
            paddingBottom: space.huge + insets.bottom,
          }}
        >
          <Card>
            <Text variant="cardLabel" upper style={{ color: cardColor.textSecondary }}>
              Pick up from
            </Text>
            <Text
              variant="cardBody"
              style={{ color: cardColor.textPrimary, marginTop: space.xs }}
            >
              {order.shop}
            </Text>

            <View
              style={{
                borderBottomWidth: 1,
                borderColor: cardColor.divider,
                marginVertical: space.lg,
              }}
            />

            <Text variant="cardLabel" upper style={{ color: cardColor.textSecondary }}>
              Deliver to
            </Text>
            <Text
              variant="cardBody"
              style={{ color: cardColor.textPrimary, marginTop: space.xs }}
            >
              {order.customer_name}
            </Text>
            <Text
              variant="cardCaption"
              style={{ color: cardColor.textSecondary, marginTop: 2 }}
            >
              {order.delivery_address}
            </Text>
            {order.promised_by ? (
              <Text
                variant="cardCaption"
                nums
                style={{ color: cardColor.textSecondary, marginTop: space.sm }}
              >
                Promised {promisedAt(order.promised_by, timezone)}
              </Text>
            ) : null}
          </Card>

          {cod ? (
            <View style={{ alignItems: 'center', marginTop: space.xxl }}>
              <Text variant="cardBody" style={{ color: cardColor.textSecondary }}>
                Cash to collect from customer
              </Text>
              <Text
                variant="cardAmount"
                nums
                style={{ color: cardColor.textPrimary, marginTop: space.xs }}
              >
                {money(order.amount_to_collect, order.currency)}
              </Text>
            </View>
          ) : (
            <View style={{ alignItems: 'center', marginTop: space.xxl }}>
              <Text variant="cardTitle" style={{ color: cardColor.green }}>
                Already paid — collect nothing
              </Text>
            </View>
          )}

          {error ? (
            <Text variant="cardBody" style={{ color: cardColor.red, marginTop: space.lg }}>
              {error}
            </Text>
          ) : null}

          <SheetButton
            label={ACTION_LABEL[primary]}
            icon="checkmark"
            tone="orange"
            onPress={() => run(primary)}
            disabled={busy}
            style={{ marginTop: space.xxl }}
          />

          {secondary.map((a) => (
            <GhostLink key={a} label={ACTION_LABEL[a]} onPress={() => run(a)} disabled={busy} />
          ))}
        </ScrollView>
      </View>
    );
  }

  /* ----------------------------------------------------------------- *
   * Handover — the delivery code is due.
   * ----------------------------------------------------------------- */
  if (primary === 'verify_delivery_otp') {
    return (
      <View style={{ flex: 1, backgroundColor: cardColor.canvas }}>
        <View
          style={{
            backgroundColor: cardColor.green,
            paddingTop: insets.top + space.md,
            paddingBottom: space.xxl,
            paddingHorizontal: space.xl,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <RoundButton icon="chevron-back" onPress={() => router.back()} translucent />
          <Text
            variant="cardTitle"
            style={{ color: cardColor.card, flex: 1, textAlign: 'center', marginRight: 40 }}
          >
            Delivering
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={{
            padding: space.xl,
            paddingBottom: space.huge + insets.bottom,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <Card>
            <Text variant="cardTitle" style={{ color: cardColor.textPrimary }}>
              {order.customer_name}
            </Text>
            <Text
              variant="cardBody"
              style={{ color: cardColor.textSecondary, marginTop: 2 }}
            >
              {order.delivery_address}
            </Text>

            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.lg }}>
              <SheetButton
                label="Navigate"
                icon="navigate"
                tone="dark"
                onPress={() => navigateTo(order)}
                style={{ flex: 1, marginTop: 0 }}
              />
              <SheetButton
                label="Call"
                icon="call-outline"
                tone="ghost"
                onPress={call}
                style={{ flex: 1, marginTop: 0 }}
              />
            </View>
          </Card>

          {cod ? (
            <View style={{ alignItems: 'center', marginTop: space.xxl }}>
              <Text variant="cardBody" style={{ color: cardColor.textSecondary }}>
                Collect this cash before handing over
              </Text>
              <Text
                variant="cardAmount"
                nums
                style={{ color: cardColor.textPrimary, marginTop: space.xs }}
              >
                {money(order.amount_to_collect, order.currency)}
              </Text>
            </View>
          ) : (
            <View style={{ alignItems: 'center', marginTop: space.xxl }}>
              <Text variant="cardTitle" style={{ color: cardColor.green }}>
                Already paid — collect nothing
              </Text>
            </View>
          )}

          <Card style={{ marginTop: space.xxl }}>
            <Text variant="cardLabel" upper style={{ color: cardColor.textSecondary }}>
              Delivery code
            </Text>
            <Text
              variant="cardBody"
              style={{ color: cardColor.textSecondary, marginTop: space.xs, marginBottom: space.lg }}
            >
              Ask the customer for the 6-digit code from their app or SMS.
            </Text>
            <OtpBoxes value={otp} onChange={setOtp} error={otpError} />
          </Card>

          {error ? (
            <Text variant="cardBody" style={{ color: cardColor.red, marginTop: space.lg }}>
              {error}
            </Text>
          ) : null}

          <SheetButton
            label={ACTION_LABEL[primary]}
            icon="checkmark"
            tone="green"
            onPress={() => run(primary)}
            disabled={busy || !canSubmit}
            style={{ marginTop: space.xxl }}
          />

          {secondary.map((a) => (
            <GhostLink key={a} label={ACTION_LABEL[a]} onPress={() => run(a)} disabled={busy} />
          ))}
        </ScrollView>
      </View>
    );
  }

  /* ----------------------------------------------------------------- *
   * En route — sheet over the map.
   * ----------------------------------------------------------------- */
  const mapH = Math.round(height * 0.42);

  return (
    <View style={{ flex: 1, backgroundColor: cardColor.canvas }}>
      <StaticMap
        latitude={order.latitude}
        longitude={order.longitude}
        width={width}
        height={mapH}
      />

      <View style={{ position: 'absolute', top: insets.top + space.sm, left: space.xl }}>
        <RoundButton icon="chevron-back" onPress={() => router.back()} />
      </View>

      <ScrollView
        style={{ marginTop: -space.xxl }}
        contentContainerStyle={{ paddingBottom: space.huge + insets.bottom }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            {
              backgroundColor: cardColor.card,
              borderTopLeftRadius: cardRadius.card,
              borderTopRightRadius: cardRadius.card,
              padding: space.xl,
              minHeight: height - mapH,
            },
            shadow.floating,
          ]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <View style={{ flex: 1, paddingRight: space.md }}>
              <Text variant="cardLabel" upper style={{ color: cardColor.textFaint }}>
                Order {order.delivery_order_name}
              </Text>
              <Text
                variant="cardTitle"
                style={{ color: cardColor.textPrimary, marginTop: 2 }}
                numberOfLines={1}
              >
                {order.shop}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <RoundButton icon="call-outline" onPress={call} tone="tint" />
              <RoundButton icon="navigate" onPress={() => navigateTo(order)} tone="brand" />
            </View>
          </View>

          {/* Where the parcel is going, once the shop is done. */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: cardColor.chipBg,
              borderRadius: cardRadius.chip,
              padding: space.md,
              marginTop: space.lg,
            }}
          >
            <Ionicons name="location" size={18} color={cardColor.orange} />
            <Text
              variant="cardBody"
              style={{ color: cardColor.textPrimary, flex: 1, marginLeft: space.sm }}
              numberOfLines={2}
            >
              Then: {order.customer_name} · {order.delivery_address}
            </Text>
          </View>

          {order.promised_by ? (
            <Text
              variant="cardCaption"
              nums
              style={{ color: cardColor.textSecondary, marginTop: space.sm }}
            >
              Promised {promisedAt(order.promised_by, timezone)}
            </Text>
          ) : null}

          {/* Collect and Items only. The reference's "You earn" has no field
              behind it, and there is no distance or ETA in the contract. */}
          <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.lg }}>
            <Tile
              label="Collect"
              value={cod ? money(order.amount_to_collect, order.currency) : 'Paid'}
              tone={cod ? cardColor.red : cardColor.green}
            />
            <Tile label="Items" value={String(order.products?.length ?? 0)} />
          </View>

          {order.products?.length ? (
            <View style={{ marginTop: space.lg }}>
              {order.products.map((p, i) => (
                <View
                  key={`${p.name}-${i}`}
                  style={{
                    flexDirection: 'row',
                    paddingVertical: space.sm,
                    borderBottomWidth: 1,
                    borderBottomColor: cardColor.divider,
                  }}
                >
                  <Text
                    variant="cardBody"
                    style={{ flex: 1, color: cardColor.textPrimary }}
                  >
                    {p.name}
                  </Text>
                  <Text variant="cardBody" nums style={{ color: cardColor.textSecondary }}>
                    x{p.quantity}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {primary === 'verify_pickup_otp' ? (
            <View style={{ marginTop: space.lg }}>
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
            <Text variant="cardBody" style={{ color: cardColor.red, marginTop: space.lg }}>
              {error}
            </Text>
          ) : null}

          {/* Only what Odoo permits, in the order Odoo permits it. */}
          {primary ? (
            <SheetButton
              label={ACTION_LABEL[primary]}
              icon="checkmark"
              onPress={() => run(primary)}
              disabled={busy || !canSubmit}
              style={{ marginTop: space.xl }}
            />
          ) : (
            <Text
              variant="cardBody"
              style={{ color: cardColor.textSecondary, marginTop: space.xl }}
            >
              This job is finished. Nothing left to do.
            </Text>
          )}

          {secondary.map((a) => (
            <GhostLink key={a} label={ACTION_LABEL[a]} onPress={() => run(a)} disabled={busy} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/** A stat tile in the sheet. */
function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: cardColor.chipBg,
        borderRadius: cardRadius.chip,
        padding: space.md,
      }}
    >
      <Text variant="cardCaption" style={{ color: cardColor.textSecondary }}>
        {label}
      </Text>
      <Text
        variant="cardTitle"
        nums
        style={{ color: tone ?? cardColor.textPrimary, marginTop: 2 }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

/** The full-width action button. */
function SheetButton({
  label,
  icon,
  tone = 'brand',
  onPress,
  disabled,
  style,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: 'brand' | 'green' | 'dark' | 'ghost' | 'orange';
  onPress: () => void;
  disabled?: boolean;
  style?: object;
}) {
  const bg =
    tone === 'green'
      ? cardColor.green
      : tone === 'orange'
        ? cardColor.orange
        : tone === 'dark'
        ? cardColor.brandDark
        : tone === 'ghost'
          ? cardColor.chipBg
          : cardColor.brand;
  const fg = tone === 'ghost' ? cardColor.textPrimary : cardColor.card;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderRadius: cardRadius.button,
          height: 54,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: space.lg,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {icon ? (
        <Ionicons name={icon} size={18} color={fg} style={{ marginRight: space.sm }} />
      ) : null}
      <Text variant="cardButton" style={{ color: fg }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A quiet secondary action, as the reference draws them. */
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
        paddingVertical: space.md,
        alignItems: 'center',
        opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
      })}
    >
      <Text variant="cardBody" style={{ color: cardColor.textSecondary }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Circular icon button — back, call, navigate. */
function RoundButton({
  icon,
  onPress,
  tone = 'plain',
  translucent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  tone?: 'plain' | 'tint' | 'brand';
  translucent?: boolean;
}) {
  const bg = translucent
    ? 'rgba(255,255,255,0.22)'
    : tone === 'brand'
      ? cardColor.brand
      : tone === 'tint'
        ? cardColor.chipBg
        : cardColor.card;
  const fg = tone === 'brand' || translucent ? cardColor.card : cardColor.brand;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      hitSlop={8}
      style={({ pressed }) => [
        {
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.8 : 1,
        },
        translucent ? null : shadow.card,
      ]}
    >
      <Ionicons name={icon} size={20} color={fg} />
    </Pressable>
  );
}
