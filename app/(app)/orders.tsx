import { useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sortForRider, useOrders } from '../../src/hooks/useOrders';
import { useSession } from '../../src/store/session';
import { cardColor, space } from '../../src/theme/tokens';
import { Card } from '../../src/ui/Card';
import { GradientHeader } from '../../src/ui/GradientHeader';
import { JobCard } from '../../src/ui/JobCard';
import { Text } from '../../src/ui/Text';

/**
 * The rider's jobs.
 *
 * The reference calls this screen "Order history" and lists finished
 * deliveries. There is no history endpoint: `/orders` returns only work in
 * hand, and a job vanishes from it the moment it is delivered or returned. So
 * this is the active list — everything the rider is carrying — which is real,
 * rather than a history that would have to be invented.
 */
export default function Orders() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const timezone = useSession((s) => s.timezone);
  const { data, isLoading } = useOrders();

  const jobs = sortForRider(data?.orders);

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
            {jobs.length ? `Your jobs · ${jobs.length}` : 'Your jobs'}
          </Text>
        </GradientHeader>

        <View style={{ paddingHorizontal: space.xl, marginTop: space.xl }}>
          {jobs.length ? (
            jobs.map((job) => (
              <View key={job.delivery_order_id} style={{ marginBottom: space.lg }}>
                <JobCard
                  job={job}
                  timezone={timezone}
                  onPress={() => router.push(`/order/${job.delivery_order_id}`)}
                />
              </View>
            ))
          ) : (
            <Card>
              <Text variant="cardTitle" style={{ color: cardColor.textPrimary }}>
                {isLoading ? 'Checking for jobs…' : 'Nothing in hand'}
              </Text>
              <Text
                variant="cardBody"
                style={{ color: cardColor.textSecondary, marginTop: space.sm }}
              >
                Jobs you accept appear here until they are delivered. Finished
                deliveries are not kept on the phone.
              </Text>
            </Card>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
