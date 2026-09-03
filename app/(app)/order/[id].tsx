import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, View } from 'react-native';
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
import { BarState, color, space } from '../../../src/theme/tokens';
import { BigNumber } from '../../../src/ui/BigNumber';
import { Hairline } from '../../../src/ui/Hairline';
import { LoadingArt } from '../../../src/ui/LoadingArt';
import { OtpInput } from '../../../src/ui/OtpInput';
import { PrimaryButton } from '../../../src/ui/PrimaryButton';
import { Screen } from '../../../src/ui/Screen';
import { StatusBar } from '../../../src/ui/StatusBar';
import { Text } from '../../../src/ui/Text';

/**
 * The job screen.
 *
 * Every button on it comes from `allowed_actions`. There is no local state
 * machine and no "what comes next" logic — the contract's first rule is that
 * Odoo decides the workflow and the app renders it, so when the flow changes in
 * Odoo this screen follows with no new release.
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
      <View style={{ flex: 1, backgroundColor: color.bg }}>
        <StatusBar state="idle" label="Loading job" />
        <LoadingArt />
      </View>
    );
  }

  // A job that resolved to nothing is not a wait — it gets an answer, not the
  // loading loop.
  if (!order) {
    return (
      <View style={{ flex: 1, backgroundColor: color.bg }}>
        <StatusBar state="idle" label="Job not found" />
        <Screen>
          <Text variant="title">That job is gone</Text>
          <PrimaryButton
            label="Back"
            onPress={() => router.replace('/')}
            style={{ marginTop: space.huge }}
          />
        </Screen>
      </View>
    );
  }

  const actions = override ?? order.allowed_actions;
  const primary = PRIMARY_ACTIONS.find((a) => actions.includes(a)) ?? null;
  const secondary = actions.filter((a) => a !== primary);

  const needsOtp = primary === 'verify_pickup_otp' || primary === 'verify_delivery_otp';
  const canSubmit = !needsOtp || otp.length === 6;

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

  const cod = order.payment_status === 'cod';

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <StatusBar
        state={order.delivery_status as BarState}
        trailing={order.delivery_order_name}
      />

      <Screen>
        <Text variant="label" tone="soft" upper>
          {order.job_code} · {order.sales_order} · {order.delivery_type}
        </Text>

        <Text variant="title" style={{ marginTop: space.md }}>
          {order.customer_name}
        </Text>
        <Text variant="body" tone="soft" style={{ marginTop: space.xs }}>
          {order.delivery_address}
        </Text>
        {order.promised_by ? (
          <Text variant="body" tone="soft" nums style={{ marginTop: space.xs }}>
            Promised {promisedAt(order.promised_by, timezone)}
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.xl }}>
          <PrimaryButton
            label="Navigate"
            kind="dark"
            onPress={() => navigateTo(order)}
            style={{ flex: 1 }}
          />
          <PrimaryButton
            label="Call"
            kind="ghost"
            onPress={() =>
              Linking.openURL(`tel:${order.customer_mobile}`).catch(() => {})
            }
            style={{ flex: 1, borderWidth: 1, borderColor: color.hairline }}
          />
        </View>

        <Hairline />

        {cod ? (
          <BigNumber
            value={money(order.amount_to_collect, order.currency)}
            label="Cash to collect from the customer"
            size="big"
          />
        ) : (
          <Text variant="bodyStrong" tone="green">
            Already paid — collect nothing
          </Text>
        )}

        {order.products?.length ? (
          <>
            <Hairline />
            <Text variant="label" tone="soft" upper>
              {order.products.length} items from {order.shop}
            </Text>
            {order.products.map((p, i) => (
              <View
                key={`${p.name}-${i}`}
                style={{
                  flexDirection: 'row',
                  paddingVertical: space.md,
                  borderBottomWidth: 1,
                  borderBottomColor: color.hairline,
                }}
              >
                <Text variant="body" style={{ flex: 1 }}>
                  {p.name}
                </Text>
                <Text variant="bodyStrong" tone="soft" nums>
                  x{p.quantity}
                </Text>
              </View>
            ))}
          </>
        ) : null}

        {needsOtp ? (
          <>
            <Hairline />
            <OtpInput
              label={
                primary === 'verify_pickup_otp' ? 'Pickup code' : 'Delivery code'
              }
              hint={
                primary === 'verify_pickup_otp'
                  ? 'The shop staff will read this out when they hand the parcel over.'
                  : 'Ask the customer for the code they were sent.'
              }
              value={otp}
              onChange={setOtp}
              error={otpError}
            />
            {primary === 'verify_pickup_otp' ? (
              <PrimaryButton
                label="Ask the shop to resend"
                kind="ghost"
                disabled={busy}
                onPress={() => api.requestPickupOtp(orderId).catch(() => {})}
                style={{ marginTop: space.md }}
              />
            ) : null}
          </>
        ) : null}

        {error ? (
          <Text variant="bodyStrong" tone="red" style={{ marginTop: space.xl }}>
            {error}
          </Text>
        ) : null}

        {/* Only what Odoo permits, in the order Odoo permits it. */}
        {primary ? (
          <PrimaryButton
            label={ACTION_LABEL[primary]}
            kind={primary === 'verify_delivery_otp' ? 'green' : 'brand'}
            onPress={() => run(primary)}
            loading={busy}
            disabled={!canSubmit}
            style={{ marginTop: space.huge }}
          />
        ) : (
          <Text variant="bodyStrong" tone="soft" style={{ marginTop: space.huge }}>
            This job is finished. Nothing left to do.
          </Text>
        )}

        {secondary.map((a) => (
          <PrimaryButton
            key={a}
            label={ACTION_LABEL[a]}
            kind="ghost"
            onPress={() => run(a)}
            disabled={busy}
            style={{
              marginTop: space.sm,
              borderWidth: 1,
              borderColor: color.hairline,
            }}
          />
        ))}
      </Screen>
    </View>
  );
}
