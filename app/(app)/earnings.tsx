import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNow } from '../../src/hooks/useNow';
import { sortForRider, useHistory, useOrders } from '../../src/hooks/useOrders';
import { cashToday, tripsToday } from '../../src/lib/cash';
import { money, onDutyFor, timeOnly } from '../../src/lib/format';
import { useSession } from '../../src/store/session';
import { CONTENT_MAX_W, font, glass, gradius, gspace } from '../../src/theme/glass';
import { GlassIcon } from '../../src/ui/glass/GlassIcon';
import { GlassProblem } from '../../src/ui/glass/GlassProblem';
import { GlassScreen } from '../../src/ui/glass/GlassScreen';
import { GlassText } from '../../src/ui/glass/GlassText';

/**
 * The rider's day, "today first" (layout A of the Earnings canvas, 6 Oct
 * 2026): today's pay or deliveries big at the top, week, month and all time
 * under it, the cash being carried said plainly as the shop's money, then
 * today's trips.
 *
 * Since delivery 19.0.21.5.0 the server has a pay model, for Delivery Partners
 * only (`rider.kind = "third_party"`): a fee per trip, totalled on `/history`
 * for today, the week, the month and all time. Those lead the screen for a
 * partner, as the server formats them. The app still never works pay out
 * itself — a figure guessed here would be read by someone deciding whether they
 * can afford petrol. Own riders are on salary and see no pay.
 *
 * Then what every rider has: what they have delivered (today's count, not the
 * all-time one), how long they have been out, and how much of someone else's
 * money they are carrying.
 */
