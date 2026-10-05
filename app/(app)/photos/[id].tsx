import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, View } from 'react-native';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../../src/api/endpoints';
import { ApiError } from '../../../src/api/types';
import { photoFileName } from '../../../src/lib/photoName';
import {
  clearOwed,
  getOwed,
  MAX_PHOTOS,
  MIN_PHOTOS,
  OwedPhotos,
  PhotoStage,
  Shot,
  updateShots,
} from '../../../src/photos/owed';
import { useSession } from '../../../src/store/session';
import { glass, gradius, gspace } from '../../../src/theme/glass';
import { LoadingArt } from '../../../src/ui/LoadingArt';
import { photoProblem, takePhoto } from '../../../src/ui/takePhoto';
import { GlassButton } from '../../../src/ui/glass/GlassButton';
import { GlassCard } from '../../../src/ui/glass/GlassCard';
import { GlassHeader } from '../../../src/ui/glass/GlassHeader';
import { GlassIcon } from '../../../src/ui/glass/GlassIcon';
import { GlassScreen } from '../../../src/ui/glass/GlassScreen';
import { GlassText } from '../../../src/ui/glass/GlassText';

const HINT: Record<PhotoStage, string> = {
  pickup: 'Photograph the parcel from 2 different sides before you leave the shop.',
  delivery: 'Photograph the parcel from 2 different sides as you hand it over.',
};

/**
 * The parcel photos after a code: 2 to 4, one at a time with a look at each.
 *
 * The code is already accepted when this opens, so it has no way out until the
 * photos are saved - no back button, Android's back swallowed - and the app
 * layout sends the rider back here while `owed` still lists the job.
 *
 * Nothing goes up until Save: the rider sees every photo first and can retake
 * any of them. Save sends the unsent ones one by one, so a signal dropping at
 * photo 3 leaves 1 and 2 on the server and only 3 and 4 to try again. Should
 * photo 3 have arrived after all, the server keeps one copy of a name it has
 * already seen (`duplicate: true`), so sending it again is harmless.
 */
