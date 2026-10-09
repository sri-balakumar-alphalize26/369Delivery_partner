import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { glass, gradius, gspace } from '../theme/glass';
import { GlassText } from './glass/GlassText';

/**
 * A short line over the top of the screen that goes by itself - "Switched to
 * Service" when an alert opened the other side. Nothing to tap, nothing to
 * dismiss: it says what just happened and leaves.
 */

const useToast = create<{ text: string | null; seq: number }>(() => ({ text: null, seq: 0 }));

export function showToast(text: string) {
  useToast.setState((s) => ({ text, seq: s.seq + 1 }));
}

const SHOW_MS = 2200;

export function ToastHost() {
  const { text, seq } = useToast();
  const insets = useSafeAreaInsets();
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!text) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    const t = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: 220, useNativeDriver: true }).start(() =>
        useToast.setState({ text: null })
      );
    }, SHOW_MS);
    return () => clearTimeout(t);
  }, [seq, text, fade]);

  if (!text) return null;
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, right: 0, top: insets.top + gspace.sm, alignItems: 'center', zIndex: 100 }}
    >
      <Animated.View
        accessibilityLiveRegion="polite"
        style={{
          opacity: fade,
          backgroundColor: glass.ink,
          borderRadius: gradius.chip,
          paddingVertical: gspace.sm,
          paddingHorizontal: gspace.lg,
          maxWidth: '90%',
        }}
      >
        <GlassText variant="bodyStrong" tone="white">
          {text}
        </GlassText>
      </Animated.View>
    </View>
  );
}
