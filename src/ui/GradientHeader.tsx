import { Image } from 'expo-image';
import { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { cardColor, cardRadius } from '../theme/tokens';

/**
 * The blue header, with the reference's blue-to-violet wash.
 *
 * Sampling the mockups across the header gives #0B3FB5 on the left through
 * #2141A4 to #4A4586 on the right, lifting slightly toward the bottom — a
 * gradient, not the blur it reads as.
 *
 * Drawn as a stretched image rather than with `expo-linear-gradient`: that is a
 * native module, so it would force an APK rebuild, and the x86_64 CMake
 * toolchain here is broken. The source is a 256x64 PNG generated at build time;
 * stretching it is exactly how a linear gradient is rasterised anyway, so there
 * is no quality cost.
 */
export function GradientHeader({
  children,
  style,
  rounded = true,
}: {
  children?: ReactNode;
  style?: ViewStyle;
  /** Rounded lower corners. Off for headers that butt against content. */
  rounded?: boolean;
}) {
  return (
    <View
      style={[
        {
          // Shows through until the image decodes, and behind it if it fails.
          backgroundColor: cardColor.brand,
          overflow: 'hidden',
          borderBottomLeftRadius: rounded ? cardRadius.header : 0,
          borderBottomRightRadius: rounded ? cardRadius.header : 0,
        },
        style,
      ]}
    >
      <Image
        source={require('../../assets/images/header-gradient.png')}
        style={StyleSheet.absoluteFill}
        // 'fill' not 'cover': the gradient should span the full width whatever
        // the header's aspect ratio, which is the whole point of stretching it.
        contentFit="fill"
        transition={0}
      />
      {children}
    </View>
  );
}
