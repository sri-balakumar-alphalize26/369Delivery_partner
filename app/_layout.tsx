import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
  useFonts,
} from '@expo-google-fonts/archivo';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { ReactNode, useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { color } from '../src/theme/tokens';
import { SplashArt } from '../src/ui/SplashArt';
import { useSession } from '../src/store/session';

SplashScreen.preventAutoHideAsync().catch(() => {});

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

  useEffect(() => {
    if (!ready) return;
    if (!connected && segments[0] !== 'connect') router.replace('/connect');
  }, [ready, connected, segments, router]);

  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
  });

  const ready = useSession((s) => s.ready);
  const restore = useSession((s) => s.restore);

  // Hold the brand splash briefly even on a fast start, so it registers as
  // branding rather than flashing past as a glitch.
  const [minTimeDone, setMinTimeDone] = useState(false);

  useEffect(() => {
    restore();
    const t = setTimeout(() => setMinTimeDone(true), 1200);
    return () => clearTimeout(t);
  }, [restore]);

  // Hand off from the native splash the moment we can paint our own, so the
  // rider never sees a blank frame between the two.
  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#F3F7FE' }} />;
  }

  if (!ready || !minTimeDone) {
    return <SplashArt />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <ExpoStatusBar style="light" />
        <Gate>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: color.bg },
              animation: 'fade',
            }}
          />
        </Gate>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
