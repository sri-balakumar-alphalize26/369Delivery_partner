import { Ionicons } from '@expo/vector-icons';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOrders } from '../../src/hooks/useOrders';
import { cardColor, space } from '../../src/theme/tokens';
import { Card } from '../../src/ui/Card';
import { GradientHeader } from '../../src/ui/GradientHeader';
import { StatChip } from '../../src/ui/StatChip';
import { Text } from '../../src/ui/Text';

/**
 * Earnings.
 *
 * The reference shows a week's total, a by-day breakdown, bonuses, tips and a
 * scheduled payout. **None of it exists.** There is no pay model in Odoo: no
 * per-order fee, no bonus, no tip and no payout on any endpoint, and `/orders`
 * returns active jobs only so nothing can be totalled from the client either.
 *
 * So this screen says so, plainly, and shows the delivery counts that ARE real.
 * A figure invented here would be trusted by someone deciding whether they can
 * afford petrol, which is the worst possible place to guess.
 */
export default function Earnings() {
  const insets = useSafeAreaInsets();
  const { data } = useOrders();
  const counts = data?.counts;

  return (
    <View style={{ flex: 1, backgroundColor: cardColor.canvas }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: space.huge + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        <GradientHeader
          style={{
            paddingTop: insets.top + space.lg,
            paddingHorizontal: space.xl,
            paddingBottom: space.xl,
            alignItems: 'center',
          }}
        >
          <Text variant="cardTitle" style={{ color: cardColor.card }}>
            Earnings
          </Text>
        </GradientHeader>

        <View style={{ paddingHorizontal: space.xl, marginTop: space.xl }}>
          <Card style={{ alignItems: 'center', paddingVertical: space.xxl }}>
            <Ionicons name="wallet-outline" size={40} color={cardColor.textFaint} />
            <Text
              variant="cardTitle"
              style={{ color: cardColor.textPrimary, marginTop: space.lg, textAlign: 'center' }}
            >
              Payouts are not set up yet
            </Text>
            <Text
              variant="cardBody"
              style={{
                color: cardColor.textSecondary,
                marginTop: space.sm,
                textAlign: 'center',
              }}
            >
              The server does not send rider pay, bonuses or tips yet. As soon as
              it does, your earnings will appear here.
            </Text>
          </Card>

          {/* What the server does return, so the screen is not empty of truth. */}
          <Text
            variant="cardLabel"
            upper
            style={{ color: cardColor.textSecondary, marginTop: space.xxl }}
          >
            Deliveries today
          </Text>
          <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.md }}>
            <StatChip value={counts?.delivered ?? 0} label="Delivered" style={{ flex: 1 }} />
            <StatChip
              value={counts?.out_for_delivery ?? 0}
              label="On road"
              style={{ flex: 1 }}
            />
            <StatChip value={counts?.assigned ?? 0} label="Assigned" style={{ flex: 1 }} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
