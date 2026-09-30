import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { Fix } from '../api/types';

/**
 * Where the phone is right now, for a step that asks — "arrived" — without
 * holding the step up.
 *
 * The position the phone already has is enough if it is under two minutes
 * old; otherwise a fresh one is asked for, but only for five seconds. Null
 * whenever location is off, not allowed, or slow: the server then uses the
 * rider's last reported position, or skips the check. Never asks permission.
 */
export async function currentFix(): Promise<Fix | null> {
  if (Platform.OS === 'web') return null;
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const known = await Location.getLastKnownPositionAsync({ maxAge: 120_000 });
    const fix =
      known ??
      (await Promise.race([
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
          mayShowUserSettingsDialog: false,
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
      ]));
    if (!fix) return null;
    return {
      latitude: fix.coords.latitude,
      longitude: fix.coords.longitude,
      accuracy: fix.coords.accuracy ?? 0,
    };
  } catch {
    return null;
  }
}
