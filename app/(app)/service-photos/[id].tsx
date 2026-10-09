import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { serviceApi } from '../../../src/api/service';
import { SERVICE_MAX_PHOTOS, SERVICE_MIN_PHOTOS, ServiceJob } from '../../../src/api/serviceTypes';
import { CONTENT_MAX_W, glass, gspace } from '../../../src/theme/glass';
import { GlassCard } from '../../../src/ui/glass/GlassCard';
import { GlassScreen } from '../../../src/ui/glass/GlassScreen';
import { GlassText } from '../../../src/ui/glass/GlassText';
import { SvcButton, SvcHeader } from '../../../src/ui/service/ServiceKit';
import { photoProblem, takePhoto } from '../../../src/ui/takePhoto';

/**
 * Before and after photos for a visit, two to four each - the delivery rule.
 *
 * Simpler than the parcel photo screen on purpose: each photo goes up as it is
 * taken, while the technician waits. The background uploader and its "photos
 * owed" guard are the delivery API's; they follow when the service API exists.
 */

const SLOTS: Record<'before' | 'after', { title: string; hint: string }[]> = {
  before: [
    { title: 'Device as found', hint: 'Before you touch it' },
    { title: 'The fault close up', hint: 'The crack, the error, the leak' },
    { title: 'Serial label', hint: 'Optional' },
    { title: 'Anything else', hint: 'Optional' },
  ],
  after: [
    { title: 'Device working', hint: 'Switched on, doing its job' },
    { title: 'Old part', hint: 'What came out' },
    { title: 'Where it is fitted', hint: 'Optional' },
    { title: 'Anything else', hint: 'Optional' },
  ],
};

export default function ServicePhotos() {
  const { id: raw, stage: rawStage } = useLocalSearchParams<{ id: string; stage: string }>();
  const id = Number(raw);
  const stage: 'before' | 'after' = rawStage === 'after' ? 'after' : 'before';
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const { data: job } = useQuery<ServiceJob>({
    queryKey: ['service-job', id],
    queryFn: () => serviceApi.job(id),
  });
  const count = job?.photo_counts[stage] ?? 0;
  const enough = count >= SERVICE_MIN_PHOTOS;

  async function shoot() {
    setProblem(null);
    const shot = await takePhoto();
    if ('error' in shot) {
      setProblem(photoProblem(shot.error));
      return;
    }
    setBusy(true);
    try {
      const res = await serviceApi.addPhoto(id, stage, shot.uri);
      qc.setQueryData(['service-job', id], res.job);
      void qc.invalidateQueries({ queryKey: ['service-jobs'] });
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassScreen>
      <SvcHeader
        eyebrow={stage === 'before' ? 'Before photos' : 'After photos'}
        title={job ? `${job.ref} · ${job.customer_name}` : 'Photos'}
        onBack={() => router.back()}
      />
      <ScrollView contentContainerStyle={{ padding: gspace.xl, rowGap: gspace.md, width: '100%', maxWidth: CONTENT_MAX_W, alignSelf: 'center', paddingBottom: gspace.xxxl + insets.bottom }}>
        <GlassText variant="body" tone="soft">
          {stage === 'before'
            ? 'Photograph the device before you touch it.'
            : 'Show the device working and the old part.'}
        </GlassText>
        <GlassCard>
          <GlassText variant="label" tone="soft" upper>
            Shot list · {enough ? `${count} taken · ready` : `${SERVICE_MIN_PHOTOS - count} more needed`}
          </GlassText>
          {SLOTS[stage].map((s, i) => (
            <View
              key={s.title}
              style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: gspace.sm, borderTopWidth: i ? 1 : 0, borderTopColor: glass.divider }}
            >
              <View style={{ flex: 1 }}>
                <GlassText variant="bodyStrong">
                  {i + 1} · {s.title}
                </GlassText>
                <GlassText variant="caption" tone="soft">
                  {s.hint}
                </GlassText>
              </View>
              <GlassText variant="caption" tone={i < count ? 'green' : i < SERVICE_MIN_PHOTOS ? 'red' : 'faint'}>
                {i < count ? 'Taken' : i < SERVICE_MIN_PHOTOS ? 'Needed' : 'Optional'}
              </GlassText>
            </View>
          ))}
        </GlassCard>
        {problem ? (
          <GlassText variant="bodyStrong" tone="red">
            {problem}
          </GlassText>
        ) : null}
        {count < SERVICE_MAX_PHOTOS ? (
          <SvcButton
            title={`Take photo ${count + 1}`}
            icon="camera"
            kind={enough ? 'ghost' : 'primary'}
            loading={busy}
            onPress={() => void shoot()}
          />
        ) : null}
        {enough ? <SvcButton title="Done" onPress={() => router.back()} /> : null}
      </ScrollView>
    </GlassScreen>
  );
}
