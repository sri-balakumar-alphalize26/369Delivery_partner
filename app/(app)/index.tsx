import { useRouter } from 'expo-router';
import { ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sortForRider, useDuty, useOrders } from '../../src/hooks/useOrders';
import { money } from '../../src/lib/format';
import { useSession } from '../../src/store/session';
import { glass, gradius, gspace } from '../../src/theme/glass';
import { GlassButton } from '../../src/ui/glass/GlassButton';
import { GlassCard } from '../../src/ui/glass/GlassCard';
import { GlassIcon } from '../../src/ui/glass/GlassIcon';
import { GlassJobCard } from '../../src/ui/glass/GlassJobCard';
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
  const { data, isLoading, refetch } = useOrders();
  const duty = useDuty();

  // The server is the authority on duty; the stored rider is only the fallback
  // before the first /orders comes back.
  const onDuty = data?.on_duty ?? rider?.on_duty ?? false;

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
          paddingBottom: gspace.xxxl + insets.bottom,
        }}
        showsVerticalScrollIndicator={false}
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
              <GlassText variant="bodyStrong">
                {onDuty ? 'You are online' : 'You are off duty'}
              </GlassText>
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

        <GlassText variant="subtitle" style={{ marginTop: gspace.xxl }}>
          {jobs.length > 1 ? `Active orders · ${jobs.length}` : 'Active order'}
        </GlassText>

        {jobs.length ? (
          jobs.map((job) => (
            <View key={job.delivery_order_id} style={{ marginTop: gspace.md }}>
              <GlassJobCard
                job={job}
                timezone={timezone}
                onPress={() => router.push(`/order/${job.delivery_order_id}`)}
              />
            </View>
          ))
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

        {/* Only when there is cash in hand — a zero tile is noise. The
            template's "cash to deposit" would need finished orders, which
            /orders does not return, so this is what the rider is carrying. */}
        {toCollect > 0 ? (
          <GlassCard padding={16} style={{ marginTop: gspace.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <GlassIcon name="cash" color={glass.red} size={18} />
              <View style={{ marginLeft: gspace.sm }}>
                <GlassText variant="caption" tone="soft">
                  Cash to collect
                </GlassText>
                <GlassText variant="subtitle" tone="red" nums>
                  {money(toCollect, currency)}
                </GlassText>
              </View>
            </View>
          </GlassCard>
        ) : null}
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
