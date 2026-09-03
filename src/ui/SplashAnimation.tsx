import { useEventListener } from 'expo';
import { VideoView, useVideoPlayer, type VideoPlayerStatus } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';

const SOURCE = require('../../assets/videos/splash.mp4');

/**
 * The clip is encoded full range (0-255), so its white really is #FFFFFF and
 * this matches it. Limited-range H.264 stores white as luma 235 and Android
 * often fails to expand it, drawing #EBEBEB — which is what previously showed
 * as a grey rectangle against this ground.
 */
const SPLASH_BG = '#FFFFFF';

/**
 * The clip's own pixel dimensions. The box is sized to this exact aspect so
 * 'contain' fits edge to edge with zero letterboxing — otherwise the dead area
 * inside the VideoView is painted with the view's background.
 */
const SRC_W = 1080;
const SRC_H = 2340;

/** Fraction of the screen the animation occupies, centred on the white ground. */
const ANIM_SCALE = 0.6;

/**
 * Slightly quicker than authored, to trim the splash without a re-export.
 *
 * 1.2 is a ceiling, not a preference: the clip holds each icon 1.15s, and a
 * 0.85s variant was rejected on 3 Sep. 1.35x would land exactly on that rejected
 * pace, so this is the most that can be taken without reopening the decision.
 * At 1.2x each icon holds 0.96s and the full pass runs ~7.0s instead of 8.4s.
 *
 * SPLASH_MIN_MS in _layout is divided by this, so the floor stays equal to one
 * complete pass and nothing is cut.
 */
const PLAYBACK_RATE = 1.2;

/** Cover lifting off the video once a frame exists. */
const REVEAL_MS = 220;
/** Cover coming back over the video before it is torn down. */
const CONCEAL_MS = 160;
/** Long enough to read as a decision, short enough not to be a wait. */
const EXIT_MS = 320;

/**
 * readyToPlay means "can start", not "a frame is on screen". Lifting the cover
 * on it immediately can expose an empty surface. onFirstFrameRender is exact and
 * lifts at once; this only delays the less precise path.
 */
const READY_GRACE_MS = 120;

/** Hand off from the native splash by now regardless. */
const PAINT_FALLBACK_MS = 900;

/**
 * Lift the cover by now whatever the player has said.
 *
 * Without this the splash is a blank white screen for its whole duration if
 * neither onFirstFrameRender nor readyToPlay arrives — which is exactly what
 * happened when the cover was gated on those alone.
 *
 * This is safe now in a way it was NOT before: the black box came from alpha
 * blending a TextureView, and the video is pinned at opacity 1 for its entire
 * life. Revealing it early can no longer produce that artefact — the worst case
 * is a frame or two of the clip's own white.
 */
const REVEAL_FALLBACK_MS = 1200;

type Props = {
  /** Flip true once the app underneath is ready to be revealed. */
  exiting?: boolean;
  /** Fires when the exit fade finishes — the caller unmounts us, releasing the player. */
  onExited?: () => void;
  /**
   * Fires once something of ours is on screen: first frame, readyToPlay, an
   * error, or the fallback timer. The caller hides the native splash on this.
   */
  onPainted?: () => void;
};

/**
 * The animation screen, shown after the native logo splash.
 *
 * The clip runs 1.5s of intro then six icons at 1.15s each, and plays through
 * once in full at its designed pace — the timing in _layout is set to its
 * length, so nothing is ever cut and nothing is sped up.
 *
 * ---------------------------------------------------------------------------
 * The one rule this file exists to enforce:
 *
 *   NEVER ANIMATE ALPHA ON, OR ABOVE, A VideoView.
 *
 * Android promotes a view containing a TextureView into a hardware layer whose
 * backing is opaque black. An opacity of `a` therefore renders the video over
 * BLACK at `a`, not over the white ground behind it — which showed up on device
 * as a dark rectangle with the logo faintly visible through it. Fading the video
 * in, fading it out, and fading any ancestor all caused it.
 *
 * So the video sits at opacity 1 for its entire life, and an opaque white COVER
 * above it is animated instead. A plain View alpha-animates correctly. The
 * visual result is identical; the black box is structurally impossible.
 *
 * surfaceType="textureView" stays, and is load-bearing: the default SurfaceView
 * punches through the view hierarchy and ignores parent opacity entirely, so
 * none of this would work with it.
 * ---------------------------------------------------------------------------
 */
