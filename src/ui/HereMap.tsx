import { ViewStyle } from 'react-native';
import { HereMapView } from './HereMapView';
import { MAP_ENABLED } from './RouteMap';

/**
 * Home's "you are here" card: where the rider is right now.
 *
 * Shown only on duty, and `active` only while Home is the tab in view, so the
 * GPS behind it stops the moment either is no longer true. Native only, for
 * the same reason as `RouteMap`.
 */
export function HereMap({
  active,
  height = 180,
  style,
}: {
  active: boolean;
  height?: number;
  style?: ViewStyle;
}) {
  if (!MAP_ENABLED) return null;
  return <HereMapView active={active} height={height} style={style} />;
}
