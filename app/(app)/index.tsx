import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { DeliveryOrder } from '../../src/api/types';
import { pickCurrent, useOrders } from '../../src/hooks/useOrders';
import { useSession } from '../../src/store/session';
import { BarState, color, space } from '../../src/theme/tokens';
import { BigNumber } from '../../src/ui/BigNumber';
import { Hairline } from '../../src/ui/Hairline';
import { PrimaryButton } from '../../src/ui/PrimaryButton';
import { Screen } from '../../src/ui/Screen';
import { StatusBar } from '../../src/ui/StatusBar';
import { Text } from '../../src/ui/Text';
import { money } from '../../src/lib/format';

/**
 * The rider's day.
 *
 * There is no duty toggle and no earnings figure — the contract has no endpoint
 * for either, so inventing numbers here would be worse than leaving them out.
 * The four `counts` Odoo does return are the dashboard instead.
 */
export default function Home() {
  const router = useRouter();
  const rider = useSession((s) => s.rider);
  const { data, isLoading, refetch } = useOrders();

  const current: DeliveryOrder | null = pickCurrent(data?.orders);
  const counts = data?.counts;

  const bar: BarState = current ? (current.delivery_status as BarState) : 'idle';

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <StatusBar state={bar} />

      <Screen>
        <Text variant="title">{rider?.name ?? 'Rider'}</Text>
        <Text variant="body" tone="soft" style={{ marginTop: 2 }}>
          {rider?.mobile}
        </Text>

        {current ? (
          <View style={{ marginTop: space.huge }}>
            <Text variant="label" tone="soft" upper>
              {current.delivery_status === 'offered' ? 'New job' : 'In progress'}
            </Text>

            <Text variant="title" style={{ marginTop: space.sm }}>
              {current.customer_name}
            </Text>
            <Text variant="body" tone="soft" style={{ marginTop: space.xs }}>
              {current.delivery_address}
            </Text>

            {current.payment_status === 'cod' ? (
              <BigNumber
                value={money(current.amount_to_collect, current.currency)}
                label="Cash to collect"
                size="big"
                style={{ marginTop: space.xxl }}
              />
            ) : (
              <Text variant="bodyStrong" tone="green" style={{ marginTop: space.xl }}>
                Already paid — collect nothing
              </Text>
            )}

            <PrimaryButton
              label={current.delivery_status === 'offered' ? 'View job' : 'Continue job'}
              onPress={() => router.push(`/order/${current.delivery_order_id}`)}
              style={{ marginTop: space.huge }}
            />
          </View>
        ) : (
          <View style={{ marginTop: space.huge }}>
            <Text variant="title">
              {isLoading ? 'Checking for jobs…' : 'Nothing to deliver'}
            </Text>
            <Text variant="body" tone="soft" style={{ marginTop: space.sm }}>
              New jobs appear here automatically. Keep the app open.
            </Text>
            <PrimaryButton
              label="Check again"
              kind="ghost"
              onPress={() => refetch()}
              style={{
                marginTop: space.xl,
                borderWidth: 1,
                borderColor: color.hairline,
              }}
            />
          </View>
        )}

        <Hairline />

        <Text variant="label" tone="soft" upper>
          Today
        </Text>
        <View style={{ flexDirection: 'row', marginTop: space.lg }}>
          <BigNumber
            value={counts?.assigned ?? 0}
            label="Assigned"
            size="mid"
            style={{ flex: 1 }}
          />
          <BigNumber
            value={counts?.out_for_delivery ?? 0}
            label="On the road"
            size="mid"
            style={{ flex: 1 }}
          />
          <BigNumber
            value={counts?.delivered ?? 0}
            label="Delivered"
            size="mid"
            style={{ flex: 1 }}
          />
        </View>
      </Screen>
    </View>
  );
}