export function SplashAnimation({ exiting = false, onExited, onPainted }: Props) {
  const { width, height } = useWindowDimensions();

  // Fit the clip's aspect inside ANIM_SCALE of the screen on both axes, so the
  // box IS the video and there is no dead area to paint.
  const boxW = Math.min(width * ANIM_SCALE, ((height * ANIM_SCALE) / SRC_H) * SRC_W);
  const boxH = (boxW / SRC_W) * SRC_H;

  const player = useVideoPlayer(SOURCE, (p) => {
    // If the app is still starting after the full pass, keep cycling rather
    // than freezing on a last frame.
    p.loop = true;
    // The file carries no audio track, but silence in the container is not the
    // same as silence in the audio session — both platforms may still take
    // focus and duck the rider's music.
    p.muted = true;
    p.audioMixingMode = 'mixWithOthers';
    p.playbackRate = PLAYBACK_RATE;
    p.play();
  });

  /** Opaque white over the video. 1 = hidden, 0 = showing. Never the video's own alpha. */
  const coverOpacity = useRef(new Animated.Value(1)).current;
  const rootOpacity = useRef(new Animated.Value(1)).current;

  // Dropped before the root fades, so the surface is torn down covered and no
  // TextureView is present while an ancestor animates alpha.
  const [videoMounted, setVideoMounted] = useState(true);

  const painted = useRef(false);
  const revealed = useRef(false);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notePainted = useCallback(() => {
    if (painted.current) return;
    painted.current = true;
    onPainted?.();
  }, [onPainted]);

  const reveal = useCallback(() => {
    notePainted();
    if (revealed.current) return;
    revealed.current = true;
    Animated.timing(coverOpacity, {
      toValue: 0,
      duration: REVEAL_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [notePainted, coverOpacity]);

  // onFirstFrameRender is not emitted reliably on every Android OEM, so accept
  // readyToPlay too — but only after a grace, since it fires before a frame
  // exists. An error counts as painted: the white ground is showing.
  const onStatus = useCallback(
    ({ status }: { status: VideoPlayerStatus }) => {
      if (status === 'readyToPlay' && graceTimer.current === null) {
        graceTimer.current = setTimeout(reveal, READY_GRACE_MS);
      }
      if (status === 'error') notePainted();
    },
    [reveal, notePainted],
  );

  useEventListener(player, 'statusChange', onStatus);

  useEffect(
    () => () => {
      if (graceTimer.current !== null) clearTimeout(graceTimer.current);
    },
    [],
  );

  useEffect(() => {
    const paint = setTimeout(notePainted, PAINT_FALLBACK_MS);
    const show = setTimeout(reveal, REVEAL_FALLBACK_MS);
    return () => {
      clearTimeout(paint);
      clearTimeout(show);
    };
  }, [notePainted, reveal]);

  useEffect(() => {
    if (!exiting) return;
    // 1. Cover the video while it is still at full opacity.
    Animated.timing(coverOpacity, {
      toValue: 1,
      duration: CONCEAL_MS,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      // 2. Drop the surface while it is hidden behind opaque white.
      setVideoMounted(false);
      // 3. Only now fade the root — by here there is no TextureView in the
      //    tree, so this is an ordinary view fade.
      Animated.timing(rootOpacity, {
        toValue: 0,
        duration: EXIT_MS,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(() => onExited?.());
    });
  }, [exiting, onExited, rootOpacity, coverOpacity]);

  return (
    <Animated.View
      // Let taps through to the real UI the moment the exit starts, rather than
      // swallowing them for the length of the fade.
      pointerEvents={exiting ? 'none' : 'auto'}
      // zIndex alone orders this above the app tree. `elevation` is deliberately
      // absent: on Android it forces its own compositing layer, which is exactly
      // the kind of thing that misbehaves around a TextureView.
      style={[StyleSheet.absoluteFill, { zIndex: 10, opacity: rootOpacity }]}
    >
      <View style={[StyleSheet.absoluteFill, { backgroundColor: SPLASH_BG }]} />

      <View style={[StyleSheet.absoluteFill, styles.centre]}>
        <View style={{ width: boxW, height: boxH }}>
          {videoMounted ? (
            <VideoView
              player={player}
              // No opacity here or on any ancestor while mounted — see the rule
              // in the docblock. White behind the surface so an empty texture
              // reads as white rather than the platform default.
              style={[StyleSheet.absoluteFill, { backgroundColor: SPLASH_BG }]}
              contentFit="contain"
              nativeControls={false}
              allowsFullscreen={false}
              surfaceType="textureView"
              onFirstFrameRender={reveal}
            />
          ) : null}

          {/* The animated element: an opaque white cover, not the video. */}
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: SPLASH_BG, opacity: coverOpacity },
            ]}
          />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  centre: { alignItems: 'center', justifyContent: 'center' },
});
