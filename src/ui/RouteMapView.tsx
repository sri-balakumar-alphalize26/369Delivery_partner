import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View, ViewStyle } from 'react-native';
import MapView, { LatLng, Marker, Polyline, Region } from 'react-native-maps';
import { peekServer } from '../api/config';
import { useRiderPosition } from '../hooks/useRiderPosition';
import { coords } from '../lib/format';
import { fetchRoute, Route } from '../lib/route';
import { metresBetween, pointAtDistance, projectOntoLeg, splitAt } from '../lib/routeGeometry';
import { glass, gradius, gshadow } from '../theme/glass';
import { GlassIcon } from './glass/GlassIcon';
import { GlassText } from './glass/GlassText';

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
 *
 * The rider now follows the road rather than cutting across the city. The
 * position is snapped onto the route and moved ALONG it — see
 * `src/lib/routeGeometry.ts` for why that is the trick, rather than animating
 * between raw fixes.
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

/**
 * How far off the line the rider may drift before the route is refetched.
 *
 * Below this it is GPS noise, and snapping is the right answer. Above it they
 * have taken a different road, and the drawn route is describing a journey
 * nobody is making.
 */
const OFF_ROUTE_M = 150;

/** A floor between refetches, because the free ORS tier is 2000 routes a day. */
const REFETCH_COOLDOWN_MS = 30_000;

/** One step per ~33ms. Sixty a second would re-render the map for no visible gain. */
const FRAME_MS = 33;

/** The gap between fixes, and so the time a step has to cover the ground. */
const STEP_MS = 1000;

/** Re-split the polyline every 25 metres rather than every frame. */
const SPLIT_GRAIN_M = 25;

