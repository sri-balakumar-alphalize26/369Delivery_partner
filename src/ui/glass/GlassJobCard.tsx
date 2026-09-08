import { View } from 'react-native';
import { Image } from 'expo-image';
import { DeliveryOrder } from '../../api/types';
import { dueIn, money, shopName } from '../../lib/format';
import { useNow } from '../../hooks/useNow';
import { useJobDistance } from '../../hooks/useJobDistance';
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

  /**
   * The promise as a countdown rather than a clock reading.
   *
   * This showed `05 Sep · 16:48`, which is a fact and not a pressure. A rider
   * glancing at a phone needs to know whether they are behind, and every
   * quick-commerce app counts down for exactly that reason. Counted against the
   * server's clock, not this phone's — see lib/clock.
   */
  const due = dueIn(job.promised_by, useNow());

  /** How far this job is by road. Null until it resolves, and null without coordinates. */
  const metres = useJobDistance(job);

  /** Only the object form carries an image; older captures send a bare string. */
  const logo = typeof job.shop === 'object' ? job.shop.image_url : null;
  // One source of truth for what each delivery state looks like.
  const band = glassBand[job.delivery_status as GlassBarState] ?? glassBand.idle;

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
          {logo ? (
            <Image
              source={{ uri: logo }}
              style={{ width: 36, height: 36, borderRadius: 18 }}
              contentFit="cover"
            />
          ) : (
            <GlassIcon name="store" color={glass.ink} size={18} />
          )}
        </View>

        <View style={{ flex: 1, paddingRight: gspace.sm }}>
          <GlassText variant="bodyStrong" numberOfLines={1}>
            {shopName(job.shop)}
          </GlassText>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 1 }}>
            {/* The countdown leads. `job_code` used to sit here reading "DEL ·",
                which is a warehouse's word for it and means nothing to a rider. */}
            {due ? (
              <GlassText variant="caption" tone={due.late ? 'red' : 'soft'} nums>
                {due.text}
              </GlassText>
            ) : null}
            <GlassText variant="caption" tone="soft" numberOfLines={1}>
              {due && job.products?.length ? ' · ' : ''}
              {job.products?.length ? `${job.products.length} items` : ''}
              {metres ? ` · ${(metres / 1000).toFixed(1)} km` : ''}
            </GlassText>
          </View>
        </View>

        <View style={{ alignItems: 'flex-end', gap: gspace.xs }}>
          <GlassPill label={band.label} bg={band.bg} fg={band.fg} />
          {/* Quick or express. It ships on every order and was drawn nowhere —
              Instamart's whole card hierarchy rests on this distinction. */}
          {job.delivery_type ? (
            <GlassPill label={job.delivery_type} tone="soft" />
          ) : null}
        </View>
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
