import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useServiceJobs } from '../../src/hooks/useServiceJobs';
import { money, timeOnly } from '../../src/lib/format';
import { staffLabel } from '../../src/lib/riderKind';
import { useSession } from '../../src/store/session';
import { CONTENT_MAX_W, glass, gspace } from '../../src/theme/glass';
import { servicePalette as S } from '../../src/theme/workspace';
import { GlassCard } from '../../src/ui/glass/GlassCard';
import { GlassScreen } from '../../src/ui/glass/GlassScreen';
import { GlassText } from '../../src/ui/glass/GlassText';
import { SvcHeader, Tile } from '../../src/ui/service/ServiceKit';

/**
 * Service's Earnings. Everyone is the shop's own staff, on salary, so this
 * counts visits signed off - never money - plus the cash in hand, which is
 * the shop's.
 */
export default function ServiceEarnings() {
  const insets = useSafeAreaInsets();
  const lines = useSession((s) => s.lines);
  const timezone = useSession((s) => s.timezone);
  const { data, isRefetching, refetch } = useServiceJobs();
  const counts = data?.counts;
  const today = (data?.history ?? []).filter(
    (j) => j.status === 'signed_off' && j.signed_off_at && new Date(j.signed_off_at).toDateString() === new Date().toDateString()
  );
  const currency = data?.history[0]?.currency ?? data?.jobs[0]?.currency;

  return (
    <GlassScreen>
      <SvcHeader eyebrow={`${staffLabel(lines)} · on salary`} title="Earnings" />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gspace.xl,
          paddingTop: gspace.lg,
          width: '100%',
          maxWidth: CONTENT_MAX_W,
          alignSelf: 'center',
          paddingBottom: gspace.xxxl + insets.bottom,
        }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
      >
        <GlassCard>
          <GlassText variant="label" tone="soft" upper>
            Today
          </GlassText>
          <GlassText variant="amountLg" nums style={{ color: S.band, marginTop: gspace.xs }}>
            {String(counts?.signed_off_today ?? 0)}
          </GlassText>
          <GlassText variant="caption" tone="soft">
            Jobs signed off today
          </GlassText>
          <View style={{ flexDirection: 'row', gap: gspace.sm, marginTop: gspace.lg }}>
            <Tile label="This week" value={String(counts?.signed_off_week ?? 0)} />
            <Tile label="This month" value={String(counts?.signed_off_month ?? 0)} />
            <Tile label="Revisits" value={String(counts?.revisits ?? 0)} />
          </View>
        </GlassCard>

        <GlassCard style={{ marginTop: gspace.lg }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <GlassText variant="bodyStrong">Cash with you</GlassText>
            <GlassText variant="bodyStrong" nums>
              {money(counts?.cash_collected ?? 0, currency)}
            </GlassText>
          </View>
          <GlassText variant="caption" tone="soft" style={{ marginTop: gspace.xs }}>
            {"The shop's money, not your pay. Hand it over at the counter."}
          </GlassText>
        </GlassCard>

        <GlassText variant="label" tone="soft" upper style={{ marginTop: gspace.xxl }}>
          {"Today's jobs"}
        </GlassText>
        <GlassCard style={{ marginTop: gspace.sm }}>
          {today.length ? (
            today.map((j, i) => (
              <View
                key={j.id}
                style={{
                  paddingVertical: gspace.sm,
                  borderTopWidth: i ? 1 : 0,
                  borderTopColor: glass.divider,
                }}
              >
                <GlassText variant="bodyStrong" numberOfLines={1}>
                  {j.title} · {j.customer_name}
                </GlassText>
                <GlassText variant="caption" tone="soft">
                  {timeOnly(j.signed_off_at ?? undefined, timezone)} · {j.ref}
                </GlassText>
              </View>
            ))
          ) : (
            <GlassText variant="body" tone="soft">
              No jobs signed off yet today.
            </GlassText>
          )}
        </GlassCard>
      </ScrollView>
    </GlassScreen>
  );
}
