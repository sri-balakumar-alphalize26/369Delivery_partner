import { useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sortForRider, useOrders } from '../../src/hooks/useOrders';
import { useSession } from '../../src/store/session';
import { gspace } from '../../src/theme/glass';
import { GlassCard } from '../../src/ui/glass/GlassCard';
import { GlassHeader } from '../../src/ui/glass/GlassHeader';
import { GlassJobCard } from '../../src/ui/glass/GlassJobCard';
import { GlassScreen } from '../../src/ui/glass/GlassScreen';
import { GlassText } from '../../src/ui/glass/GlassText';

/**
 * The rider's jobs.
 *
 * The template calls this "Order history" and lists finished deliveries. There
 * is no history endpoint: `/orders` returns only work in hand, and a job leaves
 * it the moment it is delivered or returned. So this is the active list, which
 * is real, rather than a history that would have to be invented.
 */
export default function Orders() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const timezone = useSession((s) => s.timezone);
  const { data, isLoading } = useOrders();

  const jobs = sortForRider(data?.orders);

  return (
    <GlassScreen>
      <GlassHeader title={jobs.length ? `Your jobs · ${jobs.length}` : 'Your jobs'} />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gspace.xl,
          paddingBottom: gspace.xxxl + insets.bottom,
        }}
        showsVerticalScrollIndicator={false}
      >
        {jobs.length ? (
          jobs.map((job) => (
            <View key={job.delivery_order_id} style={{ marginBottom: gspace.lg }}>
              <GlassJobCard
                job={job}
                timezone={timezone}
                onPress={() => router.push(`/order/${job.delivery_order_id}`)}
              />
            </View>
          ))
        ) : (
          <GlassCard>
            <GlassText variant="subtitle">
              {isLoading ? 'Checking for jobs…' : 'Nothing in hand'}
            </GlassText>
            <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm }}>
              Jobs you accept appear here until they are delivered. Finished
              deliveries are not kept on the phone.
            </GlassText>
          </GlassCard>
        )}
      </ScrollView>
    </GlassScreen>
  );
}
