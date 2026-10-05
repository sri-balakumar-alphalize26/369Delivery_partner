import { View } from 'react-native';
import { DeliveryOrder, isDropLocked } from '../../api/types';
import { GlassBarState, glassBand, gspace } from '../../theme/glass';
import { GlassButton } from './GlassButton';
import { GlassCard } from './GlassCard';
import { GlassPill } from './GlassPill';
import { GlassProgress } from './GlassProgress';
import { GlassText } from './GlassText';

/**
 * The job in hand, as Home's lead card ("Duty first", chosen 05 Oct): where it
 * stands, who it is for, the four steps with ticks, and one button back into it.
 * Further jobs keep the list card below it.
 */
export function HomeJobCard({
  job,
  timezone,
  onPress,
}: {
  job: DeliveryOrder;
  timezone: string | undefined;
  onPress: () => void;
}) {
  const band = glassBand[job.delivery_status as GlassBarState] ?? glassBand.idle;
  const locked = isDropLocked(job);
  const paid = job.payment_status !== 'cod';
  const offer = job.delivery_status === 'offered';

  return (
    <GlassCard style={{ marginTop: gspace.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: gspace.sm }}>
        <GlassPill label={band.label} bg={band.bg} fg={band.fg} />
        <GlassPill label={paid ? 'PAID' : 'CASH'} tone="soft" />
        <GlassText variant="caption" tone="soft" style={{ marginLeft: 'auto' }} numberOfLines={1}>
          {job.delivery_order_name}
        </GlassText>
      </View>

      <GlassText variant="subtitle" style={{ marginTop: gspace.md }} numberOfLines={1}>
        {job.customer_name || 'Customer'}
      </GlassText>
      <GlassText variant="body" tone="soft" numberOfLines={2}>
        {locked
          ? `${job.customer_area || 'Area'} · full address after pickup`
          : job.delivery_address}
      </GlassText>

      {offer ? null : (
        <View style={{ marginTop: gspace.lg }}>
          <GlassProgress order={job} timezone={timezone} />
        </View>
      )}

      <GlassButton
        title={offer ? 'Open the offer' : 'Continue delivery'}
        kind="green"
        icon="nav"
        onPress={onPress}
        style={{ marginTop: gspace.lg }}
      />
      {job.delivery_status === 'handover_waiting' ? (
        <GlassText variant="caption" tone="red" style={{ marginTop: gspace.sm }}>
          Another rider is coming for this parcel.
        </GlassText>
      ) : null}
    </GlassCard>
  );
}
