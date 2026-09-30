import { View, ViewStyle } from 'react-native';
import { glass, gradius } from '../../theme/glass';
import { GlassText } from './GlassText';

type Tone = 'orange' | 'navy' | 'green' | 'red' | 'soft';

const STYLE: Record<Tone, { bg: string; fg: string }> = {
  // The "new" chip: the same lime as the button it leads to.
  orange: { bg: glass.accent, fg: glass.accentInk },
  navy: { bg: glass.fill, fg: glass.ink },
  green: { bg: glass.greenSoft, fg: glass.green },
  red: { bg: glass.redSoft, fg: glass.red },
  soft: { bg: glass.fill, fg: glass.inkSoft },
};

/** Small rounded status / count chip — NEW JOB, PAID, COD 12.500, "2". */
export function GlassPill({
  label,
  tone = 'navy',
  bg,
  fg,
  style,
}: {
  label: string;
  tone?: Tone;
  /** Override colours (used by the state band table). */
  bg?: string;
  fg?: string;
  style?: ViewStyle;
}) {
  const c = STYLE[tone];
  const fill = bg ?? c.bg;
  return (
    <View
      style={[
        {
          backgroundColor: fill,
          borderRadius: gradius.pill,
          // A grey chip on a white card has almost no edge, so it gets the
          // card's outline; a coloured one is its own edge.
          borderWidth: 1,
          borderColor:
            fill === glass.fill ? glass.border : fill === glass.accent ? glass.accentLine : fill,
          paddingHorizontal: 8,
          paddingVertical: 4,
          alignSelf: 'flex-start',
        },
        style,
      ]}
    >
      <GlassText
        variant="label"
        nums
        style={{ fontSize: 10, letterSpacing: 0.4, color: fg ?? c.fg }}
      >
        {label}
      </GlassText>
    </View>
  );
}