export default function Earnings() {
  const insets = useSafeAreaInsets();
  const { data, isError, error, isRefetching, refetch } = useOrders();
  const rider = useSession((s) => s.rider);
  const timezone = useSession((s) => s.timezone);
  // The company's currency from sign-in: the fallback when no job carries one,
  // so an empty day still reads "OMR 0.000" rather than a bare "0.00".
  const sessionCurrency = useSession((s) => s.currency);
  const now = useNow();

  const counts = data?.counts;
  const jobs = sortForRider(data?.orders);

  /**
   * Cash the rider is holding, summed the same way Home does it — from the COD
   * jobs in hand. Not earnings: this is money owed to the shop.
   */
  const toCollect = jobs
    .filter((j) => j.payment_status === 'cod')
    .reduce((sum, j) => sum + (j.amount_to_collect ?? 0), 0);
  const currency = jobs.find((j) => j.currency)?.currency;

  const onDuty = data?.on_duty ?? rider?.on_duty ?? false;
  const shift = onDuty ? onDutyFor(rider?.duty_since, now) : null;

  /**
   * Cash already taken at the door today: the delivered cash-on-delivery jobs,
   * from /history. The card above only ever counted cash still to collect.
   * Refetched whenever the tab comes into view, since a delivery made a minute
   * ago on the job screen is exactly what a rider opens this tab to see.
   */
  const history = useHistory();
  const refetchHistory = history.refetch;
  useFocusEffect(
    useCallback(() => {
      refetchHistory();
    }, [refetchHistory])
  );
  const collected = cashToday(history.data?.jobs, now, history.data?.timezone ?? timezone);

  /** Paid per trip, so this tab shows their pay; own riders are on salary. */
  const partner = rider?.kind === 'third_party';
  const rawPay = history.data?.earnings;
  const pay = rawPay && typeof rawPay === 'object' ? rawPay : null;

  // Today's delivered trips, newest first, for the list and the average.
  const trips = tripsToday(history.data?.jobs, now, history.data?.timezone ?? timezone);
  const tripCount = trips.length;
  const deliveredToday = counts?.delivered_today ?? tripCount;
  // Every amount on this screen in one style, the app's ("OMR 1.846"); the
  // server's own strings use the Arabic symbol and read differently.
  const cur = trips.find((t) => t.currency)?.currency ?? currency ?? sessionCurrency;
  const fmt = (m?: { amount: number } | null) => (m ? money(m.amount, cur) : '—');
  const average = partner && pay?.today && tripCount > 0 ? money(pay.today.amount / tripCount, cur) : null;

  /** The shop's money the rider is carrying: taken at the door plus still to take. */
  const cashCurrency = collected.currency ?? currency ?? sessionCurrency;
  const cashWithYou = collected.total + toCollect;

  return (
    <GlassScreen>
      {/* Who this tab is for, on the green band: paid per trip or on salary. */}
      <View
        style={{
          backgroundColor: glass.band,
          paddingTop: insets.top + gspace.lg,
          paddingBottom: 72,
          paddingHorizontal: gspace.xl,
        }}
      >
        <View style={{ width: '100%', maxWidth: CONTENT_MAX_W, alignSelf: 'center' }}>
          <GlassText variant="hero" tone="white">
            Earnings
          </GlassText>
          <GlassText variant="body" style={{ color: glass.bandSoft, marginTop: 2 }}>
            {partner ? 'Delivery Partner · paid per trip' : 'Office rider · on salary'}
          </GlassText>
        </View>
      </View>

      <ScrollView
        style={{ marginTop: -56 }}
        contentContainerStyle={{
          paddingHorizontal: gspace.lg,
          width: '100%',
          maxWidth: CONTENT_MAX_W,
          alignSelf: 'center',
          paddingBottom: gspace.xxl + insets.bottom,
          rowGap: gspace.md,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching || history.isRefetching}
            onRefresh={() => {
              refetch();
              refetchHistory();
            }}
          />
        }
      >
        {/* Today first: a partner's pay, or an office rider's deliveries. Read
            from /history exactly as the server formats it; the app never works
            pay out. */}
        <View
          style={{
            backgroundColor: glass.white,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: glass.divider,
            padding: gspace.lg,
          }}
        >
          <GlassText variant="label" tone="soft" upper>
            Today
          </GlassText>
          {partner ? (
            pay ? (
              <>
                <GlassText
                  nums
                  style={{ fontFamily: font.bold, fontSize: 40, letterSpacing: -1, color: glass.green, marginTop: 2 }}
                >
                  {fmt(pay.today)}
                </GlassText>
                <GlassText variant="body" tone="soft" nums>
                  {`${tripCount} ${tripCount === 1 ? 'trip' : 'trips'}${average ? ` · avg ${average} a trip` : ''}`}
                </GlassText>
              </>
            ) : (
              <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm }}>
                {history.isLoading ? 'Checking your earnings…' : 'This server does not send pay yet.'}
              </GlassText>
            )
          ) : (
            <>
              <GlassText
                nums
                style={{ fontFamily: font.bold, fontSize: 40, letterSpacing: -1, color: glass.green, marginTop: 2 }}
              >
                {String(deliveredToday)}
              </GlassText>
              <GlassText variant="body" tone="soft" nums>
                {`Delivered today${shift ? ` · on duty ${shift}` : ''}`}
              </GlassText>
            </>
          )}

          <View style={{ height: 1, backgroundColor: glass.divider, marginVertical: gspace.lg }} />

          <View style={{ flexDirection: 'row', gap: gspace.sm }}>
            {partner ? (
              <>
                <Tile label="This week" value={fmt(pay?.week)} />
                <Tile label="This month" value={fmt(pay?.month)} />
                <Tile
                  label="All time"
                  value={fmt(pay?.total ?? (typeof pay?.amount === 'number' ? { amount: pay.amount } : null))}
                />
              </>
            ) : (
              <>
                <Tile label="This week" value={String(counts?.delivered_week ?? '—')} />
                <Tile label="This month" value={String(counts?.delivered_month ?? '—')} />
                <Tile label="On road now" value={String(counts?.out_for_delivery ?? 0)} />
              </>
            )}
          </View>
        </View>

        {/**
         * A dead server used to produce a confident zero here — `counts?.delivered
         * ?? 0` cannot tell "you have delivered nothing" from "nobody answered".
         * Of the two, a rider is far better served by being told which.
         */}
        {isError && !data ? (
          <GlassProblem message={error.message} onRetry={() => refetch()} retrying={isRefetching} />
        ) : null}
        {isError && data ? (
          <GlassProblem
            tone="quiet"
            message="Could not refresh just now. These are the last figures received."
          />
        ) : null}

        {/* Cash: somebody else's money, said plainly so it is never read as pay. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            columnGap: gspace.md,
            padding: gspace.lg,
            borderRadius: gradius.card,
            borderWidth: 1,
            borderColor: glass.orangeLine,
            backgroundColor: glass.orangeSoft,
          }}
        >
          <GlassIcon name="cash" size={26} color={glass.orange} />
          <View style={{ flex: 1 }}>
            <GlassText variant="bodyStrong" nums>
              {`Cash with you · ${money(cashWithYou, cashCurrency)}`}
            </GlassText>
            <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
              The shop&rsquo;s money, not your pay. Hand it over at the counter.
            </GlassText>
            {toCollect > 0 ? (
              <GlassText variant="caption" tone="soft" nums style={{ marginTop: 2 }}>
                {`${money(collected.total, cashCurrency)} collected · ${money(toCollect, cashCurrency)} still to collect`}
              </GlassText>
            ) : null}
          </View>
        </View>

        {/* Today's trips: what each paid a partner; an office rider sees the list without pay. */}
        <GlassText variant="label" tone="soft" upper style={{ marginTop: gspace.sm }}>
          Today&rsquo;s trips
        </GlassText>
        <View
          style={{
            backgroundColor: glass.white,
            borderRadius: gradius.card,
            borderWidth: 1,
            borderColor: glass.divider,
          }}
        >
          {trips.length ? (
            trips.map((t, i) => {
              const km = t.shop_to_customer_m ? `${(t.shop_to_customer_m / 1000).toFixed(1)} km` : null;
              return (
                <View
                  key={t.delivery_order_id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: gspace.md,
                    paddingVertical: gspace.md,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: glass.divider,
                  }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <GlassText variant="bodyStrong" numberOfLines={1}>
                      {t.customer_name}
                    </GlassText>
                    <GlassText variant="caption" tone="soft" nums numberOfLines={1}>
                      {[timeOnly(t.finished_at, history.data?.timezone ?? timezone), t.sales_order || t.delivery_order_name, km]
                        .filter(Boolean)
                        .join(' · ')}
                    </GlassText>
                  </View>
                  {partner && t.rider_fee ? (
                    <GlassText variant="bodyStrong" nums style={{ color: glass.green }}>
                      {`+${fmt(t.rider_fee)}`}
                    </GlassText>
                  ) : null}
                </View>
              );
            })
          ) : (
            <GlassText variant="body" tone="soft" style={{ padding: gspace.lg }}>
              {history.isError
                ? "Could not load today's deliveries. Pull down to try again."
                : history.isLoading
                  ? 'Checking today’s deliveries…'
                  : 'No deliveries yet today.'}
            </GlassText>
          )}
        </View>
      </ScrollView>
    </GlassScreen>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
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
      <GlassText variant="subtitle" nums numberOfLines={1}>
        {value}
      </GlassText>
      <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
        {label}
      </GlassText>
    </View>
  );
}
