import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import { gspace } from '../theme/glass';

/**
 * The space to keep clear at the bottom of a screen with no tab bar, so its
 * buttons sit just above Android's navigation and never under it.
 *
 * - Three-button navigation: the bar is about 48 dp; this is that height.
 * - Gesture navigation ("full screen"): the strip is only the thin handle, so
 *   content runs down to it, with a small margin so a button is not pressed
 *   against the swipe area.
 *
 * `useSafeAreaInsets` alone is not enough: inside the tabs it is reduced by the
 * tab bar the navigator thinks is there, even on a route that hides it, and the
 * job screen once drew its buttons inside the navigation bar for that reason.
 * `initialWindowMetrics` is the window as the OS reports it, unadjusted, so the
 * larger of the two is always safe.
 */
export function useBottomInset(): number {
  const insets = useSafeAreaInsets();
  const system = Math.max(insets.bottom, initialWindowMetrics?.insets.bottom ?? 0);
  // Under 32 dp means gesture navigation (or none): keep a little breathing room.
  return system < 32 ? system + gspace.md : system;
}
