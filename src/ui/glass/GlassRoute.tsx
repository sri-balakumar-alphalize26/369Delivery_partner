import { View } from 'react-native';
import { glass, gspace } from '../../theme/glass';
import { GlassText } from './GlassText';

/**
 * The journey, as one rail: collect here, deliver there.
 *
 * A delivery is two places and the order between them, and every rider app
 * draws it this way because it is the thing a rider is actually reading. The
 * job card used to show the shop as a heading with the address underneath
 * behind a dashed rule, which says "two facts about this job" rather than
 * "go here, then here".
 *
 * Indigo for the shop and orange for the customer, matching the map pins and
 * the rest of the job screen — the app already speaks that language, so the
 * rail should not invent a second one.
 *
 * Shared rather than inlined because the card, the offer screen and the job
 * sheet all describe the same journey, and three copies would drift.
 */
export function GlassRoute({
  from,
  fromDetail,
  to,
  toDetail,
  /** Dims the leg already behind the rider, when one end is done with. */
  done,
}: {
  from: string;
  fromDetail?: string;
  to: string;
  toDetail?: string;
  done?: 'from' | null;
}) {
  return (
    <View>
      <Stop
        marker={<Dot />}
        label={from}
        detail={fromDetail}
        dim={done === 'from'}
      />
      <Connector />
      <Stop marker={<Ring />} label={to} detail={toDetail} />
    </View>
  );
}

/**
 * One place, with its marker on the same row as its name.
 *
 * The marker lives inside the row rather than in a rail column spanning both
 * stops — that was the first shape and it put the ring beside the address
 * whenever the two stops had different heights, which is most of the time. A
 * marker in the row it belongs to cannot drift from its label.
 */
function Stop({
  marker,
  label,
  detail,
  dim,
}: {
  marker: React.ReactNode;
  label: string;
  detail?: string;
  dim?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', opacity: dim ? 0.55 : 1 }}>
      {/* Nudged to sit on the cap height of the label beside it. */}
      <View style={{ width: MARKER_W, alignItems: 'center', paddingTop: 6 }}>{marker}</View>

      <View style={{ flex: 1, marginLeft: gspace.md }}>
        <GlassText variant="bodyStrong" numberOfLines={1}>
          {label}
        </GlassText>
        {detail ? (
          <GlassText variant="caption" tone="soft" numberOfLines={2} style={{ marginTop: 1 }}>
            {detail}
          </GlassText>
        ) : null}
      </View>
    </View>
  );
}

/** The width every marker is centred in, so both stops line up exactly. */
const MARKER_W = 12;

function Dot() {
  return (
    <View
      style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: glass.indigo }}
    />
  );
}

/** Open ring: the parcel has not arrived yet. */
function Ring() {
  return (
    <View
      style={{
        width: 11,
        height: 11,
        borderRadius: 6,
        borderWidth: 3,
        borderColor: glass.orange,
        backgroundColor: glass.bg,
      }}
    />
  );
}

/** Short dashes rather than a solid rule — the leg is a journey, not a border. */
function Connector() {
  return (
    <View style={{ width: MARKER_W, alignItems: 'center', paddingVertical: 3 }}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            width: 2,
            height: 3,
            marginVertical: 1.5,
            borderRadius: 1,
            backgroundColor: glass.inkFaint,
          }}
        />
      ))}
    </View>
  );
}
