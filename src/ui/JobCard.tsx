import { Pressable, View } from 'react-native';
import { DeliveryOrder } from '../api/types';
import { money, promisedAt } from '../lib/format';
import { BarState, cardColor, cardRadius, space, statusBar } from '../theme/tokens';
import { Badge } from './Badge';
import { Card } from './Card';
import { Text } from './Text';

/**
 * One job as a card: shop and code, a state badge, a dashed rule, then the
 * customer and address with the promised time, and the button through.
 *
 * Shared by Home and the Orders tab so the two lists cannot drift apart.
 */
export function JobCard({
  job,
  timezone,
  onPress,
}: {
  job: DeliveryOrder;
  timezone: string | undefined;
  onPress: () => void;
}) {
  const cod = job.payment_status === 'cod';
  // Fed from the same map the status band uses, so one source of truth decides
  // what every delivery state looks like.
  const band = statusBar[job.delivery_status as BarState] ?? statusBar.idle;

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: space.md }}>
          <Text variant="cardTitle" style={{ color: cardColor.textPrimary }} numberOfLines={1}>
            {job.shop}
          </Text>
          <Text
            variant="cardCaption"
            style={{ color: cardColor.textSecondary, marginTop: 2 }}
            numberOfLines={1}
          >
            {job.job_code}
            {job.products?.length ? ` · ${job.products.length} items` : ''}
          </Text>
        </View>
        <Badge label={band.label} bg={band.bg} fg={band.fg} />
      </View>

      <View
        style={{
          borderBottomWidth: 1,
          borderStyle: 'dashed',
          borderColor: cardColor.border,
          marginVertical: space.lg,
        }}
      />

      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: space.md }}>
          <Text variant="cardBody" style={{ color: cardColor.textPrimary }}>
            {job.customer_name}
          </Text>
          <Text variant="cardCaption" style={{ color: cardColor.textSecondary, marginTop: 2 }}>
            {job.delivery_address}
          </Text>
        </View>
        <Text variant="cardCaption" nums style={{ color: cardColor.textSecondary }}>
          {promisedAt(job.promised_by, timezone)}
        </Text>
      </View>

      <Text
        variant="cardBody"
        nums
        style={{ color: cod ? cardColor.red : cardColor.green, marginTop: space.md }}
      >
        {cod ? money(job.amount_to_collect, job.currency) : 'Already paid'}
      </Text>

      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Open order for ${job.customer_name}`}
        style={({ pressed }) => ({
          backgroundColor: cardColor.brand,
          borderRadius: cardRadius.button,
          height: 54,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: space.lg,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text variant="cardButton" style={{ color: cardColor.card }}>
          Open order
        </Text>
      </Pressable>
    </Card>
  );
}
