import { ActivityIndicator, Pressable, View, ViewStyle } from 'react-native';
import { glass, gradius, gspace } from '../../theme/glass';
import { GlassIcon, GlassIconName } from './GlassIcon';
import { GlassText } from './GlassText';

type Kind = 'dark' | 'orange' | 'green' | 'indigo' | 'ghost' | 'danger';

const BG: Record<Kind, string> = {
  dark: glass.btnDark,
  orange: glass.orange,
  green: glass.green,
  indigo: glass.indigo,
  ghost: glass.btnGhost,
  // Destructive actions read as an outline, not a solid red slab — signing out
  // is reversible, so it should look serious without looking like a warning.
  danger: glass.btnGhost,
};

/** 52px tall, 18px radius — the template's button spec. */
export function GlassButton({
  title,
  kind = 'dark',
  icon,
  onPress,
  disabled,
  loading,
  style,
}: {
  title: string;
  kind?: Kind;
  icon?: GlassIconName;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const fg = kind === 'ghost' ? glass.ink : kind === 'danger' ? glass.red : glass.white;
  const outlined = kind === 'ghost' || kind === 'danger';
  const off = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        {
          backgroundColor: BG[kind],
          borderRadius: gradius.button,
          height: 52,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: outlined ? 1 : 0,
          borderColor: kind === 'danger' ? 'rgba(185,28,28,0.35)' : glass.border,
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
          <GlassText variant="button" style={{ color: fg }}>
            {title}
          </GlassText>
        </>
      )}
    </Pressable>
  );
}
