import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomInset } from '../../../src/hooks/useBottomInset';
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
import { serverNow } from '../../../src/lib/clock';
import { timeOnly } from '../../../src/lib/format';
import { shopTimeZone, useSession } from '../../../src/store/session';
import { glass, gradius, gspace } from '../../../src/theme/glass';
import { photoProblem, takePhoto } from '../../../src/ui/takePhoto';
import { GlassButton } from '../../../src/ui/glass/GlassButton';
import { GlassIcon } from '../../../src/ui/glass/GlassIcon';
import { GlassScreen } from '../../../src/ui/glass/GlassScreen';
import { GlassText } from '../../../src/ui/glass/GlassText';

const HEAD: Record<PhotoStage, { step: string; hint: string }> = {
  pickup: {
    step: 'Pickup photos',
    hint: 'Code accepted. Photograph the parcel before you leave the shop.',
  },
  delivery: {
    step: 'Last step · Delivery photos',
    hint: 'Code accepted. Photograph the parcel as you hand it over.',
  },
};

/**
 * What each of the four photos is of. The first two are needed; they are the
 * two the office looks for in a dispute - the whole parcel, and its label with
 * the seal. The last two are there when they help.
 */
const SLOTS: Record<PhotoStage, { title: string; hint: string }[]> = {
  pickup: [
    { title: 'Whole parcel', hint: 'At the counter, before you leave' },
    { title: 'Label and seal', hint: 'Order label readable, tape unbroken' },
    { title: 'Anything else', hint: 'Optional. A second bag or the receipt' },
    { title: 'Anything wrong', hint: 'Optional. A dent, a wet corner' },
  ],
  delivery: [
    { title: 'Whole parcel', hint: "At the door, in the customer's hands" },
    { title: 'Label and seal', hint: 'Order label readable, tape unbroken' },
    { title: 'Where you left it', hint: 'Optional. Door, gate or reception' },
    { title: 'Anything wrong', hint: 'Optional. A dent, a wet corner' },
  ],
};

