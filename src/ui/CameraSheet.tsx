import { CameraView, FlashMode, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomInset } from '../hooks/useBottomInset';
import { glass, gspace } from '../theme/glass';
import { GlassButton } from './glass/GlassButton';
import { GlassIcon } from './glass/GlassIcon';
import { GlassText } from './glass/GlassText';

/**
 * The camera, inside the app.
 *
 * The phone's own camera app (expo-image-picker) took the rider out of this
 * one, and Android, short of memory, often closed us while it was open: the
 * shot came back to an app that had restarted, and the photo was lost. The
 * Tools rental app had met the same thing and solved it this way - the camera
 * is a screen of ours, so nothing is ever left in the background.
 *
 * One sheet for the whole app, opened by `takePhoto()`; screens never mount it.
 */

export type Shot =
  | { uri: string; base64: string }
  | { error: 'denied' | 'cancelled' | 'failed' };

let open: ((wantBase64: boolean) => Promise<Shot>) | null = null;

/** The flash button cycles Auto → On → Off. */
const FLASH_NEXT: Record<FlashMode, FlashMode> = { auto: 'on', on: 'off', off: 'auto' };
/** An icon and a word: an emoji draws differently on every phone. */
const FLASH_LABEL: Record<FlashMode, string> = {
  auto: 'Auto',
  on: 'On',
  off: 'Off',
};

/** Opens the sheet; resolves once the rider uses a photo or backs out. */
export function openCamera(wantBase64: boolean): Promise<Shot> {
  return open ? open(wantBase64) : Promise.resolve({ error: 'failed' });
}

