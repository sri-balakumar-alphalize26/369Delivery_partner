import { VideoView, useVideoPlayer } from 'expo-video';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { gspace } from '../theme/glass';
import { GlassText } from './glass/GlassText';

/** The LOOP export: the icon cycle with the splash's 1.5s intro stripped off. */
const SOURCE = require('../../assets/videos/loader.mp4');

/** The clip is full-range, so its white is genuinely #FFFFFF and this matches. */
const LOADER_BG = '#FFFFFF';

type Props = {
  label?: string;
  /**
   * Hold off until the wait has been long enough to be worth animating. Most
   * calls resolve inside this, and a full-screen animation that flashes for
   * 400ms is worse than the text it replaced.
   */
  delayMs?: number;
};

/**
 * The looping brand loader.
 *
 * Deliberately not the default loading state. It is for blocking, route-level
 * waits — opening a job, connecting to a server. ActivityIndicator stays inside
 * buttons, and plain text stays on polling paths like the orders list, where a
 * looping animation would strobe on every refetch.
 */
export function LoadingArt({ label, delayMs = 500 }: Props) {
  const [show, setShow] = useState(delayMs === 0);

  useEffect(() => {
    if (delayMs === 0) return;
    const t = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);

  // The player lives in a child so the delay avoids allocating a native player
  // and a hardware decoder at all — useVideoPlayer cannot be skipped
  // conditionally, but the component that owns it can be.
  if (!show) return <View style={{ flex: 1, backgroundColor: LOADER_BG }} />;

  return <LoadingArtVideo label={label} />;
}

function LoadingArtVideo({ label }: { label?: string }) {
  const player = useVideoPlayer(SOURCE, (p) => {
    p.loop = true;
    p.muted = true;
    p.audioMixingMode = 'mixWithOthers';
    p.play();
  });

  return (
    <View style={{ flex: 1, backgroundColor: LOADER_BG }}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls={false}
        allowsFullscreen={false}
        surfaceType="textureView"
      />

      {label ? (
        <GlassText
          variant="label"
          tone="soft"
          upper
          style={{ position: 'absolute', bottom: gspace.xxxl, alignSelf: 'center' }}
        >
          {label}
        </GlassText>
      ) : null}
    </View>
  );
}
