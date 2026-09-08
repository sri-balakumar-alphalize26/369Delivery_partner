import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sortForRider, useDuty, useOrders } from '../../src/hooks/useOrders';
import { money, onDutyFor } from '../../src/lib/format';
import { useNow } from '../../src/hooks/useNow';
import { useSession } from '../../src/store/session';
import { CONTENT_MAX_W, glass, gradius, gspace } from '../../src/theme/glass';
import { useWide } from '../../src/ui/useWide';
import { GlassButton } from '../../src/ui/glass/GlassButton';
import { GlassCard } from '../../src/ui/glass/GlassCard';
import { GlassIcon } from '../../src/ui/glass/GlassIcon';
import { GlassJobCard } from '../../src/ui/glass/GlassJobCard';
import { GlassPill } from '../../src/ui/glass/GlassPill';
import { GlassProblem } from '../../src/ui/glass/GlassProblem';
import { GlassScreen } from '../../src/ui/glass/GlassScreen';
import { GlassText } from '../../src/ui/glass/GlassText';

/**
 * The rider's day, in the Glass Light style.
 *
 * Duty leads because it is the first thing that has to be true: the contract
 * offers nothing at all to an off-duty rider, so an app without this control
 * shows an empty list and no reason for it.
 *
 * The template puts today's earnings, a rating and a bonus chip on this screen.
 * None exist in the contract — there is no pay model in Odoo, `Rider` carries no
 * score, and `/orders` returns only active jobs so no daily total is derivable.
 * The card keeps the template's shape and carries the four counts Odoo does
 * return. A number here would be trusted, so it has to be real.
 */
