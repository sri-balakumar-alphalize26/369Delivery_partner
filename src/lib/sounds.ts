import { AudioPlayer, createAudioPlayer } from 'expo-audio';
import { Platform } from 'react-native';

/**
 * The app's own sounds, so a rider knows it is this app without looking - the
 * way a Snapchat or LinkedIn sound is known. Made for this app (a two-note
 * rising chime, under a second), so no licence to track.
 *
 * Plays while the app is running. With the app closed, the same file rings
 * through the `trip-updates` notification channel instead (src/push/register.ts),
 * which needs it built into the APK.
 */

let nearCustomer: AudioPlayer | null = null;

/** "Marked near the customer" - the server did it from the rider's position. */
export function playNearCustomer(): void {
  if (Platform.OS === 'web') return;
  try {
    nearCustomer ??= createAudioPlayer(require('../../assets/sounds/near_customer.wav'));
    nearCustomer.seekTo(0);
    nearCustomer.play();
  } catch {
    // A sound is a nicety: the buzz and the banner still say it.
  }
}
