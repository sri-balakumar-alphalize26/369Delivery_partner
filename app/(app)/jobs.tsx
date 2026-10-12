import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ServiceJob, SERVICE_IN_HAND } from '../../src/api/serviceTypes';
import { useNow } from '../../src/hooks/useNow';
import { useDuty, useOrders } from '../../src/hooks/useOrders';
import { useRefreshOnFocus } from '../../src/hooks/useSettingsRefresh';
import { sortServiceJobs, useServiceJobs } from '../../src/hooks/useServiceJobs';
import { money, onDutyFor } from '../../src/lib/format';
import { useSession } from '../../src/store/session';
import { CONTENT_MAX_W, glass, gspace } from '../../src/theme/glass';
import { servicePalette as S } from '../../src/theme/workspace';
import { GlassCard } from '../../src/ui/glass/GlassCard';
import { GlassProblem } from '../../src/ui/glass/GlassProblem';
import { GlassScreen } from '../../src/ui/glass/GlassScreen';
import { GlassText } from '../../src/ui/glass/GlassText';
import { NotificationsOffBanner, PhoneSetupCard } from '../../src/ui/PhoneSetupCard';
import { Chip, Countdown, km, slotText, StatusPill, SvcButton, Tile } from '../../src/ui/service/ServiceKit';
import { SosShield } from '../../src/ui/SosSheet';
import { BusyPill, PausedCard, ServicePreviewNote, WorkspaceIntro } from '../../src/ui/WorkspaceBits';
import { WorkspaceChip } from '../../src/ui/WorkspaceChip';

/**
 * Service's Home: the same duty switch as Delivery (one duty for both lines),
 * then any offer waiting, the visit in hand, and today's bookings.
 *
 * Indigo band, so a hybrid agent can tell at a glance which side is open.
 */
export default function Jobs() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const rider = useSession((s) => s.rider);
  const timezone = useSession((s) => s.timezone);
  const orders = useOrders();
  const duty = useDuty();
  const { data, isLoading, isError, error, isRefetching, refetch } = useServiceJobs();
  useRefreshOnFocus();

  const onDuty = orders.data?.on_duty ?? rider?.on_duty ?? false;
  const now = useNow();
  const shift = onDuty ? onDutyFor(rider?.duty_since, now) : null;

  const jobs = sortServiceJobs(data?.jobs ?? []);
  const offers = jobs.filter((j) => j.status === 'offered');
  const inHand = jobs.filter((j) => SERVICE_IN_HAND.includes(j.status));
  const booked = jobs.filter((j) => j.status === 'scheduled');
  const counts = data?.counts;
  const currency = jobs[0]?.currency ?? data?.history[0]?.currency;
  const next = [...inHand, ...booked][0];

  return (
    <GlassScreen>
      <View style={{ backgroundColor: S.band, paddingTop: insets.top + gspace.lg, paddingBottom: gspace.lg }}>
        <View style={{ width: '100%', maxWidth: CONTENT_MAX_W, alignSelf: 'center', paddingHorizontal: gspace.xl }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: gspace.md }}>
            <View style={{ flex: 1 }}>
              <GlassText variant="caption" style={{ color: S.bandSoft }}>
                {greeting()}
              </GlassText>
              <GlassText variant="hero" tone="white" numberOfLines={1}>
                {rider?.name ?? 'Technician'}
              </GlassText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: gspace.sm }}>
                <WorkspaceChip />
                <BusyPill onDuty={onDuty} />
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
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: onDuty ? glass.green : glass.inkFaint,
                marginRight: gspace.sm,
              }}
            />
            <View style={{ flex: 1 }}>
              <GlassText variant="bodyStrong">{onDuty ? 'You are online' : 'You are off duty'}</GlassText>
              <GlassText variant="caption" tone="soft" nums>
                {next
                  ? `Next visit ${slotText(next, timezone)} · ${next.area}`
                  : shift
                    ? `${shift} on duty`
                    : 'Go online to get service jobs.'}
              </GlassText>
            </View>
            <Switch
              value={onDuty}
              disabled={duty.isPending}
              onValueChange={(on) => duty.mutate({ on })}
              trackColor={{ true: glass.green, false: glass.dividerDashed }}
              thumbColor={onDuty ? S.accent : glass.white}
            />
          </View>
          <View style={{ flexDirection: 'row', gap: gspace.sm, marginTop: gspace.lg }}>
            <Tile label="Signed off today" value={String(counts?.signed_off_today ?? 0)} />
            <Tile label="Visits left" value={String(inHand.length + booked.length)} />
            <Tile label="Cash to collect" value={money(counts?.cash_to_collect ?? 0, currency)} />
          </View>
        </GlassCard>

        <ServicePreviewNote />
        <WorkspaceIntro />
        <PausedCard side="service" />

        <View style={{ marginTop: gspace.lg, rowGap: gspace.md }}>
          <NotificationsOffBanner />
          <PhoneSetupCard />
        </View>

        {duty.isError ? (
          <GlassText variant="bodyStrong" tone="red" style={{ marginTop: gspace.lg }}>
            {duty.error.message}
          </GlassText>
        ) : null}

        {isError && data ? (
          <GlassProblem tone="quiet" message="Could not refresh just now. Showing the last jobs received." />
        ) : null}

        {offers.length ? (
          <>
            <Section title="Waiting for you" />
            {offers.map((j) => (
              <OfferCard key={j.id} job={j} timezone={timezone} onOpen={() => router.push(`/service/${j.id}`)} />
            ))}
          </>
        ) : null}

        {inHand.length ? (
          <>
            <Section title="In hand" />
            {inHand.map((j) => (
              <VisitCard key={j.id} job={j} timezone={timezone} onOpen={() => router.push(`/service/${j.id}`)} />
            ))}
          </>
        ) : null}

        <Section title="Today's visits" action="Schedule" onAction={() => router.push('/schedule')} />
        {booked.length ? (
          booked.map((j) => (
            <VisitCard key={j.id} job={j} timezone={timezone} onOpen={() => router.push(`/service/${j.id}`)} />
          ))
        ) : isError && !data ? (
          <GlassProblem message={error.message} onRetry={() => refetch()} retrying={isRefetching} />
        ) : (
          <GlassCard style={{ marginTop: gspace.md }}>
            <GlassText variant="subtitle">
              {isLoading ? 'Checking for jobs…' : offers.length || inHand.length ? 'Nothing else booked' : 'Nothing booked yet'}
            </GlassText>
            <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm }}>
              {onDuty
                ? 'New jobs appear here by themselves, and the phone rings when one arrives.'
                : 'Go online to get service jobs.'}
            </GlassText>
          </GlassCard>
        )}
      </ScrollView>
    </GlassScreen>
  );
}