export function RouteMapView({
  latitude,
  longitude,
  shopLatitude,
  shopLongitude,
  heading,
  height,
  style,
  onRoute,
}: {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  shopLatitude?: number | null;
  shopLongitude?: number | null;
  /** Which end of the job the rider is travelling to right now. */
  heading: 'shop' | 'customer';
  height: number;
  style?: ViewStyle;
  /** Real distance and time, once a route is in hand. Null when there is none. */
  onRoute?: (summary: { distanceM: number; durationS: number } | null) => void;
}) {
  const map = useRef<MapView>(null);

  /**
   * Read through the shared guard, never `typeof lat === 'number'` inline. It
   * rejects the `0, 0` pair as well as null — that pair is a real place in the
   * Atlantic, and a map is exactly the consumer that would sail a pin there.
   */
  const customer = useMemo(() => coords(latitude, longitude), [latitude, longitude]);
  const shop = useMemo(() => coords(shopLatitude, shopLongitude), [shopLatitude, shopLongitude]);

  /**
   * A delivery is two journeys. Before the pickup code the rider is going to
   * the shop; after it, to the customer. Drawing shop-to-customer during the
   * first leg points past the rider entirely.
   */
  const target = heading === 'shop' ? shop : customer;
  const behind = heading === 'shop' ? customer : shop;

  const [route, setRoute] = useState<Route | null>(null);
  const [along, setAlong] = useState(0);
  const [following, setFollowing] = useState(true);

  // The route is what the demo rider walks, so it has to be fetched before
  // there is any rider at all — which is why the origin below falls back to the
  // fixed pin rather than waiting for a position.
  const fix = useRiderPosition(route?.leg ?? null);
  const rider = fix?.coordinate ?? null;

  /**
   * The rider only counts if they are plausibly on this job.
   *
   * The position comes from real GPS, so running the demo anywhere but Muscat
   * would draw the line off toward the actual device and frame half a continent.
   */
  const riderIsOnThisJob =
    rider != null && target != null && metresBetween(rider, target) / 1000 <= MAX_RIDER_KM;

  /**
   * The rider, read through a ref rather than as a dependency.
   *
   * A new fix arrives every second. As a dependency it would re-run the fetch
   * effect every second, and every re-run cancels the request the last one made.
   */
  const riderRef = useRef<LatLng | null>(null);
  riderRef.current = riderIsOnThisJob ? rider : null;

  /** Bumped to ask for a fresh route once the rider has left the drawn one. */
  const [refetchTick, setRefetchTick] = useState(0);

  /** Identifies the leg, so a change of destination refetches and a new fix does not. */
  const legKey = target ? `${heading}:${target.latitude},${target.longitude}` : null;

  const lastFetchAt = useRef(0);
  const fetchedFor = useRef<string | null>(null);

  /* ----------------------------------------------------------------- *
   * The route, fetched once per leg.
   *
   * Never per fix: the free tier is about two thousand routes a day, and one
   * request per GPS tick would spend that inside an hour.
   * ----------------------------------------------------------------- */
  useEffect(() => {
    if (!legKey || !target) {
      setRoute(null);
      fetchedFor.current = null;
      return;
    }
    if (fetchedFor.current === legKey) return;

    // Whichever end the rider is at. Before the first fix that is the pin
    // behind them — and on the collection leg the rider is standing near it
    // anyway, so the line is close enough to draw while the drift check below
    // corrects anything worse.
    const origin = riderRef.current ?? behind;
    if (!origin) return;

    fetchedFor.current = legKey;
    lastFetchAt.current = Date.now();

    let alive = true;
    fetchRoute(origin, target, peekServer().orsKey).then((r) => {
      if (alive) setRoute(r);
    });
    return () => {
      alive = false;
    };
  /**
   * Deps are the leg and nothing else.
   *
   * This originally listed `rider` and the two coordinate objects, and that was
   * a bug with no error to show for it: `coords()` returns a fresh object every
   * render, so the effect re-ran constantly, and its cleanup set `alive = false`
   * on the request already in flight. Every response was discarded on arrival
   * while `fetchedFor` stopped another from being made, so no route ever
   * appeared and nothing was logged. `target` and `behind` are memoised above;
   * the rider is read through a ref.
   */
  }, [legKey, target, behind, refetchTick]);

  /** Hand the real distance and time up, so the screen can show an honest ETA. */
  useEffect(() => {
    onRoute?.(route ? { distanceM: route.distanceM, durationS: route.durationS } : null);
  }, [route, onRoute]);

  /* ----------------------------------------------------------------- *
   * Moving the rider.
   *
   * The fix is snapped onto the route and the marker walks from where it was
   * to where the fix says it is. Animating the raw coordinates instead would
   * cut every corner and, on a wobbly fix, drive through buildings.
   * ----------------------------------------------------------------- */
  const alongRef = useRef(0);
  const frame = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Which route `alongRef` is a distance along — see the snap below. */
  const animatedRoute = useRef<Route | null>(null);

  useEffect(() => {
    if (!fix || !route || route.leg.length === 0) return;

    const { along: to, offset } = projectOntoLeg(route.leg, fix.coordinate);

    // Far off the line means a different road, not a bad fix. Allow a refetch,
    // but not more than once every half minute.
    if (offset > OFF_ROUTE_M && Date.now() - lastFetchAt.current > REFETCH_COOLDOWN_MS) {
      fetchedFor.current = null;
      // The fetch effect no longer depends on anything that changes by itself,
      // so it has to be asked.
      setRefetchTick((n) => n + 1);
    }

    /**
     * A distance along one route means nothing on another, so a new route has
     * to snap rather than animate. Without this, swapping routes mid-ride —
     * the leg flipping, or a drift refetch — sent the marker sliding backwards
     * from three kilometres to zero over a second, which reads as the rider
     * driving the whole way in reverse.
     */
    const isNewRoute = animatedRoute.current !== route;
    animatedRoute.current = route;

    const from = isNewRoute ? to : alongRef.current;
    const started = Date.now();

    const step = () => {
      const t = Math.min(1, (Date.now() - started) / STEP_MS);
      const value = from + (to - from) * t;
      alongRef.current = value;
      setAlong(value);
      if (t < 1) frame.current = setTimeout(step, FRAME_MS);
    };
    step();

    return () => {
      if (frame.current) clearTimeout(frame.current);
    };
  }, [fix, route]);

  /**
   * Where to draw the scooter.
   *
   * On the route when there is one, and on the raw fix when there is not — a
   * map with no ORS key still shows a rider, just not one that knows about
   * roads.
   */
  const onRoad = route && route.leg.length > 0 ? pointAtDistance(route.leg, along) : null;
  const riderPoint = onRoad?.coordinate ?? (riderIsOnThisJob ? rider : null);
  const riderBearing = onRoad?.bearing ?? fix?.heading ?? 0;

  /**
   * Split the drawn road at the rider, so ground already covered can fade back.
   *
   * Recomputed every 25 metres rather than every frame: at a few hundred points
   * a route, splitting per frame allocates two fresh arrays thirty times a
   * second for a difference nobody can see.
   */
  const grain = Math.round(along / SPLIT_GRAIN_M);
  const drawn = useMemo(
    () => (route ? splitAt(route.leg, grain * SPLIT_GRAIN_M) : null),
    [route, grain]
  );

  /** With no route, the honest straight line the map drew before. */
  const straight = !route && riderPoint && target ? [riderPoint, target] : null;

  /* ----------------------------------------------------------------- *
   * The camera.
   * ----------------------------------------------------------------- */
  const lastCamera = useRef(0);

  useEffect(() => {
    if (!following || !riderPoint) return;
    const now = Date.now();
    // Throttled hard. Moving the camera on every step fights the animation
    // already running and drains the battery the job depends on.
    if (now - lastCamera.current < 500) return;
    lastCamera.current = now;
    // Centre only, never `heading`: rotating the map turns every street label
    // with it, and the marker already says which way the rider is facing.
    map.current?.animateCamera({ center: riderPoint }, { duration: 500 });
  }, [riderPoint, following]);

  /** Frame both ends of the leg — used before there is a rider to follow. */
  const fitLeg = () => {
    const focus = [riderIsOnThisJob ? rider : behind, target].filter(
      (p): p is LatLng => p != null
    );
    if (focus.length > 1) {
      map.current?.fitToCoordinates(focus, { edgePadding: EDGE_PADDING, animated: true });
    } else if (target) {
      map.current?.animateToRegion({ ...target, latitudeDelta: 0.02, longitudeDelta: 0.02 });
    }
  };

  /**
   * Re-frame when the leg flips, and start following again.
   *
   * `initialRegion` applies once, on mount, so without this the camera stayed
   * on the shop after the pickup code and left the customer pin off-screen.
   */
  useEffect(() => {
    setFollowing(true);
    fitLeg();
    // Only on a change of leg. Following each fix is the camera effect's job.
  }, [heading]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Android snapshots a custom marker's view, and re-snapshotting it on every
   * reposition is the usual cause of a marker that stutters. Track it just long
   * enough for the first paint, then stop.
   *
   * Keyed to the marker appearing rather than the map mounting, which is the
   * bug this replaces: the rider cannot exist until the route has been fetched,
   * several seconds after mount, by which time a timer started at mount had
   * already switched tracking off. The marker was mounted but never drawn — an
   * invisible rider on a working map.
   */
  const hasRider = riderPoint != null;
  const [tracksView, setTracksView] = useState(true);
  useEffect(() => {
    if (!hasRider) return;
    setTracksView(true);
    const t = setTimeout(() => setTracksView(false), 1200);
    return () => clearTimeout(t);
  }, [hasRider]);

  const initialRegion: Region = target
    ? { ...target, latitudeDelta: 0.04, longitudeDelta: 0.04 }
    : FALLBACK;

  return (
    <View style={[{ height, overflow: 'hidden' }, style]}>
      <MapView
        ref={map}
        style={{ flex: 1 }}
        initialRegion={initialRegion}
        onMapReady={fitLeg}
        // Ours is drawn below. The library's blue dot cannot be switched off
        // separately from its position events, so both come from
        // `useRiderPosition` instead.
        showsUserLocation={false}
        /**
         * A rider who moves the map has a reason to be looking somewhere else.
         *
         * `isGesture` rather than `onPanDrag`: on Android that fired for the
         * app's own `animateCamera` too, so following switched itself off a
         * second after it started and the Recentre button appeared without
         * anyone touching the screen.
         */
        onRegionChangeComplete={(_region, details) => {
          if (details?.isGesture) setFollowing(false);
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

        {/* The road already covered, faded back so it does not read as journey
            still to come. */}
        {drawn && drawn.behind.length > 1 ? (
          <Polyline coordinates={drawn.behind} strokeColor={glass.inkFaint} strokeWidth={5} />
        ) : null}

        {drawn && drawn.ahead.length > 1 ? (
          <Polyline
            coordinates={drawn.ahead}
            strokeColor={heading === 'shop' ? glass.indigo : glass.orange}
            strokeWidth={5}
          />
        ) : null}

        {/* No routing service, or none reachable: the straight dashed leg this
            map drew before, still honest about being a direction rather than a
            route. */}
        {straight ? (
          <Polyline
            coordinates={straight}
            strokeColor={heading === 'shop' ? glass.indigo : glass.orange}
            strokeWidth={4}
            lineDashPattern={[8, 6]}
          />
        ) : null}

        {riderPoint ? (
          <Marker
            coordinate={riderPoint}
            anchor={{ x: 0.5, y: 0.5 }}
            // `flat` pins it to the ground so it turns with the map rather than
            // standing up like a pin.
            flat
            rotation={riderBearing}
            tracksViewChanges={tracksView}
            zIndex={10}
          >
            <Rider />
          </Marker>
        ) : null}
      </MapView>

      {/* Only offered once the rider has taken the map somewhere else. */}
      {!following && riderPoint ? (
        <Pressable
          onPress={() => {
            setFollowing(true);
            map.current?.animateCamera({ center: riderPoint }, { duration: 400 });
          }}
          accessibilityRole="button"
          accessibilityLabel="Centre the map on me"
          style={({ pressed }) => [
            {
              position: 'absolute',
              right: 12,
              bottom: 12,
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

/**
 * The rider, as a scooter on a disc rather than the library's blue dot.
 *
 * Rotated by the Marker rather than by a transform here, so the rotation is the
 * map's own and stays correct when the map itself is turned.
 */
function Rider() {
  return (
    <View
      style={{
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: glass.indigo,
        borderWidth: 3,
        borderColor: glass.white,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <GlassIcon name="bike" color={glass.white} size={17} />
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
