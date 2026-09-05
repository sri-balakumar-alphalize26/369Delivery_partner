import { ViewStyle } from 'react-native';

/**
 * The job map: where the rider is, and where the parcel is going.
 *
 * This replaces `StaticMap`, deleted in b32f0b0 because it could only ever draw
 * its own empty state — every order on res-test1 carries a null latitude and
 * longitude, and nothing geocodes an address. That deletion was right for that
 * component. Its replacement survives the same data, because it draws something
 * the old one never had access to: the rider's own position, which the phone
 * knows regardless of what Odoo sends.
 *
 * So the map reveals itself in stages as the backend catches up, and no stage
 * is a grey rectangle:
 *
 *   - Today, the rider alone. The camera follows them.
 *   - Once the contract's `latitude` and `longitude` arrive, a destination pin
 *     and a line appear, and the camera frames both.
 *
 * MapLibre over Google: Google's map display is genuinely unmetered, but it
 * issues no key until a card sits on the Cloud account, and the requirement
 * here was no payment method anywhere.
 *
 * This file deliberately imports NO map code. MapLibre is a native module and
 * Expo Go ships a fixed set of those, so importing it there takes the whole app
 * down at startup — before anything renders, and whether or not a map was ever
 * wanted. The real component lives in `RouteMapView` and is required lazily
 * below, so Expo Go keeps running until the development build replaces it.
 *
 * This is for orientation, not navigation. `navigateTo` on the job screen still
 * hands the written address to Google Maps, which has traffic and voice and is
 * the app the rider already knows.
 */

/**
 * A MapTiler free-tier style, or any other. Unset in a fresh checkout, and the
 * map is absent rather than a grid of failed tiles.
 */
const STYLE_URL = process.env.EXPO_PUBLIC_MAP_STYLE_URL;

/**
 * Whether `RouteMap` will draw anything at all.
 *
 * The job screen needs this before it renders: with a map it floats the back
 * button over the map, and without one that same button has to sit in normal
 * flow or it lands on top of the sheet.
 */
export const MAP_ENABLED = Boolean(STYLE_URL);

export function RouteMap(props: {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  height: number;
  style?: ViewStyle;
}) {
  if (!STYLE_URL) return null;

  try {
    // Required here, not imported above, so the native module is only reached
    // once we know a map is configured and therefore that this is a build which
    // has one.
    const { RouteMapView } = require('./RouteMapView') as typeof import('./RouteMapView');
    return <RouteMapView {...props} styleUrl={STYLE_URL} />;
  } catch {
    // A build without the native side — Expo Go with a style URL set, most
    // likely — degrades to no map, which is the same outcome as no URL at all.
    // Losing the map is survivable; taking the app down over it is not.
    return null;
  }
}
