import { Image, View, useWindowDimensions } from 'react-native';

/**
 * Full-bleed brand splash.
 *
 * This exists because Android 12+ will not render a full-screen splash image —
 * the platform forces a centred icon on a solid colour, and the artwork would
 * be cropped to nothing. So the native splash stays a brief centred mark, and
 * the designed artwork is shown here, in-app, while fonts and the session load.
 *
 * `cover` fills every phone aspect ratio without letterboxing. The background
 * matches the top of the artwork so the native-to-app handoff has no flash.
 */
export function SplashArt() {
  const { width, height } = useWindowDimensions();

  return (
    <View style={{ flex: 1, backgroundColor: '#F3F7FE' }}>
      <Image
        source={require('../../assets/images/splash-full.png')}
        style={{ width, height }}
        resizeMode="cover"
      />
    </View>
  );
}
