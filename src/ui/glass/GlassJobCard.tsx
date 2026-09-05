import { View } from 'react-native';
import { DeliveryOrder } from '../../api/types';
import { money, promisedAt, shopName } from '../../lib/format';
import { GlassBarState, glass, glassBand, gspace } from '../../theme/glass';
import { GlassButton } from './GlassButton';
import { GlassCard } from './GlassCard';
import { GlassIcon } from './GlassIcon';
import { GlassPill } from './GlassPill';
import { GlassRoute } from './GlassRoute';
import { GlassText } from './GlassText';

/**
 * One job: the shop with its state chip, the journey on a rail, then what is
 * owed and the way through.
 *
 * Sections are full-bleed and divided by hairlines rather than padded as one
 * block, which is what lets the card stay compact without feeling crowded.
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
  const when = promisedAt(job.promised_by, timezone);

  /** Once the parcel is aboard, the shop is behind the rider. */
  const collected = !['offered', 'accepted'].includes(job.delivery_status);

  return (
    <GlassCard padding={0}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: gspace.md }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: glass.fill,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: gspace.md,
          }}
        >
          <GlassIcon name="store" color={glass.ink} size={18} />
        </View>

        <View style={{ flex: 1, paddingRight: gspace.sm }}>
          <GlassText variant="bodyStrong" numberOfLines={1}>
            {shopName(job.shop)}
          </GlassText>
          <GlassText variant="caption" tone="soft" numberOfLines={1}>
            {job.job_code}
            {job.products?.length ? ` · ${job.products.length} items` : ''}
            {when ? ` · ${when}` : ''}
          </GlassText>
        </View>

        <GlassPill label={band.label} bg={band.bg} fg={band.fg} />
      </View>

      <View style={{ height: 1, backgroundColor: glass.divider }} />

      <View style={{ padding: gspace.md }}>
        <GlassRoute
          from={shopName(job.shop)}
          to={job.customer_name}
          toDetail={job.delivery_address}
          done={collected ? 'from' : null}
        />

        {/* Payment as a chip rather than a coloured sentence: it is a fact
            about the job, the same as the state, so it should look like one. */}
        <View style={{ flexDirection: 'row', marginTop: gspace.md }}>
          {cod ? (
            <GlassPill label={`COD ${money(job.amount_to_collect, job.currency)}`} tone="navy" />
          ) : (
            <GlassPill label="PAID" tone="green" />
          )}
        </View>

        <GlassButton
          title="Open order"
          kind="dark"
          icon="nav"
          size="sm"
          onPress={onPress}
          style={{ marginTop: gspace.md }}
        />
      </View>
    </GlassCard>
  );
}
