import { useEffect, useRef, useState } from 'react';
import { Pressable, View, ViewStyle } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useHerePosition } from '../hooks/useHerePosition';
import { fixSharing } from '../location/dutyLocation';
import { glass, gradius, gshadow, gspace } from '../theme/glass';
import { GlassButton } from './glass/GlassButton';
import { GlassIcon } from './glass/GlassIcon';
import { GlassText } from './glass/GlassText';
import { Rider, RiderShadow } from './RouteMapView';

/**
 * The map behind `HereMap`: the rider's own position and nothing else.
 *
 * No route, no pins and no fallback city. The job map opens on Muscat until it
 * knows something, which on a Dubai server put the rider on the wrong
 * continent; this card shows words until there is a real position to centre on.
 */

/** About a kilometre across: streets, not the city. */
const DELTA = 0.01;

export function HereMapView({
  active,
  height,
  style,
}: {
  active: boolean;
  height: number;
  style?: ViewStyle;
}) {
  const { perm, fix, recheck } = useHerePosition(active);
  const map = useRef<MapView>(null);
  const [following, setFollowing] = useState(true);
  const [asking, setAsking] = useState(false);

  const point = fix?.coordinate ?? null;
  const lat = point?.latitude;
  const lng = point?.longitude;

  // Centre only, as on the job map: rotating the map turns every label with it.
  useEffect(() => {
    if (!following || lat == null || lng == null) return;
    map.current?.animateCamera({ center: { latitude: lat, longitude: lng } }, { duration: 500 });
  }, [lat, lng, following]);

  /**
   * Android snapshots a custom marker's view once and reuses the bitmap, so
   * tracking is held until the artwork has decoded, and re-armed when the
   * heading moves a 10° step — the same rule `RouteMapView` follows.
   */
  const [riderDrawn, setRiderDrawn] = useState(false);
  const hasRider = point != null;
  const headingStep = Math.round((fix?.heading ?? 0) / 10);
  const [tracksView, setTracksView] = useState(true);
  useEffect(() => {
    if (!hasRider || !riderDrawn) return;
    setTracksView(true);
    const t = setTimeout(() => setTracksView(false), 350);
    return () => clearTimeout(t);
  }, [hasRider, riderDrawn, headingStep]);

  if (perm.kind === 'denied') {
    const turnOn = async () => {
      setAsking(true);
      try {
        await fixSharing({ kind: 'no_permission', canAsk: perm.canAsk });
      } finally {
        setAsking(false);
        recheck();
      }
    };
    return (
      <View style={[{ alignItems: 'flex-start' }, style]}>
        <GlassText variant="body" tone="soft">
          Turn on location to see where you are.
        </GlassText>
        <GlassButton
          title={perm.canAsk ? 'Turn on location' : 'Open settings'}
          icon="pin"
          kind="ghost"
          size="sm"
          loading={asking}
          onPress={turnOn}
          // The button is built full-width and has no side padding of its own;
          // shrunk to its label here, the text would touch the border.
          style={{ marginTop: gspace.md, paddingHorizontal: gspace.lg }}
        />
      </View>
    );
  }

  if (!point) {
    return (
      <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>
        <GlassIcon name="pin" color={glass.inkSoft} size={16} style={{ marginRight: gspace.sm }} />
        <GlassText variant="body" tone="soft">
          Finding your location…
        </GlassText>
      </View>
    );
  }

  return (
    <View style={[{ height, overflow: 'hidden', borderRadius: gradius.chip }, style]}>
      <MapView
        ref={map}
        style={{ flex: 1 }}
        initialRegion={{ ...point, latitudeDelta: DELTA, longitudeDelta: DELTA }}
        // Our scooter is drawn below; the library's blue dot would be a second rider.
        showsUserLocation={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        showsCompass={false}
        // `isGesture`, not `onPanDrag`: on Android that fires for our own camera moves too.
        onRegionChangeComplete={(_region, details) => {
          if (details?.isGesture) setFollowing(false);
        }}
      >
        <Marker
          coordinate={point}
          anchor={{ x: 0.5, y: 0.5 }}
          flat
          tracksViewChanges={tracksView}
          zIndex={9}
        >
          <RiderShadow />
        </Marker>
        <Marker
          coordinate={point}
          anchor={{ x: 0.5, y: 0.5 }}
          flat
          rotation={fix?.heading ?? 0}
          tracksViewChanges={tracksView}
          zIndex={10}
        >
          <Rider onReady={() => setRiderDrawn(true)} />
        </Marker>
      </MapView>

      {/* Only offered once the rider has moved the map somewhere else. */}
      {!following ? (
        <Pressable
          onPress={() => {
            setFollowing(true);
            map.current?.animateCamera({ center: point }, { duration: 400 });
          }}
          accessibilityRole="button"
          accessibilityLabel="Centre the map on me"
          style={({ pressed }) => [
            {
              position: 'absolute',
              right: 10,
              bottom: 10,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: gradius.pill,
              backgroundColor: glass.white,
              opacity: pressed ? 0.7 : 1,
            },
            gshadow.glass,
          ]}
        >
          <GlassIcon name="compass" color={glass.ink} size={16} />
          <GlassText variant="label" upper style={{ marginLeft: 6 }}>
            Recentre
          </GlassText>
        </Pressable>
      ) : null}
    </View>
  );
}
