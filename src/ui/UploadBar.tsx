import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReportUpload, useUploads } from '../photos/uploader';
import { glass, gspace } from '../theme/glass';
import { GlassIcon } from './glass/GlassIcon';
import { GlassText } from './glass/GlassText';

/**
 * A small pill at the top while parcel photos go up after Send:
 *
 *   Photos · S00042 · 2 of 4 · 63%      (with a thin bar under it)
 *   Waiting for signal · 2 photos left
 *
 * It takes no taps, so it never stands between the rider and a button, and
 * it is gone once every photo is up. Drawn from the root layout, under the
 * camera and the confirm box.
 */
export function UploadBar() {
  const s = useUploads();
  const report = useReportUpload();
  const top = useSafeAreaInsets().top;
  if (s.phase === 'idle' && report.ref === null) return null;

  // The parcel photos going up come first; a report's photo shows otherwise.
  const ownReport = s.phase !== 'sending' && 'fraction' in report ? report : null;
  const waiting = !ownReport && s.phase === 'waiting';
  const percent = Math.round((ownReport ? ownReport.fraction : s.fraction) * 100);
  const text = ownReport
    ? `Problem photo · ${ownReport.ref} · ${percent}%`
    : waiting
      ? `Waiting for signal · ${s.left} photo${s.left === 1 ? '' : 's'} left`
      : `Photos · ${s.ref} · ${s.index} of ${s.count} · ${percent}%`;

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: top + gspace.xs,
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 500,
        elevation: 500,
      }}
    >
      <View
        accessibilityLiveRegion="polite"
        style={{
          minWidth: 220,
          paddingHorizontal: gspace.md,
          paddingTop: 6,
          paddingBottom: 8,
          borderRadius: 16,
          backgroundColor: waiting ? glass.orange : glass.band,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.25)',
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 6 }}>
          <GlassIcon name={waiting ? 'offline' : 'camera'} size={14} color={glass.white} />
          <GlassText variant="label" tone="white">
            {text}
          </GlassText>
        </View>
        <View
          style={{
            height: 3,
            marginTop: 5,
            borderRadius: 2,
            backgroundColor: 'rgba(255,255,255,0.25)',
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${waiting ? 0 : percent}%`,
              height: '100%',
              backgroundColor: glass.accent,
            }}
          />
        </View>
      </View>
    </View>
  );
}
