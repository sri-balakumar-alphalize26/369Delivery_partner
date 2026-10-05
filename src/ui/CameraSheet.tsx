import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { glass, gspace } from '../theme/glass';
import { GlassButton } from './glass/GlassButton';
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

/** Opens the sheet; resolves once the rider uses a photo or backs out. */
export function openCamera(wantBase64: boolean): Promise<Shot> {
  return open ? open(wantBase64) : Promise.resolve({ error: 'failed' });
}

export function CameraHost() {
  const [visible, setVisible] = useState(false);
  const [preview, setPreview] = useState<{ uri: string; base64: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const settle = useRef<((s: Shot) => void) | null>(null);
  const base64 = useRef(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    open = (wantBase64) =>
      new Promise<Shot>((resolve) => {
        // A second call while open answers the first as cancelled.
        settle.current?.({ error: 'cancelled' });
        settle.current = resolve;
        base64.current = wantBase64;
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
      // Half quality: a parcel or a receipt must be legible, not beautiful,
      // and it goes up over a rider's mobile data.
      const pic = await camera.current.takePictureAsync({
        quality: 0.5,
        skipProcessing: true,
        exif: false,
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

  const denied = !!permission && !permission.granted && !permission.canAskAgain;
  const bottom = Math.max(insets.bottom, gspace.lg);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => (preview ? setPreview(null) : finish({ error: 'cancelled' }))}
    >
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
                paddingBottom: bottom + gspace.md,
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
              onCameraReady={() => setReady(true)}
            />
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: gspace.xxl,
                paddingTop: gspace.lg,
                paddingBottom: bottom + gspace.md,
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
              <View style={{ width: 80 }} />
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}
