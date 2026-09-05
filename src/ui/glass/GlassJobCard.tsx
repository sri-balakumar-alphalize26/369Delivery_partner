import { Pressable, View } from 'react-native';
import { DeliveryOrder } from '../../api/types';
import { money, promisedAt, shopName } from '../../lib/format';
import { GlassBarState, glass, gradius, glassBand, gspace } from '../../theme/glass';
import { GlassCard } from './GlassCard';
import { GlassIcon } from './GlassIcon';
import { GlassRoute } from './GlassRoute';
import { GlassText } from './GlassText';

/**
 * One job as a glass card: the shop with its state chip, the journey on a
 * single rail, then what is owed.
 *
 * The card used to spell the same thing out as a heading, a dashed rule, an
 * address and a full-width button — about 400px, so barely one job fitted on a
 * screen. The rail says the same in half the height, and the whole card is the
 * button now, which is both the standard pattern and the rest of the saving.
 *
 * Shared by Home and the Orders tab so the two lists cannot drift apart.
 *
 * No distance, no ETA and no fee, though every rival app shows all three: none
 * of them exists anywhere in the contract, and a number on a card like this
 * would be believed.
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

  /** Once the parcel is aboard, the shop is behind the rider. */
  const collected = !['offered', 'accepted'].includes(job.delivery_status);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open the job for ${job.customer_name}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <GlassCard>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: gradius.chip,
              backgroundColor: glass.fill,
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: gspace.md,
            }}
          >
            <GlassIcon name="store" color={glass.indigo} size={18} />
          </View>

          <View style={{ flex: 1, paddingRight: gspace.sm }}>
            <GlassText variant="caption" tone="soft" numberOfLines={1}>
              {job.job_code}
              {job.products?.length ? ` · ${job.products.length} items` : ''}
              {job.promised_by ? ` · ${promisedAt(job.promised_by, timezone)}` : ''}
            </GlassText>
          </View>

          <View
            style={{
              backgroundColor: band.bg,
              borderRadius: gradius.chip,
              paddingHorizontal: gspace.sm,
              paddingVertical: 4,
            }}
          >
            <GlassText variant="label" upper style={{ color: band.fg, fontSize: 10 }}>
              {band.label}
            </GlassText>
          </View>
        </View>

        <View style={{ marginTop: gspace.lg }}>
          <GlassRoute
            from={shopName(job.shop)}
            to={job.customer_name}
            toDetail={job.delivery_address}
            done={collected ? 'from' : null}
          />
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: gspace.lg,
            paddingTop: gspace.md,
            borderTopWidth: 1,
            borderTopColor: glass.border,
          }}
        >
          <GlassText variant="bodyStrong" tone={cod ? 'red' : 'green'} nums style={{ flex: 1 }}>
            {cod ? money(job.amount_to_collect, job.currency) : 'Already paid'}
          </GlassText>
          <GlassText variant="caption" tone="soft" style={{ marginRight: 2 }}>
            Open
          </GlassText>
          <GlassIcon name="chev" color={glass.inkFaint} size={16} />
        </View>
      </GlassCard>
    </Pressable>
  );
}
