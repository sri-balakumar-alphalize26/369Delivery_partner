import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, ViewStyle } from 'react-native';
import MapView, { LatLng, Marker, Polyline, Region } from 'react-native-maps';
import { coords } from '../lib/format';
import { glass } from '../theme/glass';

/**
 * The map itself, kept in its own file so `RouteMap` can decide whether to
 * mount it without importing any map code.
 *
 * `react-native-maps` rather than MapLibre, and the reason is worth recording
 * because it reverses an earlier decision. MapLibre was chosen to avoid Google,
 * which issues no key without a card on the Cloud account. That constraint is
 * real, but it only applies to a store binary: Expo Go bundles this library and
 * needs no key at all, so the map is visible today instead of after a
 * development build nobody has run yet. A standalone Android build will need
 * that key, and the choice then is a card or a return to MapLibre.
 */

/** Muscat, for the moment before any real coordinate is known. */
const FALLBACK: Region = {
  latitude: 23.5975,
  longitude: 58.4187,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

/** Keeps the pins clear of the sheet that overlaps the map's foot. */
const EDGE_PADDING = { top: 64, right: 64, bottom: 96, left: 64 };

/**
 * How far from the job the rider can be and still be treated as on it.
 *
 * Generous on purpose — a long Muscat run is well inside this. It exists to
 * catch the case where the two are not on the same journey at all, which today
 * means a demo running on a device thousands of kilometres from the Muscat
 * fixtures.
 */
const MAX_RIDER_KM = 50;

/** Great-circle distance, near enough for deciding whether two points are the same trip. */
function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function RouteMapView({
  latitude,
  longitude,
  shopLatitude,
  shopLongitude,
  heading,
  height,
  style,
}: {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  shopLatitude?: number | null;
  shopLongitude?: number | null;
  /** Which end of the job the rider is travelling to right now. */
  heading: 'shop' | 'customer';
  height: number;
  style?: ViewStyle;
}) {
  const map = useRef<MapView>(null);
  const [rider, setRider] = useState<LatLng | null>(null);

  /**
   * Whether the rider's own dot can be drawn — CHECKED, never requested.
   *
   * This asked at first, and testing on the tablet showed why it must not: the
   * map mounts with the job screen, so Android's location dialog appeared the
   * instant a rider opened a job, cold and unexplained. That is the prompt the
   * explainer exists to precede, and asking here fired it first and made the
   * explainer pointless.
   *
   * Permission is the tracker's business, requested at /start behind
   * `LocationPrimer`. The map draws the dot if it happens to be granted and
   * quietly does without it otherwise.
   */
  const [canShowRider, setCanShowRider] = useState(false);
  useEffect(() => {
    let alive = true;
    Location.getForegroundPermissionsAsync()
      .then((res) => {
        if (alive) setCanShowRider(res.granted);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Read through the shared guard, never `typeof lat === 'number'` inline. It
   * rejects the `0, 0` pair as well as null — that pair is a real place in the
   * Atlantic, and a map is exactly the consumer that would sail a pin there.
   *
   * `coords()` already returns `{ latitude, longitude }`, which is the shape
   * this library wants everywhere, so nothing needs converting.
   */
  const customer = coords(latitude, longitude);
  const shop = coords(shopLatitude, shopLongitude);

  /**
   * A delivery is two journeys. Before the pickup code the rider is going to
   * the shop; after it, to the customer. Drawing shop-to-customer during the
   * first leg points past the rider entirely, which is what this fixes.
   */
  const target = heading === 'shop' ? shop : customer;
  const behind = heading === 'shop' ? customer : shop;

  /**
   * The rider only counts if they are plausibly on this job.
   *
   * The dot comes from real GPS, so running the demo anywhere but Muscat drew
   * the line off toward the actual device and framed half a continent. Past
   * MAX_RIDER_KM nobody is delivering this parcel, so fall back to drawing the
   * two fixed ends. Costs nothing in production, where the rider is by
   * definition near the job.
   */
  const riderIsOnThisJob =
    rider != null && target != null && distanceKm(rider, target) <= MAX_RIDER_KM;
  const from = riderIsOnThisJob ? rider : behind;
  const leg = from && target ? [from, target] : null;

  /** Frame what matters now: the rider and where they are going, not the pin behind them. */
  const frame = useCallback(() => {
    const focus = [riderIsOnThisJob ? rider : behind, target].filter(
      (p): p is LatLng => p != null
    );
    if (focus.length > 1) {
      map.current?.fitToCoordinates(focus, { edgePadding: EDGE_PADDING, animated: true });
    } else if (target) {
      map.current?.animateToRegion({ ...target, latitudeDelta: 0.02, longitudeDelta: 0.02 });
    }
  }, [rider, riderIsOnThisJob, behind, target]);

  /**
   * Re-frame when the leg flips.
   *
   * `initialRegion` applies once, on mount, so without this the camera stayed
   * on the shop after the pickup code and left the customer pin off-screen
   * with no way to reach it.
   */
  useEffect(() => {
    frame();
    // Only on a change of leg. Following every GPS tick would wrestle the map
    // away from a rider trying to pan it.
  }, [heading]); // eslint-disable-line react-hooks/exhaustive-deps

  const initialRegion: Region = target
    ? { ...target, latitudeDelta: 0.04, longitudeDelta: 0.04 }
    : FALLBACK;

  return (
    <View style={[{ height, overflow: 'hidden' }, style]}>
      <MapView
        ref={map}
        style={{ flex: 1 }}
        initialRegion={initialRegion}
        onMapReady={frame}
        // The rider's own blue dot, drawn by the library from the permission
        // requested above. Deliberately not a second GPS subscription of our
        // own: the tracker in `src/location/tracking.ts` answers to the
        // contract's rules and those are not worth bending for a smoother
        // marker.
        showsUserLocation={canShowRider}
        onUserLocationChange={(e) => {
          const c = e.nativeEvent.coordinate;
          if (!c) return;
          setRider({ latitude: c.latitude, longitude: c.longitude });
        }}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        showsCompass={false}
      >
        {shop ? (
          <Marker coordinate={shop} anchor={{ x: 0.5, y: 1 }} title="Shop">
            <Pin color={glass.indigo} active={heading === 'shop'} />
          </Marker>
        ) : null}

        {customer ? (
          <Marker coordinate={customer} anchor={{ x: 0.5, y: 1 }} title="Customer">
            <Pin color={glass.orange} active={heading === 'customer'} />
          </Marker>
        ) : null}

        {/* Straight, and honest about it. A road-following route needs a
            routing service, which is not in this change. */}
        {leg ? (
          <Polyline
            coordinates={leg}
            strokeColor={heading === 'shop' ? glass.indigo : glass.orange}
            strokeWidth={4}
            lineDashPattern={[8, 6]}
          />
        ) : null}
      </MapView>
    </View>
  );
}

/**
 * A pin, in the job screen's own palette rather than the library's default red.
 * Anchored at its stem, so the tip sits on the place rather than beside it.
 *
 * The pin the rider is heading for is full size and solid; the other fades
 * back. Two identical pins with a line between them do not say which way to
 * drive, which is the whole point of the leg.
 */
function Pin({ color, active }: { color: string; active: boolean }) {
  const size = active ? 26 : 18;

  return (
    <View style={{ alignItems: 'center', opacity: active ? 1 : 0.5 }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          borderWidth: 3,
          borderColor: glass.white,
        }}
      />
      <View style={{ width: 2, height: active ? 10 : 7, backgroundColor: color }} />
    </View>
  );
}