/**
 * The parcel photos after a code: 2 to 4, as a shot list - one row per photo
 * saying what to take, then the photo with its time and how its upload is going.
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
  const bottomInset = useBottomInset();
  const timezone = useSession((s) => s.timezone);

  const [entry, setEntry] = useState<OwedPhotos | null>(null);
  const [loaded, setLoaded] = useState(false);
  /** The photo open full size, or none. */
  const [viewing, setViewing] = useState<number | null>(null);
  /** The photo going up right now, for its row's status. */
  const [sendingAt, setSendingAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const opened = useRef(false);

  const shots = entry?.shots ?? [];
  const done = shots.length >= MAX_PHOTOS;
  const enough = shots.length >= MIN_PHOTOS;

  /** The entry as last seen, for the thank-you screen once it is cleared. */
  const lastEntry = useRef<OwedPhotos | null>(null);
  if (entry) lastEntry.current = entry;

  function leave() {
    if (stage === 'pickup') {
      router.replace(`/order/${orderId}`);
      return;
    }
    // After the delivery photos: the thank-you screen, then the jobs.
    const e = lastEntry.current;
    if (!e) {
      router.replace('/');
      return;
    }
    router.replace({
      pathname: '/done/[id]',
      params: {
        id: String(orderId),
        ref: e.ref,
        customer: e.customerName,
        fee: e.fee?.formatted ?? '',
        at: e.deliveredAt ?? '',
      },
    });
  }

  useEffect(() => {
    let live = true;
    getOwed(orderId, stage).then((e) => {
      if (!live) return;
      setEntry(e);
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

  // Back in view (the rider pressed Back from the job onto a screen already
  // done): read the debt again, so a cleared one moves on instead of staying.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      getOwed(orderId, stage).then((e) => {
        if (live && !e) setEntry(null);
      });
      return () => {
        live = false;
      };
    }, [orderId, stage])
  );

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
    // Named again in the company's zone when it is sent; see saveAll.
    const takenAt = serverNow();
    const fresh: Shot = {
      uri: shot.uri,
      name: timezone ? photoFileName(entry.ref, new Date(takenAt), timezone) : '',
      takenAt,
      sent: false,
    };
    const current = entry.shots;
    const next =
      at === undefined ? [...current, fresh] : current.map((s, i) => (i === at ? fresh : s));
    await store(next);
  }

  async function saveAll() {
    if (!entry || !enough) return;
    setBusy(true);
    setError(null);
    let next = [...entry.shots];
    const todo = next.filter((s) => !s.sent).length;
    let n = 0;
    try {
      // Every photo of the stage named in the one zone, the company's, from
      // the moment it was taken - never the phone's zone.
      const zone = await shopTimeZone();
      next = next.map((s) =>
        !s.sent && s.takenAt ? { ...s, name: photoFileName(entry.ref, new Date(s.takenAt), zone) } : s
      );
      for (let i = 0; i < next.length; i++) {
        if (next[i].sent) continue;
        n += 1;
        setSending(`Sending ${n} of ${todo}…`);
        setSendingAt(i);
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
      setSendingAt(null);
      setBusy(false);
    }
  }

  // A plain spinner, not the box animation: this is a moment's read from the
  // phone right after a code, and a full-screen clip there looked like a restart.
  if (!loaded || !entry) {
    return (
      <GlassScreen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={glass.band} />
        </View>
      </GlassScreen>
    );
  }

  const head = HEAD[stage];
  const slots = SLOTS[stage];
  const big = viewing !== null ? shots[viewing] : undefined;
  const left = MIN_PHOTOS - shots.length;

  return (
    <GlassScreen>
      {/* Where the rider is in the job, on the app's green band. */}
      <View
        style={{
          backgroundColor: glass.band,
          paddingTop: insets.top + gspace.lg,
          paddingBottom: gspace.lg,
          paddingHorizontal: gspace.xl,
        }}
      >
        <GlassText variant="label" upper style={{ color: glass.bandSoft }}>
          {head.step}
        </GlassText>
        <GlassText variant="title" style={{ color: glass.bandInk, marginTop: gspace.xs }}>
          {entry.customerName ? `${entry.ref} · ${entry.customerName}` : entry.ref}
        </GlassText>
        <GlassText variant="body" style={{ color: glass.bandSoft, marginTop: 2 }}>
          {head.hint}
        </GlassText>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: gspace.lg, rowGap: gspace.md }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <GlassText variant="subtitle">Shot list</GlassText>
          <GlassText variant="label" tone={left > 0 ? 'orange' : 'green'}>
            {left > 0 ? `${left} more needed` : `${shots.length} taken · ready to send`}
          </GlassText>
        </View>

        {/* One row per photo, in order: what to take, then the photo once taken. */}
        {slots.map((slot, i) => {
          const s = shots[i];
          const next = !s && i === shots.length;
          if (s) {
            return (
              <View
                key={i}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  columnGap: gspace.md,
                  padding: gspace.sm,
                  borderRadius: gradius.card,
                  borderWidth: 1,
                  borderColor: s.sent ? glass.accentLine : glass.border,
                  backgroundColor: glass.white,
                }}
              >
                <Pressable
                  onPress={() => setViewing(i)}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={`See photo ${i + 1} full size`}
                >
                  <Image
                    source={{ uri: s.uri }}
                    style={{ width: 76, height: 76, borderRadius: gradius.chip }}
                    contentFit="cover"
                  />
                </Pressable>
                <View style={{ flex: 1 }}>
                  <GlassText variant="bodyStrong">{`${i + 1} · ${slot.title}`}</GlassText>
                  <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
                    {slot.hint}
                  </GlassText>
                  <RowStatus
                    sent={s.sent}
                    sendingNow={sendingAt === i}
                    waiting={busy && !s.sent && sendingAt !== i}
                    taken={timeOnly(s.takenAt ? new Date(s.takenAt).toISOString() : undefined, timezone)}
                  />
                </View>
                {!s.sent && !busy ? (
                  <Pressable
                    onPress={() => shoot(i)}
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
          return (
            <Pressable
              key={i}
              onPress={() => shoot()}
              disabled={!next || busy}
              accessibilityRole="button"
              accessibilityLabel={`Take photo ${i + 1}: ${slot.title}`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                columnGap: gspace.md,
                padding: gspace.sm,
                borderRadius: gradius.card,
                borderWidth: 1.5,
                borderStyle: 'dashed',
                borderColor: next ? glass.accentLine : glass.dividerDashed,
                backgroundColor: pressed ? glass.fill : glass.white,
                opacity: next ? 1 : 0.55,
              })}
            >
              <View
                style={{
                  width: 76,
                  height: 76,
                  borderRadius: gradius.chip,
                  backgroundColor: next ? glass.accentSoft : glass.fill,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <GlassIcon name="camera" size={26} color={next ? glass.accentText : glass.inkFaint} />
              </View>
              <View style={{ flex: 1 }}>
                <GlassText variant="bodyStrong">{`${i + 1} · ${slot.title}`}</GlassText>
                <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
                  {slot.hint}
                </GlassText>
                {i < MIN_PHOTOS ? (
                  <GlassText variant="label" tone="orange" style={{ marginTop: 4 }}>
                    Needed
                  </GlassText>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Always in reach: the next photo, then send. */}
      <View
        style={{
          backgroundColor: glass.white,
          borderTopWidth: 1,
          borderTopColor: glass.divider,
          paddingHorizontal: gspace.lg,
          paddingTop: gspace.md,
          paddingBottom: bottomInset,
          rowGap: gspace.sm,
        }}
      >
        {error ? (
          <GlassText variant="bodyStrong" tone="red">
            {error}
          </GlassText>
        ) : null}
        {enough ? (
          <GlassButton
            title={
              busy
                ? (sending ?? 'Sending…')
                : `Send ${shots.length} photos${stage === 'delivery' ? ' and finish' : ''}`
            }
            kind="green"
            icon="check"
            onPress={saveAll}
            loading={busy}
          />
        ) : (
          <GlassButton
            title={`Take photo ${shots.length + 1}`}
            kind="green"
            icon="camera"
            onPress={() => shoot()}
            disabled={busy}
          />
        )}
        <GlassText variant="caption" tone="soft" style={{ textAlign: 'center' }}>
          {enough && !done && !busy
            ? 'Add up to 4 if it helps. Photos stay on the phone until they are sent.'
            : 'Photos stay on the phone until they are sent.'}
        </GlassText>
      </View>

      {/* A photo full size, to check it before sending. */}
      <Modal
        visible={!!big}
        transparent
        animationType="fade"
        onRequestClose={() => setViewing(null)}
        statusBarTranslucent
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(4,20,12,0.94)' }}>
          {big ? (
            <Image source={{ uri: big.uri }} style={{ flex: 1 }} contentFit="contain" />
          ) : null}
          <View
            style={{
              flexDirection: 'row',
              columnGap: gspace.md,
              paddingHorizontal: gspace.xl,
              paddingTop: gspace.lg,
              paddingBottom: bottomInset + gspace.md,
            }}
          >
            {big && !big.sent && !busy && viewing !== null ? (
              <GlassButton
                title="Retake"
                kind="ghost"
                onPress={() => {
                  const at = viewing;
                  setViewing(null);
                  void shoot(at);
                }}
                style={{ flex: 1 }}
              />
            ) : null}
            <GlassButton title="Close" kind="green" onPress={() => setViewing(null)} style={{ flex: 1 }} />
          </View>
        </View>
      </Modal>
    </GlassScreen>
  );
}

/** Under each taken photo: when it was taken, then how its upload is going. */
function RowStatus({
  sent,
  sendingNow,
  waiting,
  taken,
}: {
  sent: boolean;
  sendingNow: boolean;
  waiting: boolean;
  taken: string;
}) {
  if (sent) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 4, marginTop: 4 }}>
        <GlassIcon name="check" size={14} color={glass.green} />
        <GlassText variant="label" tone="green">
          Sent
        </GlassText>
      </View>
    );
  }
  if (sendingNow) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 6, marginTop: 4 }}>
        <ActivityIndicator size="small" color={glass.band} />
        <GlassText variant="label" tone="soft">
          Sending…
        </GlassText>
      </View>
    );
  }
  return (
    <GlassText variant="label" tone={waiting ? 'faint' : 'green'} style={{ marginTop: 4 }}>
      {waiting ? 'Waiting to send' : taken ? `Taken ${taken}` : 'Taken'}
    </GlassText>
  );
}
