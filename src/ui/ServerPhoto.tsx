import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useBottomInset } from '../hooks/useBottomInset';
import { imageSource } from '../api/rest/client';
import { glass, gradius, gspace } from '../theme/glass';
import { GlassButton } from './glass/GlassButton';

/**
 * A photo the server holds; it needs the rider's token to load. A tap shows it
 * full screen. Used for the report photos on a job and the parcel photos on a
 * past job.
 */
export function ServerPhoto({ path, size = 56 }: { path: string; size?: number }) {
  const [source, setSource] = useState<{ uri: string; headers?: Record<string, string> } | null>(null);
  const [open, setOpen] = useState(false);
  const bottomInset = useBottomInset();
  useEffect(() => {
    let live = true;
    imageSource(path)
      .then((s) => live && setSource(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [path]);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={!source}
        accessibilityRole="imagebutton"
        accessibilityLabel="Show the photo"
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <Image
          source={source}
          style={{ width: size, height: size, borderRadius: gradius.chip, backgroundColor: glass.border }}
          contentFit="cover"
        />
      </Pressable>
      <Modal visible={open} animationType="fade" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <Image source={source} style={{ flex: 1 }} contentFit="contain" />
          <View
            style={{
              paddingHorizontal: gspace.xl,
              paddingTop: gspace.lg,
              paddingBottom: bottomInset,
            }}
          >
            <GlassButton title="Close" kind="ghost" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}
