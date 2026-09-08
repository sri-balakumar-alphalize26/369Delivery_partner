import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
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

/**
 * The rider on screen, in points.
 *
 * Matches the artwork's 132x256 proportions. A scooter seen from above is long
 * and narrow, so this is taller than it is wide — and small enough that it sits
 * on the streets rather than over them.
 */
const RIDER_H = 52;
const RIDER_W = 27;

/**
 * The marker view is square, and that is not cosmetic.
 *
 * Rotating a 27x52 view swings its bounding box to 52x27, and the anchor is
 * resolved against those bounds — so the sprite drifted off the road by up to
 * half the difference, to the left or the right depending on which way it was
 * pointing. A square box has the same bounds at every angle, so the anchor
 * cannot move. The scooter is centred inside it.
 */
const RIDER_BOX = RIDER_H;

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

  // `behind` is only somewhere for the DEMO rider to stand before a route
  // exists — see the hook. The route itself is never fetched from it.
  const fix = useRiderPosition(route?.leg ?? null, behind, target);
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

  /** Whether there is a position at all — a boolean, so it changes once. */
  const riderFound = riderRef.current != null;

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

    /**
     * Only ever from where the rider actually is.
     *
     * This used to fall back to the pin behind them, and on the collection leg
     * that pin is the customer's house — so the map drew twenty kilometres of
     * real road from a door the rider has never been to, and put a distance and
     * an ETA on it. Correct geometry describing a journey nobody was making.
     * With no position there is nothing true to draw, so the pins stand alone
     * until there is.
     */
    const origin = riderRef.current;
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
  /**
   * `riderFound` is in the deps because the origin now comes from the rider: the
   * effect has to run again on the fix that first gives it one, and only that
   * one. The position itself stays behind a ref, or every fix would re-fetch.
   */
  }, [legKey, target, riderFound, refetchTick]);

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

  /**
   * The disc never turns; the cone under it does.
   *
   * A side-view scooter cannot be rotated — heading north or west it lies on its
   * back — so rotating the whole marker was wrong, and mirroring it only ever
   * bought left and right. Seen from above there is no such problem: the cone is
   * a shape with no up or down, so it can point at the exact bearing from the
   * road at every angle. That is the turning, and the rider above it stays
   * upright and legible whichever way the road goes.
   *
   * Two markers rather than one, because they need different rotations — and it
   * keeps the disc's snapshot stable, since only the cone's view changes as the
   * heading changes.
   */
  /** Set once the rider artwork has decoded — see the note on `Rider`. */
  const [riderDrawn, setRiderDrawn] = useState(false);

  /**
   * Heading in coarse buckets, for the snapshot.
   *
   * Android captures a custom marker's view once and reuses that bitmap, and the
   * rotated sprite IS the view — so without re-arming, the rider keeps pointing
   * whichever way he faced when first drawn. That is exactly the complaint this
   * artwork was fetched to answer, so it would be a poor place to reintroduce it.
   *
   * Bucketed at 10 degrees rather than driven by the raw bearing: recapturing on
   * every degree of a sweeping turn would snapshot the view thirty times a
   * second, which is what `tracksViewChanges` exists to avoid.
   */
  const headingStep = Math.round(riderBearing / 10);

  const [tracksView, setTracksView] = useState(true);
  useEffect(() => {
    // Snapshotting before the image has decoded is how a marker ends up frozen
    // as an empty view, so this waits for the artwork rather than for a clock.
    if (!hasRider || !riderDrawn) return;
    setTracksView(true);
    const t = setTimeout(() => setTracksView(false), 350);
    return () => clearTimeout(t);
  }, [hasRider, riderDrawn, headingStep]);

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

        {/* The shadow first, under everything, unrotated — a blob on the road
            does not need to know which way the scooter faces. */}
        {riderPoint ? (
          <Marker
            coordinate={riderPoint}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            tracksViewChanges={tracksView}
            zIndex={9}
          >
            <RiderShadow />
          </Marker>
        ) : null}

        {/* Centred and turned to the road. Seen from above there is no foot to
            stand on the tarmac — the whole sprite sits over the route point. */}
        {riderPoint ? (
          <Marker
            coordinate={riderPoint}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            rotation={riderBearing}
            tracksViewChanges={tracksView}
            zIndex={10}
          >
            <Rider onReady={() => setRiderDrawn(true)} />
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
/**
 * The rider, as a delivery rider rather than a dot.
 *
 * This was a solid navy disc with a small white bicycle glyph, which at map
 * scale read as a black blob with something indistinct inside — measured off a
 * screenshot as rgb(27,42,74) edge to edge, the glyph carrying no meaning at
 * 20px. Inverted: a white disc reads as an object sitting ON the map instead of
 * a hole punched in it, and the rider inside is legible because it is drawn dark
 * on light and given room.
 *
 * `delivery-dining` is a rider on a scooter with a delivery box, which is the
 * shape Flipkart Minutes, JioMart and Blinkit all use.
 *
 * Nothing in here animates, and nothing can: Android snapshots a custom marker
 * view once and reuses the bitmap as it moves, which is what made this marker
 * invisible entirely on the first attempt. The movement a rider reads is the
 * marker gliding along the road, which is the same thing those apps do.
 */
/**
 * The rider, seen from above and always the right way up.
 *
 * This was a solid navy disc with a small white bicycle glyph, which at map
 * scale read as a black blob with something indistinct inside — measured off a
 * screenshot as rgb(27,42,74) edge to edge, the glyph carrying no meaning at
 * 20px. Inverted: a white disc reads as an object sitting ON the map rather than
 * a hole punched in it, and the rider inside is legible because it is dark on
 * light and given room.
 *
 * It never rotates. Direction is the cone's job, and a scooter drawn from the
 * side cannot be turned to face north without lying on its back.
 *
 * Nothing in here animates, and nothing can: Android snapshots a custom marker
 * view once and reuses the bitmap as it moves, which is what made this marker
 * invisible entirely on the first attempt. The movement a rider reads is the
 * marker gliding along the road, which is what the real apps do too.
 */
/**
 * The rider: the supplied 3D artwork, standing on the road.
 *
 * A vector glyph was never going to be this. What came before was a navy disc
 * with a bicycle in it, then a white disc with a scooter glyph — flat, mono, and
 * unmistakably an icon. This is a render, so it reads as a render.
 *
 * No disc behind it. A plate under a 3D figure makes it look like a sticker
 * pressed onto the map; the artwork carries itself.
 *
 * Anchored at its foot by the Marker, so the wheels land on the snapped route
 * point rather than the middle of the rider's back.
 *
 * `onLoad` matters more than it looks. `expo-image` decodes asynchronously, and
 * Android snapshots this view once and then reuses the bitmap — so releasing the
 * snapshot before the image arrives freezes an empty marker forever. That is
 * exactly how the font produced an empty white circle. Tracking is held until
 * this fires.
 */
function Rider({ onReady }: { onReady: () => void }) {
  return (
    /**
     * A wrapper of a known size.
     *
     * Android measures the marker view to work out where the anchor sits, and a
     * measurement taken before the image has sized itself puts the sprite beside
     * the point rather than on it. Fixing the box removes the guess.
     */
    <View
      style={{
        width: RIDER_BOX,
        height: RIDER_BOX,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
    <Image
      source={require('../../assets/images/rider-top.png')}
      style={{ width: RIDER_W, height: RIDER_H }}
      contentFit="contain"
      // Nothing to fade: a marker snapshot would capture the middle of it.
      transition={0}
      onLoad={onReady}
    />
    </View>
  );
}

/**
 * The shadow the scooter casts on the road.
 *
 * Grounds it: without one a top-down sprite floats above the map rather than
 * riding on it. Its own marker, centred on the route point, so it also shows
 * exactly where the line believes the rider is.
 */
function RiderShadow() {
  return (
    <View
      style={{
        width: RIDER_BOX,
        height: RIDER_BOX,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: RIDER_W * 0.7,
          height: RIDER_H * 0.62,
          borderRadius: RIDER_W,
          backgroundColor: 'rgba(15,23,42,0.22)',
        }}
      />
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
