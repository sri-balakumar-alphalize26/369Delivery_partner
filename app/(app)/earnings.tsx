import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNow } from '../../src/hooks/useNow';
import { sortForRider, useHistory, useOrders } from '../../src/hooks/useOrders';
import { cashToday } from '../../src/lib/cash';
import { money, onDutyFor, timeOnly } from '../../src/lib/format';
import { useSession } from '../../src/store/session';
import { CONTENT_MAX_W, glass, gradius, gspace } from '../../src/theme/glass';
import { GlassCard } from '../../src/ui/glass/GlassCard';
import { GlassHeader } from '../../src/ui/glass/GlassHeader';
import { GlassProblem } from '../../src/ui/glass/GlassProblem';
import { GlassScreen } from '../../src/ui/glass/GlassScreen';
import { GlassText } from '../../src/ui/glass/GlassText';

/**
 * The rider's day.
 *
 * The template shows a week's total, a by-day breakdown, bonuses, tips and a
 * scheduled payout. **None of it exists.** There is no pay model in Odoo: no
 * per-order fee, no bonus, no tip and no payout on any endpoint, and `/orders`
 * returns active jobs only so nothing can be totalled on the client either. A
 * figure invented here would be read by someone deciding whether they can afford
 * petrol, which is the worst possible place to guess.
 *
 * That refusal stands. What changed is what leads: the screen used to open with
 * a card about the absence, so a rider opening it learned only that the app had
 * nothing for them. Three real things go first instead — what they have
 * delivered, how long they have been out, and how much of someone else's money
 * they are carrying. The last of those is arguably what a rider most wants from
 * this tab, and it has been derivable all along.
 */
export default function Earnings() {
  const insets = useSafeAreaInsets();
  const { data, isError, error, isRefetching, refetch } = useOrders();
  const rider = useSession((s) => s.rider);
  const timezone = useSession((s) => s.timezone);
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

  return (
    <GlassScreen>
      <GlassHeader title="Today" />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gspace.xl,
          // A column, not a full-width sprawl. Binds only above CONTENT_MAX_W.
          width: '100%',
          maxWidth: CONTENT_MAX_W,
          alignSelf: 'center',
          paddingBottom: gspace.xxxl + insets.bottom,
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
        {/**
         * A dead server used to produce a confident zero here — `counts?.delivered
         * ?? 0` cannot tell "you have delivered nothing" from "nobody answered".
         * Of the two, a rider is far better served by being told which.
         */}
        {isError && !data ? (
          <GlassProblem
            message={error.message}
            onRetry={() => refetch()}
            retrying={isRefetching}
          />
        ) : null}

        {isError && data ? (
          <GlassProblem
            tone="quiet"
            message="Could not refresh just now. These are the last figures received."
          />
        ) : null}

        <GlassCard>
          <GlassText variant="caption" tone="soft">
            Delivered today
          </GlassText>
          <GlassText variant="amount" nums style={{ marginTop: 2 }}>
            {counts?.delivered ?? 0}
          </GlassText>

          <View style={{ flexDirection: 'row', gap: gspace.sm, marginTop: gspace.lg }}>
            <Tile label="On road" value={String(counts?.out_for_delivery ?? 0)} />
            <Tile label="Assigned" value={String(counts?.assigned ?? 0)} />
            <Tile label="On duty" value={shift ?? '—'} />
          </View>
        </GlassCard>

        {/* Cash already taken at the door today. Somebody else's money, so it
            gets its own card, with the jobs behind the figure. */}
        <GlassCard style={{ marginTop: gspace.lg }}>
          <GlassText variant="caption" tone="soft">
            Cash collected today
          </GlassText>
          {collected.rows.length ? (
            <>
              <GlassText variant="amount" tone="orange" nums style={{ marginTop: 2 }}>
                {money(collected.total, collected.currency)}
              </GlassText>
              <GlassText variant="body" tone="soft">
                {collected.rows.length === 1
                  ? '1 cash order delivered'
                  : `${collected.rows.length} cash orders delivered`}
              </GlassText>
              <View style={{ marginTop: gspace.md }}>
                {collected.rows.map((row, i) => (
                  <View
                    key={row.orderId}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: gspace.sm,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: glass.divider,
                    }}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <GlassText variant="bodyStrong" numberOfLines={1}>
                        {row.customer || row.code}
                      </GlassText>
                      <GlassText variant="caption" tone="soft" nums numberOfLines={1}>
                        {[row.code, timeOnly(row.at, history.data?.timezone ?? timezone)]
                          .filter(Boolean)
                          .join(' · ')}
                      </GlassText>
                    </View>
                    <GlassText variant="bodyStrong" nums>
                      {money(row.amount, collected.currency)}
                    </GlassText>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm }}>
              {history.isError
                ? "Could not load today's deliveries. Pull down to try again."
                : history.isLoading
                  ? 'Checking today’s deliveries…'
                  : 'No cash collected yet today.'}
            </GlassText>
          )}
        </GlassCard>

        {/* Cash on the jobs still being carried: not collected yet. This card
            was titled "Cash in hand", which it never was. Hidden at zero. */}
        {toCollect > 0 ? (
          <GlassCard style={{ marginTop: gspace.lg }}>
            <GlassText variant="caption" tone="soft">
              Still to collect
            </GlassText>
            <GlassText variant="amount" nums style={{ marginTop: 2 }}>
              {money(toCollect, currency)}
            </GlassText>
            <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm }}>
              On the cash orders you are carrying now.
            </GlassText>
          </GlassCard>
        ) : null}

        <GlassText variant="caption" tone="soft" style={{ marginTop: gspace.md }}>
          Hand collected cash to the shop. Handovers will be confirmed in the app
          once the server supports it.
        </GlassText>

        {/* Quiet, at the foot. It was the whole screen before, which told a
            rider only what the app could not do for them. */}
        <GlassText
          variant="caption"
          tone="faint"
          style={{ marginTop: gspace.xxl, textAlign: 'center' }}
        >
          Rider pay, bonuses and tips are not sent by the server yet. When they
          are, they will appear here.
        </GlassText>
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
