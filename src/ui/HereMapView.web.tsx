/**
 * The web build's stand-in for the Home map. See `RouteMapView.web.tsx`:
 * `react-native-maps` cannot be imported on web, and Home only draws the map
 * where `MAP_ENABLED` is true, which it never is on web.
 */
export function HereMapView(_props: unknown) {
  return null;
}