export function CameraHost() {
  const [visible, setVisible] = useState(false);
  const [preview, setPreview] = useState<{ uri: string; base64: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  // Kept between photos: a dark shop counter stays dark for the next shot.
  const [flash, setFlash] = useState<FlashMode>('auto');
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const settle = useRef<((s: Shot) => void) | null>(null);
  const base64 = useRef(false);

  useEffect(() => {
    open = (wantBase64) =>
      new Promise<Shot>((resolve) => {
        // A second call while open answers the first as cancelled.
        settle.current?.({ error: 'cancelled' });
        settle.current = resolve;
        base64.current = wantBase64;
        // A note box left open would otherwise sit over the shutter.
        Keyboard.dismiss();
        setPreview(null);
        setReady(false);
        setVisible(true);
      });
    return () => {
      open = null;
    };
  }, []);

  // Ask once the sheet opens; a refusal shows its own panel below.
  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [visible, permission, requestPermission]);

  function finish(shot: Shot) {
    settle.current?.(shot);
    settle.current = null;
    setVisible(false);
    setPreview(null);
    setBusy(false);
  }

  async function shoot() {
    if (!camera.current || busy || !ready) return;
    setBusy(true);
    try {
      // The camera's own JPEG, straight away: `skipProcessing` keeps the
      // shutter instant, and Android then ignores `quality`. The file is made
      // lighter later, off the rider's time, before it goes up (photos/shrink.ts).
      const pic = await camera.current.takePictureAsync({
        quality: 0.5,
        skipProcessing: true,
        exif: false,
        // Silent: a rider at a customer's door does not need the click.
        shutterSound: false,
        base64: base64.current,
      });
      if (pic?.uri) setPreview({ uri: pic.uri, base64: pic.base64 ?? '' });
      else finish({ error: 'failed' });
    } catch {
      finish({ error: 'failed' });
    } finally {
      setBusy(false);
    }
  }

  // The phone's Back: from the preview back to the camera, else out.
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (preview) setPreview(null);
      else finish({ error: 'cancelled' });
      return true;
    });
    return () => sub.remove();
  }, [visible, preview]);

  const denied = !!permission && !permission.granted && !permission.canAskAgain;
  // Just above Android's navigation: buttons or the gesture strip.
  const bottom = useBottomInset();
  const top = useSafeAreaInsets().top;

  /*
   * A layer over the whole app, not a <Modal>. A Modal is a separate Android
   * window, and one opened while the keyboard was closing sometimes stayed
   * white and took every tap, with the camera running behind it; Back and
   * the developer menu could not get past it. A View in our own window
   * cannot be left behind like that.
   */
  if (!visible) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 1000, elevation: 1000 }]}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {!permission?.granted ? (
          <View style={{ flex: 1, justifyContent: 'center', padding: gspace.xxl }}>
            <GlassText variant="title" tone="white" style={{ textAlign: 'center' }}>
              {denied ? 'Camera not allowed' : 'Allow the camera'}
            </GlassText>
            <GlassText variant="body" tone="white" style={{ textAlign: 'center', marginTop: gspace.sm, opacity: 0.8 }}>
              {denied
                ? 'Allow it in the phone Settings to take the parcel photos.'
                : 'The parcel photos are taken here, inside the app.'}
            </GlassText>
            {!denied ? (
              <GlassButton
                title="Allow camera"
                kind="green"
                onPress={() => void requestPermission()}
                style={{ marginTop: gspace.xl }}
              />
            ) : null}
            <GlassButton
              title="Cancel"
              kind="ghost"
              onPress={() => finish({ error: denied ? 'denied' : 'cancelled' })}
              style={{ marginTop: gspace.md }}
            />
          </View>
        ) : preview ? (
          <>
            <Image source={{ uri: preview.uri }} style={{ flex: 1 }} contentFit="contain" />
            <View
              style={{
                flexDirection: 'row',
                gap: gspace.md,
                paddingHorizontal: gspace.xl,
                paddingTop: gspace.lg,
                paddingBottom: bottom,
              }}
            >
              <GlassButton title="Retake" kind="ghost" onPress={() => setPreview(null)} style={{ flex: 1 }} />
              <GlassButton
                title="Use photo"
                kind="green"
                icon="check"
                onPress={() => finish(preview)}
                style={{ flex: 1 }}
              />
            </View>
          </>
        ) : (
          <>
            <CameraView
              ref={camera}
              style={{ flex: 1 }}
              facing="back"
              flash={flash}
              /*
               * No white "flash" on the shot. On Android, expo-camera paints the
               * whole app window white for 50 ms and then clears it through this
               * view's window - but the preview replaces this view as soon as the
               * photo is in, and once it is gone the clear misses: the app stayed
               * white for good, alive underneath, until a restart.
               */
              animateShutter={false}
              onCameraReady={() => setReady(true)}
            />
            {/* Customers and shop staff did not agree to be in these photos. */}
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: top + gspace.md,
                left: gspace.lg,
                right: gspace.lg,
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: gspace.sm,
                paddingHorizontal: gspace.md,
                borderRadius: 12,
                backgroundColor: 'rgba(0,0,0,0.6)',
              }}
            >
              <GlassIcon name="alert" size={18} color={glass.white} />
              <GlassText
                variant="bodyStrong"
                tone="white"
                style={{ flex: 1, marginLeft: gspace.sm }}
              >
                Photograph the parcel only. Please keep people&apos;s faces out of the photo.
              </GlassText>
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: gspace.xxl,
                paddingTop: gspace.lg,
                paddingBottom: bottom,
              }}
            >
              <Pressable
                onPress={() => finish({ error: 'cancelled' })}
                accessibilityRole="button"
                hitSlop={12}
                style={{ width: 80 }}
              >
                <GlassText variant="button" tone="white">
                  Cancel
                </GlassText>
              </Pressable>
              <Pressable
                onPress={shoot}
                disabled={busy || !ready}
                accessibilityRole="button"
                accessibilityLabel="Take photo"
                style={({ pressed }) => ({
                  width: 76,
                  height: 76,
                  borderRadius: 38,
                  borderWidth: 4,
                  borderColor: glass.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: busy || !ready ? 0.5 : pressed ? 0.8 : 1,
                })}
              >
                <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: glass.white }} />
              </Pressable>
              {/* Balances Cancel so the shutter stays centred. */}
              <Pressable
                onPress={() => setFlash(FLASH_NEXT[flash])}
                accessibilityRole="button"
                accessibilityLabel={`Flash ${flash}. Change.`}
                hitSlop={12}
                style={{
                  width: 80,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  columnGap: 4,
                }}
              >
                <GlassIcon
                  name={flash === 'off' ? 'flashOff' : 'flash'}
                  size={20}
                  color={flash === 'off' ? glass.white : glass.accent}
                />
                <GlassText variant="button" tone="white">
                  {FLASH_LABEL[flash]}
                </GlassText>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </View>
  );
}
