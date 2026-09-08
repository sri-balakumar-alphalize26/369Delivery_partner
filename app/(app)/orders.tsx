import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sortForRider, useOrders } from '../../src/hooks/useOrders';
import { COUNT_BUCKET, CountBucket, inBucket } from '../../src/api/types';
import { useSession } from '../../src/store/session';
import { CONTENT_MAX_W, glass, gradius, gspace } from '../../src/theme/glass';
import { useWide } from '../../src/ui/useWide';
import { GlassButton } from '../../src/ui/glass/GlassButton';
import { GlassCard } from '../../src/ui/glass/GlassCard';
import { GlassHeader } from '../../src/ui/glass/GlassHeader';
import { GlassJobCard } from '../../src/ui/glass/GlassJobCard';
import { GlassPill } from '../../src/ui/glass/GlassPill';
import { GlassProblem } from '../../src/ui/glass/GlassProblem';
import { GlassScreen } from '../../src/ui/glass/GlassScreen';
import { GlassText } from '../../src/ui/glass/GlassText';

/**
 * The buckets a rider can browse.
 *
 * `delivered` is excluded by construction rather than by care: those rows are
 * dropped from `/orders` and there is no history call, so a Delivered filter
 * could only ever show an empty list.
 */
type JobFilter = 'all' | Exclude<CountBucket, 'delivered'>;

/**
 * Worded exactly as Home's tiles are, not as `glassBand` labels them. That
 * table calls `picked` alone "COLLECTED", whereas the Collected tile counts
 * `picked` and `dispatched` together — a rider who taps a word should find the
 * same word, covering the same jobs.
 */
const FILTERS: { key: JobFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'picked_up', label: 'Collected' },
  { key: 'out_for_delivery', label: 'On road' },
];

const NOTHING: Record<JobFilter, string> = {
  all: 'Nothing in hand',
  assigned: 'Nothing assigned',
  picked_up: 'Nothing collected',
  out_for_delivery: 'Nothing on the road',
};

/** Odoo can add a status faster than the app ships, so an unknown one shows all. */
function asFilter(value: string | undefined): JobFilter | null {
  if (!value) return null;
  if (value === 'all') return 'all';
  return Object.keys(COUNT_BUCKET).includes(value) && value !== 'delivered'
    ? (value as JobFilter)
    : null;
}

/**
 * The rider's jobs.
 *
 * The template calls this "Order history" and lists finished deliveries. There
 * is no history endpoint: `/orders` returns only work in hand, and a job leaves
 * it the moment it is delivered or returned. So this is the active list, which
 * is real, rather than a history that would have to be invented.
 *
 * It doubles as the answer to Home's count tiles. Tapping "On road 2" arrives
 * here with `?bucket=out_for_delivery` and finds those two jobs.
 */
export default function Orders() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const timezone = useSession((s) => s.timezone);
  const { data, isLoading, isError, error, isRefetching, refetch } = useOrders();
  const wide = useWide();

  const { bucket } = useLocalSearchParams<{ bucket?: string }>();
  const [filter, setFilter] = useState<JobFilter>('all');

  /**
   * The parameter is an instruction from Home, not the state of this screen.
   *
   * It is consumed once and cleared. Left in place it would belong to the tab
   * rather than to the tap: a rider who opened "Assigned" from a tile, wandered
   * off and later pressed the Jobs tab itself would find the old filter still
   * applied, with no memory of having asked for it.
   */
  useEffect(() => {
    const wanted = asFilter(bucket);
    if (!wanted) return;
    setFilter(wanted);
    router.setParams({ bucket: '' });
  }, [bucket, router]);

  const all = sortForRider(data?.orders);
  const jobs =
    filter === 'all' ? all : all.filter((j) => inBucket(j.delivery_status, filter));

  return (
    <GlassScreen>
      {/* The count as a chip in the header's right slot rather than trailing
          the title, so the title stays two words however many jobs there are.

          It counts the rows actually shown, never the tile's figure. Odoo
          computes the counts over a wider set than it returns, so the two can
          honestly differ — and a heading that promised three jobs above a list
          of two would look like a bug in the list. */}
      <GlassHeader
        title="Your jobs"
        right={jobs.length ? <GlassPill label={String(jobs.length)} tone="soft" /> : undefined}
      />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gspace.xl,
          // A column, not a full-width sprawl. Binds only above CONTENT_MAX_W.
          width: '100%',
          maxWidth: CONTENT_MAX_W,
          alignSelf: 'center',
          paddingBottom: gspace.xxxl + insets.bottom,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />
        }
      >
        {/* Jobs already on screen survive a failed refresh. */}
        {isError && data ? (
          <GlassProblem
            tone="quiet"
            message="Could not refresh just now. Showing the last jobs received."
          />
        ) : null}

        {/* Only worth drawing when there is something to sort through. "All"
            always sits first, and is what keeps a `returning` job reachable —
            Odoo lists those but counts them in no bucket at all. */}
        {all.length ? (
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: gspace.sm,
              marginBottom: gspace.md,
            }}
          >
            {FILTERS.map((f) => (
              <FilterChip
                key={f.key}
                label={f.label}
                active={filter === f.key}
                onPress={() => {
                  setFilter(f.key);
                  // Drop any instruction still in the URL, so it cannot
                  // reassert itself over a choice made here.
                  if (bucket) router.setParams({ bucket: '' });
                }}
              />
            ))}
          </View>
        ) : null}

        {jobs.length ? (
          /* Two across on a tablet, one on a phone — the same grid Home uses,
             so the two lists cannot drift apart in shape any more than the
             card they share can. */
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: gspace.md }}>
            {jobs.map((job) => (
              <View
                key={job.delivery_order_id}
                style={wide ? { flexBasis: 0, flexGrow: 1, minWidth: 320 } : { width: '100%' }}
              >
                <GlassJobCard
                  job={job}
                  timezone={timezone}
                  onPress={() => router.push(`/order/${job.delivery_order_id}`)}
                />
              </View>
            ))}
          </View>
        ) : all.length ? (
          /* Jobs exist, just none of this kind. Say which kind is empty, and
             offer the way out — a filter with no visible cause is how a rider
             concludes the app has lost their work. */
          <GlassCard>
            <GlassText variant="subtitle">{NOTHING[filter]}</GlassText>
            <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm }}>
              You have {all.length} other {all.length === 1 ? 'job' : 'jobs'} in hand.
            </GlassText>
            <GlassButton
              title="Show all jobs"
              kind="ghost"
              onPress={() => setFilter('all')}
              style={{ marginTop: gspace.lg }}
            />
          </GlassCard>
        ) : isError ? (
          /* "Nothing in hand" was a lie whenever the request had failed. */
          <GlassProblem
            message={error.message}
            onRetry={() => refetch()}
            retrying={isRefetching}
          />
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

/** One filter in the row. Local, as Home's `Stat` is: it belongs to this screen. */
function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      /* `selected` is what tells a screen reader which of the four is on;
         colour alone says nothing to it. */
      accessibilityState={{ selected: active }}
      accessibilityLabel={`Show ${label.toLowerCase()}`}
      hitSlop={6}
      style={({ pressed }) => ({
        backgroundColor: active ? glass.ink : glass.fill,
        borderRadius: gradius.pill,
        borderWidth: 1,
        borderColor: active ? glass.ink : glass.border,
        paddingHorizontal: gspace.md,
        paddingVertical: gspace.sm,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <GlassText
        variant="caption"
        style={{ color: active ? glass.white : glass.inkSoft }}
      >
        {label}
      </GlassText>
    </Pressable>
  );
}
