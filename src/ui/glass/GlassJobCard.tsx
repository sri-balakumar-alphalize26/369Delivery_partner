import { View } from 'react-native';
import { DeliveryOrder } from '../../api/types';
import { money, promisedAt } from '../../lib/format';
import { GlassBarState, glass, gradius, glassBand, gspace } from '../../theme/glass';
import { GlassButton } from './GlassButton';
import { GlassCard } from './GlassCard';
import { GlassIcon } from './GlassIcon';
import { GlassText } from './GlassText';

/**
 * One job as a glass card: shop with its icon tile and a state chip, a dashed
 * rule, the drop address, then the button through.
 *
 * Shared by Home and the Orders tab so the two lists cannot drift apart.
 */
export function GlassJobCard({
  job,
  timezone,
  onPress,
}: {
  job: DeliveryOrder;
  timezone: string | undefined;
  onPress: () => void;
}) {
  const cod = job.payment_status === 'cod';
  // One source of truth for what each delivery state looks like.
  const band = glassBand[job.delivery_status as GlassBarState] ?? glassBand.idle;

  return (
    <GlassCard>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: gradius.chip,
            backgroundColor: glass.fillStrong,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: gspace.md,
          }}
        >
          <GlassIcon name="store" color={glass.indigo} size={20} />
        </View>

        <View style={{ flex: 1, paddingRight: gspace.sm }}>
          <GlassText variant="bodyStrong" numberOfLines={1}>
            {job.shop}
          </GlassText>
          <GlassText variant="caption" tone="soft" numberOfLines={1}>
            {job.job_code}
            {job.products?.length ? ` · ${job.products.length} items` : ''}
          </GlassText>
        </View>

        <View
          style={{
            backgroundColor: band.bg,
            borderRadius: gradius.chip,
            paddingHorizontal: gspace.sm,
            paddingVertical: 5,
          }}
        >
          <GlassText variant="label" upper style={{ color: band.fg, fontSize: 10 }}>
            {band.label}
          </GlassText>
        </View>
      </View>

      <View
        style={{
          borderBottomWidth: 1,
          borderStyle: 'dashed',
          borderColor: glass.dividerDashed,
          marginVertical: gspace.lg,
        }}
      />

      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <GlassIcon name="pin" color={glass.orange} size={18} />
        <View style={{ flex: 1, marginLeft: gspace.sm }}>
          <GlassText variant="body" numberOfLines={2}>
            {job.delivery_address}
          </GlassText>
          <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
            {job.customer_name}
          </GlassText>
        </View>
        <GlassText variant="caption" tone="soft" nums>
          {promisedAt(job.promised_by, timezone)}
        </GlassText>
      </View>

      <GlassText
        variant="bodyStrong"
        tone={cod ? 'red' : 'green'}
        nums
        style={{ marginTop: gspace.md }}
      >
        {cod ? money(job.amount_to_collect, job.currency) : 'Already paid'}
      </GlassText>

      <GlassButton
        title="Open order"
        kind="dark"
        icon="nav"
        onPress={onPress}
        style={{ marginTop: gspace.lg }}
      />
    </GlassCard>
  );
}
