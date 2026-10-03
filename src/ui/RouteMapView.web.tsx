/**
 * The web build's stand-in for the job map.
 *
 * `react-native-maps` has no web implementation, and importing it at all fails
 * the static web export, which the browser test and UI previews run on. Metro
 * picks this file on web and `RouteMapView.tsx` everywhere else, so phones are
 * untouched. `MAP_ENABLED` is already false on web, so nothing renders these.
 */

export const RIDER_BOX = 0;

export function RouteMapView(_props: unknown) {
  return null;
}

export function Rider(_props: { onReady: () => void }) {
  return null;
}

export function RiderShadow() {
  return null;
}
