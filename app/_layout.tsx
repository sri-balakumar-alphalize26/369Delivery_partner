import {
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/inter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, usePathname, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { glass } from '../src/theme/glass';
import { SplashAnimation } from '../src/ui/SplashAnimation';
import { CameraHost } from '../src/ui/CameraSheet';
import { ConfirmHost } from '../src/ui/ConfirmSheet';
import { OverlayHost } from '../src/ui/OverlayHost';
import * as Notifications from 'expo-notifications';
import { useOfferAlert } from '../src/hooks/useOfferAlert';
import { useDutyLocation } from '../src/location/dutyLocation';
import { useDutyWatch } from '../src/location/useDutyWatch';
import { useOutbox } from '../src/hooks/useOutbox';
import { useSettingsRefresh } from '../src/hooks/useSettingsRefresh';
import { usePush } from '../src/push/usePush';
import { useSession } from '../src/store/session';
import { flushCrashes, installCrashHandler, noteRoute } from '../src/lib/crashReport';
import { registerRingBackgroundHandler } from '../src/push/fullScreenRing';
import { useWidgetSync } from '../src/widget/useWidgetSync';

SplashScreen.preventAutoHideAsync().catch(() => {});

// Errors nothing else caught are kept and sent to the server (crashReport.ts).
installCrashHandler();
// "Not now" on a job ringing with the app in the background (fullScreenRing.ts).
registerRingBackgroundHandler();

// Any screen that throws lands here rather than on a blank page, and is reported.
export { ErrorBoundary } from '../src/ui/CrashScreen';

/**
 * What a push does while the app is already open.
 *
 * Without this a notification arriving in the foreground is swallowed silently,
 * which is exactly when a rider most needs to see a new job. shouldShowAlert is
 * deprecated in SDK 54 — banner and list are now set separately.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Free choice: the splash art is transparent, so nothing has to match it. */
const SPLASH_BG = '#FFFFFF';

/**
 * How long the splash is shown.
 *
 * The clip loops, so it cannot define its own end. 7000ms is one complete pass
 * of the 8.4s clip played at 1.2x (see PLAYBACK_RATE in SplashAnimation): the
 * 1.5s intro plus all six icons. Chosen so the whole sequence is seen, never cut
 * — if the rate changes, this must change with it.
 */
const SPLASH_MIN_MS = 7000;

/**
 * Hard ceiling on the splash.
 *
 * `restore()` calls /auth/me, and `src/api/client.ts` defaults to a 20s request
 * timeout, so a rider with a saved server and no signal would otherwise stare at
 * the splash for twenty seconds before `ready` flips. Enter without the session
 * instead — `Gate` redirects the moment it resolves.
 *
 * Must stay ABOVE SPLASH_MIN_MS: if the ceiling fired first it would cut the
 * animation short, which is the exact problem the 8400ms floor exists to fix.
 */
const SPLASH_MAX_MS = 12000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

/**
 * Sends an unconnected rider to /connect, and keeps a connected one out of it
 * unless they went there deliberately from Profile.
 */
function Gate({ children }: { children: ReactNode }) {
  const ready = useSession((s) => s.ready);
  const connected = useSession((s) => s.connected);
  const segments = useSegments();
  const router = useRouter();

  // Registers the device with Odoo once connected, refreshes the job list the
  // moment a push lands, and opens the job when the banner is tapped.
  usePush(connected);

  // And makes a new offer impossible to miss: the phone buzzes and the offer
  // screen comes up, unless the rider is already inside another job.
  useOfferAlert(connected);

  // The same with the phone locked: while on duty, a foreground service keeps
  // looking for offers and rings the lock screen. Sends no position.
  useDutyWatch(connected);

  // Steps tapped with no signal go by themselves once there is one.
  useOutbox(connected);
  // On a server with the fleet module: where this rider is, for the office's
  // live map, while on duty with the app open.
  useDutyLocation(connected);

  // What the office switches in Delivery Settings reaches an open phone too.
  useSettingsRefresh(connected);

  // The home-screen widget shows duty, today's deliveries and the job in hand.
  useWidgetSync(connected);

  // Crashes kept on the phone go to the server once signed in; each report
  // names the screen it happened on.
  const pathname = usePathname();
  useEffect(() => {
    noteRoute(pathname);
  }, [pathname]);
  useEffect(() => {
    if (connected) void flushCrashes();
  }, [connected]);

  useEffect(() => {
    if (!ready) return;
    if (!connected && segments[0] !== 'connect') router.replace('/connect');
  }, [ready, connected, segments, router]);

  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  const ready = useSession((s) => s.ready);
  const restore = useSession((s) => s.restore);

  const [floorDone, setFloorDone] = useState(false);
  const [ceilingHit, setCeilingHit] = useState(false);
  const [splashGone, setSplashGone] = useState(false);

  useEffect(() => {
    restore();
    const floor = setTimeout(() => setFloorDone(true), SPLASH_MIN_MS);
    const ceiling = setTimeout(() => setCeilingHit(true), SPLASH_MAX_MS);
    return () => {
      clearTimeout(floor);
      clearTimeout(ceiling);
    };
  }, [restore]);

  // Hand off from the native splash the moment our own art is on screen, so the
  // rider never sees a blank frame between the two.
  const handOff = useCallback(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // A font error must not hold the app hostage — fall through to system fonts.
  const appReady = (fontsLoaded || !!fontError) && ready;
  const canExit = (appReady && floorDone) || ceilingHit;

  // The app tree is mounted from the first frame and simply covered, so the
  // router settles and Gate's /connect redirect lands behind the splash. The
  // fade then reveals a screen that is already in its final state.
  return (
    <View style={{ flex: 1, backgroundColor: SPLASH_BG }}>
      <ExpoStatusBar style={splashGone ? 'light' : 'dark'} />

      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <Gate>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: glass.meshMid },
                animation: 'fade',
                // Every screen has the green band under the status bar
                // (GlassScreen draws it), so the clock and battery are white.
                // Said here as well as on ExpoStatusBar above: the native
                // stack sets the bar's style per screen and would otherwise
                // put dark icons back.
                statusBarStyle: 'light',
              }}
            />
          </Gate>
          {/* Popups a screen draws from deep in its content, e.g. the code card. */}
          <OverlayHost />
          {/* The one camera every photo uses, inside the app (see CameraSheet). */}
          <CameraHost />
          {/* The red-and-white "are you sure?" for steps that cannot be undone. */}
          <ConfirmHost />
        </SafeAreaProvider>
      </QueryClientProvider>

      {!splashGone ? (
        <SplashAnimation
          exiting={canExit}
          onExited={() => setSplashGone(true)}
          onPainted={handOff}
        />
      ) : null}
    </View>
  );
}
