import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
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
   * The map draws the rider's own dot, which needs foreground permission. Ask
   * for it here rather than assuming: without it the rider gets a map with no
   * blue dot and no explanation of why.
   *
   * Foreground only. The background permission belongs to the tracker, which
   * asks for it at /start, and the map has no business requesting it early.
   */
  const [canShowRider, setCanShowRider] = useState(false);
  useEffect(() => {
    let alive = true;
    Location.requestForegroundPermissionsAsync()
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

  /** The leg still to travel. Falls back to the pin behind before the first fix. */
  const from = rider ?? behind;
  const leg = from && target ? [from, target] : null;

  /** Frame what matters now: the rider and where they are going, not the pin behind them. */
  function frame() {
    const focus = [rider, target].filter((p): p is LatLng => p != null);
    if (focus.length > 1) {
      map.current?.fitToCoordinates(focus, { edgePadding: EDGE_PADDING, animated: true });
    }
  }

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
