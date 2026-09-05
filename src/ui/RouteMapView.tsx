import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
  UserLocation,
  useCurrentPosition,
} from '@maplibre/maplibre-react-native';
import { View, ViewStyle } from 'react-native';
import { coords } from '../lib/format';
import { glass } from '../theme/glass';

/**
 * The map itself. Split out from `RouteMap` for one reason: this file imports
 * MapLibre, which is a native module.
 *
 * Expo Go ships a fixed set of native modules and MapLibre is not among them,
 * so merely importing it there takes the whole app down at startup. `RouteMap`
 * therefore requires this file lazily, and only once it knows a map is
 * configured. Nothing outside `RouteMap` should import this module.
 */

/** Metres the rider must move before the position updates. Smooth, not chatty. */
const MIN_DISPLACEMENT_M = 5;

/** Zoom used when the rider is the only thing on the map. */
const SOLO_ZOOM = 15;

export function RouteMapView({
  latitude,
  longitude,
  height,
  styleUrl,
  style,
}: {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  height: number;
  styleUrl: string;
  style?: ViewStyle;
}) {
  /**
   * Read through the shared guard, never `typeof lat === 'number'` inline. It
   * rejects the `0, 0` pair as well as null — that pair is a real place in the
   * Atlantic, and a map is exactly the consumer that would sail a pin there.
   */
  const destination = coords(latitude, longitude);

  /**
   * The rider's own position, from MapLibre's location manager.
   *
   * Deliberately NOT the background task in `src/location/tracking.ts`. That
   * one answers to the contract — start only on the `/start` response, one fix
   * per 20 seconds, stop the moment the server says stop — and those rules are
   * not ours to relax for a smoother-looking marker. This subscription is
   * foreground-only, lives as long as this screen, and never posts anywhere.
   */
  const rider = useCurrentPosition({ minDisplacement: MIN_DISPLACEMENT_M });

  const riderPoint: [number, number] | null = rider
    ? [rider.coords.longitude, rider.coords.latitude]
    : null;
  const destinationPoint: [number, number] | null = destination
    ? [destination.longitude, destination.latitude]
    : null;

  // Both ends known: frame them together. Otherwise let the camera follow the
  // rider, which is every job today.
  const bothEnds = riderPoint && destinationPoint;

  return (
    <View style={[{ height, overflow: 'hidden' }, style]}>
      <Map
        style={{ flex: 1 }}
        mapStyle={styleUrl}
        logo={false}
        compass={false}
        scaleBar={false}
        attribution
        attributionPosition={{ bottom: 8, right: 8 }}
      >
        {bothEnds ? (
          <Camera
            bounds={[
              Math.min(riderPoint[0], destinationPoint[0]),
              Math.min(riderPoint[1], destinationPoint[1]),
              Math.max(riderPoint[0], destinationPoint[0]),
              Math.max(riderPoint[1], destinationPoint[1]),
            ]}
            // Keep both pins clear of the sheet that overlaps the map's foot.
            padding={{ top: 64, right: 64, bottom: 96, left: 64 }}
            duration={600}
          />
        ) : (
          <Camera
            trackUserLocation="default"
            initialViewState={{ zoom: SOLO_ZOOM }}
            duration={600}
          />
        )}

        <UserLocation animated minDisplacement={MIN_DISPLACEMENT_M} />

        {destinationPoint ? (
          <Marker lngLat={destinationPoint} anchor="bottom">
            <DestinationPin />
          </Marker>
        ) : null}

        {bothEnds ? (
          <GeoJSONSource
            id="route"
            data={{
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: [riderPoint, destinationPoint],
              },
            }}
          >
            {/* Straight, and honest about it. A road-following route needs a
                routing service, which is stage three and the first thing here
                that would cost money. */}
            <Layer
              id="route-line"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{
                'line-color': glass.indigo,
                'line-width': 4,
                'line-opacity': 0.75,
                'line-dasharray': [2, 1.5],
              }}
            />
          </GeoJSONSource>
        ) : null}
      </Map>
    </View>
  );
}

/**
 * The customer's pin, in the job screen's own palette rather than the map
 * library's default. Anchored at its point, so the tip sits on the address.
 */
function DestinationPin() {
  return (
    <View style={{ alignItems: 'center' }}>
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: glass.orange,
          borderWidth: 3,
          borderColor: glass.white,
        }}
      />
      <View style={{ width: 2, height: 10, backgroundColor: glass.orange }} />
    </View>
  );
}
