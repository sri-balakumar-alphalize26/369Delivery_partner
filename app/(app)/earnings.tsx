import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNow } from '../../src/hooks/useNow';
import { sortForRider, useOrders } from '../../src/hooks/useOrders';
import { money, onDutyFor } from '../../src/lib/format';
import { useSession } from '../../src/store/session';
import { CONTENT_MAX_W, glass, gradius, gspace } from '../../src/theme/glass';
import { GlassCard } from '../../src/ui/glass/GlassCard';
import { GlassHeader } from '../../src/ui/glass/GlassHeader';
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
  const { data } = useOrders();
  const rider = useSession((s) => s.rider);
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
      >
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

        {/* Cash gets its own card because it is the one figure here that is
            somebody else's money. Hidden at zero, where it is only noise. */}
        {toCollect > 0 ? (
          <GlassCard style={{ marginTop: gspace.lg }}>
            <GlassText variant="caption" tone="soft">
              Cash in hand
            </GlassText>
            <GlassText variant="amount" tone="orange" nums style={{ marginTop: 2 }}>
              {money(toCollect, currency)}
            </GlassText>
            <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm }}>
              Collected from customers on the jobs you are holding. Hand it over
              at the shop.
            </GlassText>
          </GlassCard>
        ) : null}

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
