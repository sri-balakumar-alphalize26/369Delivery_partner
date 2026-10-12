import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { serviceApi } from '../../../src/api/service';
import { SERVICE_MAX_PHOTOS, SERVICE_MIN_PHOTOS, ServiceJob } from '../../../src/api/serviceTypes';
import { serverNow } from '../../../src/lib/clock';
import { timeOnly } from '../../../src/lib/format';
import { photoFileName } from '../../../src/lib/photoName';
import { getOwed, onOwedChange, OwedPhotos, owePhotos, Shot, submitOwed, updateShots } from '../../../src/photos/owed';
import { dropPhotos, keepPhoto } from '../../../src/photos/shrink';
import { drainPhotos } from '../../../src/photos/uploader';
import { useSession } from '../../../src/store/session';
import { CONTENT_MAX_W, glass, gradius, gspace } from '../../../src/theme/glass';
import { servicePalette as S } from '../../../src/theme/workspace';
import { GlassIcon } from '../../../src/ui/glass/GlassIcon';
import { GlassScreen } from '../../../src/ui/glass/GlassScreen';
import { GlassText } from '../../../src/ui/glass/GlassText';
import { SvcButton, SvcHeader } from '../../../src/ui/service/ServiceKit';
import { photoProblem, takePhoto } from '../../../src/ui/takePhoto';

/**
 * Before and after photos for a visit, two to four each - the delivery rule,
 * and now the delivery way: a shot list to fill, every photo seen and
 * retakable, then Send. The photos go up in the background (`photos/uploader`,
 * the same queue as the parcel photos) and the technician is back on the visit
 * at once; the bar at the top shows how far along they are.
 *
 * Unlike the parcel screen there is no lock: nothing was accepted before
 * these, so Back is allowed and the photos taken so far wait here for later.
 */

type Stage = 'before' | 'after';

