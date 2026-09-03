import { ActivityIndicator, Pressable, View, ViewStyle } from 'react-native';
import { glass, gradius, gspace } from '../../theme/glass';
import { GlassIcon, GlassIconName } from './GlassIcon';
import { GlassText } from './GlassText';

type Kind = 'dark' | 'orange' | 'green' | 'indigo' | 'ghost';

const BG: Record<Kind, string> = {
  dark: glass.btnDark,
  orange: glass.orange,
  green: glass.green,
  indigo: glass.indigo,
  ghost: glass.btnGhost,
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
  const fg = kind === 'ghost' ? glass.ink : glass.white;
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
          borderWidth: kind === 'ghost' ? 1 : 0,
          borderColor: glass.border,
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
