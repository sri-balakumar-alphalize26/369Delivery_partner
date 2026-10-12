import { useEffect } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { stopWaitingOnScreen, useOpeningJob } from '../push/openJob';
import { gspace } from '../theme/glass';
import { paletteFor } from '../theme/workspace';
import { GlassText } from './glass/GlassText';
import { LoadingArt } from './LoadingArt';
import { showToast } from './Toast';

/**
 * "Opening your job…" - over everything while a job tapped from the lock
 * screen or a notification waits for the sign-in to come back. Without it the
 * rider saw the full splash and then Home, and only then the job.
 *
 * Gone the moment the job is on screen (`openJob` clears it). After 15 s it
 * steps aside with a note; the job stays held and still opens by itself.
 */

const GIVE_UP_MS = 15_000;

export function OpeningJobHost() {
  const { job, phase } = useOpeningJob();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (phase !== 'opening') return;
    const t = setTimeout(() => {
      stopWaitingOnScreen();
      showToast('Still signing you back in. Your job opens by itself when that is done.');
    }, GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase !== 'opening' || !job) return null;
  const p = paletteFor(job.kind);
  const what = job.kind === 'service' ? 'Service visit' : 'Delivery';

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Opening your job. ${what}.`}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 55 }}
    >
      <LoadingArt delayMs={0} />
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: insets.bottom + gspace.xxxl,
          alignItems: 'center',
          rowGap: gspace.sm,
          paddingHorizontal: gspace.xl,
        }}
      >
        <View
          style={{
            backgroundColor: p.band,
            borderRadius: 999,
            paddingVertical: 5,
            paddingHorizontal: gspace.md,
          }}
        >
          <GlassText variant="label" style={{ color: p.bandInk }}>
            {what.toUpperCase()}
          </GlassText>
        </View>
        <GlassText variant="title" style={{ textAlign: 'center' }}>
          Opening your job…
        </GlassText>
        <GlassText variant="body" tone="soft" style={{ textAlign: 'center' }}>
          Signing you back in
        </GlassText>
      </View>
    </View>
  );
}
