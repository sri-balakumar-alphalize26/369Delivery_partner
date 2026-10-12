import { useEffect, useState } from 'react';
import { openJob } from '../push/openJob';
import { Pressable, View } from 'react-native';
import { isServicePreview } from '../api/service';
import { WorkLine } from '../api/types';
import { useWorkload } from '../hooks/useWorkload';
import { introSeen, markIntroSeen } from '../lib/workspace';
import { useSession } from '../store/session';
import { glass, gradius, gspace } from '../theme/glass';
import { paletteFor, WORKSPACE_LABEL } from '../theme/workspace';
import { GlassCard } from './glass/GlassCard';
import { GlassIcon } from './glass/GlassIcon';
import { GlassText } from './glass/GlassText';
import { switchTo } from './WorkspaceSheet';

/**
 * The small pieces both Homes share for someone who works in both lines:
 * the one-time intro, the status pill on the band, and the "paused" card.
 */

/** "You work in Delivery and Service" - once, the first time a hybrid agent is in. */
export function WorkspaceIntro() {
  const hybrid = useSession((s) => s.lines.length > 1);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!hybrid) return;
    let live = true;
    introSeen().then((seen) => live && setShow(!seen));
    return () => {
      live = false;
    };
  }, [hybrid]);
  if (!hybrid || !show) return null;
  return (
    <GlassCard
      style={{ marginTop: gspace.lg, backgroundColor: glass.orangeSoft, borderColor: glass.orangeLine }}
    >
      <GlassText variant="subtitle">You work in Delivery and Service</GlassText>
      <GlassText variant="body" tone="soft" style={{ marginTop: gspace.xs }}>
        Switch any time from your name at the top. No second sign-in.
      </GlassText>
      <Pressable
        onPress={() => {
          setShow(false);
          void markIntroSeen();
        }}
        accessibilityRole="button"
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          marginTop: gspace.md,
          backgroundColor: glass.orange,
          borderRadius: gradius.button,
          paddingVertical: gspace.sm,
          paddingHorizontal: gspace.lg,
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <GlassText variant="bodyStrong" tone="white">
          Got it
        </GlassText>
      </Pressable>
    </GlassCard>
  );
}

/**
 * ONLINE, BUSY · DELIVERY or BUSY · SERVICE, on the band next to the chip.
 * Only for a hybrid agent: busy means something only when there is another
 * line to be busy for.
 */
export function BusyPill({ onDuty }: { onDuty: boolean }) {
  const hybrid = useSession((s) => s.lines.length > 1);
  const { busy } = useWorkload();
  if (!hybrid) return null;
  const label = !onDuty
    ? 'OFF DUTY'
    : busy === 'none'
      ? 'ONLINE'
      : `BUSY · ${WORKSPACE_LABEL[busy].toUpperCase()}`;
  const bg = !onDuty ? 'rgba(255,255,255,0.18)' : busy === 'none' ? glass.greenSoft : glass.white;
  const fg = !onDuty ? glass.white : busy === 'none' ? glass.green : paletteFor(busy as WorkLine).band;
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        marginTop: gspace.xs,
        paddingVertical: 4,
        paddingHorizontal: gspace.sm,
        borderRadius: 999,
        backgroundColor: bg,
      }}
    >
      <GlassText variant="label" style={{ color: fg }}>
        {label}
      </GlassText>
    </View>
  );
}

/**
 * On the Service side of a test rider's preview: the jobs are samples, so
 * nobody mistakes them for real bookings.
 */
export function ServicePreviewNote() {
  if (!isServicePreview()) return null;
  return (
    <GlassCard
      style={{ marginTop: gspace.lg, backgroundColor: glass.orangeSoft, borderColor: glass.orangeLine }}
    >
      <GlassText variant="bodyStrong">Sample service jobs</GlassText>
      <GlassText variant="body" tone="soft" style={{ marginTop: gspace.xs }}>
        Real visits come once the service module is on the server. Delivery is real.
      </GlassText>
    </GlassCard>
  );
}

/**
 * Shown on one side's Home while a job in the other line is in hand: no new
 * offers come here until it is over, and Continue jumps straight back to it.
 */
export function PausedCard({ side }: { side: WorkLine }) {
  const { busy, delivery, visit } = useWorkload();
  if (busy === 'none' || busy === side) return null;
  const onDelivery = busy === 'delivery';
  const p = paletteFor(busy);
  const ref = onDelivery ? delivery?.delivery_order_name : visit?.ref;
  const who = onDelivery ? delivery?.customer_name : visit?.customer_name;
  return (
    <GlassCard style={{ marginTop: gspace.lg, borderColor: p.band, borderWidth: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: gspace.sm }}>
        <GlassIcon name="pause" color={p.band} size={22} />
        <GlassText variant="subtitle" style={{ flex: 1 }}>
          {`Paused while you're on a ${onDelivery ? 'delivery' : 'service visit'}`}
        </GlassText>
      </View>
      <GlassText variant="body" tone="soft" style={{ marginTop: gspace.xs }}>
        New {side === 'service' ? 'service jobs are' : 'deliveries are'} not offered until{' '}
        {ref ?? 'that job'}
        {who ? ` (${who})` : ''} is finished.
      </GlassText>
      <Pressable
        onPress={(e) => {
          const id = onDelivery ? delivery?.delivery_order_id : visit?.id;
          if (id) openJob({ kind: busy, id });
          else switchTo(busy, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
        }}
        accessibilityRole="button"
        style={({ pressed }) => ({
          marginTop: gspace.md,
          backgroundColor: p.band,
          borderRadius: gradius.button,
          paddingVertical: gspace.md,
          alignItems: 'center',
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <GlassText variant="bodyStrong" style={{ color: p.bandInk }}>
          Continue {onDelivery ? 'delivery' : 'service visit'}
        </GlassText>
      </Pressable>
    </GlassCard>
  );
}