export default function Photos() {
  const { id, stage: stageParam } = useLocalSearchParams<{ id: string; stage: string }>();
  const orderId = Number(id);
  const stage: PhotoStage = stageParam === 'delivery' ? 'delivery' : 'pickup';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, initialWindowMetrics?.insets.bottom ?? 0);
  const timezone = useSession((s) => s.timezone);

  const [entry, setEntry] = useState<OwedPhotos | null>(null);
  const [loaded, setLoaded] = useState(false);
  /** Which photo is shown big; the newest unless the rider tapped another. */
  const [viewing, setViewing] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const opened = useRef(false);

  const shots = entry?.shots ?? [];
  const shown: Shot | undefined = shots[viewing];
  const done = shots.length >= MAX_PHOTOS;
  const enough = shots.length >= MIN_PHOTOS;

  function leave() {
    if (stage === 'pickup') router.replace(`/order/${orderId}`);
    else router.replace('/');
  }

  useEffect(() => {
    let live = true;
    getOwed(orderId, stage).then((e) => {
      if (!live) return;
      setEntry(e);
      setViewing(Math.max(0, (e?.shots.length ?? 1) - 1));
      setLoaded(true);
    });
    // The server may already hold enough: the app died between the last
    // upload and clearing the debt. Its count is the truth; no answer keeps
    // the rider here, which is the safe side.
    api
      .order(orderId)
      .then(async (o) => {
        if ((o.photo_counts?.[stage] ?? 0) < MIN_PHOTOS) return;
        await clearOwed(orderId, stage);
        if (live) setEntry(null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [orderId, stage]);

  // Nothing owed (saved already, or a stale link): back to the work.
  useEffect(() => {
    if (loaded && !entry) leave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, entry]);

  // The camera opens by itself for the first photo, once.
  useEffect(() => {
    if (!entry || opened.current) return;
    opened.current = true;
    if (entry.shots.length === 0) void shoot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  // Back does nothing until the photos are saved.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  async function store(next: Shot[]) {
    if (!entry) return;
    setEntry({ ...entry, shots: next });
    await updateShots(orderId, stage, next);
  }

  /** A new photo, or a fresh one in place of `at`. */
  async function shoot(at?: number) {
    if (!entry) return;
    setError(null);
    const shot = await takePhoto();
    if ('error' in shot) {
      setError(photoProblem(shot.error));
      return;
    }
    const fresh: Shot = {
      uri: shot.uri,
      name: photoFileName(entry.ref, new Date(), timezone),
      sent: false,
    };
    const current = entry.shots;
    const next =
      at === undefined ? [...current, fresh] : current.map((s, i) => (i === at ? fresh : s));
    await store(next);
    setViewing(at ?? next.length - 1);
  }

  async function saveAll() {
    if (!entry || !enough) return;
    setBusy(true);
    setError(null);
    let next = [...entry.shots];
    const todo = next.filter((s) => !s.sent).length;
    let n = 0;
    try {
      for (let i = 0; i < next.length; i++) {
        if (next[i].sent) continue;
        n += 1;
        setSending(`Sending ${n} of ${todo}…`);
        await api.uploadProof(orderId, next[i].uri, next[i].name, stage);
        next = next.map((s, j) => (j === i ? { ...s, sent: true } : s));
        await store(next);
      }
      await clearOwed(orderId, stage);
      leave();
    } catch (err) {
      // The server holds the most it keeps, or the job closed for photos
      // 24 h after it ended. Either way nothing more can go up, and the
      // rider must not be held on a screen with no way out.
      if (err instanceof ApiError && (err.code === 'too_many_photos' || err.code === 'wrong_state')) {
        await clearOwed(orderId, stage);
        Alert.alert(
          'Photos',
          err.code === 'too_many_photos'
            ? 'The shop already has 4 photos for this parcel.'
            : err.message
        );
        leave();
        return;
      }
      setError(
        err instanceof ApiError && err.code !== 'network'
          ? err.message
          : "Couldn't send. Your photos are kept — try again."
      );
    } finally {
      setSending(null);
      setBusy(false);
    }
  }

  if (!loaded || !entry) {
    return (
      <GlassScreen>
        <LoadingArt />
      </GlassScreen>
    );
  }

  const title = stage === 'pickup' ? 'Pickup photos' : 'Delivery photos';

  return (
    <GlassScreen>
      <GlassHeader title={title} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gspace.xl,
          paddingBottom: gspace.xxxl + bottomInset,
        }}
      >
        <GlassCard>
          <GlassText variant="subtitle">
            {entry.customerName ? `${entry.ref} · ${entry.customerName}` : entry.ref}
          </GlassText>
          <GlassText variant="body" tone="soft" style={{ marginTop: gspace.xs }}>
            {HINT[stage]}
          </GlassText>
          <GlassText
            variant="label"
            upper
            tone={enough ? 'green' : 'orange'}
            style={{ marginTop: gspace.sm }}
          >
            {enough
              ? `${shots.length} of ${MAX_PHOTOS} taken`
              : `${MIN_PHOTOS} needed · ${shots.length} taken`}
          </GlassText>
        </GlassCard>

        {/* The photo shown big, so the rider checks it before moving on. */}
        <View
          style={{
            marginTop: gspace.lg,
            aspectRatio: 3 / 4,
            borderRadius: gradius.card,
            overflow: 'hidden',
            backgroundColor: glass.fill,
            borderWidth: 1,
            borderColor: glass.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {shown ? (
            <>
              <Image
                source={{ uri: shown.uri }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
              />
              <View
                style={{
                  position: 'absolute',
                  left: gspace.md,
                  bottom: gspace.md,
                  paddingHorizontal: gspace.sm,
                  paddingVertical: gspace.xs,
                  borderRadius: gradius.chip,
                  backgroundColor: 'rgba(4,20,12,0.7)',
                }}
              >
                <GlassText variant="caption" tone="white">
                  {`Photo ${viewing + 1}${shown.sent ? ' · sent' : ''}`}
                </GlassText>
              </View>
            </>
          ) : (
            <Pressable onPress={() => shoot()} style={{ alignItems: 'center' }}>
              <GlassIcon name="camera" size={40} color={glass.inkFaint} />
              <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm }}>
                Tap to take photo 1
              </GlassText>
            </Pressable>
          )}
        </View>

        {/* All four places, filled or waiting: tap one to look at it again. */}
        <View style={{ flexDirection: 'row', marginTop: gspace.md, columnGap: gspace.sm }}>
          {Array.from({ length: MAX_PHOTOS }, (_, i) => {
            const s = shots[i];
            const on = i === viewing && !!s;
            return (
              <Pressable
                key={i}
                onPress={() => (s ? setViewing(i) : undefined)}
                disabled={!s}
                accessibilityLabel={s ? `Photo ${i + 1}` : `Photo ${i + 1}, not taken`}
                style={{
                  flex: 1,
                  aspectRatio: 1,
                  borderRadius: gradius.chip,
                  overflow: 'hidden',
                  borderWidth: on ? 2 : 1,
                  borderStyle: s ? 'solid' : 'dashed',
                  borderColor: on ? glass.accentLine : glass.border,
                  backgroundColor: glass.fillLight,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {s ? (
                  <Image source={{ uri: s.uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                ) : (
                  <GlassText variant="label" tone="faint">
                    {i < MIN_PHOTOS ? `${i + 1} *` : `${i + 1}`}
                  </GlassText>
                )}
              </Pressable>
            );
          })}
        </View>

        {error ? (
          <GlassText variant="bodyStrong" tone="red" style={{ marginTop: gspace.lg }}>
            {error}
          </GlassText>
        ) : null}
        {sending ? (
          <GlassText variant="body" tone="soft" style={{ marginTop: gspace.lg }}>
            {sending}
          </GlassText>
        ) : null}

        {/* Before 2: only onward. From 2: save, or add another. At 4: save. */}
        {shots.length > 0 && !enough ? (
          <GlassButton
            title="Next photo"
            kind="green"
            icon="camera"
            onPress={() => shoot()}
            disabled={busy}
            style={{ marginTop: gspace.xl }}
          />
        ) : null}
        {enough ? (
          <GlassButton
            title={`Save & send ${shots.length} photos`}
            kind="green"
            icon="check"
            onPress={saveAll}
            loading={busy}
            style={{ marginTop: gspace.xl }}
          />
        ) : null}
        {enough && !done ? (
          <GlassButton
            title={`Add photo ${shots.length + 1}`}
            kind="ghost"
            icon="camera"
            onPress={() => shoot()}
            disabled={busy}
            style={{ marginTop: gspace.md }}
          />
        ) : null}
        {shown && !shown.sent ? (
          <GlassButton
            title={`Retake photo ${viewing + 1}`}
            kind="ghost"
            onPress={() => shoot(viewing)}
            disabled={busy}
            style={{ marginTop: gspace.md }}
          />
        ) : null}
      </ScrollView>
    </GlassScreen>
  );
}
