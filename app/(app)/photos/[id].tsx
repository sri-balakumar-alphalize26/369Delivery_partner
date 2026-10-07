import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomInset } from '../../../src/hooks/useBottomInset';
import { api } from '../../../src/api/endpoints';
import { photoFileName } from '../../../src/lib/photoName';
import {
  clearOwed,
  getOwed,
  MAX_PHOTOS,
  MIN_PHOTOS,
  OwedPhotos,
  PhotoStage,
  Shot,
  submitOwed,
  updateShots,
} from '../../../src/photos/owed';
import { dropPhotos, keepPhoto } from '../../../src/photos/shrink';
import { drainPhotos } from '../../../src/photos/uploader';
import { serverNow } from '../../../src/lib/clock';
import { timeOnly } from '../../../src/lib/format';
import { useSession } from '../../../src/store/session';
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
 * Nothing goes up until Send: the rider sees every photo first and can retake
 * any of them. Send hands them to the uploader (`photos/uploader.ts`) and moves
 * on at once - the photos go up in the background, made lighter first, with a
 * bar at the top and a notification saying how far along they are.
 */
export default function Photos() {
  const { id, stage: stageParam } = useLocalSearchParams<{
    id: string;
    stage: string;
  }>();
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

  // Nothing owed (saved already, or a stale link), or already sent off and
  // going up in the background: back to the work.
  useEffect(() => {
    if (loaded && (!entry || entry.submitted)) leave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, entry]);

  // The camera opens by itself for the first photo, once - after the code's
  // keyboard is down, so the camera never opens while the screen is still
  // settling from the code card (a capped wait: a keyboard that never says it
  // closed does not keep the camera shut).
  useEffect(() => {
    if (!entry || opened.current) return;
    opened.current = true;
    if (entry.shots.length > 0) return;
    if (!Keyboard.isVisible()) {
      void shoot();
      return;
    }
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      sub.remove();
      clearTimeout(cap);
      void shoot();
    };
    const sub = Keyboard.addListener('keyboardDidHide', go);
    const cap = setTimeout(go, 1500);
    Keyboard.dismiss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  // Back does nothing until the photos are saved.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  // Except close a photo shown full size.
  useEffect(() => {
    if (viewing === null) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setViewing(null);
      return true;
    });
    return () => sub.remove();
  }, [viewing]);

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
    // Named again in the company's zone when it is sent; see uploader.ts.
    const takenAt = serverNow();
    const fresh: Shot = {
      // Out of the camera's cache: it may wait a while for signal.
      uri: keepPhoto(shot.uri),
      name: timezone ? photoFileName(entry.ref, new Date(takenAt), timezone) : '',
      takenAt,
      sent: false,
    };
    const current = entry.shots;
    const next =
      at === undefined ? [...current, fresh] : current.map((s, i) => (i === at ? fresh : s));
    await store(next);
    if (at !== undefined && current[at]) dropPhotos([current[at].uri, current[at].small]);
  }

  /** The photos are final: they go up in the background, and the rider moves on. */
  async function saveAll() {
    if (!entry || !enough) return;
    await submitOwed(orderId, stage);
    void drainPhotos();
    leave();
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
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'baseline',
          }}
        >
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
                    style={{
                      width: 76,
                      height: 76,
                      borderRadius: gradius.chip,
                    }}
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
                    taken={timeOnly(
                      s.takenAt ? new Date(s.takenAt).toISOString() : undefined,
                      timezone
                    )}
                  />
                </View>
                {!s.sent ? (
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
              disabled={!next}
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
                <GlassIcon
                  name="camera"
                  size={26}
                  color={next ? glass.accentText : glass.inkFaint}
                />
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
            title={`Send ${shots.length} photos${stage === 'delivery' ? ' and finish' : ''}`}
            kind="green"
            icon="check"
            onPress={saveAll}
          />
        ) : (
          <GlassButton
            title={`Take photo ${shots.length + 1}`}
            kind="green"
            icon="camera"
            onPress={() => shoot()}
          />
        )}
        <GlassText variant="caption" tone="soft" style={{ textAlign: 'center' }}>
          {enough && !done
            ? 'Add up to 4 if it helps. They upload in the background - you can carry on.'
            : 'They upload in the background - you can carry on.'}
        </GlassText>
      </View>

      {/* A photo full size, to check it before sending. A layer in the screen,
          not a <Modal>: Retake closes it and opens the camera at once, and a
          Modal window closed at that moment could stay behind, white. */}
      {big ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              zIndex: 10,
              elevation: 10,
              backgroundColor: 'rgba(4,20,12,0.94)',
            },
          ]}
        >
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
            {big && !big.sent && viewing !== null ? (
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
            <GlassButton
              title="Close"
              kind="green"
              onPress={() => setViewing(null)}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      ) : null}
    </GlassScreen>
  );
}

/** Under each taken photo: when it was taken, or Sent. Uploads show in `UploadBar`. */
function RowStatus({ sent, taken }: { sent: boolean; taken: string }) {
  if (sent) {
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          columnGap: 4,
          marginTop: 4,
        }}
      >
        <GlassIcon name="check" size={14} color={glass.green} />
        <GlassText variant="label" tone="green">
          Sent
        </GlassText>
      </View>
    );
  }
  return (
    <GlassText variant="label" tone="green" style={{ marginTop: 4 }}>
      {taken ? `Taken ${taken}` : 'Taken'}
    </GlassText>
  );
}
