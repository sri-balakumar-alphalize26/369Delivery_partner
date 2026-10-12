import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ServiceJob } from '../../src/api/serviceTypes';
import { useServiceJobs } from '../../src/hooks/useServiceJobs';
import { timeOnly } from '../../src/lib/format';
import { useSession } from '../../src/store/session';
import { CONTENT_MAX_W, glass, gradius, gspace } from '../../src/theme/glass';
import { servicePalette as S } from '../../src/theme/workspace';
import { GlassCard } from '../../src/ui/glass/GlassCard';
import { GlassScreen } from '../../src/ui/glass/GlassScreen';
import { GlassText } from '../../src/ui/glass/GlassText';
import { StatusPill, SvcHeader } from '../../src/ui/service/ServiceKit';
import { ServicePreviewNote } from '../../src/ui/WorkspaceBits';

/**
 * Visits are booked into time slots, so Service has a day view Delivery does
 * not need: a strip of days, and that day's visits in slot order - offered,
 * booked, in hand and done.
 */
export default function Schedule() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const timezone = useSession((s) => s.timezone);
  const { data, isRefetching, refetch } = useServiceJobs();
  const [offset, setOffset] = useState(0);

  const days = [-1, 0, 1, 2, 3].map((d) => {
    const x = new Date();
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() + d);
    return { d, date: x };
  });
  const day = days.find((x) => x.d === offset)!.date;

  const all: ServiceJob[] = [...(data?.jobs ?? []), ...(data?.history ?? [])];
  const visits = all
    .filter((j) => new Date(j.slot_start).toDateString() === day.toDateString())
    .sort((a, b) => a.slot_start.localeCompare(b.slot_start));

  return (
    <GlassScreen>
      <SvcHeader
        eyebrow={day.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
        title="Schedule"
      />
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
        <View style={{ flexDirection: 'row', gap: gspace.sm }}>
          {days.map(({ d, date }) => {
            const on = d === offset;
            return (
              <Pressable
                key={d}
                onPress={() => setOffset(d)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                style={({ pressed }) => ({
                  flex: 1,
                  alignItems: 'center',
                  paddingVertical: gspace.sm,
                  borderRadius: gradius.card,
                  borderWidth: 1,
                  borderColor: on ? S.band : glass.border,
                  backgroundColor: on ? S.band : glass.fillStrong,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <GlassText variant="caption" style={{ color: on ? S.bandSoft : glass.inkSoft }}>
                  {date.toLocaleDateString('en-GB', { weekday: 'short' })}
                </GlassText>
                <GlassText variant="title" nums style={{ color: on ? glass.white : glass.ink }}>
                  {date.getDate()}
                </GlassText>
              </Pressable>
            );
          })}
        </View>

        <ServicePreviewNote />

        {visits.length ? (
          visits.map((j) => (
            <Pressable
              key={j.id}
              onPress={() => router.push(`/service/${j.id}`)}
              accessibilityRole="button"
              style={({ pressed }) => ({ flexDirection: 'row', gap: gspace.md, marginTop: gspace.md, opacity: pressed ? 0.8 : 1 })}
            >
              <View style={{ width: 52, paddingTop: gspace.md, alignItems: 'flex-end' }}>
                <GlassText variant="label" tone="soft" nums>
                  {timeOnly(j.slot_start, timezone)}
                </GlassText>
              </View>
              <GlassCard
                style={{
                  flex: 1,
                  borderLeftWidth: 5,
                  borderLeftColor: S.band,
                  opacity: j.status === 'signed_off' ? 0.6 : 1,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: gspace.sm }}>
                  <GlassText variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                    {j.title}
                  </GlassText>
                  <StatusPill status={j.status} />
                </View>
                <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
                  {j.customer_name} · {j.area}
                </GlassText>
              </GlassCard>
            </Pressable>
          ))
        ) : (
          <GlassCard style={{ marginTop: gspace.lg }}>
            <GlassText variant="subtitle">No visits this day</GlassText>
            <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm }}>
              Visits are booked by the office. New offers ring like delivery jobs.
            </GlassText>
          </GlassCard>
        )}
      </ScrollView>
    </GlassScreen>
  );
}
