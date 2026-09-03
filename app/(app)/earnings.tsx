import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOrders } from '../../src/hooks/useOrders';
import { glass, gradius, gspace } from '../../src/theme/glass';
import { GlassCard } from '../../src/ui/glass/GlassCard';
import { GlassHeader } from '../../src/ui/glass/GlassHeader';
import { GlassIcon } from '../../src/ui/glass/GlassIcon';
import { GlassScreen } from '../../src/ui/glass/GlassScreen';
import { GlassText } from '../../src/ui/glass/GlassText';

/**
 * Earnings.
 *
 * The template shows a week's total, a by-day breakdown, bonuses, tips and a
 * scheduled payout. **None of it exists.** There is no pay model in Odoo: no
 * per-order fee, no bonus, no tip and no payout on any endpoint, and `/orders`
 * returns active jobs only so nothing can be totalled on the client either.
 *
 * So this screen says so plainly and shows the counts that ARE real. A figure
 * invented here would be trusted by someone deciding whether they can afford
 * petrol, which is the worst possible place to guess.
 */
export default function Earnings() {
  const insets = useSafeAreaInsets();
  const { data } = useOrders();
  const counts = data?.counts;

  return (
    <GlassScreen>
      <GlassHeader title="Earnings" />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gspace.xl,
          paddingBottom: gspace.xxxl + insets.bottom,
        }}
        showsVerticalScrollIndicator={false}
      >
        <GlassCard style={{ alignItems: 'center', paddingVertical: gspace.xxxl }}>
          <GlassIcon name="wallet" color={glass.inkFaint} size={40} />
          <GlassText variant="subtitle" style={{ marginTop: gspace.lg, textAlign: 'center' }}>
            Payouts are not set up yet
          </GlassText>
          <GlassText
            variant="body"
            tone="soft"
            style={{ marginTop: gspace.sm, textAlign: 'center' }}
          >
            The server does not send rider pay, bonuses or tips yet. As soon as it
            does, your earnings will appear here.
          </GlassText>
        </GlassCard>

        {/* What the server does return, so the screen is not empty of truth. */}
        <GlassText variant="label" tone="soft" upper style={{ marginTop: gspace.xxl }}>
          Deliveries today
        </GlassText>
        <View style={{ flexDirection: 'row', gap: gspace.sm, marginTop: gspace.md }}>
          <Tile label="Delivered" value={counts?.delivered ?? 0} />
          <Tile label="On road" value={counts?.out_for_delivery ?? 0} />
          <Tile label="Assigned" value={counts?.assigned ?? 0} />
        </View>
      </ScrollView>
    </GlassScreen>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
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
      <GlassText variant="subtitle" nums>
        {value}
      </GlassText>
      <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
        {label}
      </GlassText>
    </View>
  );
}
