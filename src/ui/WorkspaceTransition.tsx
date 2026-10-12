import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, useWindowDimensions, View } from 'react-native';
import { create } from 'zustand';
import { WorkLine } from '../api/types';
import { paletteFor } from '../theme/workspace';

/**
 * The colour burst between Delivery and Service: the side being opened grows
 * as a circle of its band colour from where the switch was tapped, until it
 * covers the screen. The side is changed under the cover, then the cover
 * fades and the new side's Home is there.
 *
 * Picked by the user from five options on 2026-10-12 ("Switch Animations"
 * artifact). Skipped when the phone asks for less motion.
 */

export type Point = { x: number; y: number };

type Burst = { to: WorkLine; at: Point | null; onCovered: () => void; seq: number };

const useBurst = create<{ burst: Burst | null }>(() => ({ burst: null }));

const GROW_MS = 300;
const FADE_MS = 180;
/** Lets the new side draw under the cover before it lifts. */
const SETTLE_MS = 60;

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled()
  .then((on) => {
    reduceMotion = on;
  })
  .catch(() => {});
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (on) => {
  reduceMotion = on;
});

let seq = 0;

/**
 * Cover the screen in `to`'s colour from `at` (centre of the screen if not
 * given), then run `onCovered` - the actual switch. Straight to `onCovered`
 * when motion is reduced, or while a burst is already running.
 */
export function burstTo(to: WorkLine, at: Point | null, onCovered: () => void): void {
  if (reduceMotion || useBurst.getState().burst) {
    onCovered();
    return;
  }
  seq += 1;
  useBurst.setState({ burst: { to, at, onCovered, seq } });
}

export function WorkspaceTransitionHost() {
  const burst = useBurst((s) => s.burst);
  const { width, height } = useWindowDimensions();
  const scale = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!burst) return;
    let live = true;
    const done = () => {
      if (live) useBurst.setState({ burst: null });
    };
    scale.setValue(0);
    fade.setValue(1);
    Animated.timing(scale, {
      toValue: 1,
      duration: GROW_MS,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: true,
    }).start(() => {
      try {
        burst.onCovered();
      } finally {
        setTimeout(() => {
          Animated.timing(fade, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(done);
        }, SETTLE_MS);
      }
    });
    return () => {
      live = false;
    };
    // One run per burst.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burst?.seq]);

  if (!burst) return null;
  const x = burst.at?.x ?? width / 2;
  const y = burst.at?.y ?? height / 2;
  // Far enough to reach the corner furthest from where it starts.
  const r = Math.hypot(Math.max(x, width - x), Math.max(y, height - y));

  return (
    // Takes every tap while it runs, so a second switch cannot start under it.
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60, overflow: 'hidden' }}>
      <Animated.View
        style={{
          position: 'absolute',
          left: x - r,
          top: y - r,
          width: r * 2,
          height: r * 2,
          borderRadius: r,
          backgroundColor: paletteFor(burst.to).band,
          opacity: fade,
          transform: [{ scale }],
        }}
      />
    </View>
  );
}
