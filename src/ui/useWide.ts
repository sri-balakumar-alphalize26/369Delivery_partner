import { useWindowDimensions } from 'react-native';
import { TABLET_MIN_WIDTH } from '../theme/glass';

/**
 * Whether there is tablet-width room to lay things out in two columns.
 *
 * One hook rather than a `useWindowDimensions()` and a comparison at each
 * screen, so every list changes shape at the same width. Reads from the window
 * rather than the screen, so it follows a split-screen or a rotation instead of
 * describing hardware the app may not have all of.
 */
export function useWide(): boolean {
  const { width } = useWindowDimensions();
  return width >= TABLET_MIN_WIDTH;
}