export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const rider = useSession((s) => s.rider);
  const timezone = useSession((s) => s.timezone);
  const { data, isLoading, isError, error, isRefetching, refetch } = useOrders();
  const duty = useDuty();
  const wide = useWide();

  // The server is the authority on duty; the stored rider is only the fallback
  // before the first /orders comes back.
  const onDuty = data?.on_duty ?? rider?.on_duty ?? false;

  /**
   * How long this shift has been running.
   *
   * `duty_since` has been on the rider object all along and shown nowhere, so a
   * rider had no way to see their own shift from inside the app. Counted against
   * the server's clock, so a phone set wrong does not invent hours.
   */
  const now = useNow();
  const shift = onDuty ? onDutyFor(rider?.duty_since, now) : null;

  const jobs = sortForRider(data?.orders);
  const counts = data?.counts;

  // Genuinely derivable: what the rider is holding across the jobs in hand.
  const toCollect = jobs
    .filter((j) => j.payment_status === 'cod')
    .reduce((sum, j) => sum + (j.amount_to_collect ?? 0), 0);
  const currency = jobs.find((j) => j.currency)?.currency;

  return (
    <GlassScreen>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + gspace.lg,
          paddingHorizontal: gspace.xl,
          // A column, not a full-width sprawl. Binds only above CONTENT_MAX_W.
          width: '100%',
          maxWidth: CONTENT_MAX_W,
          alignSelf: 'center',
          paddingBottom: gspace.xxxl + insets.bottom,
        }}
        showsVerticalScrollIndicator={false}
        /* A rider's first instinct is to pull. Until now that did nothing. */
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />
        }
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1, paddingRight: gspace.md }}>
            <GlassText variant="caption" tone="soft">
              {greeting()}
            </GlassText>
            <GlassText variant="hero" numberOfLines={1}>
              {rider?.name ?? 'Rider'}
            </GlassText>
          </View>
          {/* No bell: nothing registers for push (useOrders polls instead), so
              it would be a control that does nothing. */}
        </View>

        <GlassCard padding={16} style={{ marginTop: gspace.lg }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: onDuty ? '#22C55E' : glass.inkFaint,
                  marginRight: gspace.sm,
                }}
              />
              <View style={{ flex: 1 }}>
                <GlassText variant="bodyStrong">
                  {onDuty ? 'You are online' : 'You are off duty'}
                </GlassText>
                {shift ? (
                  <GlassText variant="caption" tone="soft" nums>
                    {shift} on duty
                  </GlassText>
                ) : null}
              </View>
            </View>
            <Switch
              value={onDuty}
              disabled={duty.isPending}
              onValueChange={(next) => duty.mutate(next)}
              trackColor={{ true: '#22C55E' }}
            />
          </View>
        </GlassCard>

        <GlassCard style={{ marginTop: gspace.lg }}>
          <GlassText variant="caption" tone="soft">
            Delivered today
          </GlassText>
          <GlassText variant="amount" nums style={{ marginTop: 2 }}>
            {counts?.delivered ?? 0}
          </GlassText>

          {/* Cash rides in this card's corner rather than a card of its own at
              the foot of the list: it is a figure about the day, like the ones
              below it, and a rider wants it beside them rather than after two
              screens of scrolling. Hidden at zero, where it is only noise. */}
          {toCollect > 0 ? (
            <View
              style={{
                position: 'absolute',
                right: 18,
                top: 18,
                alignItems: 'flex-end',
              }}
            >
              <GlassText variant="caption" tone="soft">
                Cash to collect
              </GlassText>
              <GlassText variant="bodyStrong" tone="orange" nums>
                {money(toCollect, currency)}
              </GlassText>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: gspace.sm, marginTop: gspace.lg }}>
            <Stat label="Assigned" value={counts?.assigned ?? 0} />
            <Stat label="Collected" value={counts?.picked_up ?? 0} />
            <Stat label="On road" value={counts?.out_for_delivery ?? 0} />
          </View>
        </GlassCard>

        {/* Odoo writes this for the rider — "2 job(s) were waiting." */}
        {duty.data?.message ? (
          <GlassText variant="bodyStrong" tone="indigo" style={{ marginTop: gspace.lg }}>
            {duty.data.message}
          </GlassText>
        ) : null}
        {duty.isError ? (
          <GlassText variant="bodyStrong" tone="red" style={{ marginTop: gspace.lg }}>
            {duty.error.message}
          </GlassText>
        ) : null}

        {/* The count as a chip rather than trailing the words, so the heading
            stays one short phrase whatever the number is. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: gspace.xxl,
          }}
        >
          <GlassText variant="subtitle">
            {jobs.length === 1 ? 'Active order' : 'Active orders'}
          </GlassText>
          {jobs.length ? <GlassPill label={String(jobs.length)} tone="soft" /> : null}
        </View>

        {/* A failed refresh with jobs already on screen keeps the jobs. Losing
            a rider's list to one dropped poll is worse than the dropped poll. */}
        {isError && data ? (
          <GlassProblem
            tone="quiet"
            message="Could not refresh just now. Showing the last jobs received."
          />
        ) : null}

        {jobs.length ? (
          /* Two across on a tablet, one on a phone. A single column stretched
             to 800dp wastes the width as surely as the centred column that was
             here before did. */
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: gspace.md,
              marginTop: gspace.md,
            }}
          >
            {jobs.map((job) => (
              <View
                key={job.delivery_order_id}
                style={wide ? { flexBasis: 0, flexGrow: 1, minWidth: 320 } : { width: '100%' }}
              >
                <GlassJobCard
                  job={job}
                  timezone={timezone}
                  onPress={() => router.push(`/order/${job.delivery_order_id}`)}
                />
              </View>
            ))}
          </View>
        ) : isError ? (
          /* Never "Nothing to deliver" when the truth is that nobody asked. */
          <GlassProblem
            message={error.message}
            onRetry={() => refetch()}
            retrying={isRefetching}
          />
        ) : (
          <GlassCard style={{ marginTop: gspace.md }}>
            <GlassText variant="subtitle">
              {isLoading ? 'Checking for jobs…' : onDuty ? 'Nothing to deliver' : 'Nothing yet'}
            </GlassText>
            <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm }}>
              {onDuty
                ? 'New jobs appear here automatically. Keep the app open.'
                : 'Go online to pick up whatever is waiting.'}
            </GlassText>
            {onDuty ? (
              <GlassButton
                title="Check again"
                kind="ghost"
                onPress={() => refetch()}
                style={{ marginTop: gspace.lg }}
              />
            ) : null}
          </GlassCard>
        )}

      </ScrollView>
    </GlassScreen>
  );
}

/** Local time of day — the one thing here the server has no view of. */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: glass.fill,
        borderRadius: gradius.chip,
        borderWidth: 1,
        borderColor: glass.border,
        paddingVertical: gspace.md,
        paddingHorizontal: gspace.md,
      }}
    >
      <GlassText variant="subtitle" nums>
        {value}
      </GlassText>
      <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
        {label}
      </GlassText>
    </View>
  );
}
