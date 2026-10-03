import type { ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { glass, gradius, gspace } from '../theme/glass';

/**
 * What a rider sees when a screen throws, instead of a blank white page.
 *
 * Exported as the root layout's `ErrorBoundary`, so it catches every route.
 * Plain `Text` with the system face on purpose: a crash before the fonts load
 * must not take this screen down with it.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    console.error('[crash] a screen threw:', error);
  }, [error]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: glass.bg,
        justifyContent: 'center',
        padding: gspace.xl,
      }}
    >
      <Text style={{ fontSize: 24, fontWeight: '800', color: glass.ink }}>
        Something went wrong
      </Text>
      <Text style={{ fontSize: 15, color: glass.inkSoft, marginTop: gspace.sm, lineHeight: 22 }}>
        The app hit a problem. Your jobs are safe on the server. Try again, or
        close the app and open it again.
      </Text>

      {/* Renders the screens again, which clears what a render crash left behind. */}
      <Pressable
        onPress={() => void retry()}
        accessibilityRole="button"
        style={({ pressed }) => ({
          marginTop: gspace.xl,
          height: 52,
          borderRadius: gradius.button,
          backgroundColor: glass.btnDark,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text style={{ color: glass.white, fontSize: 15, fontWeight: '700' }}>Try again</Text>
      </Pressable>

      {__DEV__ ? (
        <Text style={{ marginTop: gspace.xl, fontSize: 12, color: glass.inkFaint }} selectable>
          {error.message}
        </Text>
      ) : null}
    </View>
  );
}
