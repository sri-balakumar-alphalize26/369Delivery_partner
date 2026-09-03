import { Image } from 'expo-image';
import { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { glass } from '../../theme/glass';

/**
 * The gradient mesh every screen sits on.
 *
 * The template drew this with react-native-linear-gradient plus two hard-edged
 * circles, and its own comment conceded that "plain RN has no CSS filter: blur
 * equivalent". Baking the whole mesh into a PNG avoids a native module — so no
 * APK rebuild — and lets the blobs be genuinely blurred, which is what the
 * mockups actually show.
 */
export function GlassScreen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ flex: 1, backgroundColor: glass.meshMid }, style]}>
      <Image
        source={require('../../../assets/images/glass-mesh.png')}
        style={StyleSheet.absoluteFill}
        // 'fill' so the mesh spans whatever aspect ratio the screen is; it is a
        // soft wash, so stretching costs nothing.
        contentFit="fill"
        transition={0}
      />
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}
