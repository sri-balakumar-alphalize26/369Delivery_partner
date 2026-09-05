import { Platform, ViewStyle } from 'react-native';
import { RouteMapView } from './RouteMapView';

/**
 * The job map: where the shop is, where the parcel is going, and where the
 * rider is between them.
 *
 * This replaces `StaticMap`, deleted in b32f0b0 because it could only ever draw
 * its own empty state — every order on res-test1 carries a null latitude and
 * longitude, and nothing geocodes an address. That deletion was right for that
 * component. This one has coordinates to draw because the mock now carries real
 * Muscat ones, and because the rider's own position comes from the phone rather
 * than from Odoo.
 *
 * Stages, as the backend catches up:
 *
 *   - Demo mode today, both pins and the line between them.
 *   - Against the live server, the rider's dot alone until `latitude` and
 *     `longitude` start arriving, at which point the pins appear on their own.
 *
 * This is for orientation, not navigation. The Navigate button still hands the
 * written address to Google Maps, which has traffic and voice and is the app
 * the rider already knows.
 */

/**
 * Whether the map will draw anything at all.
 *
 * The job screen needs this before it renders: with a map it floats the back
 * button over the map, and without one that same button has to sit in normal
 * flow or it lands on top of the sheet.
 *
 * Native only. `react-native-maps` has no web implementation, and the web build
 * exists solely to preview the UI in a browser.
 */
export const MAP_ENABLED = Platform.OS !== 'web';

export function RouteMap(props: {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  shopLatitude?: number | null;
  shopLongitude?: number | null;
  /** Which end of the job the rider is travelling to right now. */
  heading: 'shop' | 'customer';
  height: number;
  style?: ViewStyle;
}) {
  if (!MAP_ENABLED) return null;
  return <RouteMapView {...props} />;
}
