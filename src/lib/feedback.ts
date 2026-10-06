import * as Haptics from 'expo-haptics';
import { Platform, Vibration } from 'react-native';
import { playJobGone, playSuccess, playWrong } from './sounds';

/**
 * What the rider hears and feels at the moments that matter, the way the big
 * rider apps confirm every key step without the rider having to look:
 *
 *   tap       a light tick on the big buttons
 *   success   delivered, or a code accepted
 *   wrong     a code refused
 *   jobGone   a job cancelled or taken by another rider
 *
 * Never throws: feedback is a nicety on top of what the screen already says.
 */

function safe(fn: () => unknown): void {
  if (Platform.OS === 'web') return;
  try {
    const r = fn();
    if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => {});
  } catch {
    // No haptics on this phone.
  }
}

export const feedback = {
  tap(): void {
    safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
  },
  /** `quiet`: the tick and a soft buzz only, for a step inside a flow. */
  success(quiet = false): void {
    safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
    if (!quiet) playSuccess();
  },
  wrong(): void {
    safe(() => Vibration.vibrate([0, 120, 80, 120]));
    playWrong();
  },
  jobGone(): void {
    safe(() => Vibration.vibrate(600));
    playJobGone();
  },
};