const SLOTS: Record<Stage, { title: string; hint: string }[]> = {
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
  const stage: Stage = rawStage === 'after' ? 'after' : 'before';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const timezone = useSession((s) => s.timezone);

  const { data: job } = useQuery<ServiceJob>({
    queryKey: ['service-job', id],
    queryFn: () => serviceApi.job(id),
  });

  const [entry, setEntry] = useState<OwedPhotos | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // The batch for this visit stage, opened once the visit is known: its
  // number names the files, and the server's count says where the list starts.
  useEffect(() => {
    if (!job) return;
    let live = true;
    const read = async () => {
      let e = await getOwed(id, stage);
      if (!e && job.photo_counts[stage] < SERVICE_MAX_PHOTOS) {
        await owePhotos({ orderId: id, stage, ref: job.ref, customerName: job.customer_name, base: job.photo_counts[stage] });
        e = await getOwed(id, stage);
      }
      if (live) {
        setEntry(e);
        setLoaded(true);
      }
    };
    void read();
    // A sent photo, or the batch cleared once all are up.
    const off = onOwedChange(() => void getOwed(id, stage).then((e) => live && setEntry(e)));
    return () => {
      live = false;
      off();
    };
    // Opened once per visit stage; later counts come from the batch itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, stage, !!job]);

  const serverCount = job?.photo_counts[stage] ?? 0;
  const base = entry?.base ?? serverCount;
  const shots = entry?.shots ?? [];
  const room = SERVICE_MAX_PHOTOS - base;
  const need = Math.max(0, SERVICE_MIN_PHOTOS - base);
  const sending = !!entry?.submitted;
  const canSend = !sending && shots.length >= Math.max(1, need);

  async function store(next: Shot[]) {
    if (!entry) return;
    setEntry({ ...entry, shots: next });
    await updateShots(id, stage, next);
  }

  /** A new photo, or a fresh one in place of `at`. */
  async function shoot(at?: number) {
    if (!entry || sending) return;
    setProblem(null);
    const shot = await takePhoto();
    if ('error' in shot) {
      setProblem(photoProblem(shot.error));
      return;
    }
    const takenAt = serverNow();
    const fresh: Shot = {
      uri: keepPhoto(shot.uri),
      name: timezone ? photoFileName(entry.ref, new Date(takenAt), timezone) : '',
      takenAt,
      sent: false,
    };
    const current = entry.shots;
    const next = at === undefined ? [...current, fresh] : current.map((s, i) => (i === at ? fresh : s));
    await store(next);
    if (at !== undefined && current[at]) dropPhotos([current[at].uri, current[at].small]);
  }

  /** Final: they go up in the background and the technician is back on the visit. */
  async function send() {
    if (!canSend) return;
    await submitOwed(id, stage);
    void drainPhotos();
    router.back();
  }

  const title = stage === 'before' ? 'Before photos' : 'After photos';
  if (!loaded) {
    return (
      <GlassScreen>
        <SvcHeader eyebrow={title} title="Photos" onBack={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={S.band} />
        </View>
      </GlassScreen>
    );
  }

  const slots = SLOTS[stage];
  const left = need - shots.length;

  return (
    <GlassScreen>
      <SvcHeader
        eyebrow={title}
        title={job ? `${job.ref} · ${job.customer_name}` : 'Photos'}
        onBack={() => router.back()}
      />
      <ScrollView
        contentContainerStyle={{
          padding: gspace.lg,
          rowGap: gspace.md,
          width: '100%',
          maxWidth: CONTENT_MAX_W,
          alignSelf: 'center',
        }}
      >
        <GlassText variant="body" tone="soft">
          {stage === 'before' ? 'Photograph the device before you touch it.' : 'Show the device working and the old part.'}
        </GlassText>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <GlassText variant="subtitle">Shot list</GlassText>
          <GlassText variant="label" tone={sending ? 'soft' : left > 0 ? 'orange' : 'green'}>
            {sending
              ? 'Going up in the background'
              : left > 0
                ? `${left} more needed`
                : `${base + shots.length} taken · ready to send`}
          </GlassText>
        </View>

        {slots.map((slot, i) => {
          // Already on the server from an earlier batch.
          if (i < base) {
            return (
              <View key={i} style={rowStyle(true)}>
                <View style={thumbBox(false)}>
                  <GlassIcon name="check" size={26} color={glass.green} />
                </View>
                <SlotText n={i + 1} slot={slot} />
                <GlassText variant="label" tone="green">
                  Sent
                </GlassText>
              </View>
            );
          }
          const s = shots[i - base];
          if (s) {
            return (
              <View key={i} style={rowStyle(s.sent)}>
                <Image source={{ uri: s.uri }} style={{ width: 76, height: 76, borderRadius: gradius.chip }} contentFit="cover" />
                <View style={{ flex: 1 }}>
                  <SlotText n={i + 1} slot={slot} />
                  <GlassText variant="label" tone={s.sent ? 'green' : sending ? 'soft' : 'green'} style={{ marginTop: 4 }}>
                    {s.sent
                      ? 'Sent ✓'
                      : sending
                        ? 'Sending…'
                        : `Taken ${timeOnly(s.takenAt ? new Date(s.takenAt).toISOString() : undefined, timezone)}`}
                  </GlassText>
                </View>
                {!sending ? (
                  <Pressable
                    onPress={() => void shoot(i - base)}
                    accessibilityRole="button"
                    accessibilityLabel={`Retake photo ${i + 1}`}
                    style={({ pressed }) => ({
                      width: 44,
                      height: 44,
                      borderRadius: gradius.button,
                      borderWidth: 1,
                      borderColor: glass.border,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: pressed ? glass.fill : glass.white,
                    })}
                  >
                    <GlassIcon name="undo" size={20} color={glass.inkSoft} />
                  </Pressable>
                ) : null}
              </View>
            );
          }
          const next = !sending && i === base + shots.length && i - base < room;
          return (
            <Pressable
              key={i}
              onPress={() => void shoot()}
              disabled={!next}
              accessibilityRole="button"
              accessibilityLabel={`Take photo ${i + 1}: ${slot.title}`}
              style={({ pressed }) => ({
                ...rowStyle(false),
                borderWidth: 1.5,
                borderStyle: 'dashed',
                borderColor: next ? S.band : glass.dividerDashed,
                backgroundColor: pressed ? glass.fill : glass.white,
                opacity: next ? 1 : 0.55,
              })}
            >
              <View style={thumbBox(next)}>
                <GlassIcon name="camera" size={26} color={next ? S.band : glass.inkFaint} />
              </View>
              <View style={{ flex: 1 }}>
                <SlotText n={i + 1} slot={slot} />
                {i < SERVICE_MIN_PHOTOS ? (
                  <GlassText variant="label" tone="orange" style={{ marginTop: 4 }}>
                    Needed
                  </GlassText>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Always in reach: the next photo, then Send. */}
      <View
        style={{
          backgroundColor: glass.white,
          borderTopWidth: 1,
          borderTopColor: glass.divider,
          paddingHorizontal: gspace.lg,
          paddingTop: gspace.md,
          paddingBottom: insets.bottom + gspace.md,
          rowGap: gspace.sm,
        }}
      >
        {problem ? (
          <GlassText variant="bodyStrong" tone="red">
            {problem}
          </GlassText>
        ) : null}
        {sending || room <= 0 ? (
          <SvcButton title="Back to the visit" onPress={() => router.back()} />
        ) : canSend ? (
          <SvcButton title={`Send ${shots.length} photo${shots.length === 1 ? '' : 's'}`} icon="check" onPress={() => void send()} />
        ) : (
          <SvcButton title={`Take photo ${base + shots.length + 1}`} icon="camera" onPress={() => void shoot()} />
        )}
        <GlassText variant="caption" tone="soft" style={{ textAlign: 'center' }}>
          They upload in the background - you can carry on with the visit.
        </GlassText>
      </View>
    </GlassScreen>
  );
}

function SlotText({ n, slot }: { n: number; slot: { title: string; hint: string } }) {
  return (
    <View style={{ flex: 1 }}>
      <GlassText variant="bodyStrong">{`${n} · ${slot.title}`}</GlassText>
      <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
        {slot.hint}
      </GlassText>
    </View>
  );
}

function rowStyle(done: boolean) {
  return {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    columnGap: gspace.md,
    padding: gspace.sm,
    borderRadius: gradius.card,
    borderWidth: 1,
    borderColor: done ? glass.accentLine : glass.border,
    backgroundColor: glass.white,
  };
}

function thumbBox(on: boolean) {
  return {
    width: 76,
    height: 76,
    borderRadius: gradius.chip,
    backgroundColor: on ? S.soft : glass.fill,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };
}
