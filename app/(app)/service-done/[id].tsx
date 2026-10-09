import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { serviceApi } from '../../../src/api/service';
import { ServiceJob } from '../../../src/api/serviceTypes';
import { timeOnly } from '../../../src/lib/format';
import { useSession } from '../../../src/store/session';
import { glass, gspace } from '../../../src/theme/glass';
import { servicePalette as S } from '../../../src/theme/workspace';
import { GlassCard } from '../../../src/ui/glass/GlassCard';
import { GlassScreen } from '../../../src/ui/glass/GlassScreen';
import { GlassText } from '../../../src/ui/glass/GlassText';
import { SvcButton } from '../../../src/ui/service/ServiceKit';

/** "Job signed off": the visit is over, and the agent is free for both lines again. */
export default function ServiceDone() {
  const { id: raw } = useLocalSearchParams<{ id: string }>();
  const id = Number(raw);
  const router = useRouter();
  const rider = useSession((s) => s.rider);
  const timezone = useSession((s) => s.timezone);
  const both = useSession((s) => s.lines.length > 1);
  const { data: job } = useQuery<ServiceJob>({ queryKey: ['service-job', id], queryFn: () => serviceApi.job(id) });
  const [left, setLeft] = useState(8);

  useEffect(() => {
    if (left <= 0) {
      router.replace('/jobs');
      return;
    }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left, router]);

  const mins =
    job?.work_started_at && job.signed_off_at
      ? Math.max(1, Math.round((Date.parse(job.signed_off_at) - Date.parse(job.work_started_at)) / 60000))
      : null;

  return (
    <GlassScreen>
      <View style={{ flex: 1, justifyContent: 'center', padding: gspace.xl, rowGap: gspace.lg }}>
        <View style={{ alignItems: 'center', rowGap: gspace.sm }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: S.band, alignItems: 'center', justifyContent: 'center' }}>
            <GlassText variant="hero" tone="white">
              ✓
            </GlassText>
          </View>
          <GlassText variant="hero">Job signed off</GlassText>
          <GlassText variant="subtitle" tone="soft">
            Thank you, {(rider?.name ?? '').split(' ')[0] || 'there'}!
          </GlassText>
        </View>
        <GlassCard>
          <Row label="Job" value={job?.ref ?? ''} />
          <Row label="Customer" value={job?.customer_name ?? ''} />
          <Row label="Signed off at" value={timeOnly(job?.signed_off_at ?? undefined, timezone)} />
          {mins ? <Row label="Time on job" value={`${mins} min`} /> : null}
        </GlassCard>
        <GlassCard style={{ backgroundColor: S.soft, borderColor: S.soft }}>
          <GlassText variant="bodyStrong">
            {both ? 'Online again for delivery and service' : 'Online again for new jobs'}
          </GlassText>
        </GlassCard>
        <SvcButton title="Back to jobs" onPress={() => router.replace('/jobs')} />
        <GlassText variant="caption" tone="soft" style={{ textAlign: 'center' }}>
          Going back by itself in {left}s
        </GlassText>
      </View>
    </GlassScreen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: glass.divider }}>
      <GlassText variant="body" tone="soft">
        {label}
      </GlassText>
      <GlassText variant="bodyStrong">{value}</GlassText>
    </View>
  );
}
