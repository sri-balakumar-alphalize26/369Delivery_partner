import { Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sortForRider, useHistory, useOrders } from '../../src/hooks/useOrders';
import { COUNT_BUCKET, CountBucket, inBucket, PastJob } from '../../src/api/types';
import { asUtc, money, shopName, timeOnly } from '../../src/lib/format';
import { useSession } from '../../src/store/session';
import {
  CONTENT_MAX_W,
  GlassBarState,
  glass,
  glassBand,
  gradius,
  gspace,
} from '../../src/theme/glass';
import { useWide } from '../../src/ui/useWide';
import { GlassButton } from '../../src/ui/glass/GlassButton';
import { GlassCard } from '../../src/ui/glass/GlassCard';
import { GlassHeader } from '../../src/ui/glass/GlassHeader';
import { GlassIcon } from '../../src/ui/glass/GlassIcon';
import { GlassJobCard } from '../../src/ui/glass/GlassJobCard';
import { GlassPill } from '../../src/ui/glass/GlassPill';
import { GlassProblem } from '../../src/ui/glass/GlassProblem';
import { GlassScreen } from '../../src/ui/glass/GlassScreen';
import { GlassText } from '../../src/ui/glass/GlassText';

/**
 * The buckets a rider can browse.
 *
 * `delivered` is excluded by construction rather than by care: those rows are
 * dropped from `/orders`, so a Delivered filter could only ever show an empty
 * list. Finished work lives under Past, from `/history`.
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
 * The rider's jobs: Active, the work in hand, and Past, the work finished.
 *
 * `/orders` returns only work in hand, and a job leaves it the moment it is
 * delivered or returned. Past reads `/history` instead, so neither list has to
 * be stitched out of the other.
 *
 * Active doubles as the answer to Home's count tiles. Tapping "On road 2"
 * arrives here with `?bucket=out_for_delivery` and finds those two jobs.
 */
export default function Orders() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const timezone = useSession((s) => s.timezone);
  const { data, isLoading, isError, error, isRefetching, refetch } = useOrders();
  const wide = useWide();

  const { bucket } = useLocalSearchParams<{ bucket?: string }>();
  const [filter, setFilter] = useState<JobFilter>('all');
  const [view, setView] = useState<'active' | 'past'>('active');
  // Fetched only once Past is opened, and again each time it is.
  const history = useHistory(view === 'past');
  const past = history.data?.jobs ?? [];

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
    setView('active');
    router.setParams({ bucket: '' });
  }, [bucket, router]);

  const all = sortForRider(data?.orders);
  const jobs =
    filter === 'all' ? all : all.filter((j) => inBucket(j.delivery_status, filter));
  const shown = view === 'active' ? jobs.length : past.length;

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
        right={shown ? <GlassPill label={String(shown)} tone="soft" /> : undefined}
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
          view === 'active' ? (
            <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />
          ) : (
            <RefreshControl
              refreshing={history.isRefetching}
              onRefresh={() => history.refetch()}
            />
          )
        }
      >
        <ViewSwitch value={view} onChange={setView} />

        {view === 'past' ? (
          <PastList
            jobs={past}
            timezone={history.data?.timezone ?? timezone}
            loading={history.isLoading}
            error={history.isError ? history.error.message : null}
            onRetry={() => history.refetch()}
            retrying={history.isRefetching}
          />
        ) : (
          <>
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
                  ones move to Past.
                </GlassText>
              </GlassCard>
            )}
          </>
        )}
      </ScrollView>
    </GlassScreen>
  );
}

/**
 * Active or Past, as two halves of one control.
 *
 * Shaped unlike the filter chips on purpose: the chips narrow one list, this
 * swaps which list is shown, and a rider should not read them as one row.
 */
