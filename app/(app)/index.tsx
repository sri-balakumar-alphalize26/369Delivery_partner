import { useRouter } from 'expo-router';
import { ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sortForRider, useDuty, useOrders } from '../../src/hooks/useOrders';
import { money } from '../../src/lib/format';
import { useSession } from '../../src/store/session';
import { cardColor, cardRadius, space } from '../../src/theme/tokens';
import { Avatar } from '../../src/ui/Avatar';
import { Card } from '../../src/ui/Card';
import { GradientHeader } from '../../src/ui/GradientHeader';
import { JobCard } from '../../src/ui/JobCard';
import { PrimaryButton } from '../../src/ui/PrimaryButton';
import { StatChip } from '../../src/ui/StatChip';
import { Text } from '../../src/ui/Text';

/**
 * The rider's day, in the Bold Cards style.
 *
 * Duty leads because it is the first thing that has to be true: the contract
 * offers nothing at all to an off-duty rider, so an app without this control
 * shows an empty list and no reason for it.
 *
 * The reference design puts today's earnings, a rating, a bonus and a
 * cash-to-deposit total on this screen. None of those exist in the contract —
 * there is no pay model in Odoo, `Rider` carries no score, and `/orders`
 * returns only active jobs so no daily total is derivable. The card keeps the
 * design's shape and fills it with the four counts Odoo does return. A number
 * here would be trusted, so it has to be real.
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
  // Not the reference's "cash to deposit", which would need finished orders too.
  const toCollect = jobs
    .filter((j) => j.payment_status === 'cod')
    .reduce((sum, j) => sum + (j.amount_to_collect ?? 0), 0);
  const currency = jobs.find((j) => j.currency)?.currency;

  return (
    <View style={{ flex: 1, backgroundColor: cardColor.canvas }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: space.huge + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        {/* Blue header. No notification bell: nothing registers for push yet
            (useOrders polls instead), so it would be a control that does
            nothing. */}
        <GradientHeader
          style={{
            paddingTop: insets.top + space.lg,
            paddingHorizontal: space.xl,
            paddingBottom: space.huge + space.xxl,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Avatar name={rider?.name} />
            <View style={{ marginLeft: space.md, flex: 1 }}>
              <Text variant="cardBody" style={{ color: 'rgba(255,255,255,0.72)' }}>
                {greeting()}
              </Text>
              <Text variant="cardTitle" style={{ color: cardColor.card }} numberOfLines={1}>
                {rider?.name ?? 'Rider'}
              </Text>
            </View>
          </View>

          {/* The design's "You are online" row, wired to the real duty
              mutation — this one maps onto the contract exactly. */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: 'rgba(255,255,255,0.14)',
              borderRadius: cardRadius.card,
              paddingVertical: space.lg,
              paddingHorizontal: space.xl,
              marginTop: space.xl,
            }}
          >
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: onDuty ? cardColor.onlineGreen : cardColor.textFaint,
              }}
            />
            <Text
              variant="cardTitle"
              style={{ color: cardColor.card, marginLeft: space.md, flex: 1 }}
            >
              {onDuty ? 'You are online' : 'You are off duty'}
            </Text>
            <Switch
              value={onDuty}
              disabled={duty.isPending}
              onValueChange={(next) => duty.mutate(next)}
              trackColor={{ true: cardColor.onlineGreen, false: 'rgba(255,255,255,0.3)' }}
              thumbColor={cardColor.card}
            />
          </View>
        </GradientHeader>

        {/* Pulled up to overlap the header, exactly as the reference does. */}
        <View style={{ paddingHorizontal: space.xl, marginTop: -(space.huge + space.md) }}>
          <Card>
            <Text variant="cardBody" style={{ color: cardColor.textSecondary }}>
              Delivered today
            </Text>
            <Text
              variant="cardAmount"
              nums
              style={{ color: cardColor.textPrimary, marginTop: space.xs }}
            >
              {counts?.delivered ?? 0}
            </Text>

            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.lg }}>
              <StatChip value={counts?.assigned ?? 0} label="Assigned" style={{ flex: 1 }} />
              <StatChip value={counts?.picked_up ?? 0} label="Collected" style={{ flex: 1 }} />
              <StatChip
                value={counts?.out_for_delivery ?? 0}
                label="On road"
                style={{ flex: 1 }}
              />
            </View>
          </Card>
        </View>

        {/* Odoo writes this for the rider — "2 job(s) were waiting." */}
        {duty.data?.message ? (
          <Text
            variant="cardBody"
            style={{
              color: cardColor.brand,
              paddingHorizontal: space.xl,
              marginTop: space.lg,
            }}
          >
            {duty.data.message}
          </Text>
        ) : null}
        {duty.isError ? (
          <Text
            variant="cardBody"
            style={{ color: cardColor.red, paddingHorizontal: space.xl, marginTop: space.lg }}
          >
            {duty.error.message}
          </Text>
        ) : null}

        <View style={{ paddingHorizontal: space.xl, marginTop: space.xxl }}>
          <Text variant="cardTitle" style={{ color: cardColor.textPrimary }}>
            {jobs.length > 1 ? `Active orders · ${jobs.length}` : 'Active order'}
          </Text>
        </View>

        {jobs.length ? (
          jobs.map((job) => (
            <View
              key={job.delivery_order_id}
              style={{ paddingHorizontal: space.xl, marginTop: space.lg }}
            >
              <JobCard
                job={job}
                timezone={timezone}
                onPress={() => router.push(`/order/${job.delivery_order_id}`)}
              />
            </View>
          ))
        ) : (
          <View style={{ paddingHorizontal: space.xl, marginTop: space.lg }}>
            <Card>
              <Text variant="cardTitle" style={{ color: cardColor.textPrimary }}>
                {isLoading ? 'Checking for jobs…' : onDuty ? 'Nothing to deliver' : 'Nothing yet'}
              </Text>
              <Text
                variant="cardBody"
                style={{ color: cardColor.textSecondary, marginTop: space.sm }}
              >
                {onDuty
                  ? 'New jobs appear here automatically. Keep the app open.'
                  : 'Go online to pick up whatever is waiting.'}
              </Text>
              {onDuty ? (
                <PrimaryButton
                  label="Check again"
                  kind="ghost"
                  onPress={() => refetch()}
                  style={{
                    marginTop: space.lg,
                    height: 46,
                    borderRadius: cardRadius.button,
                    backgroundColor: cardColor.chipBg,
                  }}
                />
              ) : null}
            </Card>
          </View>
        )}

        {/* Only shown when there is cash in hand — a zero tile is noise. */}
        {toCollect > 0 ? (
          <View style={{ paddingHorizontal: space.xl, marginTop: space.lg }}>
            <Card style={{ paddingVertical: space.lg }}>
              <Text variant="cardCaption" style={{ color: cardColor.textSecondary }}>
                Cash to collect
              </Text>
              <Text variant="cardTitle" nums style={{ color: cardColor.red, marginTop: 2 }}>
                {money(toCollect, currency)}
              </Text>
            </Card>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** Local time of day — the one thing here the server has no view of. */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
