import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  BOOKING_STATE_LABEL,
  BookingState,
  lineText,
  odooUtc,
  PastBooking,
  RepairBooking,
} from '../../api/danatfixTypes';
import { useBookingHistory, useBookings } from '../../hooks/useBookings';
import { useNow } from '../../hooks/useNow';
import { useRefreshOnFocus } from '../../hooks/useSettingsRefresh';
import { useSession } from '../../store/session';
import { CONTENT_MAX_W, glass, gradius, gspace } from '../../theme/glass';
import { servicePalette as S } from '../../theme/workspace';
import { GlassCard } from '../glass/GlassCard';
import { GlassProblem } from '../glass/GlassProblem';
import { GlassScreen } from '../glass/GlassScreen';
import { GlassText } from '../glass/GlassText';
import { SosShield } from '../SosSheet';
import { WorkspaceChip } from '../WorkspaceChip';
import { Tile } from './ServiceKit';

/**
 * Service's Home when the app has a service key: the website repair bookings,
 * as the Store's Live Screen shows them - New first (they are ringing at the
 * counter), then the ones being called, then the accepted ones. A tap opens
 * the booking with its buttons.
 */
export function BookingsHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const rider = useSession((s) => s.rider);
  const { data, isLoading, isError, error, isRefetching, refetch } = useBookings();
  const history = useBookingHistory();
  useRefreshOnFocus();
  const now = useNow(30_000);

  const rows = data?.rows ?? [];
  const by = (st: BookingState) => rows.filter((r) => r.state === st);
  const open = (b: RepairBooking) => router.push({ pathname: '/booking/[id]', params: { id: String(b.id) } });

  return (
    <GlassScreen>
      <View style={{ backgroundColor: S.band, paddingTop: insets.top + gspace.lg, paddingBottom: gspace.lg }}>
        <View style={{ width: '100%', maxWidth: CONTENT_MAX_W, alignSelf: 'center', paddingHorizontal: gspace.xl }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: gspace.md }}>
            <View style={{ flex: 1 }}>
              <GlassText variant="caption" style={{ color: S.bandSoft }}>
                Website bookings
              </GlassText>
              <GlassText variant="hero" tone="white" numberOfLines={1}>
                {rider?.name ?? 'Technician'}
              </GlassText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: gspace.sm }}>
                <WorkspaceChip />
              </View>
            </View>
            <SosShield />
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gspace.xl,
          width: '100%',
          maxWidth: CONTENT_MAX_W,
          alignSelf: 'center',
          paddingBottom: gspace.xxxl + insets.bottom,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
      >
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: -1000, right: -1000, height: 56, backgroundColor: S.band }}
        />
        <GlassCard padding={18} style={{ marginTop: gspace.xs, borderRadius: 20 }}>
          <View style={{ flexDirection: 'row', gap: gspace.sm }}>
            <Tile label="New" value={String(by('new').length)} />
            <Tile label="Calling" value={String(by('calling').length)} />
            <Tile label="Accepted" value={String(by('accepted').length)} />
          </View>
        </GlassCard>

        {isError ? (
          <GlassProblem
            tone={data ? 'quiet' : undefined}
            message={data ? 'Could not refresh just now. Showing the last bookings received.' : error.message}
            onRetry={data ? undefined : () => refetch()}
            retrying={isRefetching}
          />
        ) : null}

        {(['new', 'calling', 'accepted'] as BookingState[]).map((st) =>
          by(st).length ? (
            <View key={st}>
              <Section title={st === 'new' ? 'New bookings' : st === 'calling' ? 'Calling the customer' : 'Accepted'} />
              {by(st).map((b) => (
                <BookingCard key={b.id} booking={b} now={now} onOpen={() => open(b)} />
              ))}
            </View>
          ) : null
        )}

        {!rows.length && !isError ? (
          <GlassCard style={{ marginTop: gspace.xl }}>
            <GlassText variant="subtitle">{isLoading ? 'Checking for bookings…' : 'No open bookings'}</GlassText>
            <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm }}>
              New website bookings appear here by themselves, the same moment they ring at the counter.
            </GlassText>
          </GlassCard>
        ) : null}

        {history.data?.length ? (
          <>
            <Section title="Recently finished" />
            {history.data.map((h) => (
              <PastRow key={h.id} booking={h} />
            ))}
          </>
        ) : null}
      </ScrollView>
    </GlassScreen>
  );
}

function Section({ title }: { title: string }) {
  return (
    <GlassText variant="subtitle" style={{ marginTop: gspace.xxl }}>
      {title}
    </GlassText>
  );
}

/** "12 min ago", "3 h ago", or the date. */
export function ago(created: string, now: number): string {
  const mins = Math.max(0, Math.round((now - odooUtc(created).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return odooUtc(created).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function BookingPill({ state }: { state: BookingState }) {
  const c =
    state === 'new'
      ? { bg: S.accent, fg: S.accentInk }
      : state === 'calling'
        ? { bg: glass.orangeSoft, fg: glass.orange }
        : state === 'accepted'
          ? // Soft, not the band colour: it also sits on the indigo header.
            { bg: S.soft, fg: S.band }
          : state === 'done'
            ? { bg: glass.greenSoft, fg: glass.green }
            : { bg: glass.fill, fg: glass.inkSoft };
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: c.bg, borderRadius: gradius.pill, paddingHorizontal: gspace.sm, paddingVertical: 3 }}>
      <GlassText variant="label" style={{ color: c.fg }}>
        {BOOKING_STATE_LABEL[state]}
      </GlassText>
    </View>
  );
}

function BookingCard({ booking: b, now, onOpen }: { booking: RepairBooking; now: number; onOpen: () => void }) {
  const first = b.lines[0];
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
      <GlassCard
        style={{
          marginTop: gspace.md,
          borderLeftWidth: 5,
          borderLeftColor: b.state === 'new' ? S.accent : S.band,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: gspace.sm }}>
          <GlassText variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
            {first ? lineText(first) : 'Repair booking'}
            {b.lines.length > 1 ? ` +${b.lines.length - 1} more` : ''}
          </GlassText>
          <BookingPill state={b.state} />
        </View>
        <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }} numberOfLines={1}>
          {b.name} · {b.customer || b.phone} · {b.area || b.address || 'no address'}
        </GlassText>
        <GlassText variant="caption" tone="faint" style={{ marginTop: 2 }}>
          {ago(b.created, now)}
          {b.taken_by ? ` · taken by ${b.taken_by}` : ''}
        </GlassText>
      </GlassCard>
    </Pressable>
  );
}

function PastRow({ booking: h }: { booking: PastBooking }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: gspace.sm, paddingVertical: gspace.sm, borderBottomWidth: 1, borderBottomColor: glass.divider }}>
      <View style={{ flex: 1 }}>
        <GlassText variant="bodyStrong" numberOfLines={1}>
          {h.summary || h.name}
        </GlassText>
        <GlassText variant="caption" tone="soft" numberOfLines={1}>
          {h.name} · {h.customer_name || '—'}
          {h.accepted_by_name ? ` · ${h.accepted_by_name}` : ''}
        </GlassText>
      </View>
      <BookingPill state={h.state} />
    </View>
  );
}