function Section({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: gspace.xxl }}>
      <GlassText variant="subtitle">{title}</GlassText>
      {action ? (
        <Pressable onPress={onAction} accessibilityRole="link" hitSlop={10}>
          <GlassText variant="bodyStrong" style={{ color: S.band }}>
            {action}
          </GlassText>
        </Pressable>
      ) : null}
    </View>
  );
}

function OfferCard({ job, timezone, onOpen }: { job: ServiceJob; timezone?: string; onOpen: () => void }) {
  return (
    <GlassCard style={{ marginTop: gspace.md, borderColor: S.band, borderWidth: 2 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: gspace.xs }}>
        <StatusPill status="offered" />
        <Chip label={job.kind.toUpperCase()} />
        <Chip label={job.ref} />
      </View>
      <GlassText variant="subtitle" style={{ marginTop: gspace.sm }}>
        {job.title}
      </GlassText>
      <GlassText variant="body" tone="soft">
        {job.customer_name} · {job.area}
        {job.distance_m != null ? ` · ${km(job.distance_m)}` : ''}
      </GlassText>
      <GlassText variant="body" tone="soft" style={{ marginBottom: gspace.md }}>
        Slot {slotText(job, timezone)}
        {job.charge ? ` · charge ${money(job.charge, job.currency)}` : ' · paid online'}
      </GlassText>
      <Countdown expiresAt={job.offer_expires_at} />
      <SvcButton title="Open the offer" onPress={onOpen} style={{ marginTop: gspace.md }} />
    </GlassCard>
  );
}

function VisitCard({ job, timezone, onOpen }: { job: ServiceJob; timezone?: string; onOpen: () => void }) {
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
      <GlassCard style={{ marginTop: gspace.md, borderLeftWidth: 5, borderLeftColor: S.band }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: gspace.sm }}>
          <GlassText variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
            {job.title}
          </GlassText>
          <StatusPill status={job.status} />
        </View>
        <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
          {slotText(job, timezone)} · {job.customer_name} · {job.area}
        </GlassText>
      </GlassCard>
    </Pressable>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
