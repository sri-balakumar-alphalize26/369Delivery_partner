import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/endpoints';
import { Vehicle, VehiclesResponse } from '../api/types';
import { glass, gradius, gspace } from '../theme/glass';
import { GlassButton } from './glass/GlassButton';
import { GlassIcon } from './glass/GlassIcon';
import { GlassProblem } from './glass/GlassProblem';
import { GlassText } from './glass/GlassText';

/**
 * Which bike or car the rider is taking out, asked on the way on duty.
 *
 * The list is the server's: rider vehicles from Odoo's Fleet app that are not
 * grounded and not out with somebody else. It is fetched each time the sheet
 * opens, because "free" changes every time another rider clocks on.
 *
 * With **Vehicle Required** off in Delivery Settings the rider may go on
 * without one — the second button — and nothing else changes for them.
 */
export function VehicleSheet({
  visible,
  onDuty,
  busy,
  onPick,
  onSkip,
  onClose,
}: {
  visible: boolean;
  /** Already on duty: this is a swap, not clocking on. */
  onDuty: boolean;
  busy?: boolean;
  onPick: (vehicleId: number) => void;
  /** Go on duty without a vehicle. Offered only when the server allows it. */
  onSkip: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery<VehiclesResponse>({
    queryKey: ['vehicles'],
    queryFn: () => api.vehicles(),
    enabled: visible,
    staleTime: 0,
  });
  const [selected, setSelected] = useState<number | null>(null);

  // Start on the server's pick — the one in hand, else the rider's usual one.
  useEffect(() => {
    if (visible && data) setSelected(data.preselect_id);
  }, [visible, data]);

  const vehicles = data?.vehicles ?? [];
  const canSkip = !!data && !data.vehicle_required && !onDuty;
  // A swap only when there is something in hand to give back.
  const swapping = onDuty && !!data?.vehicle;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.45)' }}
        />

        <View
          style={{
            backgroundColor: glass.fillStrong,
            borderTopLeftRadius: gradius.card,
            borderTopRightRadius: gradius.card,
            paddingHorizontal: gspace.xl,
            paddingTop: gspace.xl,
            paddingBottom: gspace.xl + insets.bottom,
            maxHeight: '80%',
          }}
        >
          <GlassText variant="label" tone="soft" upper>
            {swapping ? 'Change vehicle' : 'Your vehicle today'}
          </GlassText>
          <GlassText variant="body" tone="soft" style={{ marginTop: gspace.xs }}>
            {swapping
              ? 'The one you have now goes back to the pool.'
              : 'Pick the bike or car you are riding. It is yours until you go off duty.'}
          </GlassText>

          {isError ? (
            <GlassProblem message={error.message} onRetry={() => refetch()} retrying={isRefetching} />
          ) : isLoading ? (
            <GlassText variant="body" tone="soft" style={{ marginTop: gspace.lg }}>
              Finding free vehicles…
            </GlassText>
          ) : vehicles.length === 0 ? (
            <GlassText variant="bodyStrong" style={{ marginTop: gspace.lg }}>
              {data?.vehicle_required
                ? 'No vehicle is free for you. Ask the office to give you one.'
                : 'No vehicle is free right now.'}
            </GlassText>
          ) : (
            <ScrollView style={{ marginTop: gspace.md }} showsVerticalScrollIndicator={false}>
              {vehicles.map((v) => (
                <VehicleRow
                  key={v.id}
                  vehicle={v}
                  checked={selected === v.id}
                  onPress={() => setSelected(v.id)}
                />
              ))}
            </ScrollView>
          )}

          <GlassButton
            title={
              swapping
                ? 'Switch to this vehicle'
                : onDuty
                  ? 'Take this vehicle'
                  : 'Go online with this vehicle'
            }
            kind="green"
            icon="check"
            onPress={() => selected && onPick(selected)}
            loading={busy}
            disabled={!selected || busy}
            style={{ marginTop: gspace.xl }}
          />
          {canSkip ? (
            <GlassButton
              title="Go online without a vehicle"
              kind="ghost"
              onPress={onSkip}
              disabled={busy}
              style={{ marginTop: gspace.sm }}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function VehicleRow({
  vehicle,
  checked,
  onPress,
}: {
  vehicle: Vehicle;
  checked: boolean;
  onPress: () => void;
}) {
  const title = vehicle.plate || vehicle.name;
  const detail = [vehicle.brand, vehicle.model].filter(Boolean).join(' ');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked }}
      accessibilityLabel={`${title}${detail ? `, ${detail}` : ''}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: gspace.md,
        borderBottomWidth: 1,
        borderBottomColor: glass.divider,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <GlassIcon
        name={vehicle.type === 'car' ? 'car' : 'bike'}
        color={glass.inkSoft}
        size={24}
        style={{ marginRight: gspace.md }}
      />
      <View style={{ flex: 1 }}>
        <GlassText variant="bodyStrong">{title}</GlassText>
        {detail ? (
          <GlassText variant="caption" tone="soft">
            {detail}
          </GlassText>
        ) : null}
      </View>
      <GlassIcon
        name={checked ? 'checked' : 'unchecked'}
        color={checked ? glass.green : glass.inkFaint}
        size={22}
      />
    </Pressable>
  );
}
