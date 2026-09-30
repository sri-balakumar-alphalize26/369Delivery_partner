import { ReactNode } from 'react';
import { View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOnline } from '../../hooks/useOnline';
import { glass, gradius, gshadow, gspace } from '../../theme/glass';
import { GlassIcon } from './GlassIcon';
import { GlassText } from './GlassText';

/**
 * The flat pale ground every screen sits on.
 *
 * It was a blurred gradient mesh, baked into `assets/images/glass-mesh.png`.
 * A wash of colour behind white cards costs contrast exactly where a rider in
 * sunlight has none to spare, so the ground is one flat tone now and the cards
 * carry an outline instead.
 */
/**
 * The offline bar lives here rather than on each screen.
 *
 * Four screens each remembering to show it is four chances to forget, and the
 * one that forgets is the one a rider is looking at when the signal drops.
 *
 * Deliberately distinct from the "cannot reach the server" card: this is the
 * phone, that is Odoo, and the remedies differ. A rider told the wrong one
 * restarts an app that was never at fault.
 */
export function GlassScreen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const online = useOnline();
  const insets = useSafeAreaInsets();

  return (
    <View style={[{ flex: 1, backgroundColor: glass.meshMid }, style]}>
      <View style={{ flex: 1 }}>{children}</View>

      {/* The green band, under the status bar, on every screen. Screens with a
          header band of their own just run into it; the ones without one (an
          offer, the map, Connect) would otherwise put white status icons on a
          pale ground. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: insets.top,
          backgroundColor: glass.band,
        }}
      />

      {/**
       * A card that floats, not a bar glued under the status bar.
       *
       * The bar version sat across the top and covered the greeting, and a
       * warning that permanently eats the head of every screen is a poor trade
       * for something that may last seconds. This lifts off the content near the
       * foot, where a rider's thumb already is, and leaves the screen intact.
       *
       * Not a modal: the condition can persist for a whole tunnel or lift, and
       * something needing dismissal every time would be worse than the fault.
       */}
      {!online ? (
        <View
          style={[
            {
              position: 'absolute',
              left: gspace.xl,
              right: gspace.xl,
              bottom: insets.bottom + gspace.xxxl,
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: glass.ink,
              borderRadius: gradius.chip,
              paddingVertical: gspace.md,
              paddingHorizontal: gspace.lg,
              zIndex: 50,
            },
            gshadow.glass,
          ]}
        >
          <GlassIcon name="bell" color={glass.white} size={18} />
          <View style={{ flex: 1, marginLeft: gspace.md }}>
            <GlassText variant="bodyStrong" tone="white">
              No connection
            </GlassText>
            <GlassText variant="caption" tone="white" style={{ opacity: 0.75 }}>
              Jobs will update when you are back online.
            </GlassText>
          </View>
        </View>
      ) : null}
    </View>
  );
}
