import { router, type ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { reportCrash } from '../lib/crashReport';
import { glass, gradius, gspace } from '../theme/glass';

/**
 * What a rider sees when a screen throws, instead of a blank white page.
 *
 * Exported as the root layout's `ErrorBoundary`, so it catches every route.
 * Plain `Text` with the system face and no icon font on purpose: a crash
 * before the fonts load must not take this screen down with it.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const insets = useSafeAreaInsets();
  useEffect(() => {
    console.error('[crash] a screen threw:', error);
    // Kept on the phone and sent to the office's server (crashReport.ts).
    void reportCrash(error, 'screen');
  }, [error]);

  const home = () => {
    try {
      router.replace('/');
    } catch {
      void retry();
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: glass.bg }}>
      {/* The same green band every screen has, so this still looks like the app. */}
      <View style={{ height: insets.top + 120, backgroundColor: glass.band }} />

      <View
        style={{
          marginTop: -64,
          marginHorizontal: gspace.xl,
          padding: gspace.xl,
          borderRadius: gradius.card,
          backgroundColor: glass.white,
          borderWidth: 1,
          borderColor: glass.border,
          alignItems: 'center',
          width: '100%',
          maxWidth: 520,
          alignSelf: 'center',
        }}
      >
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: glass.orangeSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 32, fontWeight: '800', color: glass.orange }}>!</Text>
        </View>

        <Text
          style={{
            fontSize: 22,
            fontWeight: '800',
            color: glass.ink,
            marginTop: gspace.lg,
            textAlign: 'center',
          }}
        >
          Something went wrong
        </Text>
        <Text
          style={{
            fontSize: 15,
            color: glass.inkSoft,
            marginTop: gspace.sm,
            lineHeight: 22,
            textAlign: 'center',
          }}
        >
          This screen hit a problem. Your jobs and photos are safe. Try again, or go back to your
          jobs.
        </Text>

        {/* Renders the screens again, which clears what a render crash left behind. */}
        <Pressable
          onPress={() => void retry()}
          accessibilityRole="button"
          style={({ pressed }) => ({
            marginTop: gspace.xl,
            height: 52,
            alignSelf: 'stretch',
            borderRadius: gradius.button,
            backgroundColor: glass.accent,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ color: glass.accentInk, fontSize: 16, fontWeight: '700' }}>Try again</Text>
        </Pressable>
        <Pressable
          onPress={home}
          accessibilityRole="button"
          style={({ pressed }) => ({
            marginTop: gspace.md,
            height: 52,
            alignSelf: 'stretch',
            borderRadius: gradius.button,
            borderWidth: 1,
            borderColor: glass.border,
            backgroundColor: glass.white,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ color: glass.ink, fontSize: 16, fontWeight: '700' }}>Go to my jobs</Text>
        </Pressable>

        {/* For the developer only; a rider's build never shows it. */}
        {__DEV__ ? (
          <Text
            selectable
            style={{
              marginTop: gspace.lg,
              alignSelf: 'stretch',
              padding: gspace.md,
              borderRadius: gradius.chip,
              backgroundColor: glass.fill,
              fontSize: 12,
              color: glass.inkFaint,
            }}
          >
            {error.message}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
