import { ActivityIndicator, Pressable, View, ViewStyle } from 'react-native';
import { feedback } from '../../lib/feedback';
import { glass, gradius, gspace } from '../../theme/glass';
import { GlassIcon, GlassIconName } from './GlassIcon';
import { GlassText } from './GlassText';

type Kind = 'dark' | 'orange' | 'green' | 'indigo' | 'ghost' | 'danger';

/**
 * Three looks behind six names.
 *
 * `orange`, `green` and `indigo` were three different primaries — accept, hand
 * over, enter the code. They are one now: the lime fill, which nothing else on
 * a screen uses, so the next thing to press is the one bright shape on it.
 * `dark` is the supporting action, and the two outlines are unchanged.
 */
const PRIMARY: readonly Kind[] = ['orange', 'green', 'indigo'];

const BG: Record<Kind, string> = {
  dark: glass.btnDark,
  orange: glass.accent,
  green: glass.accent,
  indigo: glass.accent,
  ghost: glass.btnGhost,
  // Destructive actions read as an outline, not a solid red slab — signing out
  // is reversible, so it should look serious without looking like a warning.
  danger: glass.btnGhost,
};

/** 52px tall; `sm` is 42 for a button inside a card. */
export function GlassButton({
  title,
  kind = 'dark',
  icon,
  onPress,
  disabled,
  loading,
  size = 'md',
  style,
}: {
  title: string;
  kind?: Kind;
  icon?: GlassIconName;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** 'sm' for a button that sits inside a card, where 52 is too tall. */
  size?: 'sm' | 'md';
  style?: ViewStyle;
}) {
  const primary = PRIMARY.includes(kind);
  const fg =
    kind === 'ghost'
      ? glass.ink
      : kind === 'danger'
        ? glass.red
        : primary
          ? glass.accentInk
          : glass.white;
  // The primary is outlined too: lime against a white card has little edge of
  // its own, and the darker rim is what keeps its shape in glare.
  const outlined = kind === 'ghost' || kind === 'danger' || primary;
  const off = disabled || loading;

  return (
    <Pressable
      // A light tick under the thumb, as the big rider apps give on every main button.
      onPress={
        onPress
          ? () => {
              feedback.tap();
              onPress();
            }
          : undefined
      }
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        {
          backgroundColor: BG[kind],
          borderRadius: gradius.button,
          height: size === 'sm' ? 42 : 52,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: outlined ? 1 : 0,
          borderColor:
            kind === 'danger' ? 'rgba(185,28,28,0.45)' : primary ? glass.accentLine : glass.border,
          opacity: off ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? (
            <View style={{ marginRight: gspace.sm }}>
              <GlassIcon name={icon} color={fg} size={16} />
            </View>
          ) : null}
          <GlassText variant="button" style={{ color: fg, fontSize: size === 'sm' ? 14 : 15 }}>
            {title}
          </GlassText>
        </>
      )}
    </Pressable>
  );
}