function ViewSwitch({
  value,
  onChange,
}: {
  value: 'active' | 'past';
  onChange: (v: 'active' | 'past') => void;
}) {
  const options: { key: 'active' | 'past'; label: string }[] = [
    { key: 'active', label: 'Active' },
    { key: 'past', label: 'Past' },
  ];
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        backgroundColor: glass.fill,
        borderRadius: gradius.button,
        borderWidth: 1,
        borderColor: glass.border,
        padding: 3,
        marginBottom: gspace.lg,
      }}
    >
      {options.map((o) => {
        const on = value === o.key;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: 'center',
              paddingVertical: gspace.sm,
              borderRadius: gradius.button - 2,
              backgroundColor: on ? glass.ink : 'transparent',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <GlassText variant="bodyStrong" style={{ color: on ? glass.white : glass.inkSoft }}>
              {o.label}
            </GlassText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The calendar day a UTC stamp falls on in the server's zone, as YYYY-MM-DD. */
function dayKey(raw: string | undefined, timeZone?: string): string {
  if (!raw) return '';
  const d = new Date(asUtc(raw));
  if (Number.isNaN(d.getTime())) return '';
  try {
    // en-CA formats as YYYY-MM-DD, which also sorts and compares as text.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** "Today", "Yesterday", or "Thu 1 Oct" — counted in the server's zone. */
function dayLabel(key: string, timeZone?: string): string {
  if (!key) return 'Earlier';
  const now = Date.now();
  if (key === dayKey(new Date(now).toISOString(), timeZone)) return 'Today';
  if (key === dayKey(new Date(now - 86_400_000).toISOString(), timeZone)) return 'Yesterday';
  // Noon UTC, so no zone can push the date across midnight.
  const d = new Date(`${key}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(d);
}

/**
 * Finished work, grouped by day, newest first.
 *
 * A row opens `past/[id]`, a read-only page, not the job screen: that one is
 * built for work in hand, and reads `/orders/{id}`, which may refuse a job
 * that is over. The past page fills from this list's own row instead.
 */
function PastList({
  jobs,
  timezone,
  loading,
  error,
  onRetry,
  retrying,
}: {
  jobs: PastJob[];
  timezone?: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  retrying: boolean;
}) {
  if (!jobs.length) {
    if (error) return <GlassProblem message={error} onRetry={onRetry} retrying={retrying} />;
    return (
      <GlassCard>
        <GlassText variant="subtitle">
          {loading ? 'Loading past jobs…' : 'No finished jobs yet'}
        </GlassText>
        {loading ? null : (
          <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm }}>
            Jobs you deliver or return show here.
          </GlassText>
        )}
      </GlassCard>
    );
  }

  // Already newest first from the server; grouping keeps that order.
  const groups: { key: string; jobs: PastJob[] }[] = [];
  for (const job of jobs) {
    const key = dayKey(job.finished_at ?? job.delivered_at, timezone);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.jobs.push(job);
    else groups.push({ key, jobs: [job] });
  }

  return (
    <View>
      {error ? (
        <GlassProblem tone="quiet" message="Could not refresh just now. Showing the last list." />
      ) : null}
      {groups.map((g) => (
        <View key={g.key || 'earlier'} style={{ marginBottom: gspace.lg }}>
          <GlassText variant="label" tone="soft" upper style={{ marginBottom: gspace.sm }}>
            {dayLabel(g.key, timezone)}
          </GlassText>
          <GlassCard padding={0}>
            {g.jobs.map((job, i) => (
              <PastRow key={job.delivery_order_id} job={job} timezone={timezone} first={i === 0} />
            ))}
          </GlassCard>
        </View>
      ))}
    </View>
  );
}

function PastRow({ job, timezone, first }: { job: PastJob; timezone?: string; first: boolean }) {
  const router = useRouter();
  const band = glassBand[job.delivery_status as GlassBarState] ?? glassBand.idle;
  const time = timeOnly(job.finished_at ?? job.delivered_at, timezone);
  const delivered = job.delivery_status === 'delivered';
  const cash = delivered && job.payment_status === 'cod';
  const from = shopName(job.shop);

  return (
    <Pressable
      // Cast: the typed-route list is regenerated by the dev server and can
      // lag a newly added screen; the route itself is `app/(app)/past/[id]`.
      onPress={() => router.push(`/past/${job.delivery_order_id}` as Href)}
      accessibilityRole="button"
      accessibilityLabel={`${band.label.toLowerCase()} job for ${job.customer_name}. Show details.`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: gspace.lg,
        paddingVertical: gspace.md,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: glass.divider,
        backgroundColor: pressed ? glass.fill : 'transparent',
      })}
    >
      <View style={{ flex: 1, marginRight: gspace.md }}>
        <GlassText variant="bodyStrong" numberOfLines={1}>
          {from ? `${from} → ${job.customer_name}` : job.customer_name}
        </GlassText>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
          <GlassText variant="label" style={{ color: band.fg }}>
            {band.label}
          </GlassText>
          {time ? (
            <GlassText variant="caption" tone="soft" nums style={{ marginLeft: gspace.sm }}>
              {time}
            </GlassText>
          ) : null}
          {job.job_code ? (
            <GlassText variant="caption" tone="faint" style={{ marginLeft: gspace.sm }}>
              {job.job_code}
            </GlassText>
          ) : null}
        </View>
      </View>
      {delivered ? (
        <GlassText variant="bodyStrong" tone={cash ? 'ink' : 'soft'} nums>
          {cash ? money(job.amount_to_collect, job.currency) : 'Paid'}
        </GlassText>
      ) : null}
      <GlassIcon name="chev" size={16} color={glass.inkFaint} style={{ marginLeft: gspace.sm }} />
    </Pressable>
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
