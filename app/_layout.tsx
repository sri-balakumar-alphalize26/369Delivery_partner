import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  Poppins_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/poppins';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { glass } from '../src/theme/glass';
import { SplashAnimation } from '../src/ui/SplashAnimation';
import * as Notifications from 'expo-notifications';
import { useOfferAlert } from '../src/hooks/useOfferAlert';
import { usePush } from '../src/push/usePush';
import { useSession } from '../src/store/session';

SplashScreen.preventAutoHideAsync().catch(() => {});

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

  useEffect(() => {
    if (!ready) return;
    if (!connected && segments[0] !== 'connect') router.replace('/connect');
  }, [ready, connected, segments, router]);

  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_800ExtraBold,
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
              }}
            />
          </Gate>
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
