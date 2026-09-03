import { Image } from 'expo-image';
import { View, ViewStyle } from 'react-native';
import { cardColor } from '../theme/tokens';

/**
 * A Google Static Maps image, used instead of an interactive map.
 *
 * Deliberately not `react-native-maps`: that is a native module, so it would
 * force an APK rebuild, and the x86_64 CMake toolchain here is broken. A still
 * image needs neither.
 *
 * Coordinates arrive only on `GET /orders/{id}` (see `DeliveryOrder.latitude`),
 * which is exactly the endpoint the job screen uses. There is no shop
 * coordinate anywhere in the contract, so this is a single drop pin rather than
 * a route line.
 */

const KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY;

export function StaticMap({
  latitude,
  longitude,
  width,
  height,
  zoom = 15,
  style,
}: {
  latitude: number | undefined;
  longitude: number | undefined;
  width: number;
  height: number;
  zoom?: number;
  style?: ViewStyle;
}) {
  const havePoint = typeof latitude === 'number' && typeof longitude === 'number';

  // Without a key Google returns an error image, which looks broken. A flat
  // panel is the honest stand-in, and the map appears the moment the key is set.
  if (!KEY || !havePoint) {
    return <View style={[{ width, height, backgroundColor: cardColor.chipBg }, style]} />;
  }

  const point = `${latitude},${longitude}`;
  // Request at scale 2 for a retina-sharp image; Google caps `size` at 640.
  const size = `${Math.min(Math.round(width), 640)}x${Math.min(Math.round(height), 640)}`;
  const uri =
    'https://maps.googleapis.com/maps/api/staticmap' +
    `?center=${point}&zoom=${zoom}&size=${size}&scale=2&maptype=roadmap` +
    `&markers=color:0x${cardColor.orange.slice(1)}%7C${point}` +
    `&key=${KEY}`;

  return (
    <View style={[{ width, height, backgroundColor: cardColor.chipBg }, style]}>
      <Image
        source={{ uri }}
        style={{ width, height }}
        contentFit="cover"
        // Each render is a billed request, so let it come from cache on a
        // re-render rather than being re-fetched.
        cachePolicy="memory-disk"
        transition={200}
      />
    </View>
  );
}
